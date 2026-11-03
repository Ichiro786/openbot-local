import { BlurView } from "expo-blur";
import { useThemeColor } from "heroui-native/hooks";
import { memo, type RefObject, useId } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { isAndroid } from "@/shared/lib/platform";
import { edges } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

/**
 * ColorOS 17 progressive edge: three stacked blur bands that get stronger toward the edge, with a
 * surface gradient on top (0.55 → 0). Absolute and touch-transparent, so the layout is unchanged.
 * Renders nothing when ColorOS motion is off. Android blurs only a `BlurTargetView` that does not
 * contain this view (a sibling, as the home search target), so the target is passed in; without one
 * the gradient alone draws. iOS blurs natively.
 */
export const ProgressiveEdgeBlur = memo(function ProgressiveEdgeBlur({
  edge,
  height = edge === "top" ? edges.topHeight : edges.bottomHeight,
  blurTarget,
}: {
  edge: "top" | "bottom";
  height?: number;
  blurTarget?: RefObject<ViewInstance | null>;
}) {
  const { enabled } = useColorOSMotion();
  const target = isAndroid ? blurTarget : undefined;
  const blurs = !isAndroid || Boolean(blurTarget);
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
      {blurs
        ? edges.bandIntensities.map((intensity, index) => {
            // Band 0 spans the whole edge, band 2 only the third nearest the screen edge.
            const bandHeight = (height * (edges.bandIntensities.length - index)) / edges.bandIntensities.length;
            return (
              <BlurView
                key={intensity}
                intensity={intensity}
                tint="default"
                blurTarget={target}
                blurMethod={target ? "dimezisBlurViewSdk31Plus" : undefined}
                style={[styles.band, edge === "top" ? styles.top : styles.bottom, { height: bandHeight }]}
              />
            );
          })
        : null}
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
  edge: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  band: { position: "absolute", left: 0, right: 0 },
  top: { top: 0 },
  bottom: { bottom: 0 },
});
