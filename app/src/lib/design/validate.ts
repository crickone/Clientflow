/**
 * The gate. ZERO RUNTIME IMPORTS (see ./parse.ts).
 *
 * This is the whole safety story for AI-composed design. A model choosing its
 * own layout is only tolerable because the tenant's brand document states its
 * rules as measured numbers, and those numbers can be checked before anyone
 * sees the result. During the Optimal Health build, computing contrast caught
 * a primary button at 3.01:1 and a ground-rotation check caught sage at 67%
 * against a one-third ceiling. The same two checks run here.
 *
 * Violations are returned as a LIST of complete English sentences naming the
 * actual measurement, because they are shown to the operator verbatim and go
 * back to the model verbatim in the repair call. "Heading is timber on sage:
 * 2.14:1, below the 4.5:1 this system requires" is actionable. "Contrast
 * violation" is not.
 *
 * It runs on RENDER, not only at generation, because there are two sources of
 * a bad slide and only one of them is the model: an operator who retypes a
 * heading or nudges a colour can break the same rule.
 */
import type { DesignSystem, TypeLevel } from "./parse";
import { LARGE_TYPE_LEVELS, valueHex } from "./parse";
import type { LayoutSpec } from "./grammar";
import { isGround } from "./parse";

export type Validation =
  | { ok: true }
  | { ok: false; violations: string[] };

const OK: Validation = { ok: true };

function result(violations: string[]): Validation {
  return violations.length === 0 ? OK : { ok: false, violations };
}

// -------------------------------------------------------------------------
//  Contrast — WCAG 2.x relative luminance, computed
// -------------------------------------------------------------------------

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] | null {
  const h = hex.trim();
  if (!HEX.test(h)) return null;
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}

