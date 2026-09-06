/**
 * Colour conversion for the slide colour picker.
 *
 * The picker is a saturation/brightness square you drag a handle across plus a
 * hue slider, so it works in HSV while everything it talks to — the slide
 * columns, the canvas templates, CSS — speaks hex. These are the two halves of
 * that round trip.
 *
 * Kept pure and out of the component so the round trip can be tested: a picker
 * that loses a little colour every time it's opened and closed is the classic
 * failure here, and it's invisible until someone's brand orange has quietly
 * drifted.
 */

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-1 */
  v: number;
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Clamp to 0-1. Exported because the picker drags in that space. */
export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

/**
 * Parse "#rgb" or "#rrggbb" (with or without the hash) into 0-255 channels.
 * Returns null for anything else, so a half-typed hex field can't blank a
 * slide's colour mid-keystroke.
 */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(raw)) return null;
  if (raw.length === 3) {
    const [r, g, b] = raw.split("");
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }
  if (raw.length === 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

/** Always lowercase "#rrggbb" — the format the slide columns already hold. */
export function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (n: number) =>
    clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  // Hue wraps; saturation and value don't.
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const vv = clamp01(v);

  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;

  let rgb: [number, number, number];
  if (hh < 60) rgb = [c, x, 0];
  else if (hh < 120) rgb = [x, c, 0];
  else if (hh < 180) rgb = [0, c, x];
  else if (hh < 240) rgb = [0, x, c];
  else if (hh < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/**
 * Normalise anything the hex field accepts into a storable colour, or null if
 * it isn't one yet.
 */
export function normaliseHex(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
}

/**
 * Pick black or white text for a swatch of this colour, so the hex label on
 * the handle stays readable on both a pale yellow and a navy.
 *
 * Uses the WCAG relative-luminance curve rather than a naive average, which
 * would call a saturated blue "light".
 */
export function readableTextOn(hex: string): "#000000" | "#ffffff" {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  // 0.179 is where contrast against black and against white are equal.
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
