import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "@/shared/lib/haptics";
import { press, stretch } from "./tokens";
import { useColorOSMotion } from "./useColorOSMotion";

type Props = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  hitSlop?: number;
};

const soft = (d: number) => {
  "worklet";
  const x = Math.abs(d) / stretch.falloff;
  return Math.sign(d) * stretch.maxOffset * (x / (1 + x));
};

/**
 * Header/floating button: swells on touch, follows the finger with a capped soft offset,
 * stretches slightly along the drag axis, springs back on release. Transforms only.
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
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const light = useSharedValue(0);
  const animate = enabled && !reduceMotion;

  const gesture = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .hitSlop(hitSlop ?? 0)
    .onBegin(() => {
      if (enabled) {
        light.value = withTiming(press.highlightOpacity, { duration: press.highlightInMs });
        runOnJS(haptics.impact)("light");
      }
      if (animate) scale.value = withSpring(stretch.swell, stretch.returnSpring);
    })
    .onUpdate((e) => {
      if (!animate) return;
      tx.value = soft(e.translationX);
      ty.value = soft(e.translationY);
    })
    .onFinalize((_e, success) => {
      scale.value = withSpring(1, stretch.returnSpring);
      tx.value = withSpring(0, stretch.returnSpring);
      ty.value = withSpring(0, stretch.returnSpring);
      light.value = withTiming(0, { duration: press.highlightOutMs, easing: Easing.out(Easing.quad) });
      if (success && onPress && Math.abs(tx.value) < 2 && Math.abs(ty.value) < 2) runOnJS(onPress)();
    });

  const body = useAnimatedStyle(() => {
    const sx = 1 + Math.min(stretch.maxAlong, (Math.abs(tx.value) / stretch.maxOffset) * stretch.maxAlong);
    const sy = 1 + Math.min(stretch.maxAlong, (Math.abs(ty.value) / stretch.maxOffset) * stretch.maxAlong);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scaleX: scale.value * sx },
        { scaleY: scale.value * sy },
      ],
    };
  });
  const lightStyle = useAnimatedStyle(() => ({ opacity: light.value }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        onAccessibilityTap={disabled ? undefined : onPress}
        style={[style, body]}
      >
        {children}
        {enabled ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", borderRadius: radius }, lightStyle]}
          />
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The stretch of PressableStretch for a control that keeps its own pressable (a glass capsule): a
 * manual gesture that never activates, so the inner Pressable still gets the tap, drives the swell,
 * the soft follow and the axis stretch from the raw touches.
 */
export function StretchShell({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { enabled, reduceMotion } = useColorOSMotion();
  const animate = enabled && !reduceMotion;
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const origin = useSharedValue({ x: 0, y: 0 });

  const gesture = Gesture.Manual()
    .enabled(animate)
    .onTouchesDown((e) => {
      const touch = e.allTouches[0];
      if (!touch) return;
      origin.value = { x: touch.absoluteX, y: touch.absoluteY };
      scale.value = withSpring(stretch.swell, stretch.returnSpring);
    })
    .onTouchesMove((e) => {
      const touch = e.allTouches[0];
      if (!touch) return;
      tx.value = soft(touch.absoluteX - origin.value.x);
      ty.value = soft(touch.absoluteY - origin.value.y);
    })
    .onTouchesUp(() => {
      scale.value = withSpring(1, stretch.returnSpring);
      tx.value = withSpring(0, stretch.returnSpring);
      ty.value = withSpring(0, stretch.returnSpring);
    })
    .onTouchesCancelled(() => {
      scale.value = withSpring(1, stretch.returnSpring);
      tx.value = withSpring(0, stretch.returnSpring);
      ty.value = withSpring(0, stretch.returnSpring);
    });

  const body = useAnimatedStyle(() => {
    const sx = 1 + Math.min(stretch.maxAlong, (Math.abs(tx.value) / stretch.maxOffset) * stretch.maxAlong);
    const sy = 1 + Math.min(stretch.maxAlong, (Math.abs(ty.value) / stretch.maxOffset) * stretch.maxAlong);
    return {
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scaleX: scale.value * sx },
        { scaleY: scale.value * sy },
      ],
    };
  });

  if (!enabled) return <>{children}</>;
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[style, body]}>{children}</Animated.View>
    </GestureDetector>
  );
}
