import {
  Canvas,
  Circle,
  LinearGradient,
  RadialGradient,
  RoundedRect,
  SweepGradient,
  vec,
} from "@shopify/react-native-skia";
import { Typography } from "heroui-native";
import { memo, useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { hexToHsv, hsvToHex, PRESET_HUES } from "@/features/agents/model/avatar-color";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

/*
 * Build 11.2: the custom colour wheel of the agent Appearance screen. Angle is hue, radius is
 * saturation (white centre); the slider below runs from the chosen colour to black (brightness).
 * Everything that moves runs on the UI thread: the gesture writes h/s/v shared values, Skia reads them
 * through derived values, and the JS side hears at most one preview every PREVIEW_MS and one commit on
 * release. Every worklet helper is declared above its first worklet caller (build 8 lesson).
 */

const WHEEL = 248;
const R = WHEEL / 2;
const THUMB = 30;
const SLIDER_H = 32;
const PREVIEW_MS = 80;
/** A preset tick fires when the hue comes within this many degrees of a preset, once per preset. */
const TICK_DEG = 4;
const MIN_TICK_SAT = 0.35;
const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"];

const presetIndexNear = (h: number): number => {
  "worklet";
  for (let i = 0; i < PRESET_HUES.length; i += 1) {
    const d = Math.abs((PRESET_HUES[i] ?? 0) - h);
    if (Math.min(d, 360 - d) <= TICK_DEG) return i;
  }
  return -1;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

interface AgentColorWheelProps {
  /** The colour shown when the screen opens (custom, or the preset/automatic felt colour). */
  initial: string;
  disabled: boolean;
  /** Throttled while dragging: the plush preview follows. */
  onPreview: (hex: string) => void;
  /** On release (and on each TalkBack step): save. */
  onCommit: (hex: string) => void;
}

export const AgentColorWheel = memo(function AgentColorWheel({
  initial,
  disabled,
  onPreview,
  onCommit,
}: AgentColorWheelProps) {
  const { t } = useText();
  const reduced = useReducedMotion();
  const start = useMemo(() => hexToHsv(initial), [initial]);
  const h = useSharedValue(start.h);
  const s = useSharedValue(start.s);
  const v = useSharedValue(start.v);
  const lastPreview = useSharedValue(0);
  const lastTick = useSharedValue(presetIndexNear(start.h));
  const pressed = useSharedValue(0);

  const hex = useDerivedValue(() => hsvToHex(h.value, s.value, v.value));
  const pure = useDerivedValue(() => hsvToHex(h.value, s.value, 1));
  const sliderColors = useDerivedValue(() => [pure.value, "#000000"]);
  const wheelDim = useDerivedValue(() => 1 - Math.max(0.35, v.value));

  const tick = useCallback(() => void haptics.selection(), []);
  // TalkBack reads these; the shared values move on the UI thread without re-rendering.
  const [spoken, setSpoken] = useState(start);
  const commit = useCallback(
    (next: string) => {
      setSpoken(hexToHsv(next));
      onCommit(next);
    },
    [onCommit],
  );

  // Throttled preview while the value moves (from the gesture or a TalkBack step).
  useAnimatedReaction(
    () => hex.value,
    (next, previous) => {
      if (next === previous) return;
      const now = Date.now();
      if (now - lastPreview.value < PREVIEW_MS) return;
      lastPreview.value = now;
      scheduleOnRN(onPreview, next);
    },
  );

  const setFromWheel = (x: number, y: number) => {
    "worklet";
    const dx = x - R;
    const dy = y - R;
    const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    h.value = hue;
    s.value = Math.min(1, Math.sqrt(dx * dx + dy * dy) / R);
    const near = s.value >= MIN_TICK_SAT ? presetIndexNear(hue) : -1;
    if (near !== lastTick.value) {
      lastTick.value = near;
      if (near >= 0) scheduleOnRN(tick);
    }
  };
  const release = () => {
    "worklet";
    pressed.value = withTiming(0, { duration: reduced ? 0 : 140 });
    lastPreview.value = 0;
    scheduleOnRN(onPreview, hex.value);
    scheduleOnRN(commit, hex.value);
  };

  const wheelGesture = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((event) => {
      pressed.value = withTiming(1, { duration: reduced ? 0 : 120 });
      setFromWheel(event.x, event.y);
    })
    .onUpdate((event) => setFromWheel(event.x, event.y))
    .onFinalize(release);

  const setFromSlider = (x: number, width: number) => {
    "worklet";
    v.value = 1 - Math.min(1, Math.max(0, x / width));
  };
  const sliderWidth = useSharedValue(1);
  const sliderGesture = Gesture.Pan()
    .enabled(!disabled)
    .minDistance(0)
    .onBegin((event) => setFromSlider(event.x, sliderWidth.value))
    .onUpdate((event) => setFromSlider(event.x, sliderWidth.value))
    .onFinalize(release);

  const thumbStyle = useAnimatedStyle(() => {
    const angle = (h.value * Math.PI) / 180;
    const radius = s.value * (R - THUMB / 4);
    return {
      backgroundColor: hex.value,
      transform: [
        { translateX: R - THUMB / 2 + Math.cos(angle) * radius },
        { translateY: R - THUMB / 2 + Math.sin(angle) * radius },
        { scale: 1 + pressed.value * 0.18 },
      ],
    };
  });
  const knobStyle = useAnimatedStyle(() => ({
    backgroundColor: hex.value,
    transform: [{ translateX: (1 - v.value) * (sliderWidth.value - SLIDER_H) }],
  }));

  // TalkBack: hue on the wheel, saturation on the thumb, brightness on the slider. Each step commits.
  const step = (kind: "h" | "s" | "v", direction: 1 | -1) => {
    if (kind === "h") h.value = (h.value + direction * 10 + 360) % 360;
    else if (kind === "s") s.value = Math.min(1, Math.max(0, s.value + direction * 0.1));
    else v.value = Math.min(1, Math.max(0, v.value + direction * 0.1));
    commit(hsvToHex(h.value, s.value, v.value));
  };
  const actions = [{ name: "increment" as const }, { name: "decrement" as const }];
  const onAction = (kind: "h" | "s" | "v") => (event: { nativeEvent: { actionName: string } }) =>
    step(kind, event.nativeEvent.actionName === "increment" ? 1 : -1);

  return (
    <View style={styles.root}>
      <Typography.Paragraph accessibilityRole="header" className="text-center text-muted" style={styles.hint}>
        {t("mobile.agent.appearance.custom.title")}
      </Typography.Paragraph>
      <GestureDetector gesture={wheelGesture}>
        <View
          style={styles.wheel}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t("mobile.agent.appearance.custom.hue")}
          accessibilityValue={{ text: `${Math.round(spoken.h)}°` }}
          accessibilityActions={actions}
          onAccessibilityAction={onAction("h")}
          testID="agent-color-wheel"
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Circle cx={R} cy={R} r={R}>
              <SweepGradient c={vec(R, R)} colors={HUE_STOPS} />
            </Circle>
            <Circle cx={R} cy={R} r={R}>
              <RadialGradient c={vec(R, R)} r={R} colors={["#ffffff", "#ffffff00"]} />
            </Circle>
            {/* Darkens with brightness, never fully: the hue stays readable. */}
            <Circle cx={R} cy={R} r={R} color="#000000" opacity={wheelDim} />
            {/* Hairline glass rim: the wheel sits on the dark glass sheet. */}
            <Circle cx={R} cy={R} r={R - 0.5} style="stroke" strokeWidth={1} color="rgba(255,255,255,0.18)" />
          </Canvas>
          <Animated.View
            style={[styles.thumb, thumbStyle]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={t("mobile.agent.appearance.custom.saturation")}
            accessibilityValue={{ text: pct(spoken.s) }}
            accessibilityActions={actions}
            onAccessibilityAction={onAction("s")}
          />
        </View>
      </GestureDetector>
      <GestureDetector gesture={sliderGesture}>
        <View
          style={styles.slider}
          onLayout={(event) => {
            sliderWidth.value = Math.max(1, event.nativeEvent.layout.width);
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t("mobile.agent.appearance.custom.brightness")}
          accessibilityValue={{ text: pct(spoken.v) }}
          accessibilityActions={actions}
          onAccessibilityAction={onAction("v")}
          testID="agent-color-brightness"
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <RoundedRect x={0} y={0} width={WHEEL} height={SLIDER_H} r={SLIDER_H / 2}>
              <LinearGradient start={vec(0, 0)} end={vec(WHEEL, 0)} colors={sliderColors} />
            </RoundedRect>
          </Canvas>
          <Animated.View style={[styles.knob, knobStyle]} pointerEvents="none" />
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { alignItems: "center", gap: 16, marginTop: 8 },
  wheel: { width: WHEEL, height: WHEEL, borderRadius: R },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
    elevation: 6,
  },
  slider: { width: WHEEL, height: SLIDER_H, borderRadius: SLIDER_H / 2, overflow: "hidden" },
  knob: {
    position: "absolute",
    top: 2,
    left: 2,
    width: SLIDER_H - 4,
    height: SLIDER_H - 4,
    borderRadius: (SLIDER_H - 4) / 2,
    borderWidth: 3,
    borderColor: "#ffffff",
  },
  hint: { fontSize: 12 },
});
