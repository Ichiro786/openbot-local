import { Skeleton } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect } from "react";
import { StyleSheet, useColorScheme, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLOROS_CHAT_HEADER_GEOMETRY, headerPillWidthOf } from "@/features/chat/components/chat-header-coloros";
import { glass } from "@/shared/glass/tokens";
import { COMPOSER_BAR_INSET, composerBottomGap, restingComposerHeight } from "@/shared/lib/composer-metrics";

/** Where the placeholder bubbles start under the header (the latest exchange lands there). */
export const CHAT_SKELETON_TOP = 84 + 8;
/** The list's side padding (chat-message-list LIST_PADDING). */
const SIDE = 16;
const LINES = ["92%", "84%", "88%", "52%"] as const;
const MORE_LINES = ["90%", "76%", "40%"] as const;
/** Build 13: a soft breathing shimmer, after the zoom open (a pulse during it would redraw its layer). */
const SHIMMER_DELAY_MS = 380;
const SHIMMER_MS = 750;
const SHIMMER_LOW = 0.5;

const DEFAULT_PILL_WIDTH = 120;
const DEFAULT_COMPOSER_WIDTH = 240;

function useShimmer() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(
      withDelay(
        SHIMMER_DELAY_MS,
        withRepeat(
          withTiming(SHIMMER_LOW, {
            duration: SHIMMER_MS,
            easing: Easing.inOut(Easing.sin),
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          true,
          undefined,
          ReduceMotion.System,
        ),
        ReduceMotion.System,
      ),
    );
  }, [opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.get() }));
}

/**
 * Message-shaped placeholders where the latest exchange lands (the latest user message under the header,
 * the reply under it), breathing softly. Shared by the zoom-open shell and the
 * chat's own opening skeleton, so the hand-over between them is seamless.
 */
export function SkeletonBubbles({ top }: { top: number }) {
  const insets = useSafeAreaInsets();
  const shimmer = useShimmer();
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.bubbles, { top, left: insets.left + SIDE, right: insets.right + SIDE }, shimmer]}
    >
      <Skeleton variant="none" style={styles.user} />
      <View style={styles.lines}>
        {LINES.map((width) => (
          <Skeleton key={width} variant="none" style={[styles.line, { width }]} />
        ))}
      </View>
      <View style={[styles.lines, styles.paragraph]}>
        {MORE_LINES.map((width) => (
          <Skeleton key={width} variant="none" style={[styles.line, { width }]} />
        ))}
      </View>
    </Animated.View>
  );
}

/**
 * Build 13 (Syed: "open it immediately, show the skeleton"): the whole ColorOS chat at its final layout,
 * drawn in the zoom open's first frame while the chat itself mounts: round Back, the avatar over the name
 * pill, the ••• pill, placeholder bubbles and the composer capsule. Plain views, no data, no blur.
 */
export function ChatShellSkeleton({ chatId }: { chatId?: string }) {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const background = String(useThemeColor("background") ?? "#000");
  const fill = useColorScheme() === "light" ? "rgba(0, 0, 0, 0.06)" : glass.material.button.solidDark;
  const g = COLOROS_CHAT_HEADER_GEOMETRY;
  const top = insets.top;
  const inner = width - insets.left - insets.right;
  const centreX = insets.left + inner / 2;
  const pillWidth = Math.min(
    g.pillMaxWidth,
    Math.max(g.pillMinWidth, (chatId && headerPillWidthOf(chatId)) || DEFAULT_PILL_WIDTH),
  );
  const cardWidth = inner - 2 * COMPOSER_BAR_INSET;
  const composerWidth = Math.min(cardWidth, DEFAULT_COMPOSER_WIDTH);
  const composerHeight = restingComposerHeight(fontScale);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: background }]}>
      <View
        style={[
          styles.abs,
          {
            left: insets.left + g.back.left,
            top: top + g.back.top,
            width: g.back.size,
            height: g.back.size,
            borderRadius: g.back.size / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            right: insets.right + g.more.right,
            top: top + g.more.top,
            width: g.more.width,
            height: g.more.height,
            borderRadius: g.more.height / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: centreX - pillWidth / 2,
            top: top + g.rowTop + g.avatar - g.overlap,
            width: pillWidth,
            height: g.pillHeight,
            borderRadius: g.pillHeight / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            left: centreX - g.avatar / 2,
            top: top + g.rowTop,
            width: g.avatar,
            height: g.avatar,
            borderRadius: g.avatar / 2,
            backgroundColor: fill,
          },
        ]}
      />
      <SkeletonBubbles top={top + CHAT_SKELETON_TOP} />
      <View
        style={[
          styles.abs,
          {
            left: insets.left + COMPOSER_BAR_INSET + (cardWidth - composerWidth) / 2,
            bottom: composerBottomGap(insets.bottom),
            width: composerWidth,
            height: composerHeight,
            borderRadius: composerHeight / 2,
            backgroundColor: fill,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute" },
  bubbles: { position: "absolute", gap: 10 },
  user: { alignSelf: "flex-end", width: "58%", height: 44, borderRadius: 22 },
  lines: { gap: 10, paddingTop: 6 },
  line: { height: 14, borderRadius: 7 },
  paragraph: { paddingTop: 8 },
});
