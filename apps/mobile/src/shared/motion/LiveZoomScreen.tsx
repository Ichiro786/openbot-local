import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, StackActions, useIsFocused, useNavigation, useRoute } from "expo-router/react-navigation";
import { useThemeColor } from "heroui-native/hooks";
import { type ComponentType, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BackHandler, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
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

/** ColorOS-like open: emphasized decelerate. The close is the same curve played backwards. */
const OPEN_MS = 300;
const CLOSE_MS = 260;
const OPEN_EASING = Easing.bezier(0.05, 0.7, 0.1, 1);
const CLOSE_EASING = Easing.bezier(0.3, 0, 0.8, 0.15);
/** The open settles by OPEN_MS + this at the latest (its deferred work then starts anyway). */
const SETTLE_SLACK_MS = 250;
/** The chat's scale when closed, and how far the predictive gesture shrinks it more. */
const CLOSED_SCALE = 0.92;
const GESTURE_SCALE = 0.1;
/** How far the gesture shifts the chat toward the finger, as a share of the width. */
const GESTURE_SHIFT = 0.06;
const RADIUS = 28;
/** Home dims at most this much under the open chat. */
const DIM = 0.25;
const SPRING_BACK = { damping: 22, stiffness: 260 };
/**
 * The longest any Back leaves a zoomed chat on top: its pop goes out when the close animation ends,
 * and in any case by then.
 */
export const BACK_HARD_MS = CLOSE_MS + 120;
/** A pop that left the chat on top this long after the hard bound: the chat shows again, Back works again. */
const RECOVER_MS = 300;
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
        withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING }, (finished) => {
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
      if (!activeNow.current) return false;
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
        withTiming(0, { duration: CLOSE_MS, easing: CLOSE_EASING }, (finished) => {
          if (finished) scheduleOnRN(done);
        }),
      );
      return true;
    },
  }).current;

  // The open, two frames after mount: the mount's layout and first draw are done before the first
  // moving frame (the first commit has the rows, B8).
  useEffect(() => {
    const done = api.opened;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        visible.set(
          withTiming(1, { duration: OPEN_MS, easing: OPEN_EASING }, (finished) => {
            if (finished) scheduleOnRN(done);
          }),
        );
      });
    });
    // A slow device or an interrupted open still settles (the frost must come on).
    const bound = setTimeout(done, OPEN_MS + SETTLE_SLACK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(bound);
    };
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
      navigation.addListener("blur", () => api.dropGesture()),
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
        if (st.leaving || !navigation.isFocused()) return;
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
  }, [api, edge, gesture, navigation, predictive, st]);
}

function LiveZoomFrame({ zoom, routeKey, children }: { zoom: LiveZoom; routeKey: string; children: ReactNode }) {
  const background = String(useThemeColor("background") ?? "#000");
  const { width } = useWindowDimensions();
  const visible = useSharedValue(0);
  const gesture = useSharedValue(0);
  const edge = useSharedValue(1);
  // One commit, after the open: the chat's frosts and deferred content start then.
  const [settled, setSettled] = useState(false);
  useLiveZoomMotion(routeKey, () => setSettled(true), visible, gesture, edge);
  const frameStyle = useAnimatedStyle(() => {
    const open = visible.get();
    const drag = gesture.get();
    return {
      opacity: Math.min(1, open * 1.6),
      borderRadius: RADIUS * Math.min(1, Math.max(1 - open, drag) * 2),
      transform: [
        { translateX: edge.get() * drag * width * GESTURE_SHIFT },
        { scale: (CLOSED_SCALE + (1 - CLOSED_SCALE) * open) * (1 - GESTURE_SCALE * drag) },
      ],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: DIM * visible.get() }));
  return (
    <View style={styles.fill}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dim, dimStyle]} />
      <Animated.View
        style={[
          styles.fill,
          styles.frame,
          { backgroundColor: background, transformOrigin: `50% ${Math.max(0, zoom.originY)}px` },
          frameStyle,
        ]}
      >
        <LiveZoomSettledContext.Provider value={settled}>{children}</LiveZoomSettledContext.Provider>
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
    const routeKey = useRoute().key;
    const [zoom] = useState(() => liveZoomOf(routeKey));
    if (!zoom) return <Screen {...props} />;
    return (
      <LiveZoomFrame zoom={zoom} routeKey={routeKey}>
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