function linearise(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. NaN for anything that is not a 6-digit hex. */
export function relativeLuminance(hex: string): number {
  const rgb = channels(hex);
  if (!rgb) return NaN;
  const [r, g, b] = rgb.map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, 1..21. NaN if either is not a hex —
 * callers treat NaN as "cannot be measured" and say so, rather than passing
 * or failing a slide on maths that did not happen.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (Number.isNaN(la) || Number.isNaN(lb)) return NaN;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** As shown to a human: two decimal places, the way the brand document
 *  publishes its own table. */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

// -------------------------------------------------------------------------
//  Resolving what is actually on screen
// -------------------------------------------------------------------------

/** The value key whose hex this is, if the system owns it. Comparison is on
 *  the normalised hex, because a colour reaching us from a slide row is a hex
 *  the operator picked, not a key. */
export function valueKeyForHex(
  system: DesignSystem,
  hex: string | null | undefined,
): string | null {
  if (!hex) return null;
  const h = hex.trim().toLowerCase();
  return system.values.find((v) => v.hex === h)?.key ?? null;
}

/**
 * The type colour this system would put on a given ground: the value with the
 * highest contrast against it, excluding the reserved values and anything the
 * system forbids as type.
 *
 * This DERIVES the brand document's "ink on sage and plaster, plaster on ink"
 * rule from its own numbers rather than restating it, which means a system
 * that adds or changes a value gets the right answer without anyone editing
 * this file. It is also why a default composition is safe by construction:
 * violations arise when a colour is OVERRIDDEN, by the model or the operator,
 * not when the system is left to choose.
 */
export function defaultTypeValue(
  system: DesignSystem,
  groundHex: string,
): { key: string; hex: string; ratio: number } | null {
  let best: { key: string; hex: string; ratio: number } | null = null;
  for (const value of system.values) {
    if (value.role === "reserved") continue;
    if (system.rules.neverType.includes(value.key)) continue;
    const ratio = contrastRatio(value.hex, groundHex);
    if (Number.isNaN(ratio)) continue;
    if (!best || ratio > best.ratio) best = { key: value.key, hex: value.hex, ratio };
  }
  return best;
}

/** How a colour is named in a violation: its value key if the system owns it,
 *  otherwise the raw hex, so an off-system colour reads as the intruder it is. */
function name(system: DesignSystem, hex: string): string {
  return valueKeyForHex(system, hex) ?? hex.toLowerCase();
}

/**
 * The slide row's own content and colour. Structure lives in the LayoutSpec;
 * CONTENT and COLOUR stay in the existing slide columns, so an operator edits
 * a composed slide with exactly the controls they already have and retyping a
 * heading invalidates nothing about the layout.
 */
export interface SlideColours {
  /** The row's backgroundColor, when the operator set one. Overrides the
   *  spec's ground. */
  background?: string | null;
  /** The row's accentColor — highlighted words and the accent rule. */
  accent?: string | null;
  /**
   * Whether the accent is actually SET IN TYPE on this slide, rather than only
   * filling a rule. An accent used to divide and fill is exempt from the type
   * rules — that is what an accent is for — so checking it unconditionally
   * would flag every composed slide whose palette has a forbidden-as-type
   * accent, which is most of them. Callers derive it from the content: the
   * accent carries text only where the heading has *asterisk* highlight
   * markup. Defaults to true, so a caller that has not thought about it gets
   * the strict answer rather than a silent pass.
   */
  accentCarriesText?: boolean;
  /** Whether a background photograph is actually present. Type over a
   *  photograph cannot be checked against a flat hex, so contrast is not
   *  measured there; the ban on non-type values still applies. */
  hasPhoto?: boolean;
}

// -------------------------------------------------------------------------
//  Per-slide validation
// -------------------------------------------------------------------------

function floorFor(system: DesignSystem, level: TypeLevel): number {
  return LARGE_TYPE_LEVELS.has(level)
    ? system.rules.minContrastLarge
    : system.rules.minContrastBody;
}

function levelLabel(level: TypeLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Check one slide: its spec against the system, and the colours actually on
 * the row against the system's contrast floors.
 */
export function validateSlide(
  spec: LayoutSpec,
  system: DesignSystem,
  colours: SlideColours = {},
): Validation {
  const violations: string[] = [];

  // -- The spec's own references still resolve. The grammar checked these at
  // parse time; they are checked again here because validation runs on
  // render, against rows that may have been written by an older build.
  const specGroundHex = valueHex(system, spec.ground);
  if (specGroundHex === null) {
    violations.push(
      `The layout's ground "${spec.ground}" is not a value in this design system.`,
    );
  } else if (!isGround(system, spec.ground)) {
    violations.push(
      `"${spec.ground}" is not one of this system's grounds (${system.grounds.map((g) => g.value).join(", ")}).`,
    );
  }

  // -- The ground actually painted. An operator's backgroundColor wins over
  // the spec, which is the point of keeping colour on the row.
  const override = colours.background?.trim();
  const groundHex = override || specGroundHex;
  if (override && !valueKeyForHex(system, override)) {
    violations.push(
      `The background ${override.toLowerCase()} is not a value in this design system. ` +
        `The palette is ${system.values.map((v) => v.key).join(", ")}, and it is deliberately closed.`,
    );
  }

  // -- Spans still fit the grid.
  for (let i = 0; i < spec.slots.length; i++) {
    const slot = spec.slots[i];
    if (slot.span < 1 || slot.span > system.grid.columns) {
      violations.push(
        `${levelLabel(slot.level)} spans ${slot.span} columns, and this grid has ${system.grid.columns}.`,
      );
    }
  }

  // -- The accent rule may use any value; that is what an accent is for. But
  // it must be a value.
  if (spec.accentRule && valueHex(system, spec.accentRule.value) === null) {
    violations.push(
      `The accent rule's colour "${spec.accentRule.value}" is not a value in this design system.`,
    );
  }

  if (!groundHex) return result(violations);

  // -- Type colour. The operator's accent, when they set one, carries the
  // highlighted words; otherwise the system chooses, and its choice is safe
  // by construction.
  const accent = colours.accent?.trim() || null;
  const carriesText = colours.accentCarriesText !== false;
  const fallback = defaultTypeValue(system, groundHex);

  const textColours: { hex: string; why: string }[] = [];
  if (fallback) textColours.push({ hex: fallback.hex, why: "" });
  if (carriesText && accent && (!fallback || accent.toLowerCase() !== fallback.hex)) {
    textColours.push({ hex: accent, why: " highlight" });
  }

  const groundName = name(system, groundHex);

  for (const { hex, why } of textColours) {
    // A value the system forbids as type is forbidden whatever the maths
    // says, and whether or not there is a photograph under it.
    const key = valueKeyForHex(system, hex);
    if (key && system.rules.neverType.includes(key)) {
      violations.push(
        `${key} is set as type${why ? " (highlight)" : ""}, and this system never sets type in ${key} — ` +
          `it is for rules, blocks and fills.`,
      );
      continue;
    }

    // Over a photograph there is no flat ground to measure against, so the
    // ratio is not computed rather than computed against the wrong thing.
    if (colours.hasPhoto && spec.photo === "full") continue;

    for (const slot of spec.slots) {
      const floor = floorFor(system, slot.level);
      const ratio = contrastRatio(hex, groundHex);
      if (Number.isNaN(ratio)) {
        violations.push(
          `${levelLabel(slot.level)} contrast could not be measured: ${hex} on ${groundHex}.`,
        );
        break;
      }
      if (ratio < floor) {
        violations.push(
          `${levelLabel(slot.level)}${why} is ${name(system, hex)} on ${groundName}: ` +
            `${formatRatio(ratio)}, below the ${floor.toFixed(1)}:1 this system requires for ` +
            `${LARGE_TYPE_LEVELS.has(slot.level) ? "large text" : "body text"}.`,
        );
      }
    }
  }

  return result(violations);
}

// -------------------------------------------------------------------------
//  Carousel-level validation
// -------------------------------------------------------------------------

/**
 * How many slides of a set may carry a given ground. `share` is a fraction,
 * and it is ROUNDED rather than floored: the brand document's own reference
 * rotation is sage, plaster, plaster, sage, ink, plaster, and sage's stated
 * ceiling is "a third" written as 0.33 -- floor(0.33 x 6) is 1, which would
 * reject the document's own example. Rounding gives 2, which is what "a
 * third of six" means. The floor of 1 keeps a single-slide post legal, since
 * the rotation rule is about sets.
 */
export function groundBudget(share: number, slides: number): number {
  return Math.max(1, Math.round(share * slides));
}

/**
 * Check a whole set: the ground rotation. This is the rule that stops "sage
 * creep" — without it every piece drifts back to a green ground within a
 * week, which is the failure the brand document calls out by name.
 */
export function validateCarousel(
  specs: LayoutSpec[],
  system: DesignSystem,
): Validation {
  const violations: string[] = [];
  const n = specs.length;
  if (n === 0) return OK;

  for (const ground of system.grounds) {
    const used = specs.filter((s) => s.ground === ground.value).length;
    const budget = groundBudget(ground.share, n);
    if (used > budget) {
      violations.push(
        `${ground.value} is the ground on ${used} of ${n} slides, and this system allows ` +
          `at most ${budget} (${Math.round(ground.share * 100)}% of a set).`,
      );
    }
  }

  // Consecutive runs.
  let runValue = "";
  let runLength = 0;
  let runStart = 0;
  const reportRun = () => {
    if (!runValue) return;
    const ground = system.grounds.find((g) => g.value === runValue);
    if (ground && runLength > ground.maxRun) {
      violations.push(
        `${runValue} is the ground on ${runLength} consecutive slides (${runStart + 1}-${runStart + runLength}), ` +
          `and this system allows at most ${ground.maxRun} in a row.`,
      );
    }
  };
  for (let i = 0; i < n; i++) {
    if (specs[i].ground === runValue) {
      runLength++;
    } else {
      reportRun();
      runValue = specs[i].ground;
      runLength = 1;
      runStart = i;
    }
  }
  reportRun();

  return result(violations);
}

/** Both levels at once, for a set that is about to be shown or persisted. */
export function validateSet(
  slides: { spec: LayoutSpec; colours?: SlideColours }[],
  system: DesignSystem,
): Validation {
  const violations: string[] = [];
  slides.forEach((slide, i) => {
    const r = validateSlide(slide.spec, system, slide.colours);
    if (!r.ok) violations.push(...r.violations.map((v) => `Slide ${i + 1}: ${v}`));
  });
  const set = validateCarousel(
    slides.map((s) => s.spec),
    system,
  );
  if (!set.ok) violations.push(...set.violations);
  return result(violations);
}
