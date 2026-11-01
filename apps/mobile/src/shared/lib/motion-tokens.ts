import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from "react-native-reanimated";

/**
 * Material 3 Expressive motion tokens for Reanimated.
 *
 * The springs come from Compose `ExpressiveMotionTokens` (damping ratio ζ and stiffness k) and are
 * converted to Reanimated's physics form: `{ mass: 1, stiffness: k, damping: 2ζ√k }`. The mass is
 * always 1. Reanimated's own default mass is 4, which turns an M3 stiffness into a much slower spring.
 *
 * - Spatial springs move position, size, shape and corner radius. They may overshoot.
 * - Effects springs move colour and opacity. They never overshoot.
 * - Fast is for small components (buttons, switches, chips), default for things that cover part of
 *   the screen (sheets, the drawer), slow for full-screen changes.
 *
 * Every config carries `ReduceMotion.System`, so the system Reduce Motion setting still snaps them.
 * The app's own Animations setting is applied by `useMotion()`, which swaps the expressive set for
 * the calm one.
 */
const system = ReduceMotion.System;

export const springs = {
  // Expressive scheme: ζ 0.6 / 0.8.
  fastSpatial: { mass: 1, stiffness: 800, damping: 33.9, reduceMotion: system },
  defaultSpatial: { mass: 1, stiffness: 380, damping: 31.2, reduceMotion: system },
  slowSpatial: { mass: 1, stiffness: 200, damping: 22.6, reduceMotion: system },
  // Effects: critically damped, ζ 1.0.
  fastEffects: { mass: 1, stiffness: 3800, damping: 123.3, reduceMotion: system },
  defaultEffects: { mass: 1, stiffness: 1600, damping: 80, reduceMotion: system },
  slowEffects: { mass: 1, stiffness: 800, damping: 56.6, reduceMotion: system },
  // Standard scheme (ζ 0.9): the calmer spatial fallback used when motion is reduced in the app.
  standardFastSpatial: { mass: 1, stiffness: 1400, damping: 67.3, reduceMotion: system },
  standardDefaultSpatial: { mass: 1, stiffness: 700, damping: 47.6, reduceMotion: system },
  standardSlowSpatial: { mass: 1, stiffness: 300, damping: 31.2, reduceMotion: system },
} as const satisfies Record<string, WithSpringConfig>;

export type SpringToken = keyof typeof springs;

/** Expo's strong ease-out, for a press that has to answer at once. */
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** Timing equivalents of the effects springs (M3 spring → curve table), for timing-only APIs. */
export const timings = {
  fastEffects: { duration: 150, easing: Easing.bezier(0.31, 0.94, 0.34, 1), reduceMotion: system },
  defaultEffects: { duration: 200, easing: Easing.bezier(0.34, 0.8, 0.34, 1), reduceMotion: system },
  slowEffects: { duration: 300, easing: Easing.bezier(0.34, 0.88, 0.34, 1), reduceMotion: system },
  pressIn: { duration: 100, easing: EASE_OUT, reduceMotion: system },
} as const satisfies Record<string, WithTimingConfig>;

/** A spring that starts at a gesture's release velocity, so a flick carries into the settle. */
export function withVelocity(config: WithSpringConfig, velocity: number): WithSpringConfig {
  "worklet";
  return { ...config, velocity };
}

/** The scale a pressed control draws at. */
export const PRESSED_SCALE = 0.97;
/** The opacity a pressed control draws at. Subtle: the scale carries most of the feedback. */
export const PRESSED_OPACITY = 0.86;
