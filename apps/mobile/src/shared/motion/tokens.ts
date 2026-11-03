/**
 * ColorOS 17 motion tokens: the single tunable source for build 7 motion.
 *
 * Sources: /workspace/work/coloros17-motion-spec.md (120 fps capture of
 * ColorOS 17 Notes) and coloros17-research.md. Units are dp.
 * Alternatives from the spec/research are kept as comments next to each value.
 *
 * Every spring is explicit: Reanimated 4 defaults are critically damped
 * (stiffness 900 / damping 120 / mass 4), so never rely on them.
 */

export type SpringToken = {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly overshootClamping?: boolean;
};

const spring = (stiffness: number, damping: number, mass = 1, overshootClamping = false): SpringToken => ({
  stiffness,
  damping,
  mass,
  overshootClamping,
});

/** 1. Press feedback (PressableSquish). */
export const press = {
  /** Spec §2: ≤0.96–0.97 (compression <3% invisible). Alt: COUI SinkFeedback 0.94. */
  scale: 0.96,
  /** ζ 0.8 at k 600 → damping = 0.8·2·√600 ≈ 39. Alt (spec §2): 900/45 (~60 ms). */
  spring: spring(600, 39),
  /**
   * Highlight: luma +45% in ~25 ms, decays over 120–150 ms (spec §2, H). A full white fill at α
   * lifts a #242424 button by (255−36)·α, so +24 luma (36→60) is α ≈ 0.11. Alt (radial, spec §2): 0.22.
   */
  highlightOpacity: 0.11,
  /** Rows: "+6% white for 25 ms" (spec §4). */
  rowHighlightOpacity: 0.06,
  highlightInMs: 25,
  /** Alt: 120. */
  highlightOutMs: 140,
  /** List rows (research §4.10): lighter scale, tint only. */
  rowScale: 0.98,
} as const;

/** 2. Drag stretch (PressableStretch). Provisional: the spec has no "Drag stretch (measured)" section. */
export const stretch = {
  /** Button swells ~5% on touch. */
  swell: 1.05,
  /**
   * Brief: offset = 12·d/(1+d/40). Read literally with d in dp it tends to 480 dp,
   * so d is normalised by the falloff: offset = 12·(d/40)/(1+d/40), capped at 12 dp.
   * Alt (spec §2): R·(1−1/(1+|d|/R·0.55)), R = 12.
   */
  maxOffset: 12,
  falloff: 40,
  /** Stretch along the drag axis, ≤ 4%. Alt (spec §2): 1 + 0.10·(1−e^(−|d|/40)). */
  maxAlong: 0.04,
  /** Return. Alt (spec §2): 420/22 (ζ≈0.54, ~8–10% overshoot); research: 520/22. */
  returnSpring: spring(600, 40),
} as const;

/** 3. GlassMenu (spec §3, H for open). */
export const menu = {
  fromScale: 0.25,
  /** Critically damped ω≈38, no overshoot. Alt: { duration: 230, dampingRatio: 1 }. */
  openSpring: spring(1450, 76, 1, true),
  contentFadeInMs: 70,
  radius: 27,
  anchorGap: 8,
  rowPitch: 37,
  /** Frost tint top → bottom, rgba(22,22,22,a). */
  tintTop: 0.7,
  tintBottom: 0.92,
  /** expo-blur intensity. Alt: 90–100 (spec), 70–80 (research). */
  blurIntensity: 95,
  highlight: {
    fill: "rgba(255,255,255,0.13)",
    inset: 6,
    /** Trails the finger, ζ≈0.95. Alt (research): 700/40. */
    spring: spring(700, 50),
  },
  lean: {
    /** translateY ≈ +7 dp toward the finger; clamp −4..+9 (spec). */
    factor: 0.07,
    min: -4,
    max: 9,
    /** scaleY 1.015 at the bottom row. */
    maxStretch: 0.015,
    spring: spring(600, 40),
  },
  /** Close in 60–100 ms. */
  closeMs: 90,
  closeScale: 0.5,
  /** The action fires ~200 ms after release (menu closes first). */
  actionDelayMs: 200,
} as const;

