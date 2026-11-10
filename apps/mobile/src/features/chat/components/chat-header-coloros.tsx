import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { type RefObject, useMemo } from "react";
import { Pressable, StyleSheet, View, type ViewInstance, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChannelAvatar } from "@/features/channels/components/channel-avatar";
import { ChatGlassButton, ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useAvatarScale } from "@/features/settings/model/avatar-size";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";
import { MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { GlassBand } from "@/shared/glass/GlassBand";
import { GlassFace, useGlassPress, useGlassPressHandlers } from "@/shared/glass/GlassButton";
import { useText } from "@/shared/lib/text";
import { useGlassMenuDoubleFrost } from "@/shared/motion/GlassMenu";
import { useLiveZoomSettled } from "@/shared/motion/liveZoom";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import type { ChatTarget } from "../model/chat-target";

/** Hotfix 11.1 (Syed, ChatGPT-style reference): a big avatar right over a compact name pill. */
const AVATAR = 52;
/** How far the avatar sits over the pill's top edge. */
const OVERLAP = 4;
const PILL_HEIGHT = 32;
/** Build 11.3: Avatar size grows the header avatar at most 10 % (it overlaps the pill by 4 dp). */
const HEADER_AVATAR_MAX_SCALE = 1.1;
/** Row top below the status bar; the plush fur reaches ~3 dp above the avatar box. */
const ROW_TOP = 4;
const ROW_HEIGHT = AVATAR - OVERLAP + PILL_HEIGHT;
/** The 48 dp side boxes are centred on the avatar + pill group. */
const SIDE_TOP = (ROW_HEIGHT - 48) / 2;
/** Where the ColorOS agent header ends under the status bar (the chat's list starts a little below). */
export const COLOROS_CHAT_HEADER_BOTTOM = ROW_TOP + ROW_HEIGHT;
/** The side boxes (Back, •••) and the screen-edge padding beside them. */
const SIDE_BOX = 64;
const EDGE_PAD = 16;
const MORE_WIDTH = 60;
/** Build #102: how far below the header row the frost fades out. */
const BAND_FADE = 24;
/**
 * Build 10 (ColorOS motion, Android): the agent chat's header in the X glass layout. A round Back on
 * the left, the agent's avatar over the top edge of a frosted name pill (name, the thread menu's
 * chevron and unread dot, and the agent's title under it) in the middle, and a ••• pill on the right
 * that opens the agent page, which also holds the agent's browser.
 *
 * Build 11: the three glass shapes share ONE masked header-band blur of the chat's message-list target
 * (`GlassBand`, a sibling region; this header is outside it), with the Notes press physics on each. The
 * band pauses while a frosted glass menu is open, so the chat draws at most two blurs (band + composer;
 * a message menu pauses the composer too). Without a target the glass is the solid material.
 *
 * Build 11.3 (Syed's reference): the band is a full-width progressive frost under the status bar,
 * avatar, pill and both buttons (strong blur + a slight dim, fading out below the pill), so text that
 * scrolls under the header is unreadable mush. Before, the blur was masked to the three glass shapes
 * only, so the text between and around them stayed sharp.
 */
export function ColorOSChatHeader({
  target,
  needsAction = false,
  fallbackBackground,
  foreground,
  topInset,
  showBack,
  onBack,
  threadMenu,
  frostTarget,
  accessibilityHidden,
}: {
  /** Build 11.3 batch 1 (Syed): a channel gets the same header; only the avatar slot differs. */
  target: ChatTarget;
  /** A channel task needs the user: ••• turns into the warning that opens the channel actions. */
  needsAction?: boolean;
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
  const { reduceMotion } = useColorOSMotion();
  // Build 11.3 (Syed: the header frost vanished whenever a menu opened): a one-blur menu (thread menu,
  // + menu, ••• menus) takes the composer's blur instead (ChatComposer pauses), so the band stays.
  // Only a two-blur menu (message long-press: reaction bar + card) pauses it; its dim stays.
  const menuDouble = useGlassMenuDoubleFrost();
  // Build 11.3 simple zoom: the band's blur starts once a zoom open has settled (none under the moving chat).
  const settled = useLiveZoomSettled();
  const bandOn = Boolean(frostTarget) && !menuDouble && settled;
  // Build 11.3: the band ends above the pill, so the pill and the side buttons (which reach below it)
  // carry their own solid glass fill; text under them never shows through sharp.
  const material = "solid";
  const backPress = useGlassPress();
  const pillPress = useGlassPress();
  const morePress = useGlassPress();
  const pillHandlers = useGlassPressHandlers(pillPress, PILL_HEIGHT, true, reduceMotion);
  const padLeft = insets.left + EDGE_PAD;
  const padRight = insets.right + EDGE_PAD;
  const pillTop = topInset + ROW_TOP + AVATAR - OVERLAP;
  // Not drawn any more (hotfix 11.1: name only); TalkBack still hears the role, or the description.
  const subtitle = useMobileWorkspaceSelector((current) => {
    if (target.kind === "channel") return "";
    const agent = current.agents.find((item) => item.id === target.id && item.serverId === target.serverId);
    return agent?.title.trim() || agent?.description.trim() || "";
  });
  const warning = useThemeColor("warning");
  // The glass press gives the one tick (review R2-2).
  const openAgentPage = () => {
    if (target.kind === "channel")
      router.push({
        pathname: "/channel-info/[channelId]",
        params: { channelId: target.id, serverId: target.serverId },
      });
    else router.push({ pathname: "/agent-info/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
  const openChannelActions = () => {
    router.push({
      pathname: "/channel-actions/[channelId]",
      params: { channelId: target.id, serverId: target.serverId },
    });
  };
  const channelWarning = target.kind === "channel" && needsAction;
  const nameLabel = threadMenu
    ? threadMenu.attention > 0
      ? t("mobile.chat.threads.menuAttention", { name: target.name, count: threadMenu.attention })
      : t("mobile.chat.threads.menu", { name: target.name })
    : t("mobile.chat.header.info", { name: target.name });
  const pillContent = (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={nameLabel}
      accessibilityHint={subtitle || undefined}
      style={styles.pillContent}
    >
      <View style={styles.nameRow}>
        <Typography.Paragraph className="font-semibold min-w-0 shrink" numberOfLines={1} style={styles.name}>
          {target.name}
        </Typography.Paragraph>
        {/* Build 11.2: the › says "opens the agent page"; a thread menu opens a menu instead, so no ›. */}
        {threadMenu ? null : <ChevronRight color={iconColor} size={16} strokeWidth={2.75} style={styles.chevron} />}
        {threadMenu && threadMenu.attention > 0 ? (
          <View style={[styles.badge, { backgroundColor: threadMenu.color }]} />
        ) : null}
      </View>
    </View>
  );
  return (
    <>
      {/* Build #102 (Syed's videos: message text and a row's "Try now" button read sharp behind Back,
          the pill and •••): the frost is full strength down to the bottom of the header row and fades
          out below it, so nothing scrolled under the header shows through at full contrast. */}
      <GlassBand
        target={frostTarget}
        shown={bandOn}
        solid={(pillTop + PILL_HEIGHT) / (pillTop + PILL_HEIGHT + BAND_FADE)}
        style={[styles.band, { top: 0, height: pillTop + PILL_HEIGHT + BAND_FADE }]}
      />
      <View
        pointerEvents="box-none"
        accessibilityElementsHidden={accessibilityHidden}
        importantForAccessibility={accessibilityHidden ? "no-hide-descendants" : "auto"}
        style={[styles.row, { top: topInset + ROW_TOP, paddingLeft: padLeft, paddingRight: padRight }]}
      >
        <View style={styles.side}>
          {showBack ? (
            <ChatGlassIconButton
              accessibilityLabel={t("common.back")}
              fallbackBackground={fallbackBackground}
              liquidGlassAvailable={false}
              glassMaterial={material}
              press={backPress}
              onPress={onBack}
            >
              <ArrowLeft color={iconColor} size={24} strokeWidth={2} />
            </ChatGlassIconButton>
          ) : null}
        </View>
        <View pointerEvents="box-none" style={styles.middle}>
          <Animated.View style={{ marginTop: AVATAR - OVERLAP }} {...pillHandlers}>
            <GlassFace press={pillPress} variant="pill" size={PILL_HEIGHT} material={material} contentPadding={0}>
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
            </GlassFace>
          </Animated.View>
          {/* Over the pill's top edge; it takes no touches, so a tap on it reaches the pill below. */}
          <View pointerEvents="none" style={styles.avatar}>
            <AgentPinAvatar agentId={target.id} location="chat" size={AVATAR}>
              {target.kind === "channel" ? (
                <ChannelHeaderAvatar members={target.members} serverId={target.serverId} />
              ) : (
                <BloubAvatar
                  agentId={target.id}
                  serverId={target.serverId}
                  hue={target.avatarHue}
                  color={target.avatarColor}
                  seed={target.avatarSeed}
                  size={AVATAR}
                  maxScale={HEADER_AVATAR_MAX_SCALE}
                />
              )}
            </AgentPinAvatar>
          </View>
        </View>
        <View style={[styles.side, styles.trailing]}>
          <ChatGlassButton
            accessibilityLabel={
              channelWarning
                ? t("mobile.chat.header.actionsNeeded")
                : t("mobile.chat.header.info", { name: target.name })
            }
            fallbackBackground={fallbackBackground}
            liquidGlassAvailable={false}
            width={MORE_WIDTH}
            glassMaterial={material}
            press={morePress}
            onPress={channelWarning ? openChannelActions : openAgentPage}
          >
            {channelWarning ? (
              <TriangleAlert color={String(warning)} size={24} strokeWidth={2.5} />
            ) : (
              <Ellipsis color={iconColor} size={24} strokeWidth={2} />
            )}
          </ChatGlassButton>
        </View>
      </View>
      <SheetScrollEdgeEffect
        style={{
          height: topInset + ROW_TOP + ROW_HEIGHT + 4,
          left: 0,
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 10,
        }}
      />
    </>
  );
}

/**
 * Build 11.3 batch 1: the channel's members in the agent header's avatar slot. One member is drawn as
 * that agent's own header avatar; more use the chat list's member grid (first four) at the slot's full
 * size, grown by Avatar size with the same 10 % cap.
 */
function ChannelHeaderAvatar({
  members,
  serverId,
}: {
  members: Extract<ChatTarget, { kind: "channel" }>["members"];
  serverId: string;
}) {
  const scale = Math.min(
    useAvatarScale((state) => state.scale),
    HEADER_AVATAR_MAX_SCALE,
  );
  const disconnected = useMobileWorkspaceSelector(
    (current) => !current.servers.some((server) => server.id === serverId && showsOnline(server)),
  );
  const agents = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const [only] = members;
  if (members.length === 1 && only)
    return (
      <BloubAvatar
        agentId={only.id}
        serverId={only.serverId}
        hue={only.avatarHue}
        color={only.avatarColor}
        seed={only.avatarSeed}
        size={AVATAR}
        maxScale={HEADER_AVATAR_MAX_SCALE}
      />
    );
  return (
    <View style={styles.channelAvatar}>
      <ChannelAvatar
        channel={{ members: members.map((member) => ({ agentId: member.id })) }}
        agents={agents}
        size={AVATAR * scale}
        disconnected={disconnected}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, zIndex: 20, flexDirection: "row", alignItems: "flex-start" },
  band: { position: "absolute", left: 0, right: 0, zIndex: 19 },
  side: { width: SIDE_BOX, height: 48, marginTop: SIDE_TOP },
  trailing: { alignItems: "flex-end" },
  middle: { flex: 1, alignItems: "center" },
  // Hugs the name (up to 220 dp, then ellipsis); never narrower than the avatar over it.
  pillContent: {
    height: PILL_HEIGHT,
    maxWidth: 220,
    minWidth: AVATAR + 16,
    paddingLeft: 14,
    paddingRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 0 },
  name: { fontSize: 15, lineHeight: 19 },
  // Build 11.2: full strength, so the › reads on the light frosted pill too (0.6 washed out there).
  chevron: { opacity: 0.9 },
  badge: { width: 8, height: 8, borderRadius: 4, marginLeft: 2 },
  avatar: { position: "absolute", top: 0 },
  channelAvatar: { width: AVATAR, height: AVATAR, alignItems: "center", justifyContent: "center" },
});
