import { BlurView } from "expo-blur";
import { type RefObject, useEffect, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { composerFrost, pill } from "./tokens";

/**
 * Build 10 (ColorOS motion, Android 12+): the chat composer's frosted glass, the home search pill's
 * look with a more opaque tint. It lies first in the composer card (so it is clipped by the card's
 * radius) and blurs the chat's message list target, a sibling region: the composer is outside it.
 *
 * Blur rules (build 9): the BlurView always uses `dimezisBlurViewSdk31Plus` (never `none`, which
 * paints a solid tint), mounts at opacity 0 and fades in after its first layout, and is hidden with
 * opacity while `shown` is false. Under the blur, the card's solid fill comes back with the inverse
 * opacity, so a paused or disabled frost is the build 9 composer.
 */
export function ComposerFrost({
  target,
  shown,
  solid,
  radius,
}: {
  target: RefObject<ViewInstance | null>;
  /** False while the screen must not draw this blur (a two-blur menu, the voice mode). */
  shown: boolean;
  /** The card's own solid fill, shown while the frost is not. */
  solid: string;
  radius: number;
}) {
  const dark = useUniwind().theme === "dark";
  const [ready, setReady] = useState(false);
  const visible = useSharedValue(0);
  const on = ready && shown && ANDROID_BLUR;
  useEffect(() => {
    visible.set(withTiming(on ? 1 : 0, { duration: on ? composerFrost.fadeInMs : composerFrost.fadeOutMs }));
  }, [on, visible]);
  const frostStyle = useAnimatedStyle(() => ({ opacity: visible.get() }));
  const solidStyle = useAnimatedStyle(() => ({ opacity: 1 - visible.get() }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: solid }, solidStyle]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, frostStyle]} onLayout={() => setReady(true)}>
        {ANDROID_BLUR && target.current ? (
          <BlurView
            blurTarget={target}
            blurMethod="dimezisBlurViewSdk31Plus"
            intensity={composerFrost.intensity}
            // The composer is small: blur a quarter-size image of the list, as the home pill does.
            blurReductionFactor={4}
            tint={dark ? "dark" : "light"}
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? composerFrost.fillDark : composerFrost.fillLight },
          ]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderCurve: "continuous",
              borderWidth: 1,
              borderColor: `rgba(255, 255, 255, ${dark ? pill.rimBottomDark : pill.rimBottomLight})`,
              borderTopColor: `rgba(255, 255, 255, ${dark ? pill.rimTopDark : pill.rimTopLight})`,
            },
          ]}
        />
      </Animated.View>
    </>
  );
}
