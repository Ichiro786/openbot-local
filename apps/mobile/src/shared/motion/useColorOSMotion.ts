import { useReducedMotion } from "react-native-reanimated";
import { create } from "zustand";

type ColorOSMotionState = {
  /** Setting "ColorOS motion", default ON. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

/** Build 7 flag. Wire persistence through the app's settings model. */
export const useColorOSMotionStore = create<ColorOSMotionState>((set) => ({
  enabled: true,
  setEnabled: (enabled) => set({ enabled }),
}));

/** `enabled` gates every ColorOS primitive; `reduceMotion` drops transforms but keeps feedback. */
export function useColorOSMotion() {
  const enabled = useColorOSMotionStore((s) => s.enabled);
  const reduceMotion = useReducedMotion();
  return { enabled, reduceMotion };
}
