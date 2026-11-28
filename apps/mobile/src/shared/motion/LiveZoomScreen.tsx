import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, StackActions, useIsFocused, useNavigation, useRoute } from "expo-router/react-navigation";
import { useThemeColor } from "heroui-native/hooks";
import {
  type ComponentType,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  type AnimationCallback,
  type AnimationObject,
  cancelAnimation,
  defineAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useAvatarScale } from "@/features/settings/model/avatar-size";
import { supportLog } from "@/features/support/model/support-log";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { openTraceMark } from "@/shared/lib/open-trace";
import { isAndroid } from "@/shared/lib/platform";
import {
  coverLiveZoomHome,
  type LiveZoom,
  LiveZoomSettledContext,
  liveZoomOf,
  releaseLiveZoomHome,
  resolveZoomAvatar,
  resolveZoomOrigin,
} from "./liveZoom";
import { chatBackHeld, holdPredictiveBack, predictiveBack, watchChatBackHolds } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";

/**
 * Build 14 (Syed's phone, build 12 videos 97/98): a container transform. The chat is an OPAQUE rounded
 * card that grows out of the tapped element's rect to the full screen (and back into it), with the chat
 * inside fading in over the card's own surface, so home never shows through the chat. The card's clip is
 * two nested translated views (top edge, bottom edge) under one scale: transforms only, on the UI
 * thread, no layout per frame. The curve is critically damped (no overshoot, a gentle first frame).
 */
const OPEN_MS = 300;
const CLOSE_MS = 300;
const MORPH_AVATAR_BASE = 128;
/** Critical damping: 1 - (1 + kt)e^(-kt), normalised to reach 1 at t = 1 (k = 7.4: within 0.5 % at ~0.7). */
const CRIT_K = 5.4;
const CRIT_NORM = 1 - (1 + CRIT_K) * Math.exp(-CRIT_K);
function crit(t: number): number {
  "worklet";
  return (1 - (1 + CRIT_K * t) * Math.exp(-CRIT_K * t)) / CRIT_NORM;
}
function mix(from: number, to: number, progress: number): number {
  "worklet";
  return from + (to - from) * progress;
}
type ZoomFrame = {
  open: number;
  scale: number;
  half: number;
  x: number;
  y: number;
  radius: number;
  opacity: number;
  surface: number;
  content: number;
  fill: number;
  avatar: number;
  avatarX: number;
  avatarY: number;
  avatarSize: number;
};

/** The chat fades in over the card's opaque surface from this share of the clock, over this share. */
const CONTENT_FADE_FROM = 0.75;
const CONTENT_FADE_SHARE = 0.25;
/**
 * The open clock advances at most this much per drawn frame: a slow frame (the chat's mount, a busy
 * render thread) never skips the open, so its first drawn frame is the start and every frame moves.
 */
const MAX_STEP_MS = 25;
/** The open settles by this at the latest (its deferred work then starts anyway). */
const SETTLE_BOUND_MS = 1200;
/** The card's corner on screen at the start, in dp (none once open: the chat fills the screen). */
const START_RADIUS = 24;
/**
 * The predictive gesture: how far it shrinks the chat more (at the full swipe, eased so a short swipe
 * already shows home around the card: build 12 video 97 kept it at ~0.99 for the whole drag), its corner,
 * and how far it shifts it toward the finger.
 */
const GESTURE_SCALE = 0.12;
const GESTURE_RADIUS = 32;
const GESTURE_SHIFT = 0;
/** Home dims at most this much under the open chat. */
const DIM = 0.2;
const SPRING_BACK = { stiffness: 1400, damping: 67, mass: 1 };
/**
 * Build 14 (video 97 frames 370-379: the drag stepped at 60 Hz at its start): each progress event (they
 * reach JS at most once a frame, fewer when it is busy) is followed on the UI thread over this long, so
 * the card moves on every 120 Hz frame.
 */
const FOLLOW_MS = 24;
/**
 * The longest any Back leaves a zoomed chat on top: its pop goes out when the close animation ends,
 * and in any case by then.
 */
