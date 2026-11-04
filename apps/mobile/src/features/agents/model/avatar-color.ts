// Build 11.2: custom avatar colours (`avatar-color-v1`). Pure colour maths, worklet-safe: every
// function here is declared before any worklet that calls it and calls nothing declared later
// (build 8 lesson: a later helper is undefined under release Hermes + worklets 0.13).

export type Hsv = { h: number; s: number; v: number };

const clamp01 = (value: number) => {
  "worklet";
  return Math.min(1, Math.max(0, value));
};

const hex2 = (value: number) => {
  "worklet";
  const byte = Math.round(clamp01(value) * 255);
  return (byte < 16 ? "0" : "") + byte.toString(16);
};

/** HSV (h in degrees, s and v in 0..1) as lowercase `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  "worklet";
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 1) [r, g, b] = [c, x, 0];
  else if (hue < 2) [r, g, b] = [x, c, 0];
  else if (hue < 3) [r, g, b] = [0, c, x];
  else if (hue < 4) [r, g, b] = [0, x, c];
  else if (hue < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `#${hex2(r + m)}${hex2(g + m)}${hex2(b + m)}`;
}

/** `#rrggbb` as HSV. */
export function hexToHsv(hex: string): Hsv {
  "worklet";
  const value = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/** Felt lightness bounds: below, the felt is black and loses its shading and the closed-eye line; above, it is flat white. */
const FELT_MIN_L = 0.22;
const FELT_MAX_L = 0.8;
const FELT_MAX_S = 0.92;

/**
 * The felt colour the plush tints with for a custom colour: the same hue, with lightness clamped to
 * FELT_MIN_L..FELT_MAX_L and saturation capped, so near-black, near-white and grey still show fur
 * shading, the eyes and the closed-eye line. Swatches and the wheel show the chosen colour itself.
 */
export function feltColor(hex: string): string {
  "worklet";
  const { h, s, v } = hexToHsv(hex);
  // HSV -> HSL
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  const L = Math.min(FELT_MAX_L, Math.max(FELT_MIN_L, l));
  const S = Math.min(FELT_MAX_S, sl);
  // HSL -> HSV
  const V = L + S * Math.min(L, 1 - L);
  return hsvToHex(h, V === 0 ? 0 : 2 * (1 - L / V), V);
}

/** Hues of the presets, as `AVATAR_HUES` in contracts. */
export const PRESET_HUES = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;
export type PresetHue = (typeof PRESET_HUES)[number];

/** The preset nearest on the hue circle; same rule as the engine's `nearestAvatarHue`. */
export function nearestPresetHue(hex: string): PresetHue {
  "worklet";
  const { h } = hexToHsv(hex);
  let best: PresetHue = 0;
  let bestDistance = 361;
  for (const preset of PRESET_HUES) {
    const d = Math.min(Math.abs(preset - h), 360 - Math.abs(preset - h));
    if (d < bestDistance) {
      bestDistance = d;
      best = preset;
    }
  }
  return best;
}

export const AVATAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
export const isAvatarColor = (value: unknown): value is string =>
  typeof value === "string" && AVATAR_COLOR_PATTERN.test(value);

/**
 * What a plush is tinted with: a preset hue, null for the automatic colour, or a custom `#rrggbb`
 * (`avatar-color-v1`). Every renderer that takes `hue` takes a tint.
 */
export type AvatarTint = PresetHue | null | string;

/** The tint of an agent: its custom colour when the host keeps one, else its preset (or automatic) hue. */
export function agentTint(hue: PresetHue | null, color: string | undefined): AvatarTint {
  return color ?? hue;
}
