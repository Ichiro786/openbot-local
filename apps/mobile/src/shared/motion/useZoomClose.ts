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
import { markZoomClosing, takeZoomSource, zoomSource } from "./zoomPush";

/**
 * Build 11.2: a zoom-opened chat closes by zooming back into its home row (ZoomCloseOverlay), for
 * every Back that removes it: the header Back, system Back and the edge swipe. On Android 14+ with
 * gesture navigation the predictive back progress drives the shrink, and a cancel leaves the chat.
 * ColorOS motion OFF, reduced motion, iOS, a chat not opened by the zoom: nothing changes (the
 * stack's own pop).
 */
export function useZoomClose(routeKey: string) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { enabled, reduceMotion } = useColorOSMotion();
  const active = isAndroid && enabled && !reduceMotion;
  const held = useSyncExternalStore(watchChatBackHolds, chatBackHeld);
  const zoomed = active && zoomSource(routeKey) !== undefined;
  // A close of this chat is under way (a gesture or a Back): a second Back waits for it.
  const pending = useRef(false);
  const disablePrevention = useRef<() => void>(() => undefined);

  const pop = useRef((action: NavigationAction | null) => {
    pending.current = true;
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

  // Header Back, system Back without progress (3-button, Android 13 and older), anything else that
  // goes back: the removal is held, the still covers the chat, then the chat pops under it.
  disablePrevention.current = usePreventRemove(zoomed, ({ data }) => {
    if (pending.current) return;
    const action = data.action;
    const source = zoomSource(routeKey);
    const back = action.type === "GO_BACK" || action.type === "POP";
    if (!back || !source || zoomClosing()) {
      disablePrevention.current();
      navigation.dispatch(action);
      return;
    }
    pending.current = true;
    void zoomCloseBegin(source, () => pop(action), false).then((handle) => {
      if (handle) {
        handle.commit();
        return;
      }
      // No still: the stack's normal pop.
      disablePrevention.current();
      navigation.dispatch(action);
    });
  });

  // Predictive back (Android 14+, gesture navigation): the gesture holds the close open.
  useEffect(() => {
    if (!active || !predictiveBack) return;
    const module = predictiveBack;
    let gesture: { handle: Promise<ZoomCloseHandle | null>; progress: number } | null = null;
    const subscriptions = [
      module.addListener("onBackStart", () => {
        if (!navigation.isFocused() || pending.current || gesture) return;
        const source = zoomSource(routeKey);
        if (!source || zoomClosing()) return;
        const current = { handle: zoomCloseBegin(source, () => pop(null), true), progress: 0 };
        gesture = current;
        pending.current = true;
        void current.handle.then((handle) => handle?.progress(current.progress));
      }),
      module.addListener("onBackProgress", ({ progress }) => {
        const current = gesture;
        if (!current) return;
        current.progress = progress;
        void current.handle.then((handle) => handle?.progress(current.progress));
      }),
      module.addListener("onBackCancel", () => {
        const current = gesture;
        if (!current) return;
        gesture = null;
        pending.current = false;
        void current.handle.then((handle) => handle?.cancel());
      }),
      module.addListener("onBackInvoke", () => {
        const current = gesture;
        gesture = null;
        if (!current) return;
        void current.handle.then((handle) => {
          if (handle) {
            handle.commit();
            return;
          }
          // No still: the stack's normal pop.
          pending.current = false;
          disablePrevention.current();
          navigation.goBack();
        });
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [active, navigation, pop, routeKey]);

  // The predictive callback is on only while this zoom-opened chat is in front and nothing in it takes
  // Back first; otherwise React Native and react-native-screens handle Back exactly as before.
  const predictive = Boolean(predictiveBack) && zoomed && focused && !held;
  useEffect(() => {
    if (!predictive) return;
    return holdPredictiveBack();
  }, [predictive]);
}
