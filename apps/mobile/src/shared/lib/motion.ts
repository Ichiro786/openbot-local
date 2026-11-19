import { useReducedMotion as useSystemReducedMotion, type WithSpringConfig } from "react-native-reanimated";
import { type MotionPreference, useMotionPreferences } from "../../features/settings/model/motion";
import { springs } from "./motion-tokens";

export function useReducedMotion(): boolean {
  const system = useSystemReducedMotion();
  const animations = useMotionPreferences((state) => state.allAnimations);
  return system || !animations;
}

export type TransitionMode = "blur" | "fade" | "none";

export function useTransitionMode(name: Exclude<MotionPreference, "allAnimations">): TransitionMode {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  if (!enabled) return "none";
  return reduced ? "fade" : "blur";
}

export interface Motion {
  reduced: boolean;
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

export function useMotion(): Motion {
  return useReducedMotion() ? REDUCED_MOTION : FULL_MOTION;
}

export function useMotionPreference(name: Exclude<MotionPreference, "allAnimations">): boolean {
  const reduced = useReducedMotion();
  const enabled = useMotionPreferences((state) => state[name]);
  return enabled && !reduced;
}
