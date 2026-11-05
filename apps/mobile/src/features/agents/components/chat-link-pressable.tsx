import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { armLiveZoom } from "@/shared/motion/liveZoom";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

/**
 * Build 11.3 simple zoom: a second tap this soon after a zoom-open is dropped instead of navigating a
 * second time (a plain time, so nothing ever stays blocked).
 */
let lastZoomTapAt = 0;
const ZOOM_TAP_GUARD_MS = 500;

// Link injects its handler here. Defer that exact handler rather than recreating navigation with
// router.push.
export function ChatLinkPressable({
  chatId,
  prefetchServerId,
  onPress,
  onPressIn,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** The chat this row opens. The chat list pane does not open the chat that shows already. */
  chatId?: string;
  /**
   * Build 11: the agent's server. With it, a touch on the row starts reading the agent chat's latest
   * page (the read the chat makes on mount, deduplicated by the store), so the chat is often ready on
   * its first commit.
   */
  prefetchServerId?: string;
}) {
  const conversationStore = useMobileWorkspaceSelector((current) => current.conversationStore);
  const loadConversation = useMobileWorkspaceSelector((current) => current.loadConversation);
  const gate = useContext(ChatNavigationGateContext);
  const pane = useChatListPane();
  const route = useRoute();
  const navigation = useNavigation();
  const mounted = useRef(true);
  const { enabled: colorOS, reduceMotion } = useColorOSMotion();
  // ColorOS motion on Android: the chat zooms open from the row (iOS keeps Link.AppleZoom).
  const zoom = isAndroid && colorOS && !reduceMotion && !pane;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        if (chatId && prefetchServerId && !conversationStore.isUpToDate(chatId))
          void loadConversation(chatId, prefetchServerId).catch(() => undefined);
        onPressIn?.(event);
      }}
      onPress={(event) => {
        if (event.defaultPrevented) return;
        void haptics.impact("soft");
        event.persist();
        // Build 11.3 council A6: a zoom-open navigates even if this row remounted meanwhile (a list
        // refresh or a settings re-render between the tap and the push dropped the open silently).
        // Link's handler pushes through the router, not through this instance.
        const navigate = () => {
          if (mounted.current || zoom) onPress?.(event);
        };
        const go = () => {
          if (pane) openChatFromPane(pane, chatId, navigate);
          else if (gate && route.name === "connected") gate.request(navigate, navigation.isFocused);
          else navigate();
        };
        if (!zoom) {
          go();
          return;
        }
        if (Date.now() - lastZoomTapAt < ZOOM_TAP_GUARD_MS) return;
        lastZoomTapAt = Date.now();
        // The chat grows from the tapped row's height (LiveZoomScreen).
        armLiveZoom(event.nativeEvent.pageY);
        go();
      }}
    />
  );
}
