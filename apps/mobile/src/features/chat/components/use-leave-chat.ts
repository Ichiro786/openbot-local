import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation, useRoute } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { backOrConnected } from "@/shared/lib/back-or-connected";
import { openTraceMark, openTraceStart } from "@/shared/lib/open-trace";
import { useCloseScreen } from "@/shared/lib/use-close-screen";
import { runChatBack } from "@/shared/motion/LiveZoomScreen";

const HOLD_MS = 300;
const RETRY_MS = 300;

export function useLeaveChat(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const route = useRoute();
  const closingAt = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const clear = () => {
      closingAt.current = 0;
    };
    const unsubscribes = [
      navigation.addListener("transitionStart", (event) => {
        if (event.data.closing) closingAt.current = Date.now();
      }),
      navigation.addListener("transitionEnd", (event) => {
        openTraceMark(`transitionEnd (closing: ${event.data.closing})`);
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
  const closeChat = useCloseScreen(backOrConnected);
  return useCallback(() => {
    openTraceStart("chat back");
    // Build 11.3 zoomfix: a zoom-opened chat (ColorOS on) closes by its zoom, bounded in LiveZoomScreen.
    if (runChatBack(route.key)) {
      void KeyboardController.dismiss();
      return;
    }
    if (Date.now() - closingAt.current < HOLD_MS) return;
    closingAt.current = Date.now();
    void KeyboardController.dismiss();
    closeChat();
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => {
      retry.current = null;
      // Still on top: the first Back was swallowed. This one meets no close in progress (LiveZoomScreen
      // pops a repeated Back the plain way), so the chat leaves, with the routes above it.
      const state = navigation.getState();
      if (state.routes[state.index]?.key !== route.key) return;
      closingAt.current = Date.now();
      closeChat();
    }, RETRY_MS);
  }, [navigation, route.key, closeChat]);
}