export const BACK_HARD_MS = CLOSE_MS + 120;
/** A pop that left the chat on top this long after the hard bound: the chat shows again, Back works again. */
const RECOVER_MS = 300;
/**
 * The open clock: from where it is to 1 in OPEN_MS of drawn frames, each frame advancing by its real
 * time but at most MAX_STEP_MS (first frame: 0). Declared before every worklet that uses it.
 */
function openClock(callback: AnimationCallback): number {
  "worklet";
  const animation = defineAnimation<AnimationObject>(1, () => {
    "worklet";
    return {
      onFrame: (animation: { current: number; last: number }, now: number) => {
        const step = animation.last < 0 ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - animation.last));
        animation.last = now;
        animation.current = Math.min(1, animation.current + step / OPEN_MS);
        return animation.current >= 1;
      },
      onStart: (animation: { current: number; last: number }, value: number) => {
        animation.current = Math.max(0, Math.min(1, value));
        animation.last = -1;
      },
      callback,
      // The target, as withTiming's: Reanimated finishes at once an animation whose current equals the value.
      current: 1,
      toValue: 1,
      last: -1,
    };
  });
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: a Reanimated animation object stands in for the value it animates (as withTiming's does).
  return animation as unknown as number;
}
/** Diagnostic (council D18): a header Back soon after a cancelled gesture is logged. */
const CANCEL_LOG_MS = 1500;
let gestureCancelledAt = 0;

/** The Back of each zoomed chat in front, for the header Back (useLeaveChat). */
const chatBacks = new Map<string, () => boolean>();

/** Runs the chat's zoom Back. False when this chat closes the stack's way (not zoomed, ColorOS off). */
export function runChatBack(routeKey: string): boolean {
  return chatBacks.get(routeKey)?.() ?? false;
}

type MotionFlags = {
  /** A Back is taking this chat: whether its pop went out, and its hard bound. */
  leaving: { popped: boolean; timer: ReturnType<typeof setTimeout> } | null;
  recover: ReturnType<typeof setTimeout> | null;
  /** A predictive back gesture is undecided. */
  gestureOn: boolean;
  /** The open has finished once. */
  settled: boolean;
};

/**
 * The open, close and predictive back of a zoomed chat, on its live root. Never holds the route's
 * removal (no usePreventRemove): a Back starts the close and the chat pops itself when it ends, by
 * BACK_HARD_MS at the latest; a second Back pops at once. The pop is this route's own (`source`).
 * Every flag here is reset by focus, a cancel, the hard bound (+ recovery) or unmount.
 */
