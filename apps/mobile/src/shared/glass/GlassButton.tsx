import { type ReactNode, useRef } from "react";
import {
  type AccessibilityValue,
  type GestureResponderEvent,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { haptics } from "@/shared/lib/haptics";
import { useColorOSMotion } from "@/shared/motion/useColorOSMotion";
import { GlintRim } from "./GlintRim";
import { followAmount, glass } from "./tokens";

/** The shared values of one button's press: a `GlassBand` mask shape reads the same ones. */
export type GlassPress = {
  scale: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
  along: SharedValue<number>;
  across: SharedValue<number>;
  /** The drag direction, in radians. */
  angle: SharedValue<number>;
  highlight: SharedValue<number>;
};

export function useGlassPress(): GlassPress {
  return {
    scale: useSharedValue(1),
    x: useSharedValue(0),
    y: useSharedValue(0),
    along: useSharedValue(1),
    across: useSharedValue(1),
    angle: useSharedValue(0),
    highlight: useSharedValue(0),
  };
}

/** The transform of a pressed button: shrink, follow the finger, and squash across the drag. */
export function useGlassPressStyle(press: GlassPress) {
  return useAnimatedStyle(() => {
    const angle = press.angle.get();
    return {
      transform: [
        { translateX: press.x.get() },
        { translateY: press.y.get() },
        { rotate: `${angle}rad` },
        { scaleX: press.scale.get() * press.along.get() },
        { scaleY: press.scale.get() * press.across.get() },
        { rotate: `${-angle}rad` },
      ],
    };
  });
}

/**
 * Drives a `GlassPress` from the raw touches of a Pressable (JS thread writes shared values; the
 * springs run on the UI thread). No gesture-handler root, so it is safe in native headers (build 8/9
 * lesson), and Pressable alone decides whether the tap counts.
 */
export function useGlassPressHandlers(press: GlassPress, size: number, enabled: boolean, reduceMotion: boolean) {
  const origin = useRef({ x: 0, y: 0 });
  const release = () => {
    const spring = reduceMotion ? null : glass.press.release;
    const home = (value: SharedValue<number>, to: number) =>
      value.set(spring ? withSpring(to, spring) : withTiming(to, { duration: glass.press.reducedMs }));
    home(press.scale, 1);
    home(press.x, 0);
    home(press.y, 0);
    home(press.along, 1);
    home(press.across, 1);
    press.highlight.set(withTiming(0, { duration: glass.press.highlightOutMs, easing: Easing.out(Easing.quad) }));
  };
  if (!enabled) return {};
  return {
    onTouchStart: (event: GestureResponderEvent) => {
      origin.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      press.scale.set(
        reduceMotion
          ? withTiming(glass.press.scale, { duration: glass.press.reducedMs })
          : withSpring(glass.press.scale, glass.press.inSpring),
      );
      press.highlight.set(withTiming(glass.press.highlight, { duration: glass.press.highlightInMs }));
      void haptics.impact("light");
    },
    onTouchMove: (event: GestureResponderEvent) => {
      if (reduceMotion) return;
      const from = origin.current;
      const dx = event.nativeEvent.pageX - from.x;
      const dy = event.nativeEvent.pageY - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance > glass.press.cancelFactor * size) {
        release();
        return;
      }
      if (distance < 0.5) return;
      const amount = followAmount(distance);
      const reach = glass.press.followMax * size * amount;
      press.x.set((dx / distance) * reach);
      press.y.set((dy / distance) * reach);
      press.angle.set(Math.atan2(dy, dx));
      press.along.set(1 + glass.press.stretchAlong * amount);
      press.across.set(1 - glass.press.squashAcross * amount);
    },
    onTouchEnd: release,
    onTouchCancel: release,
  };
}

/**
 * The visible glass of a control: the Notes material (fill, soft shadow), the press highlight, the
 * lens and the GlintRim edge, moved by its press values. `solid` is the glass with nothing to blur
 * behind (an opaque bar, dark media); `band` is a lighter tint over a `GlassBand` blur drawn behind it
 * by its bar; `none` has no glass of its own (an icon inside the composer glass) and only the press.
 */
