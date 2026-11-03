import { Spinner } from "heroui-native";
import ArrowUp from "lucide-react-native/icons/arrow-up";
import AudioLines from "lucide-react-native/icons/audio-lines";
import Square from "lucide-react-native/icons/square";
import { type ReactNode, useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { AnimatedPressable } from "@/shared/components/animated-pressable";
import { useMotion } from "@/shared/lib/motion";

// The control is drawn in a 40 pt box. Round while it sends or dictates; while a turn runs it
// becomes the rounded square M3 Expressive uses for a selected icon button, so Stop reads as a
// different control in the same place.
const ROUND_RADIUS = 20;
const SQUARE_RADIUS = 12;
// A primed fill grows in from this scale on the fast spatial spring, so it pops with a small overshoot.
const FILL_REST_SCALE = 0.82;

type Mode = "send" | "stop" | "dictate";

interface ComposerSendControlProps {
  mode: Mode;
  primed: boolean;
  spinner: boolean;
  /** False while dictation still writes the draft: Send waits for the last words. */
  ready: boolean;
  /** The card dims as a whole when the composer is disabled, so the control does not dim again. */
  disabled: boolean;
  label: string;
  /** The agent's colour behind Send, Stop and the voice mode. */
  accentFill: string;
  /** The glyph colour on that fill. */
  accentGlyph: string;
  muted: ViewStyle["backgroundColor"];
  onPress: () => void;
}

/**
 * Send, Stop and Dictate as one control that changes role in place. The fill, its shape and the three
 * glyphs are always mounted and move on shared values: a mode change starts springs on the UI thread
 * and never remounts the button, so the eye stays on the same target.
 */
export function ComposerSendControl({
  mode,
  primed,
  spinner,
  ready,
  disabled,
  label,
  accentFill,
  accentGlyph,
  muted,
  onPress,
}: ComposerSendControlProps) {
  const motion = useMotion();
  const send = useSharedValue(!spinner && mode === "send" ? 1 : 0);
  const stop = useSharedValue(!spinner && mode === "stop" ? 1 : 0);
  const mic = useSharedValue(!spinner && mode === "dictate" ? 1 : 0);
  // The voice mode is always filled: it sets it apart from the dictation mic beside it.
  const filled = primed || mode === "dictate";
  const fill = useSharedValue(filled ? 1 : 0);
  const fillScale = useSharedValue(filled ? 1 : 0);
  const square = useSharedValue(mode === "stop" ? 1 : 0);

  useEffect(() => {
    send.set(withSpring(!spinner && mode === "send" ? 1 : 0, motion.fastSpatial));
    stop.set(withSpring(!spinner && mode === "stop" ? 1 : 0, motion.fastSpatial));
    mic.set(withSpring(!spinner && mode === "dictate" ? 1 : 0, motion.fastSpatial));
    square.set(withSpring(mode === "stop" ? 1 : 0, motion.fastSpatial));
  }, [mode, spinner, motion, send, stop, mic, square]);

  useEffect(() => {
    fill.set(withSpring(filled ? 1 : 0, motion.fastEffects));
    fillScale.set(withSpring(filled ? 1 : 0, motion.fastSpatial));
  }, [filled, motion, fill, fillScale]);

  const transforms = motion.transforms;
  const fillStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, fill.get())),
    borderRadius: ROUND_RADIUS + (SQUARE_RADIUS - ROUND_RADIUS) * square.get(),
    transform: [{ scale: transforms ? FILL_REST_SCALE + (1 - FILL_REST_SCALE) * fillScale.get() : 1 }],
  }));

  return (
    <AnimatedPressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !ready, busy: spinner }}
      disabled={!ready}
      className="size-10 items-center justify-center"
      onPress={onPress}
    >
      {/* Dim lives on this inner layer: the pressable's own opacity belongs to its press feedback. */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.center, { opacity: disabled || ready ? 1 : 0.45 }]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: accentFill }, fillStyle]} />
        {spinner ? <Spinner size="sm" color={accentGlyph} /> : null}
        <Glyph progress={send} turn={-45} transforms={transforms}>
          <ArrowUp color={primed ? accentGlyph : String(muted)} size={21} strokeWidth={2.2} />
        </Glyph>
        <Glyph progress={stop} turn={45} transforms={transforms}>
          <Square color={accentGlyph} fill={accentGlyph} size={14} strokeWidth={2} />
        </Glyph>
        <Glyph progress={mic} turn={0} transforms={transforms}>
          <AudioLines color={accentGlyph} size={20} strokeWidth={2} />
        </Glyph>
      </View>
    </AnimatedPressable>
  );
}

/** One glyph of the control: it scales in from 0.6 with a small turn while the others leave. */
function Glyph({
  progress,
  turn,
  transforms,
  children,
}: {
  progress: SharedValue<number>;
  turn: number;
  transforms: boolean;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const shown = progress.get();
    const clamped = Math.min(1, Math.max(0, shown));
    return {
      opacity: clamped,
      transform: transforms ? [{ scale: 0.6 + 0.4 * shown }, { rotate: `${(1 - clamped) * turn}deg` }] : [],
    };
  });
  return <Animated.View style={[styles.glyph, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  glyph: { position: "absolute" },
});
