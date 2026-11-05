/**
 * Build 11: the shared glass layer's tokens (ColorOS 17 Notes, measured in /workspace/work/b11-spec.md
 * §1–§2). One source for the rim, the lens, the materials and the press physics of every glass control.
 * The Classic look (ColorOS motion off) keeps its own values (`pill.*`, `useChromeGlass`).
 */
import { spring } from "@/shared/motion/tokens";

export const glass = {
  /**
   * The edge: two soft glints instead of a drawn hairline. A ~1 dp core with a soft inner halo,
   * brightest at the top-left shoulder (A) and weaker at the bottom-right (B); the long sides go to 0.
   */
  rim: {
    core: 1,
    halo: 2,
    haloAlpha: 0.35,
    /** Circle: angle in degrees (0 = right, 90 = down). Capsule: x as a fraction of the width. */
    glintA: { angle: 235, x: 0.18, alpha: 0.15, spread: 0.45 },
    glintB: { angle: 70, x: 0.82, alpha: 0.09, spread: 0.4 },
    /**
     * Capsules (long edges): both glints reach 0 before the middle of the top edge (gate ≤ 0.04 there;
     * review heads-up: 0.45/0.4 left ≈ 0.053 on the composer and the header pill).
     */
    capsuleSpread: 0.3,
    /** …and never past this fraction of the width (GlassMenu card, review R3-1). */
    capsuleMaxWidth: 0.35,
    /** Light theme (inferred: no light-mode reference). */
    lightA: 0.55,
    lightB: 0.22,
  },
  /** The lens: a soft glow low inside the glass (Notes lights the bottom, not the top). */
  lens: { alpha: 0.045, alphaLight: 0.12, cy: 0.85, r: 0.65 },
  /** Materials. `solid` is the fill with no blur behind; `overBlur` the tint over a live blur. */
  material: {
    button: {
      solidDark: "rgba(255, 255, 255, 0.075)",
      overBlurDark: "rgba(22, 22, 24, 0.42)",
      overBlurLight: "rgba(255, 255, 255, 0.5)",
      shadow: "0 3px 8px rgba(0, 0, 0, 0.45)",
      shadowLight: "0 3px 8px rgba(0, 0, 0, 0.12)",
      intensity: 24,
      reduction: 4,
    },
    /** The frosted GlassMenu card: tint as build 9 (menu.tintTop/Bottom), the GlintRim edge. */
    menu: { rimScale: 1 },
  },
  /** Press, drag-follow and release (Notes ⋮, spec §2). */
  press: {
    scale: 0.955,
    /** ~80 ms in. */
    inSpring: spring(900, 60),
    highlight: 0.07,
    highlightInMs: 50,
    highlightOutMs: 150,
    /** The button follows the finger up to this fraction of its size. */
    followMax: 0.32,
    falloff: 40,
    squashAcross: 0.14,
    stretchAlong: 0.03,
    /**
     * Build 11.3 motion B1 (audit N10): ζ ≈ 0.61, ~9 % overshoot, settled in ~260 ms: a very fast
     * rebound with a little bounce (was 205/10: ζ 0.35, 31 % overshoot, ~800 ms of wobble).
     */
    release: spring(600, 30),
    /** Past this many diameters the press visuals spring home (Pressable cancels the tap itself). */
    cancelFactor: 1.5,
    reducedMs: 100,
  },
  /** Live blurs allowed on screen at once. */
  budget: 2,
} as const;

/** 1 − e^(−d/falloff): how far into the follow a drag of `d` dp is. Declared before every worklet use. */
export function followAmount(distance: number): number {
  "worklet";
  return 1 - Math.exp(-Math.abs(distance) / glass.press.falloff);
}
