import { Skeleton } from "heroui-native";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
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

/** The list's side padding (chat-message-list LIST_PADDING). */
const SIDE = 16;
const LINES = ["92%", "84%", "88%", "52%"] as const;
const MORE_LINES = ["90%", "76%", "40%"] as const;
/** Build 13: a soft breathing shimmer, after the zoom open (a pulse during it would redraw its layer). */
const SHIMMER_DELAY_MS = 380;
const SHIMMER_MS = 750;
const SHIMMER_LOW = 0.5;

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

const styles = StyleSheet.create({
  bubbles: { position: "absolute", gap: 10 },
  user: { alignSelf: "flex-end", width: "58%", height: 44, borderRadius: 22 },
  lines: { gap: 10, paddingTop: 6 },
  line: { height: 14, borderRadius: 7 },
  paragraph: { paddingTop: 8 },
});
