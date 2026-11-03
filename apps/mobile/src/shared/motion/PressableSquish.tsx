import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { press } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style" | "children"> & {
  children?: ReactNode;
  /** Same style the original Pressable had: layout is untouched. */
  style?: StyleProp<ViewStyle>;
  /** Corner radius of the highlight layer (match the button). */
  radius?: number;
  /** Row variant: lighter scale (0.98) and no haptic. */
  variant?: "button" | "row";
  haptic?: boolean;
};

/**
 * ColorOS 17 press feedback: scale to 0.96 on a 600/39 spring, a white highlight
 * that rises in 25 ms and decays over ~140 ms, and a light haptic on press-in.
 * Only a transform on the Pressable and an absolute overlay as its last child,
 * so the layout never changes.
 */
export function PressableSquish({
  children,
  style,
  radius = 0,
  variant = "button",
  haptic = variant === "button",
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const { enabled, reduceMotion } = useColorOSMotion();
  const scale = useSharedValue(1);
  const light = useSharedValue(0);
  const target = variant === "row" ? press.rowScale : press.scale;

  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.value }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, scaleStyle]}
      onPressIn={(e) => {
        if (enabled) {
          if (!reduceMotion) scale.value = withSpring(target, press.spring);
          light.value = withTiming(press.highlightOpacity, { duration: press.highlightInMs });
          if (haptic) void haptics.impact("light");
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (enabled) {
          scale.value = reduceMotion ? 1 : withSpring(1, press.spring);
          light.value = withTiming(0, { duration: press.highlightOutMs, easing: Easing.out(Easing.quad) });
        }
        onPressOut?.(e);
      }}
    >
      {children}
      {enabled ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.light, { borderRadius: radius }, lightStyle]}
        />
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  light: { backgroundColor: "#ffffff" },
});
