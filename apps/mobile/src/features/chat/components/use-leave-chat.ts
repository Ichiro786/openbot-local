import { router } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, StackActions, useNavigation, useRoute } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { logBack, registerBackFlags } from "@/shared/debug/backDebug";
import { runChatBack } from "@/shared/motion/useZoomClose";

/**
 * Build 11.3: how long one close holds the next Back. A close that has not taken the chat off the
 * screen by then (a Back that something swallowed, a transition that never reported its end) never
 * holds Back again.
 */
const HOLD_MS = 300;
/**
 * Build 11.3: a Back that has left the chat on top this long pops it once more, the plain way (Syed:
 * Back still stuck with a 1.2 s retry; a Back must leave within ~300 ms for any reason).
 */
const RETRY_MS = 300;

/**
 * Leaves the chat, once. A swipe back can close the chat while Back is pressed. Two closes put the
 * native stack out of step with JS, so Back does nothing while the chat closes.
 *
 * Build 11.3 fix (Back stuck on the real phone): the "closing" mark was a plain flag that only a
 * transition event cleared. A Back whose pop never happened (or a closing transition with no end)
 * left it set, and every later header Back and edge swipe did nothing. It is now a time: it holds a
 * second Back for at most HOLD_MS, a focus clears it, the pop is this route's own (a late second
 * Back can never pop the screen under the chat), and a Back that left the chat on top is sent again.
 */
export function useLeaveChat(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const route = useRoute();
  const closingAt = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () =>
      registerBackFlags("leave", () => ({
        latchAgoMs: closingAt.current ? Date.now() - closingAt.current : null,
        retryArmed: retry.current !== null,
      })),
    [],
  );
  useEffect(() => {
    const clear = () => {
      closingAt.current = 0;
    };
    const unsubscribes = [
      navigation.addListener("transitionStart", (event) => {
        if (event.data.closing) closingAt.current = Date.now();
      }),
      navigation.addListener("transitionEnd", (event) => {
        if (!event.data.closing) clear();
      }),
      navigation.addListener("gestureCancel", clear),
      navigation.addListener("focus", clear),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      if (retry.current) clearTimeout(retry.current);
    };
  }, [navigation]);
  return useCallback(() => {
    // Build 11.3 zoomfix: a zoom-opened chat (ColorOS on) closes by its zoom, bounded in useZoomClose.
    if (runChatBack(route.key)) {
      void KeyboardController.dismiss();
      return;
    }
    if (Date.now() - closingAt.current < HOLD_MS) {
      logBack("header tap", `latched ${Date.now() - closingAt.current} ms`);
      return;
    }
    logBack("header tap", `goBack canGoBack=${router.canGoBack()} route=${route.key}`);
    closingAt.current = Date.now();
    void KeyboardController.dismiss();
    if (!router.canGoBack()) {
      router.replace("/connected");
      return;
    }
    navigation.goBack();
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      retry.current = null;
      // Still on top: the first Back was swallowed. This one meets no close in progress (useZoomClose
      // pops a repeated Back the plain way), so the chat leaves.
      const state = navigation.getState();
      if (state.routes[state.index]?.key !== route.key) return;
      logBack("header retry fired", `top ${state.routes[state.index]?.name}; pop dispatched`);
      closingAt.current = Date.now();
      navigation.dispatch({ ...StackActions.pop(), source: route.key, target: state.key });
    }, RETRY_MS);
  }, [navigation, route.key]);
}
