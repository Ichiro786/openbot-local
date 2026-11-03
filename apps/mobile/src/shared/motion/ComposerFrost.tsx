import { BlurView } from "expo-blur";
import { type RefObject, useEffect, useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { useBlurBudget } from "@/shared/glass/blurBudget";
import { GlintRim } from "@/shared/glass/GlintRim";
import { composerFrost } from "./tokens";
import { useBlurLive } from "./useBlurLive";
import { zoomCovering } from "./ZoomOpenOverlay";

/**
 * Build 10 (ColorOS motion, Android 12+): the chat composer's frosted glass, the home search pill's
 * look with a more opaque tint. It lies first in the composer card (so it is clipped by the card's
 * radius) and blurs the chat's message list target, a sibling region: the composer is outside it.
 *
 * Blur rules (build 9): the BlurView always uses `dimezisBlurViewSdk31Plus` (never `none`, which
 * paints a solid tint), mounts at opacity 0 and fades in after its first layout, and is hidden with
 * opacity while `shown` is false; it stops blurring (`none`, hidden in the same commit) the moment it is paused. Under the blur, the card's solid fill comes back with the inverse
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
  // Paused = not blurring at once (build 9 rule 8): the blur is hidden and set to `none` in the same
  // commit and the glass goes with it (the solid fill takes its place), so a menu that takes this
  // frost's place never runs alongside it and no unblurred glass fill is ever seen.
  const live = useBlurLive(on);
  useBlurBudget(live, "composer-frost");
  // Build 11 (review R3-2): mounted under the zoom surface, the first frost comes on at once; the
  // surface's one dissolve is the fade, so the composer never crossfades after the reveal.
  const underZoom = useRef(zoomCovering());
  useEffect(() => {
    const instant = on && underZoom.current;
    if (on) underZoom.current = false;
    // Paused: the glass goes at once with its blur (fading the fill alone would show unblurred text).
    visible.set(withTiming(on ? 1 : 0, { duration: on && !instant ? composerFrost.fadeInMs : 0 }));
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
            blurMethod={on ? "dimezisBlurViewSdk31Plus" : "none"}
            intensity={composerFrost.intensity}
            // The composer is small: blur a quarter-size image of the list, as the home pill does.
            blurReductionFactor={4}
            tint={dark ? "dark" : "light"}
            style={[StyleSheet.absoluteFill, { opacity: live ? 1 : 0 }]}
          />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: dark ? composerFrost.fillDark : composerFrost.fillLight },
          ]}
        />
        {/* Build 11: soft edge glints (spec §1) in place of the drawn top hairline. */}
        <GlintRim radius={radius} dark={dark} />
      </Animated.View>
    </>
  );
}