function useLiveZoomMotion(
  routeKey: string,
  zoom: LiveZoom,
  onSettled: () => void,
  visible: SharedValue<number>,
  gesture: SharedValue<number>,
  edge: SharedValue<number>,
  card: SharedValue<ZoomFrame>,
  closeFrom: SharedValue<ZoomFrame | null>,
  closeProgress: SharedValue<number>,
  /** Build 14: re-finds the element the chat closes into (it may have moved since the open). */
  resolveOrigin: () => void,
  /** Build 14: a close starts: the chat's frosts stop (home's blurs run again). */
  onClosing: () => void,
) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { enabled, reduceMotion } = useColorOSMotion();
  const active = isAndroid && enabled && !reduceMotion;
  const held = useSyncExternalStore(watchChatBackHolds, chatBackHeld);
  const activeNow = useRef(active);
  activeNow.current = active;
  const settledCallback = useRef(onSettled);
  settledCallback.current = onSettled;
  const closingCallback = useRef(onClosing);
  closingCallback.current = onClosing;
  const st = useRef<MotionFlags>({ leaving: null, recover: null, gestureOn: false, settled: false }).current;

  const api = useRef({
    /** The open has finished: once, the chat's deferred work may start. */
    opened() {
      // Never during a close: the frosts and deferred content would commit under the moving chat.
      if (st.settled || st.leaving) return;
      st.settled = true;
      // Build 14: the chat covers home now: home's blurs pause as the chat's frosts start.
      coverLiveZoomHome(routeKey);
      settledCallback.current();
    },
    /** The real pop of this chat; a no-op once the chat is not on top. */
    popNow() {
      const state = navigation.getState();
      if (state.routes[state.index]?.key !== routeKey) return;
      navigation.dispatch({ ...StackActions.pop(), source: routeKey, target: state.key });
    },
    /** The close animation ended: pop once. */
    closed() {
      const current = st.leaving;
      if (!current || current.popped) return;
      current.popped = true;
      api.popNow();
    },
    /** The chat is in front again after a Back (or a pop that did not take it): show it, clear every flag. */
    showAgain() {
      const current = st.leaving;
      st.leaving = null;
      if (current) clearTimeout(current.timer);
      if (st.recover) clearTimeout(st.recover);
      st.recover = null;
      st.gestureOn = false;
      const done = api.opened;
      scheduleOnUI(() => {
        "worklet";
        if (!closeFrom.get()) {
          gesture.set(withSpring(0, SPRING_BACK));
          return;
        }
        closeProgress.set(
          withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }, (finished) => {
            if (!finished) return;
            closeFrom.set(null);
            gesture.set(withSpring(0, SPRING_BACK));
            visible.set(
              openClock((opened) => {
                "worklet";
                if (opened) scheduleOnRN(done);
              }),
            );
          }),
        );
      });
    },
    dropGesture() {
      if (!st.gestureOn) return;
      st.gestureOn = false;
      gesture.set(withSpring(0, SPRING_BACK));
    },
    /** Every Back of a zoomed chat. False: not ours, the caller goes back the usual way. */
    back(): boolean {
      const sinceCancel = Date.now() - gestureCancelledAt;
      if (sinceCancel < CANCEL_LOG_MS)
        supportLog.add(
          "info",
          "app",
          `Chat Back ${sinceCancel} ms after a cancelled back gesture (leaving=${Boolean(st.leaving)}, focused=${navigation.isFocused()})`,
        );
      // ColorOS turned off, or home is no longer under the chat (a screen was pushed over it): the stack's way.
      if (!activeNow.current || zoom.nativeClose) return false;
      if (st.leaving) {
        return true;
      }
      if (!navigation.isFocused()) return false;
      const timer = setTimeout(() => {
        api.closed();
        api.popNow();
        // Defense in depth: a pop that still left the chat on top shows the chat again.
        st.recover = setTimeout(() => {
          st.recover = null;
          const state = navigation.getState();
          if (state.routes[state.index]?.key === routeKey) api.showAgain();
        }, RECOVER_MS);
      }, BACK_HARD_MS);
      st.leaving = { popped: false, timer };
      st.gestureOn = false;
      // Build 14: home's blurs run again under the closing card and the chat's frosts stop (their
      // scrim stands in), so the unmount at the end restarts nothing on home (build 12 video 97: a
      // 34 ms frame there). An open that comes back (showAgain) settles again.
      st.settled = false;
      releaseLiveZoomHome(routeKey);
      closingCallback.current();
      const done = api.closed;
      scheduleOnUI(() => {
        "worklet";
        const from = card.get();
        cancelAnimation(visible);
        cancelAnimation(gesture);
        cancelAnimation(closeProgress);
        closeFrom.set(from);
        closeProgress.set(0);
        closeProgress.set(
          withTiming(1, { duration: Math.max(120, CLOSE_MS * from.open), easing: crit }, (finished) => {
            if (finished) scheduleOnRN(done);
          }),
        );
      });
      resolveOrigin();
      return true;
    },
  }).current;

  // The open, from the mount's commit: the clock was 0 in the first commit (the chat's first drawn frame
  // is the start state) and its frame-clamped steps never skip a slow first frame (the first commit has
  // the rows, B8).
  useEffect(() => {
    const done = api.opened;
    visible.set(
      openClock((finished) => {
        "worklet";
        if (finished) scheduleOnRN(done);
      }),
    );
    // A slow device or an interrupted open still settles (the frost must come on).
    const bound = setTimeout(done, SETTLE_BOUND_MS);
    return () => clearTimeout(bound);
  }, [api, visible]);

  // Header Back reaches the close through runChatBack.
  useEffect(() => {
    const back = () => api.back();
    chatBacks.set(routeKey, back);
    return () => {
      if (chatBacks.get(routeKey) === back) chatBacks.delete(routeKey);
    };
  }, [api, routeKey]);

  // Focus (in front again) resets every flag a Back or a gesture can set; blur drops a gesture;
  // unmount clears the timers and lets home's blurs run again.
  useEffect(() => {
    const subscriptions = [
      navigation.addListener("focus", () => {
        if (st.leaving || st.gestureOn) api.showAgain();
      }),
      navigation.addListener("blur", () => {
        api.dropGesture();
      }),
    ];
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      const current = st.leaving;
      st.leaving = null;
      if (current) clearTimeout(current.timer);
      if (st.recover) clearTimeout(st.recover);
      st.recover = null;
      releaseLiveZoomHome(routeKey);
    };
  }, [api, navigation, routeKey, st]);

  // System Back without the predictive callback (3-button navigation, or while it is off): this
  // listener runs before React Navigation's. Off while a chat listener takes Back first (held).
  const listen = active && focused && !held;
  useEffect(() => {
    if (!listen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => api.back());
    return () => subscription.remove();
  }, [api, listen]);

  // Predictive back (Android 14+, gesture navigation): the live chat follows the finger. Each event
  // only sets a shared value; the frame's style runs on the UI thread.
  const predictive = Boolean(predictiveBack) && listen;
  useEffect(() => {
    if (!predictive || !predictiveBack) return;
    const module = predictiveBack;
    const subscriptions = [
      module.addListener("onBackStart", ({ edge: swipeEdge, progress }) => {
        if (st.leaving || zoom.nativeClose || !navigation.isFocused()) return;
        st.gestureOn = true;
        // BackEventCompat.EDGE_LEFT = 0: the chat moves right, with the finger.
        edge.set(swipeEdge === 0 ? 1 : -1);
        gesture.set(progress);
      }),
      module.addListener("onBackProgress", ({ progress }) => {
        if (st.gestureOn) gesture.set(withTiming(progress, { duration: FOLLOW_MS, easing: Easing.linear }));
      }),
      module.addListener("onBackCancel", () => {
        gestureCancelledAt = Date.now();
        supportLog.add("info", "app", "Back gesture cancelled on a zoomed chat");
        api.dropGesture();
      }),
      module.addListener("onBackInvoke", () => {
        // Never swallowed: a Back the close cannot take goes back the stack's way.
        if (!api.back()) {
          api.dropGesture();
          if (navigation.isFocused() && navigation.canGoBack()) navigation.goBack();
        }
      }),
    ];
    const release = holdPredictiveBack();
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      release();
      api.dropGesture();
    };
  }, [api, edge, gesture, navigation, predictive, st, zoom]);
}

