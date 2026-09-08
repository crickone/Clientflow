/**
 * Authored design systems. Zero runtime imports (see ./parse.ts).
 *
 * These are transcriptions, not inventions: every number below is lifted from
 * the tenant's own brand document, and the document is the thing to change if
 * a value is wrong. A preset is seeded into a tenant's settings via
 * setDesignSystem() in ./system.ts; nothing reads a preset at render time, so
 * a tenant that has edited their stored system keeps their edits.
 */
import type { DesignSystem } from "./parse";

/**
 * Optimal Health and Recovery at Inspire — "Sage Field", adopted 7 Sept 2026.
 * Transcribed from OPTIMAL-BRAND-SYSTEM.md, section by section.
 *
 * Two things in that document deliberately do NOT appear here, because the
 * DesignSystem shape has nowhere to put them and inventing a place would be
 * scope creep: the second, deeper photo grade for ink grounds (saturation 48 /
 * contrast 96 / brightness 90 / 6% wash), and the two logo files with their
 * ink-on-light, plaster-on-dark rule. Both are noted so the next person knows
 * they were seen and skipped, not missed.
 */
export const OPTIMAL_HEALTH_DESIGN_SYSTEM: DesignSystem = {
  version: 1,

  // Section 2 — five values, no more (navy is the reserved sixth, for
  // wayfinding and signage only, and is carried so a composed layout can be
  // told it exists and may not have it).
  values: [
    { key: "sage", hex: "#c7d2bb", role: "ground" },
    { key: "ink", hex: "#24231f", role: "type" },
    { key: "plaster", hex: "#f2f3ed", role: "ground" },
    { key: "timber", hex: "#b0844f", role: "accent" },
    { key: "deep-green", hex: "#5e6b4e", role: "type" },
    { key: "navy", hex: "#26334e", role: "reserved" },
  ],

  // Section 3 — three grounds and the rotation rule. Ink's primary role is
  // "type"; it is also the anchor ground, which is why ground eligibility is
  // read from this list and not from `role`. Sage's maxRun of 1 IS the
  // document's "sage never on two consecutive slides".
  grounds: [
    { value: "plaster", share: 0.5, maxRun: 3 },
    { value: "sage", share: 0.33, maxRun: 1 },
    { value: "ink", share: 0.17, maxRun: 2 },
  ],

  // Section 5 — the type scale, authored for a 1080px field.
  //
  // ONE DELIBERATE DEPARTURE from the document, at the client's request
  // (2026-09-08): headline is 64px here, not the document's 50. Social posts
  // are read at thumbnail size in a feed, where 50px on a 1080 field is merely
  // legible rather than the emphasis a headline is for — the operator looked at
  // real generated carousels and asked for bigger headings twice. Changing the
  // SCALE rather than the prompt is what makes it hold: the size a heading
  // takes is brand-system data, and asking a model to override its own type
  // scale is a rule that quietly stops being followed. The website build made
  // two similar departures for the same reason. Every other level is the
  // document's.
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },

  // Section 7 — six columns on a 1080px field. Margins 76, gutters 28, which
  // makes each column 131.33px; the document rounds it to 131.
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },

  // Section 8 — the house grade. Percentages in the document, multipliers
  // here (52% -> 0.52).
  photo: {
    saturate: 0.52,
    contrast: 0.9,
    brightness: 1.06,
    wash: { hex: "#b0844f", alpha: 0.07 },
  },

  // Section 4 — contrast stated as rules, plus the one value that fails as
  // text on every ground it could sit on (section 10, gotcha 3).
  rules: {
    minContrastBody: 4.5,
    minContrastLarge: 3,
    neverType: ["timber"],
  },
};

/** Presets by a stable id, for seeding. */
export const DESIGN_SYSTEM_PRESETS: Record<string, DesignSystem> = {
  "optimal-health": OPTIMAL_HEALTH_DESIGN_SYSTEM,
};
