import type { NativeStackNavigationProp } from "expo-router/native-stack";
import {
  type NavigationAction,
  type ParamListBase,
  useIsFocused,
  useNavigation,
  usePreventRemove,
} from "expo-router/react-navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { isAndroid } from "@/shared/lib/platform";
import { chatBackHeld, holdPredictiveBack, predictiveBack, watchChatBackHolds } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";
import { type ZoomCloseHandle, zoomCloseBegin, zoomClosing } from "./ZoomCloseOverlay";
import { markZoomClosing, takeZoomSource, type ZoomSource, zoomSource } from "./zoomPush";

/**
 * The still capture of a close must answer within this, or Back pops the chat the plain way (and a
 * late still is dropped). Back must always leave the chat.
 */
const BEGIN_MS = 700;
/** A close that has not popped the chat by then is stale: the next Back pops it the plain way. */
const STALE_MS = 2500;

/** zoomCloseBegin, bounded: null on timeout or error; a still that comes later is cancelled. */
function beginWithin(source: ZoomSource, pop: () => void, interactive: boolean): Promise<ZoomCloseHandle | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, BEGIN_MS);
    zoomCloseBegin(source, pop, interactive).then(
      (handle) => {
        if (settled) {
          handle?.cancel();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(handle);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Build 11.2: a zoom-opened chat closes by zooming back into its home row (ZoomCloseOverlay), for
 * every Back that removes it: the header Back, system Back and the edge swipe. On Android 14+ with
 * gesture navigation the predictive back progress drives the shrink, and a cancel leaves the chat.
 * ColorOS motion OFF, reduced motion, iOS, a chat not opened by the zoom: nothing changes (the
 * stack's own pop).
 *
 * Build 11.2 fix (stuck Back): a close that cannot run, never answers, or was cut off (the chat lost
 * focus mid gesture, the native callback was turned off) never holds Back: the close state resets on
 * blur and focus, a stale close is dropped, and Back then pops the chat the plain way.
 */
export function useZoomClose(routeKey: string) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { enabled, reduceMotion } = useColorOSMotion();
  const active = isAndroid && enabled && !reduceMotion;
  const held = useSyncExternalStore(watchChatBackHolds, chatBackHeld);
  const zoomed = active && zoomSource(routeKey) !== undefined;
  // A close of this chat is under way (a gesture or a Back) since `pendingAt`: a second Back waits for it.
  const pending = useRef(false);
  const pendingAt = useRef(0);
  const gesture = useRef<{ handle: Promise<ZoomCloseHandle | null>; progress: number } | null>(null);
  const disablePrevention = useRef<() => void>(() => undefined);

  const startPending = useRef(() => {
    pending.current = true;
    pendingAt.current = Date.now();
  }).current;
  // Drops a close that did not pop the chat: its still (if any) springs away, Back is free again.
  const reset = useRef(() => {
    const current = gesture.current;
    gesture.current = null;
    pending.current = false;
    if (current) void current.handle.then((handle) => handle?.cancel());
  }).current;

  const pop = useRef((action: NavigationAction | null) => {
    startPending();
    takeZoomSource(routeKey);
    markZoomClosing(routeKey);
    // The options function reads the closing mark: the pop takes animation "none" (one frame later,
    // so react-native-screens has the new animation before the screen is removed).
    navigation.setOptions({});
    requestAnimationFrame(() => {
      disablePrevention.current();
      if (action) navigation.dispatch(action);
      else navigation.goBack();
    });
  }).current;

  // The plain pop: prevention off, then the action as the stack would run it.
  const plain = useRef((action: NavigationAction | null) => {
    pending.current = false;
    gesture.current = null;
    disablePrevention.current();
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  }).current;

  // A blur (the agent page, any push over the chat) or a new focus ends any close still under way.
  useEffect(() => {
    const subscriptions = [navigation.addListener("blur", reset), navigation.addListener("focus", reset)];
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
    };
  }, [navigation, reset]);

  // Header Back, system Back without progress (3-button, Android 13 and older), anything else that
  // goes back: the removal is held, the still covers the chat, then the chat pops under it.
  disablePrevention.current = usePreventRemove(zoomed, ({ data }) => {
    const action = data.action;
    if (pending.current) {
      // A close is running: it pops the chat itself. A stale one never will: pop now.
      if (Date.now() - pendingAt.current < STALE_MS) return;
      reset();
      plain(action);
      return;
    }
    const source = zoomSource(routeKey);
    const back = action.type === "GO_BACK" || action.type === "POP";
    if (!back || !source || zoomClosing()) {
      plain(action);
      return;
    }
    startPending();
    void beginWithin(source, () => pop(action), false).then((handle) => {
      if (handle) {
        handle.commit();
        return;
      }
      // No still: the stack's normal pop.
      plain(action);
    });
  });

  // Predictive back (Android 14+, gesture navigation): the gesture holds the close open.
  useEffect(() => {
    if (!active || !predictiveBack) return;
    const module = predictiveBack;
    const subscriptions = [
      module.addListener("onBackStart", () => {
        if (gesture.current && Date.now() - pendingAt.current >= STALE_MS) reset();
        if (!navigation.isFocused() || pending.current || gesture.current) return;
        const source = zoomSource(routeKey);
        if (!source || zoomClosing()) return;
        startPending();
        const current = { handle: beginWithin(source, () => pop(null), true), progress: 0 };
        gesture.current = current;
        void current.handle.then((handle) => handle?.progress(current.progress));
      }),
      module.addListener("onBackProgress", ({ progress }) => {
        const current = gesture.current;
        if (!current) return;
        current.progress = progress;
        void current.handle.then((handle) => handle?.progress(current.progress));
      }),
      module.addListener("onBackCancel", reset),
      module.addListener("onBackInvoke", () => {
        const current = gesture.current;
        gesture.current = null;
        if (!current) {
          // The callback took a Back that this chat did not start (or a cut-off one): never swallow it.
          if (navigation.isFocused() && !pending.current) plain(null);
          return;
        }
        void current.handle.then((handle) => {
          if (handle) {
            handle.commit();
            return;
          }
          // No still: the stack's normal pop.
          plain(null);
        });
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [active, navigation, pop, plain, reset, startPending, routeKey]);

  // The predictive callback is on only while this zoom-opened chat is in front and nothing in it takes
  // Back first; otherwise React Native and react-native-screens handle Back exactly as before.
  const predictive = Boolean(predictiveBack) && zoomed && focused && !held;
  useEffect(() => {
    if (!predictive) return;
    return holdPredictiveBack();
  }, [predictive]);
}
