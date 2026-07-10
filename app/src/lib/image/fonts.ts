/**
 * Font registry for the Content Studio picker. Each option points to a CSS
 * variable that next/font registers for us in app/fonts.ts + layout.tsx.
 *
 * Adding a new font: register it in fonts.ts, wire its variable into the
 * <html className=...> in layout.tsx, then add an entry here.
 *
 * The Content Studio renders via HTML Canvas, which can't resolve
 * `var(--...)` directly in font strings — so we keep the variable name and
 * a fallback chain separate. Use `resolveCanvasFont()` to produce a string
 * suitable for `ctx.font`.
 */

export type FontGroup = "display" | "sans" | "serif";

export interface FontOption {
  id: string;
  name: string;
  /** CSS variable name as set in app/fonts.ts (e.g. '--font-heading'). */
  cssVar: string;
  /** Fallback font family if the variable hasn't loaded yet. */
  fallback: string;
  group: FontGroup;
  /** Whether this font is appropriate as a heading face. */
  forHeading?: boolean;
  /** Whether this font is appropriate as a body face. */
  forBody?: boolean;
}

export const FONT_OPTIONS: FontOption[] = [
  // ---- Display / heading-led ----
  {
    id: "nebula",
    name: "Nebula",
    cssVar: "--font-heading",
    fallback: '"Hanken Grotesk", system-ui, sans-serif',
    group: "display",
    forHeading: true,
  },
  {
    id: "nebula-hollow",
    name: "Nebula Hollow",
    cssVar: "--font-heading-hollow",
    fallback: '"Hanken Grotesk", system-ui, sans-serif',
    group: "display",
    forHeading: true,
  },
  {
    id: "clash-display",
    name: "Clash Display",
    cssVar: "--font-clash",
    fallback: '"Hanken Grotesk", system-ui, sans-serif',
    group: "display",
    forHeading: true,
  },
  {
    id: "bebas-neue",
    name: "Bebas Neue",
    cssVar: "--font-bebas",
    fallback: '"Oswald", "Arial Narrow", system-ui, sans-serif',
    group: "display",
    forHeading: true,
  },
  {
    id: "playfair",
    name: "Playfair Display",
    cssVar: "--font-playfair",
    fallback: "Georgia, serif",
    group: "serif",
    forHeading: true,
    forBody: true,
  },

  // ---- Sans bodies (also work as soft headings) ----
  {
    id: "hanken-grotesk",
    name: "Hanken Grotesk",
    cssVar: "--font-body",
    fallback: "system-ui, sans-serif",
    group: "sans",
    forHeading: true,
    forBody: true,
  },
  {
    id: "inter",
    name: "Inter",
    cssVar: "--font-inter",
    fallback: "system-ui, sans-serif",
    group: "sans",
    forHeading: true,
    forBody: true,
  },
  {
    id: "manrope",
    name: "Manrope",
    cssVar: "--font-manrope",
    fallback: "system-ui, sans-serif",
    group: "sans",
    forHeading: true,
    forBody: true,
  },
  {
    id: "space-grotesk",
    name: "Space Grotesk",
    cssVar: "--font-space-grotesk",
    fallback: "system-ui, sans-serif",
    group: "sans",
    forHeading: true,
    forBody: true,
  },
];

export const DEFAULT_HEADING_FONT_ID = "nebula";
export const DEFAULT_BODY_FONT_ID = "hanken-grotesk";

export function getFontOption(
  id: string | null | undefined,
): FontOption | null {
  if (!id) return null;
  return FONT_OPTIONS.find((f) => f.id === id) ?? null;
}

/**
 * Resolve a font id (or fallback id) to a canvas-friendly font-family
 * string. The CSS variable is looked up against the document root at call
 * time so the actual loaded font family is used.
 */
export function resolveCanvasFont(
  id: string | null | undefined,
  fallbackId: string,
): string {
  const option = getFontOption(id) ?? getFontOption(fallbackId);
  if (!option) return "sans-serif";
  if (typeof window === "undefined") return option.fallback;
  const resolved = getComputedStyle(document.documentElement)
    .getPropertyValue(option.cssVar)
    .trim();
  return resolved ? `${resolved}, ${option.fallback}` : option.fallback;
}
