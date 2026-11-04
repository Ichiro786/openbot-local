import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable, type ViewInstance } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { snapshotNavigator } from "@/shared/motion/ColorOSMotionRoot";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { zoomOpen } from "@/shared/motion/ZoomOpenOverlay";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

// Link injects its handler here. Defer that exact handler rather than recreating navigation with
// router.push.
export function ChatLinkPressable({
  chatId,
  prefetchServerId,
  onPress,
  onPressIn,
  ref,
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
  const self = useRef<ViewInstance | null>(null);
  // Build 11.2: a recycled list row can show another chat by the time the opened one closes.
  const shownChat = useRef(chatId);
  shownChat.current = chatId;
  const { enabled: colorOS, reduceMotion } = useColorOSMotion();
  // ColorOS motion on Android: the row zooms open into the chat (iOS keeps Link.AppleZoom).
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
      ref={(node: ViewInstance | null) => {
        self.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref && "current" in ref) ref.current = node;
      }}
      onPressIn={(event) => {
        if (chatId && prefetchServerId && !conversationStore.isUpToDate(chatId))
          void loadConversation(chatId, prefetchServerId).catch(() => undefined);
        onPressIn?.(event);
      }}
      onPress={(event) => {
        if (event.defaultPrevented) return;
        void haptics.impact("soft");
        event.persist();
        const navigate = () => {
          if (mounted.current) onPress?.(event);
        };
        const go = () => {
          if (pane) openChatFromPane(pane, chatId, navigate);
          else if (gate && route.name === "connected") gate.request(navigate, navigation.isFocused);
          else navigate();
        };
        const node = self.current;
        if (!zoom || !node) {
          go();
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          if (!width || !height) {
            go();
            return;
          }
          // Build 11.2: the close zooms back into this row: it re-measures the row then, and shows a
          // still of this screen behind the chat while a predictive back gesture is undecided.
          const openedChat = chatId;
          const source = {
            skeletonKey: chatId,
            home: snapshotNavigator(),
            measure: (done: (rect: { x: number; y: number; width: number; height: number } | null) => void) => {
              const row = self.current;
              if (!mounted.current || !row || shownChat.current !== openedChat) {
                done(null);
                return;
              }
              row.measureInWindow((rx, ry, rw, rh) => done(rw && rh ? { x: rx, y: ry, width: rw, height: rh } : null));
            },
          };
          if (!zoomOpen({ x, y, width, height }, go, 0, source)) {
            void source.home.then((image) => image?.dispose());
            go();
          }
        });
      }}
    />
  );
}
