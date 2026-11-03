import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable, type ViewInstance } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { zoomOpen } from "@/shared/motion/ZoomOpenOverlay";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

// Link injects its handler here. Defer that exact handler rather than recreating navigation with
// router.push.
export function ChatLinkPressable({
  chatId,
  onPress,
  ref,
  ...props
}: ComponentProps<typeof Pressable> & {
  /** The chat this row opens. The chat list pane does not open the chat that shows already. */
  chatId?: string;
}) {
  const gate = useContext(ChatNavigationGateContext);
  const pane = useChatListPane();
  const route = useRoute();
  const navigation = useNavigation();
  const mounted = useRef(true);
  const self = useRef<ViewInstance | null>(null);
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
          if (!width || !height || !zoomOpen({ x, y, width, height }, go, 0)) go();
        });
      }}
    />
  );
}