function LiveZoomFrame({
  zoom,
  routeKey,
  agentId,
  children,
}: {
  zoom: LiveZoom;
  routeKey: string;
  agentId?: string;
  children: ReactNode;
}) {
  const background = String(useThemeColor("background") ?? "#000");
  const agent = useMobileWorkspaceSelector((current) =>
    agentId ? current.agents.find((item) => item.id === agentId) : undefined,
  );
  const hasAgent = Boolean(agent);
  const avatarScale = useAvatarScale((state) => state.scale);
  const blobFill = agent ? avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor) : background;
  const { width, height } = useWindowDimensions();
  const visible = useSharedValue(0);
  const gesture = useSharedValue(0);
  const edge = useSharedValue(1);
  const closeFrom = useSharedValue<ZoomFrame | null>(null);
  const closeProgress = useSharedValue(0);
  const originX = useSharedValue(zoom.origin.x);
  const originY = useSharedValue(zoom.origin.y);
  const originW = useSharedValue(zoom.origin.width);
  const originH = useSharedValue(zoom.origin.height);
  const initialClose = zoom.avatarOrigin ?? zoom.origin;
  const closeX = useSharedValue(initialClose.x);
  const closeY = useSharedValue(initialClose.y);
  const closeW = useSharedValue(initialClose.width);
  const closeH = useSharedValue(initialClose.height);
  useEffect(() => {
    if (zoom.avatarOrigin) return;
    resolveZoomAvatar(zoom.chatId, (rect) => {
      zoom.avatarOrigin = rect;
      closeX.set(rect.x);
      closeY.set(rect.y);
      closeW.set(rect.width);
      closeH.set(rect.height);
    });
  }, [zoom, closeX, closeY, closeW, closeH]);
  const resolveOrigin = useCallback(() => {
    const resolved = resolveZoomAvatar(zoom.chatId, (rect) => {
      if (visible.get() < 0.35) return;
      zoom.avatarOrigin = rect;
      closeX.set(rect.x);
      closeY.set(rect.y);
      closeW.set(rect.width);
      closeH.set(rect.height);
    });
    if (resolved) return;
    resolveZoomOrigin(zoom, (rect) => {
      if (visible.get() < 0.35) return;
      zoom.origin = rect;
      originX.set(rect.x);
      originY.set(rect.y);
      originW.set(rect.width);
      originH.set(rect.height);
      if (!zoom.avatarOrigin) {
        closeX.set(rect.x);
        closeY.set(rect.y);
        closeW.set(rect.width);
        closeH.set(rect.height);
      }
    });
  }, [zoom, visible, originX, originY, originW, originH, closeX, closeY, closeW, closeH]);
  // One commit after the open (the chat's frosts start), one at a close's start (they stop).
  const [settled, setSettled] = useState(false);
  const onSettled = useCallback(() => setSettled(true), []);
  const onClosing = useCallback(() => setSettled(false), []);
  const [chatShown, setChatShown] = useState(false);
  useEffect(() => {
    openTraceMark("zoom frame mounted");
  }, []);
  useEffect(() => {
    if (chatShown) return;
    const frame = requestAnimationFrame(() => {
      openTraceMark("chat mount requested");
      startTransition(() => setChatShown(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [chatShown]);
  const card = useDerivedValue(() => {
    const from = closeFrom.get();
    const targetDiameter = Math.min(closeW.get(), closeH.get()) * (hasAgent ? avatarScale : 1);
    const targetCentreX = closeX.get() + closeW.get() / 2;
    const targetCentreY = closeY.get() + closeH.get() / 2;
    const avatarBase = MORPH_AVATAR_BASE * Math.min(1, avatarScale);
    if (from) {
      const t = closeProgress.get();
      const avatarFade = Math.min(1, Math.max(0, (t - 0.18) / 0.34));
      const fillIn = Math.min(1, Math.max(0, (t - 0.14) / 0.24));
      const fillOut = Math.min(1, Math.max(0, 1 - (t - 0.52) / 0.28));
      return {
        open: from.open * (1 - t),
        scale: mix(from.scale, Math.max(0.05, targetDiameter / width), t),
        half: mix(from.half, Math.min(height / 2, width / 2), t),
        x: mix(from.x, targetCentreX - width / 2, t),
        y: mix(from.y, targetCentreY - height / 2, t),
        radius: mix(from.radius, width / 2, t),
        opacity: from.opacity * (hasAgent ? 1 : Math.min(1, (1 - t) / 0.08)),
        surface: from.surface * (hasAgent ? Math.min(1, (1 - t) / 0.2) : 1),
        content: from.content * Math.max(0, 1 - t / 0.14),
        fill: hasAgent ? Math.min(mix(from.fill, 1, fillIn), fillOut) : 0,
        avatar: hasAgent ? mix(from.avatar, 1, avatarFade) : 0,
        avatarX: mix(from.avatarX, 0, t),
        avatarY: mix(from.avatarY, 0, t),
        avatarSize: mix(from.avatarSize, width / avatarBase, t),
      };
    }
    const clock = visible.get();
    const open = crit(clock);
    const drag = 1 - (1 - gesture.get()) ** 3;
    const centreX = originX.get() + originW.get() / 2;
    const centreY = originY.get() + originH.get() / 2;
    const startScale = Math.min(1, Math.max(0.05, originW.get() / width));
    const scale = mix(startScale, 1, open) * (1 - GESTURE_SCALE * drag);
    const half = mix(originH.get() / (2 * startScale), height / 2, open);
    const blob = hasAgent ? 1 - Math.min(1, Math.max(0, (clock - 0.5) / 0.25)) : 0;
    return {
      open,
      scale,
      half: Math.min(height / 2, half),
      x: (centreX - width / 2) * (1 - open) + edge.get() * drag * width * GESTURE_SHIFT,
      y: (centreY - height / 2) * (1 - open),
      radius: (START_RADIUS * (1 - open) + GESTURE_RADIUS * drag) / scale,
      opacity: 1,
      surface: 1,
      content: Math.min(1, Math.max(0, (clock - CONTENT_FADE_FROM) / CONTENT_FADE_SHARE)),
      fill: blob,
      avatar: blob,
      avatarX: ((targetCentreX - centreX) * (1 - open)) / scale,
      avatarY: ((targetCentreY - centreY) * (1 - open)) / scale,
      avatarSize: mix(targetDiameter, width, open) / (avatarBase * scale),
    };
  });
  useLiveZoomMotion(
    routeKey,
    zoom,
    onSettled,
    visible,
    gesture,
    edge,
    card,
    closeFrom,
    closeProgress,
    resolveOrigin,
    onClosing,
  );

  const cardStyle = useAnimatedStyle(() => {
    const c = card.get();
    return {
      opacity: c.opacity,
      transform: [{ translateX: c.x }, { translateY: c.y }, { scale: c.scale }],
    };
  });
  const topClipStyle = useAnimatedStyle(() => {
    const c = card.get();
    return { borderRadius: c.radius, transform: [{ translateY: height / 2 - c.half }] };
  });
  const bottomClipStyle = useAnimatedStyle(() => {
    const c = card.get();
    return { borderRadius: c.radius, transform: [{ translateY: 2 * c.half - height }] };
  });
  const cardSurfaceStyle = useAnimatedStyle(() => ({ opacity: card.get().surface }));
  const contentStyle = useAnimatedStyle(() => {
    const c = card.get();
    return {
      opacity: c.content,
      transform: [{ translateY: height / 2 - c.half }],
    };
  });
  const blobFillStyle = useAnimatedStyle(() => ({ opacity: card.get().fill }));
  const blobAvatarStyle = useAnimatedStyle(() => {
    const c = card.get();
    return {
      opacity: c.avatar,
      transform: [{ translateX: c.avatarX }, { translateY: c.avatarY }, { scale: c.avatarSize }],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({
    backgroundColor: "#000",
    opacity: DIM * card.get().open,
  }));
  return (
    <View style={styles.fill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, dimStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.clip, topClipStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.clip, bottomClipStyle]}>
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: background }, cardSurfaceStyle]}
            />
            <Animated.View renderToHardwareTextureAndroid={!settled} style={[StyleSheet.absoluteFill, contentStyle]}>
              <LiveZoomSettledContext.Provider value={settled}>
                {chatShown ? children : null}
              </LiveZoomSettledContext.Provider>
            </Animated.View>
            {agent ? (
              <Animated.View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: blobFill }, blobFillStyle]}
              />
            ) : null}
          </Animated.View>
        </Animated.View>
        {agent ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.blobOverlay, blobAvatarStyle]}>
            <BloubAvatar
              agentId={agent.id}
              serverId={agent.serverId}
              hue={agent.avatarHue}
              color={agent.avatarColor}
              seed={agent.avatarSeed}
              avatarUrl={agent.avatarUrl}
              size={MORPH_AVATAR_BASE}
              maxScale={1}
              animateIdle={false}
              activityMood="idle"
            />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

/**
 * The chat-like route's screen. A route the ColorOS zoom opened (decided by its options before it
 * mounts) draws inside the live zoom frame; any other route renders exactly as before.
 */
export function withLiveZoom<P extends object>(Screen: ComponentType<P>) {
  function LiveZoomScreen(props: P) {
    const route = useRoute();
    const routeKey = route.key;
    const [zoom] = useState(() => liveZoomOf(routeKey));
    if (!zoom) return <Screen {...props} />;
    const { params } = route;
    const agentId = params && "agentId" in params && typeof params.agentId === "string" ? params.agentId : undefined;
    return (
      <LiveZoomFrame zoom={zoom} routeKey={routeKey} agentId={agentId}>
        <Screen {...props} />
      </LiveZoomFrame>
    );
  }
  return LiveZoomScreen;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: "hidden" },
  blobOverlay: { alignItems: "center", justifyContent: "center" },
});
