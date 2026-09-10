/**
 * The six authored design directions. Data only, zero runtime imports.
 *
 * Each is a transcription of a set of decisions someone made and then LOOKED
 * AT as rendered slides -- not a palette with a name on it. The defaults are
 * the direction's own look for the picker; a tenant replaces them slot by
 * slot with their brand colours and the structure stays.
 *
 * SAGE_FIELD is Optimal Health's system with the hexes lifted into slots, and
 * directions.test.ts pins that it composes back to the hand-authored preset
 * byte for byte. The other five are distinct in TYPEFACE and STRUCTURE, not
 * just colour -- six directions in one face would be six colour schemes.
 *
 * Shares are ceilings (fraction of a set) and need not sum to 1; maxRun is
 * how many consecutive slides may carry that ground.
 */
import type { DesignDirection } from "./direction";

export const SAGE_FIELD: DesignDirection = {
  id: "sage-field",
  name: "Sage Field",
  blurb: "Calm, clinical warmth. Plaster and sage grounds, ink type, a timber accent that is never text.",
  font: "Inter",
  slots: [
    { key: "sage", label: "Signature ground", role: "ground", defaultHex: "#c7d2bb", ground: { share: 0.33, maxRun: 1 } },
    { key: "ink", label: "Type, and the anchor ground", role: "type", defaultHex: "#24231f", ground: { share: 0.17, maxRun: 2 } },
    { key: "plaster", label: "Main ground", role: "ground", defaultHex: "#f2f3ed", ground: { share: 0.5, maxRun: 3 } },
    { key: "timber", label: "Accent (rules and fills, never text)", role: "accent", defaultHex: "#b0844f" },
    { key: "deep-green", label: "Secondary type", role: "type", defaultHex: "#5e6b4e" },
    { key: "navy", label: "Reserved (signage only)", role: "reserved", defaultHex: "#26334e" },
  ],
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.52, contrast: 0.9, brightness: 1.06, wash: { slot: "timber", alpha: 0.07 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["timber"] },
};

