import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, StackActions, useIsFocused, useNavigation } from "expo-router/react-navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { BackHandler } from "react-native";
import { isAndroid } from "@/shared/lib/platform";
import { chatBackHeld, holdPredictiveBack, predictiveBack, watchChatBackHolds } from "./predictiveBack";
import { useColorOSMotion } from "./useColorOSMotion";
import { type ZoomCloseHandle, zoomCloseStart } from "./ZoomCloseOverlay";
import { markZoomClosing, unmarkZoomClosing, zoomOpenHolding, zoomOpenReverse, zoomSource } from "./zoomPush";

/**
 * Build 11.3 zoomfix: the longest any Back leaves a zoom-opened chat on top. Whatever happens to the
 * still, the row or the animation, the chat's pop is dispatched by then (the close normally pops it
 * within a frame or STILL_WAIT_MS).
 */
export const BACK_HARD_MS = 250;

/** The zoom Back of each zoom-opened chat in front, for the header Back (useLeaveChat). */
const chatBacks = new Map<string, () => boolean>();

/** Runs the chat's zoom-close Back. False when this chat closes the stack's way (not zoom-opened, ColorOS off). */
export function runChatBack(routeKey: string): boolean {
  return chatBacks.get(routeKey)?.() ?? false;
}

/**
 * Build 11.2: a zoom-opened chat closes by zooming back into its home row (ZoomCloseOverlay), for the
 * header Back, system Back and the predictive back gesture (whose progress drives the shrink; a cancel
 * leaves the chat). ColorOS motion OFF, reduced motion, iOS, a chat not opened by the zoom: nothing
 * changes (the stack's own pop).
 *
 * Build 11.3 zoomfix (Back stuck on Syed's Android 17 phone after a settings change; every build that
 * held the chat's removal got stuck, the build without the hold did not): the chat never holds its
 * removal any more (no usePreventRemove). Each Back is taken where it starts (the header Back, a
 * BackHandler listener, the predictive callback), a close starts at once (visual only), and the chat
 * pops itself: when the still is up, else after STILL_WAIT_MS, and in any case BACK_HARD_MS after the
 * Back. A second Back pops at once. The pop is this route's own (`source`), so it can never pop the
 * screen under the chat.
 */
export function useZoomClose(routeKey: string) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const focused = useIsFocused();
  const { enabled, reduceMotion } = useColorOSMotion();
  const active = isAndroid && enabled && !reduceMotion;
  const held = useSyncExternalStore(watchChatBackHolds, chatBackHeld);
  const zoomed = active && zoomSource(routeKey) !== undefined;
  const activeNow = useRef(active);
  activeNow.current = active;
  /** A Back is taking this chat: whether its pop went out, and its hard bound. */
  const leaving = useRef<{ popped: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** The predictive gesture's close while the gesture is undecided. */
  const gesture = useRef<ZoomCloseHandle | null>(null);

  const api = useRef({
    /** The real pop of this chat, at most once per Back; a no-op once the chat is not on top. */
    popNow() {
      const current = leaving.current;
      if (current) {
        if (current.popped) return;
        current.popped = true;
      }
      const state = navigation.getState();
      if (state.routes[state.index]?.key !== routeKey) return;
      navigation.dispatch({ ...StackActions.pop(), source: routeKey, target: state.key });
    },
    /** Ends a Back that did not take the chat (the chat is in front again). */
    clearLeaving() {
      const current = leaving.current;
      leaving.current = null;
      if (current) clearTimeout(current.timer);
      if (unmarkZoomClosing(routeKey)) navigation.setOptions({});
    },
    dropGesture() {
      const current = gesture.current;
      gesture.current = null;
      current?.cancel();
    },
    /** Every Back of a zoom-opened chat. False: not ours, the caller goes back the usual way. */
    back(): boolean {
      if (!activeNow.current) return false;
      const source = zoomSource(routeKey);
      if (!source) return false;
      if (leaving.current) {
        // A repeated Back never waits for the close: the chat pops now.
        const current = leaving.current;
        current.popped = false;
        api.popNow();
        return true;
      }
      if (!navigation.isFocused()) return false;
      const timer = setTimeout(() => {
        const current = leaving.current;
        if (current) current.popped = false;
        api.popNow();
      }, BACK_HARD_MS);
      leaving.current = { popped: false, timer };
      // Build 11.3 motion: still under the open's surface, the surface itself shrinks back into the row.
      const handle = gesture.current ?? (zoomOpenReverse() ? null : zoomCloseStart(source, false));
      gesture.current = null;
      // The pop takes animation "none": the overlay plays the close. The options function reads the mark.
      markZoomClosing(routeKey);
      navigation.setOptions({});
      if (!handle) {
        requestAnimationFrame(() => api.popNow());
        return true;
      }
      // One frame after the options change, so react-native-screens has "none" before the removal.
      handle.commit(() => requestAnimationFrame(() => api.popNow()));
      return true;
    },
  }).current;

  // Header Back reaches the close through runChatBack.
  useEffect(() => {
    const back = () => api.back();
    chatBacks.set(routeKey, back);
    return () => {
      if (chatBacks.get(routeKey) === back) chatBacks.delete(routeKey);
    };
  }, [api, routeKey]);

  // Focus (in front again: a push over it closed, or a Back did not take it) and blur reset every
  // flag a Back can set; unmount clears the hard bound and any gesture close.
  useEffect(() => {
    const subscriptions = [
      navigation.addListener("focus", () => {
        api.dropGesture();
        api.clearLeaving();
      }),
      navigation.addListener("blur", () => api.dropGesture()),
    ];
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe();
      api.dropGesture();
      const current = leaving.current;
      leaving.current = null;
      if (current) clearTimeout(current.timer);
    };
  }, [api, navigation]);

  // System Back without the predictive callback (3-button navigation, or while the callback is off):
  // this listener runs before React Navigation's. Off while a chat listener takes Back first (held).
  const listen = zoomed && focused && !held;
  useEffect(() => {
    if (!listen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => api.back());
    return () => subscription.remove();
  }, [api, listen]);

  // Predictive back (Android 14+, gesture navigation): the gesture's progress shrinks the still.
  const predictive = Boolean(predictiveBack) && listen;
  useEffect(() => {
    if (!predictive || !predictiveBack) return;
    const module = predictiveBack;
    const subscriptions = [
      module.addListener("onBackStart", ({ edge }) => {
        api.dropGesture();
        // Build 11.3 motion: no preview of a chat still under the open's surface (it flashed the chat for
        // a frame); the Back reverses the open instead.
        if (leaving.current || !navigation.isFocused() || zoomOpenHolding()) return;
        const source = zoomSource(routeKey);
        if (source) gesture.current = zoomCloseStart(source, true, edge);
      }),
      module.addListener("onBackProgress", ({ progress }) => gesture.current?.progress(progress)),
      module.addListener("onBackCancel", () => api.dropGesture()),
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
  }, [api, navigation, predictive, routeKey]);
}
