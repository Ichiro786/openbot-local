import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * Build 11.3 (Syed): Settings › Appearance › Avatar size scales agent avatars app-wide (ColorOS ON).
 * 1 = an imported photo's size in its slot; the plush is drawn to match it at 1.
 */
export const AVATAR_SCALE_MIN = 0.8;
export const AVATAR_SCALE_MAX = 1.3;
/** 5 % steps: few plush bake sizes, so the picture cache stays small. */
export const AVATAR_SCALE_STEP = 0.05;
const key = "openbot.mobile.avatar-scale.v1";

export function clampAvatarScale(value: number): number {
  const stepped = Math.round(value / AVATAR_SCALE_STEP) * AVATAR_SCALE_STEP;
  return Math.min(AVATAR_SCALE_MAX, Math.max(AVATAR_SCALE_MIN, Number(stepped.toFixed(2))));
}

export const useAvatarScale = create<{ scale: number; ready: boolean; saving: boolean }>(() => ({
  scale: 1,
  ready: false,
  saving: false,
}));

export async function loadAvatarScale(): Promise<void> {
  if (useAvatarScale.getState().ready) return;
  try {
    const stored = Number(await SecureStore.getItemAsync(key));
    if (!useAvatarScale.getState().ready && Number.isFinite(stored) && stored > 0) {
      useAvatarScale.setState({ scale: clampAvatarScale(stored) });
    }
  } finally {
    useAvatarScale.setState({ ready: true });
  }
}

/** Applies at once (every avatar redraws at the new size), then stores it. */
export async function saveAvatarScale(value: number): Promise<void> {
  const scale = clampAvatarScale(value);
  if (scale === useAvatarScale.getState().scale) return;
  useAvatarScale.setState({ scale, saving: true });
  try {
    await SecureStore.setItemAsync(key, String(scale));
  } finally {
    useAvatarScale.setState({ saving: false });
  }
}
