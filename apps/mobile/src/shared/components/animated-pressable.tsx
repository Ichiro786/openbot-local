import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { useMotion } from "@/shared/lib/motion";
import { EASE_OUT, PRESSED_OPACITY, PRESSED_SCALE } from "@/shared/lib/motion-tokens";
import { press as colorOSPress } from "@/shared/motion/tokens";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";

const AnimatedBase = Animated.createAnimatedComponent(Pressable);

/** The haptic a press plays on release. One per action, so leave it off where onPress plays its own. */
export type PressHaptic = "selection" | "light" | "medium" | "send" | "confirm" | "reject" | "longPress";

function playHaptic(kind: PressHaptic): void {
  switch (kind) {
    case "selection":
      void haptics.selection();
      return;
    case "light":
      void haptics.impact("light");
      return;
    case "medium":
      void haptics.impact("medium");
      return;
    case "send":
      void haptics.send();
      return;
    case "confirm":
      void haptics.confirm();
      return;
    case "reject":
      void haptics.reject();
      return;
    case "longPress":
      void haptics.longPress();
  }
}

/** Presets: a button or chip scales a little; a full-width row barely scales, so its edges stay put. */
const VARIANT_SCALE = { control: PRESSED_SCALE, row: 0.985, none: 1 } as const;
const VARIANT_OPACITY = { control: PRESSED_OPACITY, row: 0.9, none: 0.7 } as const;

// A quick tap lands its press-in before the release. Without this a 40 ms tap moves the control
// by a pixel and the press never reads; M3's button group waits for most of the press the same way.
const PRESS_IN_MS = 90;
const PRESS_SETTLE = 0.75;

export interface AnimatedPressableProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** How much the control gives under the finger. Default `control`. */
  variant?: keyof typeof VARIANT_SCALE;
  /** Overrides the variant's pressed scale. */
  pressScale?: number;
  /** Overrides the variant's pressed opacity. */
  pressOpacity?: number;
  /** Played with onPress. Off by default, since most handlers already play their own. */
  haptic?: PressHaptic;
  /** ColorOS motion: corner radius of the press highlight. Default: round for a control, square for a row. */
  highlightRadius?: number;
  /** ColorOS motion: the light tick on press-in. Default on for a control without its own `haptic`. */
  pressInHaptic?: boolean;
}

/** ColorOS 17 press: 0.96 (rows 0.98) on a 600/ζ0.8 spring, no dim, a white lift that decays in ~140 ms. */
const COLOROS_SCALE = { control: colorOSPress.scale, row: colorOSPress.rowScale, none: 1 } as const;
const COLOROS_LIGHT = {
  control: colorOSPress.highlightOpacity,
  row: colorOSPress.rowHighlightOpacity,
  none: 0,
} as const;

/**
 * Pressable that answers the touch: it sinks to ~0.97 and dims slightly on press-in, then springs
 * back on M3 Expressive fast spatial with a small overshoot. The press only flips a shared value;
 * the spring runs in a worklet on the UI thread, so a press never re-renders the component.
 * Under reduced motion only the opacity change plays.
 */
export function AnimatedPressable({
  variant = "control",
  pressScale,
  pressOpacity,
  haptic,
  highlightRadius,
  pressInHaptic,
  style,
  disabled,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...props
}: AnimatedPressableProps) {
  const motion = useMotion();
  const colorOS = useColorOSMotion().enabled;
  const restScale = colorOS ? COLOROS_SCALE[variant] : VARIANT_SCALE[variant];
  const minScale = motion.transforms ? (pressScale ?? restScale) : 1;
  const minOpacity = colorOS ? (pressOpacity ?? 1) : (pressOpacity ?? VARIANT_OPACITY[variant]);
  const release = colorOS && motion.transforms ? colorOSPress.spring : motion.fastSpatial;
  const fade = motion.fastEffects;
  const lightPeak = colorOS ? COLOROS_LIGHT[variant] : 0;
  const tickOnPressIn = colorOS && (pressInHaptic ?? (variant === "control" && haptic === undefined));
  const pressed = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const light = useSharedValue(0);

  useAnimatedReaction(
    () => pressed.get(),
    (now, before) => {
      if (before === null || now === before) return;
      if (now === 1) {
        scale.set(
          lightPeak > 0
            ? withSpring(minScale, release)
            : withTiming(minScale, { duration: PRESS_IN_MS, easing: EASE_OUT }),
        );
        opacity.set(withSpring(minOpacity, fade));
        if (lightPeak > 0) light.set(withTiming(lightPeak, { duration: colorOSPress.highlightInMs }));
        return;
      }
      if (lightPeak > 0) {
        light.set(withTiming(0, { duration: colorOSPress.highlightOutMs, easing: Easing.out(Easing.quad) }));
      }
      const depth = minScale < 1 ? (1 - scale.get()) / (1 - minScale) : 1;
      scale.set(
        depth < PRESS_SETTLE
          ? withSequence(
              withTiming(minScale, { duration: Math.round(PRESS_IN_MS * (1 - depth)), easing: EASE_OUT }),
              withSpring(1, release),
            )
          : withSpring(1, release),
      );
      opacity.set(withSpring(1, fade));
    },
    [minScale, minOpacity, release, fade, lightPeak],
  );

  // A caller's own opacity, such as a disabled dim, stays the resting value: the press scales it.
  const restOpacity = StyleSheet.flatten(style)?.opacity ?? 1;
  const pressStyle = useAnimatedStyle(() => ({
    opacity: restOpacity * opacity.get(),
    transform: [{ scale: scale.get() }],
  }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.get() }));
  const highlight =
    lightPeak > 0 ? (
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.light,
          { borderRadius: highlightRadius ?? (variant === "row" ? 0 : 999) },
          lightStyle,
        ]}
      />
    ) : null;

  return (
    <AnimatedBase
      {...props}
      disabled={disabled}
      style={[style, pressStyle]}
      onPressIn={(event: GestureResponderEvent) => {
        pressed.set(1);
        if (tickOnPressIn) void haptics.impact("light");
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        pressed.set(0);
        onPressOut?.(event);
      }}
      onPress={
        onPress
          ? (event: GestureResponderEvent) => {
              if (haptic) playHaptic(haptic);
              onPress(event);
            }
          : undefined
      }
    >
      {/* ColorOS off (no highlight): the children pass through unchanged, as before build 7. */}
      {highlight === null ? (
        children
      ) : typeof children === "function" ? (
        (state) => (
          <>
            {children(state)}
            {highlight}
          </>
        )
      ) : (
        <>
          {children}
          {highlight}
        </>
      )}
    </AnimatedBase>
  );
}

const styles = StyleSheet.create({
  light: { backgroundColor: "#ffffff" },
});
