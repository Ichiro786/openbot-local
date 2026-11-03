import { useThemeColor } from "heroui-native/hooks";
import { memo, useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { edges } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

/**
 * ColorOS edge fade: one full-bleed surface gradient (scrim alpha → 0), absolute and
 * touch-transparent. Build 7 stacked three rectangular BlurView bands here; on Android they drew as a
 * grey box with a hard top line and stepped stripes, so the blur is gone and only the smooth fade is
 * left. Renders nothing when ColorOS motion is off. Not used on home any more (home keeps its
 * original search background).
 */
export const ProgressiveEdgeBlur = memo(function ProgressiveEdgeBlur({
  edge,
  height = edge === "top" ? edges.topHeight : edges.bottomHeight,
}: {
  edge: "top" | "bottom";
  height?: number;
}) {
  const { enabled } = useColorOSMotion();
  const id = `edge-${edge}-${useId().replaceAll(":", "")}`;
  const surface = useThemeColor("background");
  if (!enabled) return null;
  const color = String(surface ?? "#000");
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.edge, edge === "top" ? styles.top : styles.bottom, { height }]}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" x2="0" y1={edge === "top" ? "0" : "1"} y2={edge === "top" ? "1" : "0"}>
            <Stop offset="0" stopColor={color} stopOpacity={edges.scrimAlpha} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  edge: { position: "absolute", left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
