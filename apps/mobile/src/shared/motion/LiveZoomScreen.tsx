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
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { supportLog } from "@/features/support/model/support-log";
import { isAndroid } from "@/shared/lib/platform";
import { type LiveZoom, LiveZoomSettledContext, liveZoomOf, releaseLiveZoomHome } from "./liveZoom";
import { chatBackHeld, holdPredictiveBack, predictiveBack, watchChatBackHolds } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";

/**
 * The open and close run one LINEAR clock (`visible`, 0 closed .. 1 open); the frame's style eases it.
 * The open's ease starts gently (no 60%-in-one-frame jump, the #97 "just appears"), never overshoots,
 * and the close is the same clock run backwards: the exact reverse, accelerating back into the row.
 */
const OPEN_MS = 360;
const CLOSE_MS = 300;
const EASE = Easing.bezierFn(0.2, 0, 0, 1);
/** The chat fades in over this share of the open's time (and out over the close's last share). */
const FADE_SHARE = 0.4;
/**
 * The open clock advances at most this much per drawn frame: a slow frame (the chat's mount, a busy
 * render thread) never skips the open, so its first drawn frame is the start and every frame moves.
 */
const MAX_STEP_MS = 25;
/** The open settles by this at the latest (its deferred work then starts anyway). */
const SETTLE_BOUND_MS = 1200;
/** The chat's scale when closed (around the tapped row), and how far the predictive gesture shrinks it more. */
const CLOSED_SCALE = 0.86;
const GESTURE_SCALE = 0.1;
/** How far the gesture shifts the chat toward the finger, as a share of the width. */
const GESTURE_SHIFT = 0.06;
/** When closed, the chat's centre sits this share of the way from the screen's centre to the row. */
const ROW_PULL = 0.3;
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
      // From where it is (mid-open, or shrunk by the gesture, which it keeps) to closed. The worklet
      // callback captures the bare function only, never the api object.
      const done = api.closed;
      visible.set(
        withTiming(0, { duration: CLOSE_MS * visible.get(), easing: Easing.linear }, (finished) => {
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
  const pull = (Math.max(0, zoom.originY) - height / 2) * ROW_PULL;
  const visible = useSharedValue(0);
  const gesture = useSharedValue(0);
  const edge = useSharedValue(1);
  // One commit, after the open: the chat's frosts and deferred content start then.
  const [settled, setSettled] = useState(false);
  useLiveZoomMotion(routeKey, zoom, () => setSettled(true), visible, gesture, edge);
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
  const frameStyle = useAnimatedStyle(() => {
    const clock = visible.get();
    const open = EASE(clock);
    const drag = gesture.get();
    // Transform and opacity only (no animated corner radius: no clip re-render while it moves).
    return {
      opacity: Math.min(1, clock / FADE_SHARE),
      transform: [
        { translateX: edge.get() * drag * width * GESTURE_SHIFT },
        { translateY: (1 - open) * pull },
        { scale: (CLOSED_SCALE + (1 - CLOSED_SCALE) * open) * (1 - GESTURE_SCALE * drag) },
      ],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: DIM * EASE(visible.get()) }));
  return (
    <View style={styles.fill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      {/* While the open runs, the chat is drawn once into a GPU layer and each frame only composites it
          (scaled, faded); off once settled, before the frosts and deferred content come on. */}
      <Animated.View
        renderToHardwareTextureAndroid={!settled}
        style={[
          styles.fill,
          styles.frame,
          { backgroundColor: background, transformOrigin: `50% ${Math.max(0, zoom.originY)}px` },
          frameStyle,
        ]}
      >
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
  frame: { overflow: "hidden" },
  dim: { backgroundColor: "#000" },
});
