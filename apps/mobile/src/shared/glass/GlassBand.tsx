import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { type RefObject, useId, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useUniwind } from "uniwind";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { useBlurLive } from "@/shared/motion/useBlurLive";
import { useBlurBudget } from "./blurBudget";

/** Build 11.3: a strong frost, so text under the bar is unreadable (Syed's reference). */
const INTENSITY = 40;
const REDUCTION = 4;
/**
 * The dim at the top of the band, fading out with the blur. Build 11.3 (Syed): neutral black, never a
 * theme or agent colour, so the frost adds no tint of its own.
 */
const DIM_DARK = 0.32;
const DIM_LIGHT = 0.12;
const STEPS = 24;

/**
 * Opaque from 0 to `solid`, then a long smootherstep down to 0 at the bottom edge (Syed: no visible
 * edge, it blends into the content). Blur strength and dim follow the same curve, so the blur seems to
 * thin out progressively instead of stopping at a line.
 */
function stops(solid: number) {
  const ramp = Array.from({ length: STEPS + 1 }, (_, index) => {
    const t = index / STEPS;
    return { offset: solid + (1 - solid) * t, opacity: 1 - t * t * t * (t * (t * 6 - 15) + 10) };
  });
  return [{ offset: 0, opacity: 1 }, ...ramp];
}

/**
 * Build 11: ONE BlurView behind a bar (the chat header), so a whole bar costs one blur of the budget.
 * It blurs a sibling target (this band sits outside it), mounts at opacity 0, goes live two frames
 * after it starts and stops at once (hidden in the same commit) when `shown` turns false.
 *
 * Build 11.3 (Syed's reference): the band is a full-width progressive frost, not only the glass shapes:
 * the blur and a slight dim are full strength down to `solid` (a fraction of the height) and fade out
 * below it. The dim stays while the blur is paused (a frosted menu took its place: ≤2 live blurs), so
 * text under the bar never shows at full contrast.
 */
export function GlassBand({
  target,
  shown,
  solid,
  style,
}: {
  target: RefObject<ViewInstance | null> | undefined;
  shown: boolean;
  /** Where the fade starts, 0..1 of the band's height. */
  solid: number;
  style?: object;
}) {
  const dark = useUniwind().theme === "dark";
  const id = useId().replaceAll(":", "");
  const [ready, setReady] = useState(false);
  const running = ready && shown && ANDROID_BLUR && Boolean(target?.current);
  const live = useBlurLive(running);
  useBlurBudget(live, "glass-band");
  if (!ANDROID_BLUR || !target) return null;
  const ramp = stops(solid);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
      onLayout={() => setReady(true)}
    >
      <MaskedView
        androidRenderingMode="hardware"
        style={StyleSheet.absoluteFill}
        maskElement={
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={`band-mask-${id}`} x1="0" x2="0" y1="0" y2="1">
                {ramp.map(({ offset, opacity }) => (
                  <Stop key={offset} offset={offset} stopColor="#000000" stopOpacity={opacity} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#band-mask-${id})`} />
          </Svg>
        }
      >
        {target.current ? (
          <BlurView
            blurTarget={target}
            blurMethod={running ? "dimezisBlurViewSdk31Plus" : "none"}
            intensity={INTENSITY}
            blurReductionFactor={REDUCTION}
            tint={dark ? "dark" : "light"}
            style={[StyleSheet.absoluteFill, { opacity: live ? 1 : 0 }]}
          />
        ) : null}
      </MaskedView>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={`band-dim-${id}`} x1="0" x2="0" y1="0" y2="1">
            {ramp.map(({ offset, opacity }) => (
              <Stop
                key={offset}
                offset={offset}
                stopColor="#000000"
                stopOpacity={opacity * (dark ? DIM_DARK : DIM_LIGHT)}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#band-dim-${id})`} />
      </Svg>
    </View>
  );
}
