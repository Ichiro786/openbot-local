import * as SecureStore from "expo-secure-store";
import { Uniwind } from "uniwind";
import { create } from "zustand";
import { androidSdkInt, getDynamicColors, setLiveUpdateAccent } from "../../../../modules/openbot-engine";

/**
 * OpenBot Local theme options on top of Light / Dark / System:
 *  - AMOLED: pure black (#000000) canvas and near-black surfaces while the dark theme shows.
 *  - Material You: the accent palette from the wallpaper (Android 12+), for light and dark.
 *
 * Both change the same tokens every screen reads (OpenBot tokens and the HeroUI aliases), at runtime,
 * with Uniwind.updateCSSVariables, so the drawer, sheets and composer follow without their own code.
 * Turning an option off writes the brand values back (they mirror @openbot/brand/tokens-native.css).
 */

const amoledKey = "openbot.local.theme.amoled.v1";
const dynamicKey = "openbot.local.theme.dynamic-color.v1";

/** Material You needs the system palettes of Android 12 (API 31). */
export const DYNAMIC_COLOR_MIN_SDK = 31;

export function dynamicColorSupported(): boolean {
  return androidSdkInt() >= DYNAMIC_COLOR_MIN_SDK;
}

export const useThemeStyle = create<{ amoled: boolean; dynamicColor: boolean; ready: boolean; saving: boolean }>(
  () => ({ amoled: false, dynamicColor: false, ready: false, saving: false }),
);

type Vars = Record<string, string>;

/** Dark brand values of the tokens AMOLED replaces. */
const DARK_SURFACES: Vars = {
  "--openbot-bg-canvas": "#1a1a1a",
  "--openbot-bg-native-canvas": "#141414",
  "--openbot-bg-native-sidebar": "#141414",
  "--openbot-bg-sidebar": "#1a1a1a",
  "--openbot-bg-surface": "#212121",
  "--openbot-bg-surface-raised": "#242424",
  "--openbot-bg-control": "#212121",
  "--openbot-bg-control-active": "#2a2a2a",
  "--openbot-bg-overlay": "rgba(26, 26, 26, 0.92)",
  "--openbot-bg-sheet": "#141414",
  "--openbot-bg-grouped": "#212121",
  "--openbot-border-grouped": "#333335",
  "--openbot-bg-chrome-glass": "rgba(38, 38, 40, 0.96)",
  "--openbot-bg-chrome-blur": "rgba(26, 26, 28, 0.62)",
  "--openbot-scroll-edge-overlay": "rgba(0, 0, 0, 0.72)",
};

/** Pure black canvas, near-black layers so sheets and cards still separate. */
const AMOLED_SURFACES: Vars = {
  "--openbot-bg-canvas": "#000000",
  "--openbot-bg-native-canvas": "#000000",
  "--openbot-bg-native-sidebar": "#000000",
  "--openbot-bg-sidebar": "#000000",
  "--openbot-bg-surface": "#0f0f10",
  "--openbot-bg-surface-raised": "#151516",
  "--openbot-bg-control": "#131314",
  "--openbot-bg-control-active": "#1d1d1f",
  "--openbot-bg-overlay": "rgba(0, 0, 0, 0.92)",
  "--openbot-bg-sheet": "#0a0a0a",
  "--openbot-bg-grouped": "#121213",
  "--openbot-border-grouped": "#232325",
  "--openbot-bg-chrome-glass": "rgba(16, 16, 18, 0.96)",
  "--openbot-bg-chrome-blur": "rgba(0, 0, 0, 0.62)",
  "--openbot-scroll-edge-overlay": "rgba(0, 0, 0, 0.8)",
};

/** HeroUI aliases that read the surfaces (global.css). Set directly too, so no cached var() lags. */
function heroSurfaces(surfaces: Vars): Vars {
  return {
    "--background": surfaces["--openbot-bg-native-canvas"] ?? "#141414",
    "--overlay": surfaces["--openbot-bg-surface-raised"] ?? "#242424",
    "--surface": surfaces["--openbot-bg-surface"] ?? "#212121",
    "--surface-secondary": surfaces["--openbot-bg-control"] ?? "#212121",
    "--surface-tertiary": surfaces["--openbot-bg-surface-raised"] ?? "#242424",
    "--default": surfaces["--openbot-bg-control"] ?? "#212121",
    "--field-background": surfaces["--openbot-bg-control"] ?? "#212121",
    "--backdrop": surfaces["--openbot-bg-overlay"] ?? "rgba(26, 26, 26, 0.92)",
  };
}

