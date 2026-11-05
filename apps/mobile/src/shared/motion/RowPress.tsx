import { StyleSheet, useColorScheme } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";

/**
 * Build 11.3 motion B1 (audit N02): the ColorOS press of a home list row. The highlight rises in 25 ms
 * and decays over 140 ms, and the row compresses to 0.985 (none under reduced motion). Reanimated CSS
 * transitions run them on the UI thread. ColorOS off keeps the 0.58 opacity snap.
 */
const OUT = cubicBezier(0.23, 1, 0.32, 1);

export function rowPressStyle(pressed: boolean, reduceMotion: boolean) {
  return {
    transform: [{ scale: pressed && !reduceMotion ? 0.985 : 1 }],
    transitionProperty: "transform",
    transitionDuration: pressed ? 25 : 140,
    transitionTimingFunction: OUT,
  } as const;
}

export function RowPressHighlight({ pressed }: { pressed: boolean }) {
  const dark = useColorScheme() === "dark";
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)",
          opacity: pressed ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: pressed ? 25 : 140,
          transitionTimingFunction: OUT,
        },
      ]}
    />
  );
}
