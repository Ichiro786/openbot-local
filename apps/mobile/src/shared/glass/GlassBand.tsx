import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { type RefObject, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import Animated from "react-native-reanimated";
import { useUniwind } from "uniwind";
import { ANDROID_BLUR } from "@/shared/components/glass-capsule";
import { useBlurLive } from "@/shared/motion/useBlurLive";
import { useBlurBudget } from "./blurBudget";
import { type GlassPress, useGlassPressStyle } from "./GlassButton";
import { glass } from "./tokens";

/** One glass shape in the band, in the band's own coordinates. */
export type GlassBandShape = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  /** The button's press, so the blur squashes and follows with it. */
  press?: GlassPress;
};

/**
 * Build 11: ONE BlurView behind several glass controls of a bar (the chat header's back, name pill and
 * •••), masked to the union of their shapes in a hardware layer (the build 9 HomeEdgeBlur pattern), so
 * a whole bar costs one blur of the budget. The mask shapes share the buttons' press values. It blurs a
 * sibling target (this band sits outside it), mounts at opacity 0, goes live two frames after it starts
 * and stops at once (`none`, hidden in the same commit) when `shown` turns false.
 */
export function GlassBand({
  target,
  shown,
  shapes,
  style,
}: {
  target: RefObject<ViewInstance | null> | undefined;
  shown: boolean;
  shapes: readonly GlassBandShape[];
  style?: object;
}) {
  const dark = useUniwind().theme === "dark";
  const [ready, setReady] = useState(false);
  const running = ready && shown && ANDROID_BLUR && Boolean(target?.current) && shapes.length > 0;
  const live = useBlurLive(running);
  useBlurBudget(live, "glass-band");
  if (!ANDROID_BLUR || !target) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
      onLayout={() => setReady(true)}
    >
      <MaskedView
        androidRenderingMode="hardware"
        style={StyleSheet.absoluteFill}
        maskElement={
          <View style={StyleSheet.absoluteFill}>
            {shapes.map((shape) => (
              <MaskShape key={shape.key} shape={shape} />
            ))}
          </View>
        }
      >
        {target.current ? (
          <BlurView
            blurTarget={target}
            blurMethod={running ? "dimezisBlurViewSdk31Plus" : "none"}
            intensity={glass.material.button.intensity}
            blurReductionFactor={glass.material.button.reduction}
            tint={dark ? "dark" : "light"}
            style={[StyleSheet.absoluteFill, { opacity: live ? 1 : 0 }]}
          />
        ) : null}
      </MaskedView>
    </View>
  );
}

function MaskShape({ shape }: { shape: GlassBandShape }) {
  return shape.press ? <PressedMaskShape shape={shape} press={shape.press} /> : <View style={maskStyle(shape)} />;
}

function PressedMaskShape({ shape, press }: { shape: GlassBandShape; press: GlassPress }) {
  const pressStyle = useGlassPressStyle(press);
  return <Animated.View style={[maskStyle(shape), pressStyle]} />;
}

function maskStyle(shape: GlassBandShape) {
  return {
    position: "absolute" as const,
    left: shape.x,
    top: shape.y,
    width: shape.width,
    height: shape.height,
    borderRadius: shape.radius,
    backgroundColor: "#000000",
  };
}
