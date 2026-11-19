import { create } from "zustand";
import { storedFields } from "./stored-fields";

export interface MotionPreferences {
  allAnimations: boolean;
  agentFaces: boolean;
  composerResize: boolean;
  textReveal: boolean;
  searchTransitions: boolean;
  /** ColorOS 17 motion: springy press feedback, glass menus, stretch and zoom. */
  colorOSMotion: boolean;
}

export type MotionPreference = keyof MotionPreferences;

const DEFAULTS: MotionPreferences = {
  allAnimations: true,
  agentFaces: true,
  composerResize: true,
  textReveal: true,
  searchTransitions: true,
  colorOSMotion: true,
};
export const MOTION_PREFERENCE_NAMES: readonly MotionPreference[] = [
  "allAnimations",
  "agentFaces",
  "composerResize",
  "textReveal",
  "searchTransitions",
  "colorOSMotion",
];

export const useMotionPreferences = create<MotionPreferences & { ready: boolean }>(() => ({
  ...DEFAULTS,
  ready: false,
}));

export function decodeMotionPreferences(stored: string | null): MotionPreferences {
  const fields = storedFields(stored) ?? new Map<string, unknown>();
  const preferences = { ...DEFAULTS };
  for (const name of MOTION_PREFERENCE_NAMES) {
    const field = fields.get(name);
    if (typeof field === "boolean") preferences[name] = field;
  }
  return preferences;
}