const BRAND_ACCENT = {
  light: { accent: "#6960f1", text: "#5b52df", fileSoft: "rgba(91, 82, 223, 0.12)" },
  dark: { accent: "#007cf7", text: "#42a0ff", fileSoft: "rgba(0, 124, 247, 0.14)" },
} as const;

function accentVars(accent: string, text: string, fileSoft: string): Vars {
  return {
    "--openbot-accent": accent,
    "--openbot-accent-text": text,
    "--openbot-file-default": text,
    "--openbot-file-default-soft": fileSoft,
    "--accent": accent,
    "--focus": accent,
    "--link": text,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * The Material 3 roles from the system palette. White text sits on the accent everywhere in the app,
 * so the filled accent uses tone 600 (light) / 500 (dark) rather than the pastel M3 dark primary.
 */
function dynamicAccents(): { light: Vars; dark: Vars; live: string } | null {
  const palette = getDynamicColors();
  const pick = (key: string) => palette?.[key];
  const lightAccent = pick("accent1_600");
  const lightText = pick("accent1_700");
  const darkAccent = pick("accent1_500");
  const darkText = pick("accent1_200");
  if (!lightAccent || !lightText || !darkAccent || !darkText) return null;
  return {
    light: accentVars(lightAccent, lightText, withAlpha(lightText, 0.12)),
    dark: accentVars(darkAccent, darkText, withAlpha(darkAccent, 0.14)),
    live: darkAccent,
  };
}

/** Writes the current choice into the theme tokens. Safe to call any time; cheap when nothing changed. */
export function applyThemeStyle(): void {
  const { amoled, dynamicColor } = useThemeStyle.getState();
  const surfaces = amoled ? AMOLED_SURFACES : DARK_SURFACES;
  const dynamic = dynamicColor && dynamicColorSupported() ? dynamicAccents() : null;
  const brandLight = BRAND_ACCENT.light;
  const brandDark = BRAND_ACCENT.dark;
  const light = dynamic?.light ?? accentVars(brandLight.accent, brandLight.text, brandLight.fileSoft);
  const dark = dynamic?.dark ?? accentVars(brandDark.accent, brandDark.text, brandDark.fileSoft);
  try {
    Uniwind.updateCSSVariables("dark", { ...surfaces, ...heroSurfaces(surfaces), ...dark });
    Uniwind.updateCSSVariables("light", light);
  } catch {
    // An older Uniwind without runtime variables keeps the brand theme.
  }
  setLiveUpdateAccent(dynamic?.live ?? null);
}

export async function loadThemeStyle(): Promise<void> {
  if (useThemeStyle.getState().ready) return;
  try {
    const [amoled, dynamicColor] = await Promise.all([
      SecureStore.getItemAsync(amoledKey),
      SecureStore.getItemAsync(dynamicKey),
    ]);
    if (!useThemeStyle.getState().ready) {
      useThemeStyle.setState({ amoled: amoled === "true", dynamicColor: dynamicColor === "true" });
    }
  } finally {
    useThemeStyle.setState({ ready: true });
    applyThemeStyle();
  }
}

export async function saveThemeStyle(change: { amoled?: boolean; dynamicColor?: boolean }): Promise<void> {
  const state = useThemeStyle.getState();
  if (!state.ready || state.saving) return;
  // Apply at once, including when storage fails. Settings shows the error.
  useThemeStyle.setState({ ...change, saving: true });
  applyThemeStyle();
  try {
    if (change.amoled !== undefined) await SecureStore.setItemAsync(amoledKey, String(change.amoled));
    if (change.dynamicColor !== undefined) await SecureStore.setItemAsync(dynamicKey, String(change.dynamicColor));
  } finally {
    useThemeStyle.setState({ saving: false });
  }
}

/** The wallpaper can change while the app is away: read the palette again when it comes back. */
export function refreshDynamicColor(): void {
  const { ready, dynamicColor } = useThemeStyle.getState();
  if (ready && dynamicColor) applyThemeStyle();
}
