import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { useThemeColor } from "heroui-native/hooks";
import { memo, type RefObject, useEffect, useId, useState } from "react";
import { StyleSheet, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { edges } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

// Smoothstep from 0 (top of the zone) to 1 (at 60 % of it), held to the bottom: no edge, no bands.
const MASK_STOPS = Array.from({ length: 17 }, (_, index) => {
  const progress = index / 16;
  return { offset: progress * 0.6, opacity: progress * progress * (3 - 2 * progress) };
});

/**
 * ColorOS progressive blur behind the home search pill. One BlurView of the home list target (this
 * view is a sibling after the target, never inside it), masked by a smooth alpha ramp in a hardware
 * layer, so the rows scrolling down behind the pill blur in gradually from a clear top edge. A
 * background-colour scrim ramps in under it for legibility. While the pill is solid (search open,
 * home moving, drawer) the whole zone fades to 0 and the blur stops. Renders nothing when ColorOS
 * motion is off, below Android 12, or without a target, so those paths are unchanged.
 */
export const HomeEdgeBlur = memo(function HomeEdgeBlur({
  target,
  paused,
  height,
}: {
  target: RefObject<ViewInstance | null> | undefined;
  paused: boolean;
  /** From the bottom of the screen to the top of the zone. */
  height: number;
}) {
  const { enabled } = useColorOSMotion();
  const dark = useUniwind().theme === "dark";
  const background = String(useThemeColor("background") ?? "#000");
  const id = useId().replaceAll(":", "");
  // A BlurView paints its tint for a frame when it starts: the zone stays at 0 until it has a layout.
  const [ready, setReady] = useState(false);
  // Turned off and on again: wait for a fresh layout before showing it.
  if (!enabled && ready) setReady(false);
  const shown = ready && !paused && enabled;
  // The blur keeps running until the zone has faded out: `none` paints the solid tint (expo-blur sets
  // the tint as background), so it is only set once the zone is invisible.
  const [blurring, setBlurring] = useState(shown);
  useEffect(() => {
    if (shown) {
      setBlurring(true);
      return;
    }
    const timer = setTimeout(() => setBlurring(false), edges.homeFadeMs + 40);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!enabled || !ANDROID_BLUR || !target || height <= 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={() => setReady(true)}
      style={[
        styles.zone,
        {
          height,
          opacity: shown ? 1 : 0,
          transitionProperty: "opacity",
          transitionDuration: edges.homeFadeMs,
        },
      ]}
    >
      <MaskedView
        androidRenderingMode="hardware"
        style={StyleSheet.absoluteFill}
        maskElement={
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={`edge-mask-${id}`} x1="0" x2="0" y1="0" y2="1">
                {MASK_STOPS.map(({ offset, opacity }) => (
                  <Stop key={offset} offset={offset} stopColor="#000000" stopOpacity={opacity} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#edge-mask-${id})`} />
          </Svg>
        }
      >
        <BlurView
          blurTarget={target}
          blurMethod={shown || blurring ? "dimezisBlurViewSdk31Plus" : "none"}
          intensity={edges.homeIntensity}
          blurReductionFactor={4}
          tint={dark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={`edge-scrim-${id}`} x1="0" x2="0" y1="0" y2="1">
            {MASK_STOPS.map(({ offset, opacity }) => (
              <Stop
                key={offset}
                offset={0.2 + (offset / 0.6) * 0.8}
                stopColor={background}
                stopOpacity={opacity * edges.homeScrim}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#edge-scrim-${id})`} />
      </Svg>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  zone: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
