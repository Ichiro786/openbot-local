import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import { type RefObject, useState } from "react";
import { Pressable, StyleSheet, View, type ViewInstance, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUniwind } from "uniwind";
import { AgentPinAvatar } from "@/features/agents/components/agent-pin-avatar";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { ChatGlassButton, ChatGlassIconButton } from "@/features/chat/components/chat-glass-icon-button";
import type { ChatThreadMenu } from "@/features/chat/components/chat-thread-menu";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { MenuView } from "@/shared/components/menu-view";
import { SheetScrollEdgeEffect } from "@/shared/components/sheet-scroll-edge-effect";
import { GlassBand, type GlassBandShape } from "@/shared/glass/GlassBand";
import { GlassFace, useGlassPress, useGlassPressHandlers } from "@/shared/glass/GlassButton";
import { useText } from "@/shared/lib/text";
import { useGlassMenuFrostOpen } from "@/shared/motion/GlassMenu";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { recordZoomSkeleton } from "@/shared/motion/zoomSkeleton";
import type { AgentChatTarget } from "../model/chat-target";

/** Hotfix 11.1 (Syed, ChatGPT-style reference): a big avatar right over a compact name pill. */
const AVATAR = 52;
/** How far the avatar sits over the pill's top edge. */
const OVERLAP = 4;
const PILL_HEIGHT = 32;
/** The back and ••• glass: 40 dp in the 48 dp side boxes. */
const BUTTON = 40;
const BUTTON_INSET = 4;
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
/**
 * Build 11.2: the header's geometry for the zoom-open skeleton (ZoomOpenOverlay), from the constants
 * above, so the skeleton draws the shapes exactly where this header puts them. Offsets are from the
 * top of the safe area (add the status bar inset) and from the screen's left and right edges (add the
 * side insets).
 */
export const COLOROS_CHAT_HEADER_GEOMETRY = {
  rowTop: ROW_TOP,
  avatar: AVATAR,
  overlap: OVERLAP,
  pillHeight: PILL_HEIGHT,
  /** The pill's narrowest width (it hugs the name): never narrower than the avatar over it. */
  pillMinWidth: AVATAR + 16,
  pillMaxWidth: 220,
  back: { left: EDGE_PAD + BUTTON_INSET, top: ROW_TOP + SIDE_TOP + BUTTON_INSET, size: BUTTON },
  more: {
    right: EDGE_PAD + BUTTON_INSET,
    top: ROW_TOP + SIDE_TOP + BUTTON_INSET,
    width: MORE_WIDTH - BUTTON_INSET * 2,
    height: BUTTON,
  },
  /** The middle column (avatar and pill are centred in it) starts after the leading side box. */
  sideBox: SIDE_BOX,
  edgePad: EDGE_PAD,
} as const;

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
  const { reduceMotion } = useColorOSMotion();
  const menuFrost = useGlassMenuFrostOpen();
  const bandOn = Boolean(frostTarget) && !menuFrost;
  const material = bandOn ? "band" : "solid";
  const backPress = useGlassPress();
  const pillPress = useGlassPress();
  const morePress = useGlassPress();
  const pillHandlers = useGlassPressHandlers(pillPress, PILL_HEIGHT, true, reduceMotion);
  const [pillFrame, setPillFrame] = useState<{ x: number; width: number } | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  const padLeft = insets.left + EDGE_PAD;
  const padRight = insets.right + EDGE_PAD;
  const shapes: GlassBandShape[] = rowWidth
    ? [
        ...(showBack
          ? [
              {
                key: "back",
                x: padLeft + BUTTON_INSET,
                y: SIDE_TOP + BUTTON_INSET,
                width: BUTTON,
                height: BUTTON,
                radius: BUTTON / 2,
                press: backPress,
              },
            ]
          : []),
        ...(pillFrame
          ? [
              {
                key: "pill",
                x: pillFrame.x,
                y: AVATAR - OVERLAP,
                width: pillFrame.width,
                height: PILL_HEIGHT,
                radius: PILL_HEIGHT / 2,
                press: pillPress,
              },
            ]
          : []),
        {
          key: "more",
          x: rowWidth - padRight - 60 + BUTTON_INSET,
          y: SIDE_TOP + BUTTON_INSET,
          width: 60 - BUTTON_INSET * 2,
          height: BUTTON,
          radius: BUTTON / 2,
          press: morePress,
        },
      ]
    : [];
  // Not drawn any more (hotfix 11.1: name only); TalkBack still hears the role, or the description.
  const subtitle = useMobileWorkspaceSelector((current) => {
    const agent = current.agents.find((item) => item.id === target.id && item.serverId === target.serverId);
    return agent?.title.trim() || agent?.description.trim() || "";
  });
  // The glass press gives the one tick (review R2-2).
  const openAgentPage = () => {
    router.push({ pathname: "/agent-info/[agentId]", params: { agentId: target.id, serverId: target.serverId } });
  };
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
      <GlassBand
        target={frostTarget}
        shown={bandOn}
        shapes={shapes}
        style={[styles.band, { top: topInset + ROW_TOP, height: ROW_HEIGHT }]}
      />
      <View
        onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
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
          <Animated.View
            style={{ marginTop: AVATAR - OVERLAP }}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              // The middle column starts after the leading side box.
              const left = padLeft + SIDE_BOX + x;
              if (left !== pillFrame?.x || width !== pillFrame?.width) setPillFrame({ x: left, width });
              // Build 11.2: the next zoom-open of this chat draws its skeleton pill this wide.
              recordZoomSkeleton(target.id, {
                pillWidth: width,
                avatarColor: avatarHeadColor(target.avatarSeed, target.avatarHue, target.avatarColor),
              });
            }}
            {...pillHandlers}
          >
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
            width={MORE_WIDTH}
            glassMaterial={material}
            press={morePress}
            onPress={openAgentPage}
          >
            <Ellipsis color={iconColor} size={24} strokeWidth={2} />
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
});
