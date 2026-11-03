import { useMotionPreferences } from "@/features/settings/model/motion";
import { useReducedMotion } from "@/shared/lib/motion";

/**
 * The "ColorOS motion" setting (Settings > Animations, default ON, persisted with the other
 * motion preferences). `enabled` gates every ColorOS primitive; `reduceMotion` (system Reduce
 * Motion or the app's "all animations" switch) drops transforms but keeps the highlight and haptics.
 */
export function useColorOSMotion() {
  const enabled = useMotionPreferences((s) => s.colorOSMotion);
  const reduceMotion = useReducedMotion();
  return { enabled, reduceMotion };
}

/** Non-hook read for callbacks outside render. */
export function colorOSMotionEnabled(): boolean {
  return useMotionPreferences.getState().colorOSMotion;
}
