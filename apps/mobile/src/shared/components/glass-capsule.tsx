import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import type { PropsWithChildren, RefObject } from "react";
import { Platform, StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { cubicBezier } from "react-native-reanimated";
import { useCSSVariable, useUniwind } from "uniwind";
import { ChromeGlassSheen } from "@/shared/components/chrome-glass-sheen";
import { useBlurBudget } from "@/shared/glass/blurBudget";
import { GlintRim } from "@/shared/glass/GlintRim";
import { useChromeGlass } from "@/shared/lib/chrome-glass";
import { isAndroid } from "@/shared/lib/platform";
import { pill } from "@/shared/motion/tokens";
import { useBlurLive } from "@/shared/motion/useBlurLive";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

export const GLASS_CAPSULE_HEIGHT = 52;
const CSS_EASE_SMOOTH = cubicBezier(0.32, 0.72, 0, 1);
const TINT_IN = 380;
const TINT_OUT = 280;

const CAPSULE_SHADOW = "0 6px 18px rgba(0, 0, 0, 0.07)";
const BLUR_RADIUS = 24;
export const ANDROID_BLUR = isAndroid && Number(Platform.Version) >= 31;

export function GlassCapsule({
  liquidGlass,
  fallbackBackground,
  width,
  height = GLASS_CAPSULE_HEIGHT,
  animateGlass = false,
  glassHidden = false,
  tint,
  tintShown = true,
  blurTarget,
  blurPaused = false,
  colorOSFrost = false,
  children,
}: PropsWithChildren<{
  /**
   * ColorOS motion (build 9): while the capsule blurs, a lighter fill lets the colours behind glow
   * through, with a hairline specular rim and a soft top light. Ignored when ColorOS motion is off.
   */
  colorOSFrost?: boolean;
  liquidGlass: boolean;
  /** Android: the content to blur under the capsule. Without it the capsule has the solid glass. */
  blurTarget?: RefObject<ViewInstance | null>;
  /** Shows the solid glass over the blur, for a time when the target is not under the capsule. */
  blurPaused?: boolean;
  fallbackBackground: unknown;
  width?: number;
  height?: number;
  tint?: string;
  tintShown?: boolean;
  animateGlass?: boolean;
  glassHidden?: boolean;
}>) {
  const milky = useChromeGlass();
  const { theme } = useUniwind();
  const blurFill = String(useCSSVariable("--openbot-bg-chrome-blur"));
  const blurs = ANDROID_BLUR && !liquidGlass && blurTarget !== undefined && !blurPaused;
  const colorOS = useColorOSMotion().enabled;
  const frost = colorOSFrost && colorOS && blurs;
  const frostShown = useBlurLive(frost);
  const dark = theme === "dark";
  useBlurBudget(blurs, "glass-capsule");
  const fallback = isAndroid ? milky : { backgroundColor: String(fallbackBackground), boxShadow: CAPSULE_SHADOW };
  return (
    <GlassView
      glassEffectStyle={
        animateGlass
          ? { style: liquidGlass && !glassHidden ? "regular" : "none", animate: true, animationDuration: 0.36 }
          : liquidGlass
            ? "regular"
            : "none"
      }
      isInteractive={liquidGlass}
      style={[
        liquidGlass ? { backgroundColor: "transparent" } : fallback,
        // The fill lies in its own layer over the blur.
        isAndroid && !liquidGlass ? { backgroundColor: "transparent" } : null,
        {
          borderCurve: "continuous",
          borderRadius: height / 2,
          height,
          overflow: "hidden",
          width,
        },
      ]}
    >
      {isAndroid && !liquidGlass ? (
        <>
          {ANDROID_BLUR && blurTarget ? (
            <BlurView
              blurTarget={blurTarget}
              blurMethod={blurs ? "dimezisBlurViewSdk31Plus" : "none"}
              intensity={BLUR_RADIUS}
              blurReductionFactor={4}
              tint={theme === "dark" ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: frostShown
                  ? dark
                    ? pill.fillDark
                    : pill.fillLight
                  : blurs && !frost
                    ? blurFill
                    : milky.backgroundColor,
              },
            ]}
          />
          {frostShown ? <FrostRim height={height} dark={dark} /> : <ChromeGlassSheen />}
        </>
      ) : null}
      {tint ? (
        <Animated.View
          pointerEvents="none"
          className="absolute inset-0"
          style={{
            backgroundColor: tint,
            borderCurve: "continuous",
            borderRadius: GLASS_CAPSULE_HEIGHT / 2,
            opacity: tintShown ? 1 : 0,
            transitionProperty: "opacity",
            transitionDuration: tintShown ? TINT_IN : TINT_OUT,
            transitionTimingFunction: CSS_EASE_SMOOTH,
          }}
        />
      ) : null}
      {children}
    </GlassView>
  );
}

/**
 * ColorOS frost (build 11): no top sheen and no drawn hairline. The shared glass edge: two soft glints
 * and the lens glow low inside (spec §1).
 */
function FrostRim({ height, dark }: { height: number; dark: boolean }) {
  return <GlintRim radius={height / 2} dark={dark} />;
}
