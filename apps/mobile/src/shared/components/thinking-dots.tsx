import { useEffect } from "react";
import { type ColorValue, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useMotion } from "@/shared/lib/motion";

const DOTS = [0, 1, 2] as const;
// One full wave across the three dots. Each dot peaks a third of the cycle after the one before.
const CYCLE_MS = 1100;

/**
 * Three dots that pulse in a wave, for a wait that has no progress to show. One shared clock drives
 * all three in worklets, so the loop costs one animation and keeps moving while JS is busy streaming.
 * Under reduced motion the dots stay still at a readable opacity.
 */
export function ThinkingDots({
  color,
  size = 6,
  gap = 4,
  accessibilityLabel,
}: {
  color: ColorValue;
  size?: number;
  gap?: number;
  accessibilityLabel?: string;
}) {
  const motion = useMotion();
  const clock = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      cancelAnimation(clock);
      clock.set(0);
      return;
    }
    clock.set(0);
    clock.set(withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(clock);
  }, [clock, motion.reduced]);

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? "progressbar" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: "row", alignItems: "center", gap, height: size * 2 }}
    >
      {DOTS.map((index) => (
        <Dot key={index} index={index} clock={clock} size={size} color={color} still={motion.reduced} />
      ))}
    </View>
  );
}

function Dot({
  index,
  clock,
  size,
  color,
  still,
}: {
  index: number;
  clock: SharedValue<number>;
  size: number;
  color: ColorValue;
  still: boolean;
}) {
  const style = useAnimatedStyle(() => {
    if (still) return { opacity: 0.6, transform: [{ translateY: 0 }, { scale: 1 }] };
    // A raised cosine bump per dot, offset by a third of the cycle: 0 at rest, 1 at the peak.
    const phase = (((clock.get() - index / 3) % 1) + 1) % 1;
    const bump = phase < 0.5 ? 0.5 - 0.5 * Math.cos(phase * 4 * Math.PI) : 0;
    return {
      opacity: 0.35 + 0.65 * bump,
      transform: [{ translateY: -size * 0.45 * bump }, { scale: 0.85 + 0.25 * bump }],
    };
  });
  return (
    <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />
  );
}