export function GlassFace({
  press,
  variant = "circle",
  size = 40,
  width,
  material = "solid",
  contentPadding,
  children,
}: {
  press: GlassPress;
  variant?: "circle" | "pill";
  size?: number;
  width?: number;
  material?: "solid" | "band" | "none";
  /** A pill's horizontal padding (default 12). */
  contentPadding?: number;
  children?: ReactNode;
}) {
  const dark = useUniwind().theme === "dark";
  const pressStyle = useGlassPressStyle(press);
  const highlightStyle = useAnimatedStyle(() => ({ opacity: press.highlight.get() }));
  const radius = size / 2;
  const shape = {
    height: size,
    width: variant === "circle" ? size : width,
    minWidth: size,
    borderRadius: radius,
    borderCurve: "continuous" as const,
  };
  const { button } = glass.material;
  const fill =
    material === "none"
      ? undefined
      : material === "band"
        ? dark
          ? button.overBlurDark
          : button.overBlurLight
        : dark
          ? button.solidDark
          : button.overBlurLight;
  return (
    <Animated.View style={[shape, pressStyle]}>
      {material === "none" ? null : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderCurve: "continuous",
              backgroundColor: fill,
              boxShadow: material === "solid" ? (dark ? button.shadow : button.shadowLight) : undefined,
            },
          ]}
        />
      )}
      <View
        style={[
          styles.content,
          { borderRadius: radius, paddingHorizontal: variant === "pill" ? (contentPadding ?? 12) : 0 },
        ]}
      >
        {children}
      </View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: "#ffffff" }, highlightStyle]}
      />
      {material === "none" ? null : <GlintRim radius={radius} dark={dark} />}
    </Animated.View>
  );
}

/**
 * Build 11.3 motion (Syed's 1000053850 video): room round a glass button in a native header slot. The
 * react-native-screens header subview is a plain Android ViewGroup (clipChildren = true), so it cuts
 * its React root at the root's own bounds; a button that follows the finger (up to followMax 0.32 of
 * its size, ~13 dp) out of its 48 dp box lost its far edges flat. The margin hands the space back, so
 * layout and touch target stay where they were while the root, and so the clip, is ROOM dp larger.
 */
const HEADER_ROOM = 16;
export function GlassHeaderRoom({ children }: { children: ReactNode }) {
  return (
    <View pointerEvents="box-none" style={{ margin: -HEADER_ROOM, padding: HEADER_ROOM }}>
      {children}
    </View>
  );
}

/**
 * Build 11 (ColorOS motion): a round or pill glass control in the Notes material (see `GlassFace`).
 * The press shrinks to 0.955, follows a drag and squashes across it, then springs back with the Notes
 * bounce (205/10). Reduced motion keeps only the scale and the highlight.
 */
export function GlassButton({
  variant = "circle",
  size = 40,
  width,
  material = "solid",
  contentPadding,
  press: external,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityValue,
  onPress,
  onPressIn,
  onLongPress,
  disabled = false,
  hitSlop,
  style,
  children,
}: {
  variant?: "circle" | "pill";
  /** The height (and a circle's width), in dp. */
  size?: number;
  /** A pill's width; unset = sized by its content. */
  width?: number;
  material?: "solid" | "band" | "none";
  contentPadding?: number;
  /** Shared press values, when a `GlassBand` mask must follow this button. */
  press?: GlassPress;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
  accessibilityValue?: AccessibilityValue;
  onPress?: () => void;
  /** Build 11.3 motion B3: a head start for work the press will need (the zoom-close still). */
  onPressIn?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const own = useGlassPress();
  const press = external ?? own;
  const { reduceMotion } = useColorOSMotion();
  const handlers = useGlassPressHandlers(press, size, !disabled, reduceMotion);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, ...accessibilityState }}
      accessibilityValue={accessibilityValue}
      disabled={disabled}
      // A 48 dp target round a 40 dp button.
      hitSlop={hitSlop ?? Math.max(0, (48 - size) / 2)}
      onPress={onPress}
      onPressIn={onPressIn}
      onLongPress={onLongPress}
      style={style}
      {...handlers}
    >
      <GlassFace
        press={press}
        variant={variant}
        size={size}
        width={width}
        material={material}
        contentPadding={contentPadding}
      >
        {children}
      </GlassFace>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", overflow: "hidden" },
});
