import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { press, stretch } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  hitSlop?: number;
};

/**
 * Header/floating button: swells on touch with a white lift and springs back on release.
 *
 * Build 7 drove this with a gesture-handler Pan (minDistance 0) that decided the tap itself on the UI
 * thread. Inside the Android native-stack header the gesture handler root does not reliably get the
 * touches, a tap was judged from a spring value read the same frame it was set, and haptics were
 * passed to runOnJS as an object method. It is now a plain Pressable: React Native delivers the tap,
 * the motion is transform-only and never decides whether the press counts. The finger-follow stretch
 * is dropped (correctness over effect).
 */
export function PressableStretch({
  children,
  style,
  radius = 0,
  onPress,
  accessibilityLabel,
  disabled = false,
  hitSlop,
}: Props) {
  const { enabled, reduceMotion } = useColorOSMotion();
  const scale = useSharedValue(1);
  const light = useSharedValue(0);
  const animate = enabled && !reduceMotion;

  const body = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.value }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onPressIn={() => {
        if (!enabled) return;
        light.value = withTiming(press.highlightOpacity, { duration: press.highlightInMs });
        if (animate) scale.value = withSpring(stretch.swell, stretch.returnSpring);
        void haptics.impact("light");
      }}
      onPressOut={() => {
        scale.value = animate ? withSpring(1, stretch.returnSpring) : 1;
        light.value = withTiming(0, { duration: press.highlightOutMs, easing: Easing.out(Easing.quad) });
      }}
      style={[style, body]}
    >
      {children}
      {enabled ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", borderRadius: radius }, lightStyle]}
        />
      ) : null}
    </AnimatedPressable>
  );
}

/**
 * Was a gesture-handler Manual gesture round a control that keeps its own Pressable (the floating
 * glass capsules). It competed with the inner Pressable and the scroll views under the composer, so
 * it is now a pass-through: the capsule keeps its own opacity press.
 */
export function StretchShell({ children }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <>{children}</>;
}
