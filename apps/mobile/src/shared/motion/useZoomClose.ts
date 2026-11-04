import type { NativeStackNavigationProp } from "expo-router/native-stack";
import {
  type NavigationAction,
  type ParamListBase,
  StackActions,
  useIsFocused,
  useNavigation,
  usePreventRemove,
} from "expo-router/react-navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { logBack, registerBackFlags } from "@/shared/debug/backDebug";
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
/**
 * Build 11.3 (Back still stuck on Syed's Android 17 phone with the 11.3 fix): any Back that has not
 * taken the chat off the top of the stack within this, for any reason, pops it the plain way.
 */
export const BACK_WATCHDOG_MS = 300;
/**
 * Build 11.3 option B (Back still stuck on Syed's Android 17 phone, not reproduced on the emulator):
 * false = no Back ever runs the zoom-close. The chat holds no removal and no predictive callback, so
 * header Back, system Back and the edge swipe are the stack's own plain pop (normal pop animation).
 * true = build 11.2/11.3 zoom-close with the watchdog.
 */
export const ZOOM_CLOSE_ON_BACK = false;

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
 *
 * Build 11.3 fix (Back still stuck at random on the phone): no Back ever waits for a close. A Back that
 * comes while a close is under way (or after one that never ended) drops it and pops the chat the
 * plain way at once, and a system Back the callback did not start pops it too. Each close carries an
 * epoch: a close that was dropped never pops later (no second pop of the screen below) and its still
 * springs away.
 */
export function useZoomClose(routeKey: string) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { enabled, reduceMotion } = useColorOSMotion();
  const active = isAndroid && enabled && !reduceMotion;
  const held = useSyncExternalStore(watchChatBackHolds, chatBackHeld);
  const zoomed = ZOOM_CLOSE_ON_BACK && active && zoomSource(routeKey) !== undefined;
  // A close of this chat is under way (a gesture or a Back). Build 11.3: a second Back never waits for it.
  const pending = useRef(false);
  // Build 11.3: bumped whenever a close is dropped or the chat pops the plain way; a close whose epoch
  // is old never pops (its still is cancelled).
  const epoch = useRef(0);
  const gesture = useRef<{ handle: Promise<ZoomCloseHandle | null>; progress: number } | null>(null);
  const disablePrevention = useRef<() => void>(() => undefined);

  const startPending = useRef(() => {
    pending.current = true;
    epoch.current += 1;
    return epoch.current;
  }).current;
  // Drops a close that did not pop the chat: its still (if any) springs away, Back is free again.
  const reset = useRef(() => {
    const current = gesture.current;
    gesture.current = null;
    pending.current = false;
    epoch.current += 1;
    if (current) void current.handle.then((handle) => handle?.cancel());
  }).current;

  const pop = useRef((action: NavigationAction | null) => {
    const mine = startPending();
    takeZoomSource(routeKey);
    markZoomClosing(routeKey);
    // The options function reads the closing mark: the pop takes animation "none" (one frame later,
    // so react-native-screens has the new animation before the screen is removed).
    navigation.setOptions({});
    requestAnimationFrame(() => {
      // A plain pop (a repeated Back) already took the chat: never pop a second time.
      if (epoch.current !== mine) return;
      disablePrevention.current();
      if (action) navigation.dispatch(action);
      else navigation.goBack();
    });
  }).current;

  // The plain pop: prevention off, then the action as the stack would run it.
  const plain = useRef((action: NavigationAction | null) => {
    pending.current = false;
    gesture.current = null;
    epoch.current += 1;
    disablePrevention.current();
    if (action) navigation.dispatch(action);
    else navigation.goBack();
  }).current;

  // Build 11.3 watchdog: whatever swallowed the Back (a close that never popped, a still that never
  // came, a removal held by a stale prevention), the chat leaves BACK_WATCHDOG_MS after the Back.
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useRef(() => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => {
      watchdog.current = null;
      const state = navigation.getState();
      if (state.routes[state.index]?.key !== routeKey) return;
      logBack("watchdog fired", `${routeKey}; pop dispatched`);
      reset();
      disablePrevention.current();
      navigation.dispatch({ ...StackActions.pop(), source: routeKey, target: state.key });
    }, BACK_WATCHDOG_MS);
  }).current;
  useEffect(
    () => () => {
      if (watchdog.current) clearTimeout(watchdog.current);
    },
    [],
  );

  const zoomedNow = useRef(zoomed);
  zoomedNow.current = zoomed;
  // Build 11.3 Back debug: this chat's lifecycle and Back flags (no-op while Back debug is off).
  useEffect(() => {
    logBack("chat mount", routeKey);
    const unregister = registerBackFlags("chat", () => ({
      key: routeKey,
      focused: navigation.isFocused(),
      zoomed: zoomedNow.current,
      pending: pending.current,
      epoch: epoch.current,
      gesture: gesture.current !== null,
      watchdog: watchdog.current !== null,
    }));
    const subscriptions = [
      navigation.addListener("beforeRemove", (e) => logBack("beforeRemove", `${routeKey} ${e.data.action.type}`)),
      navigation.addListener("focus", () => logBack("chat focus", routeKey)),
      navigation.addListener("blur", () => logBack("chat blur", routeKey)),
      navigation.addListener("transitionStart", (e) => logBack("transitionStart", `closing=${e.data.closing}`)),
      navigation.addListener("transitionEnd", (e) => logBack("transitionEnd", `closing=${e.data.closing}`)),
      navigation.addListener("gestureCancel", () => logBack("gestureCancel", routeKey)),
    ];
    return () => {
      unregister();
      for (const unsubscribe of subscriptions) unsubscribe();
      logBack("chat unmount", routeKey);
    };
  }, [navigation, routeKey]);

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
    logBack("prevented", `${action.type} pending=${pending.current}`);
    if (action.type === "GO_BACK" || action.type === "POP") arm();
    if (pending.current) {
      // Build 11.3: a Back while a close is under way (or one that never ended) never waits for it:
      // the close is dropped (its still springs away) and the chat pops now.
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
    const mine = startPending();
    void beginWithin(source, () => pop(action), false).then((handle) => {
      if (epoch.current !== mine) {
        // Dropped meanwhile (a repeated Back popped the chat, a blur): this close never pops.
        handle?.cancel();
        return;
      }
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
    if (!ZOOM_CLOSE_ON_BACK || !active || !predictiveBack) return;
    const module = predictiveBack;
    const subscriptions = [
      module.addListener("onBackStart", () => {
        // Build 11.3: a gesture left over from a start with no end never blocks the new one.
        if (gesture.current) reset();
        if (!navigation.isFocused() || pending.current) return;
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
        if (navigation.isFocused()) arm();
        const current = gesture.current;
        gesture.current = null;
        if (!current) {
          // The callback took a Back that this chat did not start (or a cut-off one): never swallow it.
          // Build 11.3: a close under way (a header Back) is dropped and the chat pops now.
          if (navigation.isFocused()) {
            reset();
            plain(null);
          }
          return;
        }
        const mine = epoch.current;
        void current.handle.then((handle) => {
          if (epoch.current !== mine) {
            handle?.cancel();
            return;
          }
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
  }, [active, navigation, pop, plain, reset, startPending, routeKey, arm]);

  // The predictive callback is on only while this zoom-opened chat is in front and nothing in it takes
  // Back first; otherwise React Native and react-native-screens handle Back exactly as before.
  const predictive = Boolean(predictiveBack) && zoomed && focused && !held;
  useEffect(() => {
    if (!predictive) return;
    return holdPredictiveBack();
  }, [predictive]);
}