export const EDITORIAL: DesignDirection = {
  id: "editorial",
  name: "Editorial",
  blurb: "Magazine serif at scale. Paper and a warm tint, ink type, a deep red accent used sparingly.",
  font: "Playfair Display",
  slots: [
    { key: "paper", label: "Main ground", role: "ground", defaultHex: "#f5f1e8", ground: { share: 0.55, maxRun: 4 } },
    { key: "tint", label: "Second ground", role: "ground", defaultHex: "#e6dccb", ground: { share: 0.25, maxRun: 2 } },
    { key: "ink", label: "Type, and the dark ground", role: "type", defaultHex: "#1a1a1a", ground: { share: 0.2, maxRun: 1 } },
    { key: "accent", label: "Accent", role: "accent", defaultHex: "#8b2c2c" },
  ],
  type: {
    display: { size: 96, leading: 0.94, tracking: -0.02, weight: 600 },
    headline: { size: 68, leading: 1.0, tracking: -0.015, weight: 500 },
    subhead: { size: 32, leading: 1.25, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.12, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 80, gutter: 24, field: 1080 },
  photo: { saturate: 0.7, contrast: 1.0, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const BOLD: DesignDirection = {
  id: "bold",
  name: "Bold",
  blurb: "Oversized grotesk, black and white, one signal colour. Loud at thumbnail size.",
  font: "Archivo",
  slots: [
    { key: "black", label: "Main ground, and type on light", role: "ground", defaultHex: "#0a0a0a", ground: { share: 0.5, maxRun: 3 } },
    { key: "white", label: "Light ground, and type on dark", role: "ground", defaultHex: "#ffffff", ground: { share: 0.35, maxRun: 2 } },
    { key: "signal", label: "Signal colour (accent, and an occasional ground)", role: "accent", defaultHex: "#ffd400", ground: { share: 0.15, maxRun: 1 } },
  ],
  type: {
    display: { size: 120, leading: 0.9, tracking: -0.04, weight: 700 },
    headline: { size: 76, leading: 0.96, tracking: -0.03, weight: 700 },
    subhead: { size: 32, leading: 1.2, tracking: -0.01, weight: 600 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 500 },
    label: { size: 16, leading: 1, tracking: 0.16, weight: 700, upper: true },
  },
  grid: { columns: 4, margin: 64, gutter: 24, field: 1080 },
  photo: { saturate: 0.3, contrast: 1.15, brightness: 0.95, wash: { slot: "black", alpha: 0.1 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const CLINICAL: DesignDirection = {
  id: "clinical",
  name: "Clinical",
  blurb: "Soft, precise, medical without being cold. Cloud and mist grounds, slate type, a teal signal.",
  font: "Manrope",
  slots: [
    { key: "cloud", label: "Main ground", role: "ground", defaultHex: "#f4f6f5", ground: { share: 0.6, maxRun: 4 } },
    { key: "mist", label: "Second ground", role: "ground", defaultHex: "#dfe7e4", ground: { share: 0.25, maxRun: 2 } },
    { key: "slate", label: "Type, and the dark ground", role: "type", defaultHex: "#1f2a2e", ground: { share: 0.15, maxRun: 1 } },
    { key: "deep", label: "Secondary type", role: "type", defaultHex: "#0f3b3a" },
    { key: "signal", label: "Accent", role: "accent", defaultHex: "#2f7f6f" },
  ],
  type: {
    display: { size: 80, leading: 0.98, tracking: -0.03, weight: 600 },
    headline: { size: 60, leading: 1.04, tracking: -0.02, weight: 600 },
    subhead: { size: 28, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 21, leading: 1.55, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.18, weight: 600, upper: true },
  },
  grid: { columns: 8, margin: 72, gutter: 24, field: 1080 },
  photo: { saturate: 0.6, contrast: 0.95, brightness: 1.08, wash: { slot: "mist", alpha: 0.06 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const SWISS: DesignDirection = {
  id: "swiss",
  name: "Swiss",
  blurb: "Grid, grotesk, red. Monochrome photography, black type, white ground, one hard accent.",
  font: "Space Grotesk",
  slots: [
    { key: "white", label: "Main ground", role: "ground", defaultHex: "#ffffff", ground: { share: 0.5, maxRun: 3 } },
    { key: "black", label: "Type, and the dark ground", role: "type", defaultHex: "#111111", ground: { share: 0.3, maxRun: 2 } },
    { key: "red", label: "Accent, and an occasional ground", role: "accent", defaultHex: "#c8001a", ground: { share: 0.2, maxRun: 1 } },
    { key: "grey", label: "Secondary type", role: "type", defaultHex: "#6b6b6b" },
  ],
  type: {
    display: { size: 100, leading: 0.92, tracking: -0.04, weight: 500 },
    headline: { size: 64, leading: 1.0, tracking: -0.03, weight: 500 },
    subhead: { size: 30, leading: 1.25, tracking: -0.01, weight: 500 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.1, weight: 500, upper: true },
  },
  grid: { columns: 12, margin: 60, gutter: 20, field: 1080 },
  photo: { saturate: 0, contrast: 1.1, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const WARM: DesignDirection = {
  id: "warm",
  name: "Warm",
  blurb: "Soft serif, cream and cocoa, terracotta. Feels like a good kitchen.",
  font: "Fraunces",
  slots: [
    { key: "cream", label: "Main ground", role: "ground", defaultHex: "#f7efe4", ground: { share: 0.5, maxRun: 3 } },
    { key: "terracotta", label: "Accent, and a warm ground", role: "accent", defaultHex: "#a34a2a", ground: { share: 0.3, maxRun: 1 } },
    { key: "cocoa", label: "Type, and the dark ground", role: "type", defaultHex: "#3b2a22", ground: { share: 0.2, maxRun: 2 } },
    { key: "olive", label: "Secondary type", role: "type", defaultHex: "#5c6b3a" },
  ],
  type: {
    display: { size: 88, leading: 0.96, tracking: -0.02, weight: 500 },
    headline: { size: 62, leading: 1.04, tracking: -0.01, weight: 500 },
    subhead: { size: 30, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.14, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.8, contrast: 0.95, brightness: 1.05, wash: { slot: "terracotta", alpha: 0.08 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const DESIGN_DIRECTIONS: DesignDirection[] = [SAGE_FIELD, EDITORIAL, BOLD, CLINICAL, SWISS, WARM];

export function getDirection(id: string): DesignDirection | null {
  return DESIGN_DIRECTIONS.find((d) => d.id === id) ?? null;
}
