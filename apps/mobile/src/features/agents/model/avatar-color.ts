// Build 11.2: colour wheel maths for `agent-colors-v1` custom colours. Pure colour maths, worklet-safe: every
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
export function hsvToHex(h: number, s: number, v: number): `#${string}` {
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
