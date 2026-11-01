import { useReducedMotion as useSystemReducedMotion, type WithSpringConfig } from "react-native-reanimated";
import { type MotionPreference, useMotionPreferences } from "../../features/settings/model/motion";
import { springs } from "./motion-tokens";

/**
 * True when the system Reduce Motion setting is on, or when Settings turns animations off in the app.
 * Use it in place of Reanimated's `useReducedMotion`, which reads only the system setting.
 */
export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  return system || !animations;
}

/**
 * How a transition that carries a state change plays: with blur and movement, as a plain fade when
 * motion is reduced, or not at all when Settings turns it off. A fade keeps the change legible.
 */
export type TransitionMode = "blur" | "fade" | "none";

export function useTransitionMode(name: Exclude<MotionPreference, "allAnimations">): TransitionMode {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  if (!enabled) return "none";
  return reduced ? "fade" : "blur";
}

/**
 * The motion set a component animates with. Expressive while motion is full; under reduced motion
 * (the system setting, or Settings > Animations off) the spatial springs become critically damped
 * effects springs, so state changes still read but nothing bounces, scales or travels.
 */
export interface Motion {
  reduced: boolean;
  /** Press scale and other decorative transforms play. False under reduced motion. */
  transforms: boolean;
  fastSpatial: WithSpringConfig;
  defaultSpatial: WithSpringConfig;
  slowSpatial: WithSpringConfig;
  fastEffects: WithSpringConfig;
  defaultEffects: WithSpringConfig;
  slowEffects: WithSpringConfig;
}

const FULL_MOTION: Motion = {
  reduced: false,
  transforms: true,
  fastSpatial: springs.fastSpatial,
  defaultSpatial: springs.defaultSpatial,
  slowSpatial: springs.slowSpatial,
  fastEffects: springs.fastEffects,
  defaultEffects: springs.defaultEffects,
  slowEffects: springs.slowEffects,
};

const REDUCED_MOTION: Motion = {
  reduced: true,
  transforms: false,
  fastSpatial: springs.fastEffects,
  defaultSpatial: springs.defaultEffects,
  slowSpatial: springs.slowEffects,
  fastEffects: springs.fastEffects,
  defaultEffects: springs.defaultEffects,
  slowEffects: springs.slowEffects,
};

/** One of two module constants, so a component only re-renders when the setting itself changes. */
export function useMotion(): Motion {
  return useReducedMotion() ? REDUCED_MOTION : FULL_MOTION;
}

/** True when one animation plays: Settings keeps it on, and motion is not reduced. */
export function useMotionPreference(name: Exclude<MotionPreference, "allAnimations">): boolean {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  return enabled && !reduced;
}
