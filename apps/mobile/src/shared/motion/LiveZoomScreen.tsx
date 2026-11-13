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
  defineAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { supportLog } from "@/features/support/model/support-log";
import { isAndroid } from "@/shared/lib/platform";
import { type LiveZoom, LiveZoomSettledContext, liveZoomOf, releaseLiveZoomHome, resolveZoomOrigin } from "./liveZoom";
import { chatBackHeld, holdPredictiveBack, predictiveBack, watchChatBackHolds } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";

/**
 * The open and close run one LINEAR clock (`visible`, 0 closed .. 1 open); the frame's style eases it.
 * Build 14 (Syed's phone, build 12 videos 97/98): a container transform. The chat is an OPAQUE rounded
 * card that grows out of the tapped element's rect to the full screen (and back into it), with the chat
 * inside fading in over the card's own surface, so home never shows through the chat. The card's clip is
 * two nested translated views (top edge, bottom edge) under one scale: transforms only, on the UI
 * thread, no layout per frame. The curve is critically damped (no overshoot, a gentle first frame).
 */
const OPEN_MS = 270;
const CLOSE_MS = 260;
/** Critical damping: 1 - (1 + kt)e^(-kt), normalised to reach 1 at t = 1 (k = 7.4: within 0.5 % at ~0.7). */
const CRIT_K = 7.4;
const CRIT_NORM = 1 - (1 + CRIT_K) * Math.exp(-CRIT_K);
function crit(t: number): number {
  "worklet";
  return (1 - (1 + CRIT_K * t) * Math.exp(-CRIT_K * t)) / CRIT_NORM;
}
/** The clock value whose eased value is `value` (crit is monotonic): to turn an open into a close mid-way. */
function critInverse(value: number): number {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (crit(mid) < value) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
/** The card itself fades in over this share of the open (out over the close's last share): no hard edge on the row. */
const CARD_FADE_SHARE = 0.1;
/** The chat fades in over the card's opaque surface from this share of the clock, over this share. */
const CONTENT_FADE_FROM = 0.06;
const CONTENT_FADE_SHARE = 0.3;
/**
 * The open clock advances at most this much per drawn frame: a slow frame (the chat's mount, a busy
 * render thread) never skips the open, so its first drawn frame is the start and every frame moves.
 */
const MAX_STEP_MS = 25;
/** The open settles by this at the latest (its deferred work then starts anyway). */
const SETTLE_BOUND_MS = 1200;
/** The card's narrowest start (a pinned tile grows from about its own width), and its widest (a row). */
const MIN_START_SCALE = 0.3;
const MAX_START_SCALE = 0.92;
/** The card's corner on screen at the start, in dp (none once open: the chat fills the screen). */
const START_RADIUS = 24;
/** The predictive gesture: how far it shrinks the chat more, its corner, and how far it shifts it toward the finger. */
const GESTURE_SCALE = 0.1;
const GESTURE_RADIUS = 28;
const GESTURE_SHIFT = 0.06;
/** Build 13: the zoom-open skeleton dissolves into the mounted chat over this long. */
const SHELL_FADE_MS = 160;
/** Home dims at most this much under the open chat. */
const DIM = 0.2;
const SPRING_BACK = { damping: 22, stiffness: 260 };
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
  /** Build 14: 1 while the clock runs the close's curve (the open's mirrored), 0 for the open's. */
  closing: SharedValue<number>,
  /** Build 14: re-finds the element the chat closes into (it may have moved since the open). */
  resolveOrigin: () => void,
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
  const st = useRef<MotionFlags>({ leaving: null, recover: null, gestureOn: false, settled: false }).current;

  const api = useRef({
    /** The open has finished: once, the chat's deferred work may start. */
    opened() {
      // Never during a close: the frosts and deferred content would commit under the moving chat.
      if (st.settled || st.leaving) return;
      st.settled = true;
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
      gesture.set(withSpring(0, SPRING_BACK));
      const done = api.opened;
      // From where the close got to, on the open's curve again (the same eased point, no jump).
      if (closing.get() > 0) {
        visible.set(critInverse(1 - crit(1 - visible.get())));
        closing.set(0);
      }
      visible.set(
        openClock((finished) => {
          "worklet";
          if (finished) scheduleOnRN(done);
        }),
      );
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
        // A repeated Back never waits for the close: the chat pops now.
        api.popNow();
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
      resolveOrigin();
      // From where it is (mid-open, or shrunk by the gesture) to closed, on the close's curve: it leaves
      // at once and lands softly in the element. The same eased point, so a close mid-open does not jump.
      // The gesture's extra shrink and shift go with it, so the card lands exactly on the element.
      const from = closing.get() > 0 ? visible.get() : 1 - critInverse(1 - crit(visible.get()));
      closing.set(1);
      visible.set(from);
      const duration = CLOSE_MS * from;
      if (gesture.get() > 0) gesture.set(withTiming(0, { duration, easing: Easing.out(Easing.quad) }));
      // The worklet callback captures the bare function only, never the api object.
      const done = api.closed;
      visible.set(
        withTiming(0, { duration, easing: Easing.linear }, (finished) => {
          if (finished) scheduleOnRN(done);
        }),
      );
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
        // A screen was pushed over the chat: home is detached under it from now on (LiveZoom.nativeClose).
        // The options re-read it, so the chat's pop takes the normal animation.
        if (!st.leaving && !zoom.nativeClose) {
          zoom.nativeClose = true;
          navigation.setOptions({});
        }
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
  }, [api, navigation, routeKey, st, zoom]);

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
        if (st.gestureOn) gesture.set(progress);
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
  shell,
  children,
}: {
  zoom: LiveZoom;
  routeKey: string;
  /**
   * Build 13 (Syed: "it takes time to open"): the chat's skeleton at its final layout. With it, the
   * route's first commit is only this light shell, so the zoom starts on the tap's next frames; the chat
   * itself mounts right after that first frame (its JS and first commit were what held the open back,
   * ~0.4 s on the phone) under the shell, which dissolves once the chat has laid out.
   */
  shell?: ReactNode;
  children: ReactNode;
}) {
  const background = String(useThemeColor("background") ?? "#000");
  const { width, height } = useWindowDimensions();
  const visible = useSharedValue(0);
  const gesture = useSharedValue(0);
  const edge = useSharedValue(1);
  const closing = useSharedValue(0);
  // The source element's window rect: the open's, then the one a close re-finds.
  const originX = useSharedValue(zoom.origin.x);
  const originY = useSharedValue(zoom.origin.y);
  const originW = useSharedValue(zoom.origin.width);
  const originH = useSharedValue(zoom.origin.height);
  const resolveOrigin = useCallback(() => {
    resolveZoomOrigin(zoom, (rect) => {
      zoom.origin = rect;
      originX.set(rect.x);
      originY.set(rect.y);
      originW.set(rect.width);
      originH.set(rect.height);
    });
  }, [zoom, originX, originY, originW, originH]);
  // One commit, after the open: the chat's frosts and deferred content start then.
  const [settled, setSettled] = useState(false);
  useLiveZoomMotion(routeKey, zoom, () => setSettled(true), visible, gesture, edge, closing, resolveOrigin);
  const [chatShown, setChatShown] = useState(!shell);
  const [shellGone, setShellGone] = useState(!shell);
  const shellOpacity = useSharedValue(1);
  useEffect(() => {
    if (chatShown) return;
    // After the shell's first frame: the chat's mount never delays the open's start.
    const frame = requestAnimationFrame(() => startTransition(() => setChatShown(true)));
    return () => cancelAnimationFrame(frame);
  }, [chatShown]);
  const chatLaidOut = useCallback(() => {
    shellOpacity.set(
      withTiming(0, { duration: SHELL_FADE_MS, easing: Easing.linear }, (finished) => {
        if (finished) scheduleOnRN(setShellGone, true);
      }),
    );
  }, [shellOpacity]);
  const shellStyle = useAnimatedStyle(() => ({ opacity: shellOpacity.get() }));
  // The card's geometry on this frame (all on the UI thread): its scale, the half height of its window
  // in the chat's own coordinates, and its centre on screen.
  const card = useDerivedValue(() => {
    const clock = visible.get();
    const open = closing.get() > 0 ? 1 - crit(1 - clock) : crit(clock);
    const drag = gesture.get();
    const startScale = Math.min(MAX_START_SCALE, Math.max(MIN_START_SCALE, originW.get() / width));
    const scale = startScale + (1 - startScale) * open;
    const half = originH.get() / (2 * startScale) + (height / 2 - originH.get() / (2 * startScale)) * open;
    const centreX = originX.get() + originW.get() / 2;
    const centreY = originY.get() + originH.get() / 2;
    const total = scale * (1 - GESTURE_SCALE * drag);
    return {
      clock,
      open,
      scale: total,
      half: Math.min(height / 2, half),
      x: (centreX - width / 2) * (1 - open) + edge.get() * drag * width * GESTURE_SHIFT,
      y: (centreY - height / 2) * (1 - open),
      // The corner on screen, drawn in the scaled card's own units.
      radius: (START_RADIUS * (1 - open) + GESTURE_RADIUS * drag) / total,
    };
  });
  const cardStyle = useAnimatedStyle(() => {
    const c = card.get();
    return {
      opacity: Math.min(1, c.clock / CARD_FADE_SHARE),
      transform: [{ translateX: c.x }, { translateY: c.y }, { scale: c.scale }],
    };
  });
  // The window's top edge (and its top corners), then its bottom edge (and bottom corners).
  const topClipStyle = useAnimatedStyle(() => {
    const c = card.get();
    return { borderRadius: c.radius, transform: [{ translateY: height / 2 - c.half }] };
  });
  const bottomClipStyle = useAnimatedStyle(() => {
    const c = card.get();
    return { borderRadius: c.radius, transform: [{ translateY: 2 * c.half - height }] };
  });
  // The chat stays where it is on screen inside the moving window; it fades in over the opaque card.
  const contentStyle = useAnimatedStyle(() => {
    const c = card.get();
    return {
      opacity: Math.min(1, Math.max(0, (c.clock - CONTENT_FADE_FROM) / CONTENT_FADE_SHARE)),
      transform: [{ translateY: height / 2 - c.half }],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: DIM * card.get().open }));
  return (
    <View style={styles.fill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.clip, topClipStyle]}>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: background }, bottomClipStyle]}
          >
            {/* While the open runs, the chat is drawn once into a GPU layer and each frame only composites
                it (moved, faded); off once settled, before the frosts and deferred content come on. */}
            <Animated.View renderToHardwareTextureAndroid={!settled} style={[StyleSheet.absoluteFill, contentStyle]}>
              <LiveZoomSettledContext.Provider value={settled}>
                {chatShown ? (
                  shell ? (
                    <View style={styles.fill} onLayout={chatLaidOut}>
                      {children}
                    </View>
                  ) : (
                    children
                  )
                ) : null}
              </LiveZoomSettledContext.Provider>
              {shellGone ? null : (
                <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, shellStyle]}>
                  {shell}
                </Animated.View>
              )}
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * The chat-like route's screen. A route the ColorOS zoom opened (decided by its options before it
 * mounts) draws inside the live zoom frame; any other route renders exactly as before.
 */
export function withLiveZoom<P extends object>(
  Screen: ComponentType<P>,
  /** Build 13: the skeleton a zoom open draws first (route params give the chat's id). */
  Shell?: ComponentType<{ chatId?: string }>,
) {
  function LiveZoomScreen(props: P) {
    const route = useRoute();
    const routeKey = route.key;
    const [zoom] = useState(() => liveZoomOf(routeKey));
    if (!zoom) return <Screen {...props} />;
    const { params } = route;
    const id = !params
      ? undefined
      : "agentId" in params
        ? params.agentId
        : "channelId" in params
          ? params.channelId
          : undefined;
    return (
      <LiveZoomFrame
        zoom={zoom}
        routeKey={routeKey}
        shell={Shell ? <Shell chatId={typeof id === "string" ? id : undefined} /> : undefined}
      >
        <Screen {...props} />
      </LiveZoomFrame>
    );
  }
  return LiveZoomScreen;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  clip: { overflow: "hidden" },
  dim: { backgroundColor: "#000" },
});
