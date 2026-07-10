// Pure theme model — no server-only imports, so both the server (layout
// injection) and the client (live settings preview) can use it. A tenant's
// theme is just two chosen colours (page background + accent); the full token
// palette used across the app is *derived* from them so everything stays
// coherent whether the background is dark or light.

export interface ThemeConfig {
  bg: string; // page canvas hex, e.g. "#0c0d10"
  accent: string; // accent hex, e.g. "#ff6a32"
  headingFont: string; // id from HEADING_FONTS below
}

/**
 * Selectable UI heading fonts. `cssVar` is the next/font CSS variable already
 * loaded on <html> (see app/fonts.ts + FONT_VARS in layout.tsx). Choosing one
 * repoints `--font-heading`, so every heading across the app follows.
 */
export const HEADING_FONTS: { id: string; label: string; cssVar: string }[] = [
  { id: "space-grotesk", label: "Space Grotesk", cssVar: "--font-space-grotesk" },
  { id: "bebas", label: "Bebas Neue", cssVar: "--font-bebas" },
  { id: "nebula", label: "Nebula", cssVar: "--font-nebula" },
  { id: "clash", label: "Clash Display", cssVar: "--font-clash" },
  { id: "playfair", label: "Playfair Display", cssVar: "--font-playfair" },
  { id: "manrope", label: "Manrope", cssVar: "--font-manrope" },
  { id: "inter", label: "Inter", cssVar: "--font-inter" },
];
export const DEFAULT_HEADING_FONT = "space-grotesk";

function headingCssVar(id: string): string {
  const f = HEADING_FONTS.find((x) => x.id === id) ?? HEADING_FONTS[0];
  return f.cssVar;
}

export const DEFAULT_THEME: ThemeConfig = {
  bg: "#0c0d10",
  accent: "#ff6a32",
  headingFont: DEFAULT_HEADING_FONT,
};

/** A handful of ready-made colour pairs for the settings picker. */
export const THEME_PRESETS: { name: string; theme: { bg: string; accent: string } }[] = [
  { name: "Charcoal · Orange", theme: { bg: "#0c0d10", accent: "#ff6a32" } },
  { name: "Charcoal · Gold", theme: { bg: "#0e0f12", accent: "#d4af37" } },
  { name: "Midnight · Blue", theme: { bg: "#0b1020", accent: "#4d8df0" } },
  { name: "Ink · Violet", theme: { bg: "#0e0c16", accent: "#a366e6" } },
  { name: "Slate · Green", theme: { bg: "#0b1210", accent: "#22c55e" } },
  { name: "Onyx · Cyan", theme: { bg: "#08100f", accent: "#06b6d4" } },
  { name: "Espresso · Amber", theme: { bg: "#100b08", accent: "#f59e0b" } },
  { name: "Graphite · Rose", theme: { bg: "#0f0d0e", accent: "#f43f5e" } },
  { name: "Plum · Magenta", theme: { bg: "#120b14", accent: "#ec4899" } },
  { name: "Steel · Sky", theme: { bg: "#0a0e14", accent: "#38bdf8" } },
  { name: "Warm Sand · Terracotta", theme: { bg: "#f4f1ea", accent: "#c4622d" } },
];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v.trim());
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function toHex({ r, g, b }: RGB): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
const WHITE: RGB = { r: 255, g: 255, b: 255 };
const BLACK: RGB = { r: 0, g: 0, b: 0 };
function lighten(c: RGB, t: number) {
  return mix(c, WHITE, t);
}
function darken(c: RGB, t: number) {
  return mix(c, BLACK, t);
}
function rgba(c: RGB, a: number) {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}
/** Perceived luminance 0..1 (sRGB relative). */
function luminance(c: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/**
 * Derive the full CSS-variable palette from the two chosen colours. Returns an
 * ordered list of [property, value] pairs (custom props + `color-scheme`),
 * suitable for both a `:root{}` rule and per-property `setProperty` calls.
 */
export function resolveThemeVars(cfg: ThemeConfig): Array<[string, string]> {
  const bgHex = isHexColor(cfg.bg) ? cfg.bg : DEFAULT_THEME.bg;
  const accentHex = isHexColor(cfg.accent) ? cfg.accent : DEFAULT_THEME.accent;
  const bg = parseHex(bgHex);
  const accent = parseHex(accentHex);
  const dark = luminance(bg) < 0.4;

  // Foreground ink is white on dark backgrounds, near-black on light ones.
  const fg: RGB = dark ? WHITE : { r: 20, g: 21, b: 23 };

  // Surfaces step away from the canvas (lighter on dark, darker on light).
  const step = dark ? lighten : darken;
  const surface1 = step(bg, dark ? 0.05 : 0.04);
  const surface2 = step(bg, dark ? 0.1 : 0.07);
  const surface3 = step(bg, dark ? 0.15 : 0.11);

  const accentInk = dark ? lighten(accent, 0.18) : darken(accent, 0.12);

  return [
    ["--bg", bgHex],
    ["--surface-1", toHex(surface1)],
    ["--surface-2", toHex(surface2)],
    ["--surface-3", toHex(surface3)],
    ["--grid", rgba(fg, 0.05)],
    ["--hairline", rgba(fg, dark ? 0.09 : 0.12)],
    ["--hairline-strong", rgba(fg, dark ? 0.2 : 0.24)],
    ["--text-primary", rgba(fg, dark ? 0.96 : 0.92)],
    ["--text-secondary", rgba(fg, 0.64)],
    ["--text-tertiary", rgba(fg, 0.42)],
    ["--accent", accentHex],
    ["--accent-ink", toHex(accentInk)],
    ["--accent-soft", rgba(accent, 0.14)],
    ["--accent-glow", `0 0 0 1px ${rgba(accent, 0.4)}, 0 6px 24px -6px ${rgba(accent, 0.5)}`],
    ["--glass", rgba(surface1, 0.72)],
    ["--font-heading", `var(${headingCssVar(cfg.headingFont ?? DEFAULT_HEADING_FONT)})`],
    ["color-scheme", dark ? "dark" : "light"],
  ];
}

/** Build a `:root{}` CSS rule string for server-side injection. */
export function themeCss(cfg: ThemeConfig): string {
  const body = resolveThemeVars(cfg)
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `:root{${body}}`;
}
