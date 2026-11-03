import { memo, useId, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { glass } from "./tokens";

type Size = { width: number; height: number };

/**
 * Build 11 (spec §1): the glass edge as two soft refraction glints, never a drawn stroke. Each glint is
 * the shape's outline stroked with a radial gradient centred on its shoulder (top-left A, bottom-right B),
 * so it fades along the edge and the long sides stay dark: a ~1 dp core plus a 2 dp inner halo at 0.35×.
 * Optionally the lens: a soft glow low inside the glass. Pure SVG, no blur, no animated values; it
 * follows its parent's transform, so it squashes with a pressed button.
 */
export const GlintRim = memo(function GlintRim({
  radius,
  dark,
  lens = true,
  strength = 1,
}: {
  /** Corner radius; a value ≥ half the height draws a circle or capsule. */
  radius: number;
  dark: boolean;
  /** Draws the bottom glow inside the glass too. */
  lens?: boolean;
  /** Scales both glints (a menu card's long edges read brighter, so it may ask for less). */
  strength?: number;
}) {
  const id = `glint-${useId().replaceAll(":", "")}`;
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
    const width = Math.round(layout.width * 2) / 2;
    const height = Math.round(layout.height * 2) / 2;
    if (width !== size?.width || height !== size?.height) setSize({ width, height });
  };
  const { rim } = glass;
  const alphaA = (dark ? rim.glintA.alpha : rim.lightA) * strength;
  const alphaB = (dark ? rim.glintB.alpha : rim.lightB) * strength;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size && size.width > 0 && size.height > 0 ? (
        <GlintSvg id={id} size={size} radius={radius} alphaA={alphaA} alphaB={alphaB} lens={lens} dark={dark} />
      ) : null}
    </View>
  );
});

function GlintSvg({
  id,
  size: { width, height },
  radius,
  alphaA,
  alphaB,
  lens,
  dark,
}: {
  id: string;
  size: Size;
  radius: number;
  alphaA: number;
  alphaB: number;
  lens: boolean;
  dark: boolean;
}) {
  const { rim } = glass;
  const r = Math.min(radius, width / 2, height / 2);
  const round = r >= height / 2 - 0.5 && Math.abs(width - height) < 1;
  // Where each glint sits on the edge.
  const at = (angle: number, x: number, top: boolean) => {
    if (round) {
      const a = (angle * Math.PI) / 180;
      return { x: width / 2 + (width / 2) * Math.cos(a), y: height / 2 + (height / 2) * Math.sin(a) };
    }
    return { x: width * x, y: top ? 0 : height };
  };
  const a = at(rim.glintA.angle, rim.glintA.x, true);
  const b = at(rim.glintB.angle, rim.glintB.x, false);
  // The spread is a fraction of half the outline.
  const half = (2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Math.PI * r) / 2;
  const core = rim.core;
  const halo = rim.halo;
  const coreInset = core / 2;
  const haloInset = core + halo / 2;
  const outline = (inset: number, strokeWidth: number, gradient: string, opacity: number) => (
    <Rect
      x={inset}
      y={inset}
      width={Math.max(0, width - inset * 2)}
      height={Math.max(0, height - inset * 2)}
      rx={Math.max(0, r - inset)}
      ry={Math.max(0, r - inset)}
      fill="none"
      stroke={`url(#${gradient})`}
      strokeWidth={strokeWidth}
      strokeOpacity={opacity}
    />
  );
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      <Defs>
        <RadialGradient
          id={`${id}-a`}
          gradientUnits="userSpaceOnUse"
          cx={a.x}
          cy={a.y}
          r={half * (round ? rim.glintA.spread : rim.capsuleSpread)}
          fx={a.x}
          fy={a.y}
        >
          <Stop offset="0" stopColor="#ffffff" stopOpacity={alphaA} />
          <Stop offset="0.55" stopColor="#ffffff" stopOpacity={alphaA * 0.35} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient
          id={`${id}-b`}
          gradientUnits="userSpaceOnUse"
          cx={b.x}
          cy={b.y}
          r={half * (round ? rim.glintB.spread : rim.capsuleSpread)}
          fx={b.x}
          fy={b.y}
        >
          <Stop offset="0" stopColor="#ffffff" stopOpacity={alphaB} />
          <Stop offset="0.55" stopColor="#ffffff" stopOpacity={alphaB * 0.35} />
          <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </RadialGradient>
        {lens ? (
          <RadialGradient id={`${id}-lens`} cx="0.5" cy={glass.lens.cy} r={glass.lens.r} fx="0.5" fy={glass.lens.cy}>
            <Stop offset="0" stopColor="#ffffff" stopOpacity={dark ? glass.lens.alpha : glass.lens.alphaLight} />
            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
          </RadialGradient>
        ) : null}
      </Defs>
      {lens ? <Rect width={width} height={height} rx={r} ry={r} fill={`url(#${id}-lens)`} /> : null}
      {outline(coreInset, core, `${id}-a`, 1)}
      {outline(haloInset, halo, `${id}-a`, rim.haloAlpha)}
      {outline(coreInset, core, `${id}-b`, 1)}
      {outline(haloInset, halo, `${id}-b`, rim.haloAlpha)}
    </Svg>
  );
}
