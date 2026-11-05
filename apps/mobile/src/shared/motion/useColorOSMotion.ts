import { useMotionPreferences } from "@/features/settings/model/motion";
import { useReducedMotion } from "@/shared/lib/motion";
import { isAndroid } from "@/shared/lib/platform";

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

const PAGE = { animation: "ios_from_right" } as const;
const STOCK: { animation?: "ios_from_right" } = {};

/**
 * Build 11.3 motion B2 (audit N03): the push of a page (never a chat) with ColorOS motion on Android, to
 * spread into a stack's options: a strong ease-out, the page under it moves −25 % and dims
 * (react-native-screens is patched to retune its otherwise unused ios_from_right set). Empty otherwise,
 * so ColorOS off and reduced motion keep exactly the stack's own animation.
 */
export function useColorOSPageAnimation(): { animation?: "ios_from_right" } {
  const { enabled, reduceMotion } = useColorOSMotion();
  return isAndroid && enabled && !reduceMotion ? PAGE : STOCK;
}