/** 4. Progressive edge blur (spec §1e; research §3.2). */
export const edges = {
  /** 3 expo-blur bands. Alt intensities: 15/35/60 (spec presets). */
  bandIntensities: [15, 35, 60] as const,
  topHeight: 90,
  bottomHeight: 72,
  /** Dim scrim black 0.55 → 0. */
  scrimAlpha: 0.55,
  /**
   * Build 9 home edge (one masked BlurView, spec §1e: blur ramps from 0 over the zone). expo-blur
   * intensity on a 1/4-size image, like the search pill (24).
   */
  homeIntensity: 22,
  /** The zone rises this far above the top of the search pill. */
  homeRise: 72,
  /** Background-colour scrim at the bottom edge (0 at the zone top), for text over the blur. */
  homeScrim: 0.5,
  /** Opacity in/out when the blur pauses (search open, home moving). */
  homeFadeMs: 180,
} as const;

/** Build 9 search pill frost (spec §1: tint over blur, 1 px rim white 10–12 % top, ~6 % sides). */
export const pill = {
  /** Lighter than the chrome fill (0.62 dark / 0.55 light) so colours behind show through. */
  fillDark: "rgba(22, 22, 24, 0.34)",
  fillLight: "rgba(255, 255, 255, 0.42)",
  rimTopDark: 0.22,
  rimBottomDark: 0.05,
  rimTopLight: 0.7,
  rimBottomLight: 0.18,
  /** The soft light across the top third of the glass. */
  sheenDark: 0.1,
  sheenLight: 0.22,
} as const;

/** 5. Zoom open (spec §4). */
export const zoom = {
  /** ζ≈0.95, 90% at ~200 ms. Alt: { duration: 320, dampingRatio: 0.95 }. */
  openSpring: spring(380, 37),
  /** Back/close toward the re-measured rect. */
  closeSpring: spring(420, 40),
  /** Background blur 10–12 dp (expo-blur intensity ≈ 70). Alt scale: 0.94. */
  backgroundBlurIntensity: 70,
  backgroundScale: 0.945,
  backgroundDim: 0.5,
  endRadius: 0,
  /** Fill crossfade over p ∈ [0.15, 0.55]. */
  fillFade: [0.15, 0.55] as const,
  /** Source content scale 1 → 1.8, fades out by p 0.4. */
  sourceScale: 1.8,
  sourceFadeEnd: 0.4,
  /** Destination content scale 0.62 → 1, fades in over p ∈ [0.2, 0.6]. */
  destFromScale: 0.62,
  destFade: [0.2, 0.6] as const,
  /** Navigate once the overlay covers ≥ 90%. */
  navigateAt: 0.9,
  unmountBelow: 0.01,
} as const;

/** Overscroll return (spec §5, H). Alt (COUI): 280 / ζ1. */
export const overscroll = {
  returnSpring: spring(225, 30),
  rubberBand: 160,
} as const;

/** Glow (Skia only). */
export const glow = {
  rimTop: 0.14,
  rimBottom: 0.03,
  touchRadiusFactor: 0.6,
  touchAlpha: 0.22,
  fadeMs: 140,
} as const;

/** Haptics: light impact on press-in, selection on menu highlight change. */
export const haptics = {
  pressIn: "light",
  menuHighlight: "selection",
} as const;

/** offset = maxOffset·(d/falloff)/(1 + d/falloff), signed, in dp. */
export function dragOffset(d: number): number {
  "worklet";
  const a = Math.abs(d) / stretch.falloff;
  return Math.sign(d) * ((stretch.maxOffset * a) / (1 + a));
}

/** Scale along the drag axis, ≤ 1 + maxAlong. */
export function dragStretch(distance: number): number {
  "worklet";
  const a = Math.abs(distance);
  return 1 + stretch.maxAlong * (a / (a + stretch.falloff));
}

export function rubberBand(offset: number, dimension: number, c = 0.55): number {
  "worklet";
  const x = Math.abs(offset);
  return Math.sign(offset) * (1 - 1 / ((x * c) / dimension + 1)) * dimension;
}
