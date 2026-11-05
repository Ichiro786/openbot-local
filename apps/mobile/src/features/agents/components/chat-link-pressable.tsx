import { useNavigation, useRoute } from "expo-router/react-navigation";
import { type ComponentProps, createContext, useContext, useEffect, useRef } from "react";
import { Pressable, type ViewInstance } from "react-native";
import { openChatFromPane, useChatListPane } from "@/features/agents/components/chat-list-pane-context";
import type { createChatNavigationGate } from "@/features/agents/model/chat-navigation-gate";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { snapshotNavigator } from "@/shared/motion/ColorOSMotionRoot";
import { predictiveBack } from "@/shared/motion/predictiveBack";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { zoomCovering, zoomOpen } from "@/shared/motion/ZoomOpenOverlay";
import { measureZoomRow, registerZoomRow } from "@/shared/motion/zoomPush";

export const ChatNavigationGateContext = createContext<ReturnType<typeof createChatNavigationGate> | null>(null);

/**
 * Build 11.3 batch 1 (F05): the tap whose row is being measured for a zoom-open (0: none). Reserved
 * at the tap, before the async measure, so a second tap while it measures (or while a zoom is up) is
 * dropped instead of navigating a second time. A measure that never answers frees it after the bound.
 */
let measuringTap = 0;
let tapSeq = 0;
const MEASURE_BOUND_MS = 400;

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
  // Build 11.3 zoomfix: the close finds this chat's row here even after the row it opened from remounted.
  useEffect(() => (zoom && chatId ? registerZoomRow(chatId, self) : undefined), [zoom, chatId]);

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
        if (measuringTap || zoomCovering()) return;
        const tap = ++tapSeq;
        measuringTap = tap;
        const settle = () => {
          if (measuringTap !== tap) return false;
          measuringTap = 0;
          clearTimeout(bound);
          return true;
        };
        const bound = setTimeout(() => {
          if (settle() && navigation.isFocused()) go();
        }, MEASURE_BOUND_MS);
        node.measureInWindow((x, y, width, height) => {
          // A zoom another row started meanwhile owns this open (its tap navigates once).
          if (!settle() || zoomCovering()) return;
          // The screen lost focus while measuring: no zoom; the home gate still waits for its focus.
          if (!navigation.isFocused()) {
            if (gate && route.name === "connected") go();
            return;
          }
          if (!width || !height) {
            go();
            return;
          }
          // Build 11.2: the close zooms back into this row: it re-measures the row then, and shows a
          // still of this screen behind the chat while a predictive back gesture is undecided.
          const openedChat = chatId;
          const source = {
            skeletonKey: chatId,
            // Build 11.3 motion B3: only a predictive gesture shows the home still; no capture without one.
            home: predictiveBack ? snapshotNavigator() : Promise.resolve(null),
            // Build 11.3 zoomfix: this row if it still shows the chat, else the chat's current row (pinned or not).
            measure: (done: (rect: { x: number; y: number; width: number; height: number } | null) => void) => {
              const row = mounted.current && shownChat.current === openedChat ? self.current : null;
              measureZoomRow(openedChat, row, done);
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
