import { useCallback } from "react";
import { type StyleProp, StyleSheet, useColorScheme, type ViewStyle } from "react-native";
import Animated, {
  cubicBezier,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * Build 11.3 motion B1 (audit N02): the ColorOS press of a home list row. The highlight rises in 25 ms
 * and decays over 140 ms, and the row compresses to 0.985 (none under reduced motion). ColorOS off
 * keeps the 0.58 opacity snap.
 *
 * The press is a shared value that the press handlers set, so it starts on the UI thread in the frame
 * of the touch. It does not wait for a React render, which a busy JS thread (a streaming reply) delays.
 */
const OUT = cubicBezier(0.23, 1, 0.32, 1);
const PRESS_IN = { duration: 25, easing: OUT, reduceMotion: ReduceMotion.Never };
const PRESS_OUT = { duration: 140, easing: OUT, reduceMotion: ReduceMotion.Never };
const ROW_SCALE = 0.985;

export function useRowPress(reduceMotion: boolean) {
  const pressed = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: reduceMotion ? 1 : 1 - (1 - ROW_SCALE) * pressed.get() }],
  }));
  const highlightStyle = useAnimatedStyle(() => ({ opacity: pressed.get() }));
  const onPressIn = useCallback(() => pressed.set(withTiming(1, PRESS_IN)), [pressed]);
  const onPressOut = useCallback(() => pressed.set(withTiming(0, PRESS_OUT)), [pressed]);
  return { rowStyle, highlightStyle, onPressIn, onPressOut };
}

export function RowPressHighlight({ style }: { style: StyleProp<ViewStyle> }) {
  const dark = useColorScheme() === "dark";
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)" },
        style,
      ]}
    />
  );
}
