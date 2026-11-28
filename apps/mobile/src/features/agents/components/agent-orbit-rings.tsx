import { Canvas, PaintStyle, Picture, Skia, StrokeCap, StrokeJoin, TileMode } from "@shopify/react-native-skia";
import { type PropsWithChildren, useEffect, useMemo } from "react";
import { View } from "react-native";
import {
  cancelAnimation,
  Easing,
  ReduceMotion,
  type SharedValue,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import {
  ORBIT_CYCLE,
  orbitFrameIndex,
  orbitFrames,
  orbitRings,
  prepareOrbitFrames,
} from "@/features/agents/model/bloub-orbit";
import { useMotionPreference } from "@/shared/lib/motion";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { useScreenFocusedWhile } from "@/shared/lib/use-screen-focused-while";

const RING_SCALE = 1.58 / 1.28;
const GRADIENT_OFFSETS = [0, 0.5, 1];

function OrbitLayer({ clock, layer, size }: { clock: SharedValue<number>; layer: "back" | "front"; size: number }) {
  const box = size * RING_SCALE;
  const kit = useMemo(
    () => ({
      recorder: Skia.PictureRecorder(),
      bounds: Skia.XYWHRect(0, 0, box, box),
      paints: orbitRings().map((ring) => {
        const paint = Skia.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(ring.width);
        paint.setStrokeCap(StrokeCap.Round);
        paint.setStrokeJoin(StrokeJoin.Miter);
        paint.setShader(
          Skia.Shader.MakeLinearGradient(
            { x: ring.gradient.x1, y: ring.gradient.y1 },
            { x: ring.gradient.x2, y: ring.gradient.y2 },
            ring.gradient.stops.map((color) => Skia.Color(color)),
            ring.gradient.stops.map((_, index) => GRADIENT_OFFSETS[index] ?? 1),
            TileMode.Clamp,
          ),
        );
        return paint;
      }),
    }),
    [box],
  );
  const picture = useDerivedValue(() => {
    const frames = orbitFrames.get();
    const frame = frames.length > 0 ? frames[orbitFrameIndex(clock.get(), frames.length)] : undefined;
    const canvas = kit.recorder.beginRecording(kit.bounds);
    canvas.translate(box / 2, box / 2);
    canvas.scale(size / 256, size / 256);
    if (frame) {
      for (let index = 0; index < frame.length; index += 1) {
        const arc = frame[index];
        const path = arc?.[layer];
        const paint = kit.paints[index];
        if (!arc || !path || !paint || arc.opacity <= 0) continue;
        paint.setAlphaf(arc.opacity);
        canvas.drawPath(path, paint);
      }
    }
    return kit.recorder.finishRecordingAsPicture();
  });
  return (
    <Canvas
      accessibilityElementsHidden
      accessible={false}
      pointerEvents="none"
      style={{ position: "absolute", left: (size - box) / 2, top: (size - box) / 2, width: box, height: box }}
    >
      <Picture picture={picture} />
    </Canvas>
  );
}

export function AgentOrbitRings({ active, size, children }: PropsWithChildren<{ active: boolean; size: number }>) {
  const clock = useSharedValue(0);
  const animate = useMotionPreference("agentFaces");
  const focused = useScreenFocusedWhile(active && animate);
  const foreground = useAppForeground();
  useEffect(() => {
    if (active) prepareOrbitFrames();
  }, [active]);
  useEffect(() => {
    clock.set(0);
    if (!active || !animate || !focused || !foreground) return;
    clock.set(
      withRepeat(
        withTiming(ORBIT_CYCLE, {
          duration: ORBIT_CYCLE * 1000,
          easing: Easing.linear,
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(clock);
  }, [active, animate, clock, focused, foreground]);
  return (
    <View style={{ width: size, height: size }}>
      {active ? <OrbitLayer clock={clock} layer="back" size={size} /> : null}
      {children}
      {active ? <OrbitLayer clock={clock} layer="front" size={size} /> : null}
    </View>
  );
}
