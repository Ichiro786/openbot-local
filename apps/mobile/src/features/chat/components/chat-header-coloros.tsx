import { router } from "expo-router";
import { Typography } from "heroui-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import type { RefObject } from "react";
import { Pressable, StyleSheet, View, type ViewInstance, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatGlassButton, ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { ComposerFrost } from "@/shared/motion/ComposerFrost";
import { useGlassMenuFrostOpen } from "@/shared/motion/GlassMenu";
import type { AgentChatTarget } from "../model/chat-target";

const AVATAR = 34;
/** How far the avatar sits over the pill's top edge. */
const OVERLAP = 10;
const PILL_HEIGHT = 46;

/**
 * Build 10 (ColorOS motion, Android): the agent chat's header in the X glass layout. A round Back on
 * the left, the agent's avatar over the top edge of a frosted name pill (name, the thread menu's
 * chevron and unread dot, and the agent's title under it) in the middle, and a ••• pill on the right
 * that opens the agent page, which also holds the agent's browser.
 *
 * The pill frosts the chat's message-list target (a sibling region; this header is outside it) with
 * the composer's glass. It pauses while a frosted glass menu is open, so the chat draws at most two
 * blurs (this pill and the composer; a message menu pauses the composer too).
 */
export function ColorOSChatHeader({
  target,
  fallbackBackground,
  foreground,
  topInset,
  showBack,
  onBack,
  threadMenu,
  frostTarget,
  accessibilityHidden,
}: {
  target: AgentChatTarget;
  fallbackBackground: ViewStyle["backgroundColor"];
  foreground: ViewStyle["backgroundColor"];
  topInset: number;
  showBack: boolean;
  onBack: () => void;
  threadMenu?: ChatThreadMenu;
  frostTarget?: RefObject<ViewInstance | null>;
  accessibilityHidden: boolean;
}) {
  const { t } = useText();
  const insets = useSafeAreaInsets();
  const dark = useUniwind().theme === "dark";
  const iconColor = String(foreground);
  const subtitle = useMobileWorkspaceSelector(
    (current) =>
      current.agents.find((agent) => agent.id === target.id && agent.serverId === target.serverId)?.title.trim() ?? "",
  );
  const openAgentPage = () => {
    void haptics.impact("soft");
    router.push({ pathname: "/agent-info/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
  const nameLabel = threadMenu
    ? threadMenu.attention > 0
      ? t("mobile.chat.threads.menuAttention", { name: target.name, count: threadMenu.attention })
      : t("mobile.chat.threads.menu", { name: target.name })
    : t("mobile.chat.header.info", { name: target.name });
  const pillContent = (
    <View accessible accessibilityRole="button" accessibilityLabel={nameLabel} style={styles.pillContent}>
      <View style={styles.nameRow}>
        <Typography.Paragraph className="font-semibold min-w-0 shrink" numberOfLines={1} style={styles.name}>
          {target.name}
        </Typography.Paragraph>
        {threadMenu ? <ChevronDown color={iconColor} size={14} strokeWidth={2.5} /> : null}
        {threadMenu && threadMenu.attention > 0 ? (
          <View style={[styles.badge, { backgroundColor: threadMenu.color }]} />
        ) : null}
      </View>
      {subtitle ? (
        <Typography.Paragraph type="body-xs" numberOfLines={1} className="text-muted" style={styles.subtitle}>
          {subtitle}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
  return (
    <>
      <View
        pointerEvents="box-none"
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        style={[styles.row, { top: topInset + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}
      >
        <View style={styles.side}>
          {showBack ? (
            <ChatGlassIconButton
              accessibilityLabel={t("common.back")}
              fallbackBackground={fallbackBackground}
              liquidGlassAvailable={false}
              onPress={() => {
                void haptics.impact("soft");
                onBack();
              }}
            >
              <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
            </ChatGlassIconButton>
          ) : null}
        </View>
        <View pointerEvents="box-none" style={styles.middle}>
          <View style={[styles.pill, { marginTop: AVATAR - OVERLAP }]}>
            <HeaderFrost target={frostTarget} solid={String(fallbackBackground)} />
            {threadMenu ? (
              <MenuView
                colorScheme={dark ? "dark" : "light"}
                actions={threadMenu.actions}
                onPressAction={({ nativeEvent }) => threadMenu.onPressAction(nativeEvent.event)}
              >
                {pillContent}
              </MenuView>
            ) : (
              <Pressable hitSlop={6} onPress={openAgentPage}>
                {pillContent}
              </Pressable>
            )}
          </View>
          {/* Over the pill's top edge; it takes no touches, so a tap on it reaches the pill below. */}
          <View pointerEvents="none" style={styles.avatar}>
            <AgentPinAvatar agentId={target.id} location="chat" size={AVATAR}>
              <BloubAvatar
                agentId={target.id}
                serverId={target.serverId}
                hue={target.avatarHue}
                seed={target.avatarSeed}
                size={AVATAR}
              />
            </AgentPinAvatar>
          </View>
        </View>
        <View style={[styles.side, styles.trailing]}>
          <ChatGlassButton
            accessibilityLabel={t("mobile.chat.header.info", { name: target.name })}
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={false}
            width={60}
            onPress={openAgentPage}
          >
            <Ellipsis color={iconColor} size={24} strokeWidth={2} />
          </ChatGlassButton>
        </View>
      </View>
      <SheetScrollEdgeEffect
        style={{ height: topInset + 82, left: 0, position: "absolute", right: 0, top: 0, zIndex: 10 }}
      />
    </>
  );
}

/**
 * The pill's glass: the composer's frost (the same component, so the same blur rules: dimezis only,
 * faded in after layout, stopped once faded out). It pauses while a frosted glass menu is open. Without
 * a target (frost off for this chat) the pill is the solid fill.
 */
function HeaderFrost({ target, solid }: { target?: RefObject<ViewInstance | null>; solid: string }) {
  const menuFrost = useGlassMenuFrostOpen();
  if (!target) return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: solid }]} />;
  return <ComposerFrost target={target} shown={!menuFrost} solid={solid} radius={PILL_HEIGHT / 2} />;
}

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, zIndex: 20, flexDirection: "row", alignItems: "flex-start" },
  side: { width: 64, height: 48 },
  trailing: { alignItems: "flex-end" },
  middle: { flex: 1, alignItems: "center" },
  pill: {
    height: PILL_HEIGHT,
    maxWidth: 240,
    minWidth: 120,
    borderRadius: PILL_HEIGHT / 2,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  pillContent: {
    height: PILL_HEIGHT,
    paddingHorizontal: 18,
    paddingTop: OVERLAP,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 },
  name: { fontSize: 15, lineHeight: 19 },
  subtitle: { fontSize: 11, lineHeight: 14 },
  badge: { width: 8, height: 8, borderRadius: 4, marginLeft: 2 },
  avatar: { position: "absolute", top: 0 },
});
