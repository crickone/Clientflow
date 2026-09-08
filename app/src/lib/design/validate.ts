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
 * WHAT IS HERE AND WHAT IS NOT. These are the colour primitives: real WCAG
 * luminance, the ratio, and the derivations that follow from a system's own
 * values. The slide-shaped validators that used to sit below them belonged to
 * the archetype grammar, where every colour was a named key and the ground was
 * known -- neither is true of a free-form design, whose ground can only be
 * resolved by laying the document out.
 *
 * lib/design/htmlAudit.ts is what checks a design today, and uses
 * valueKeyForHex from here. The rest is kept because it is the brand's own
 * measured rules, pinned against the ratios Optimal Health publishes, and is
 * what a real contrast check will be built from once a ground can be resolved.
 */
import type { DesignSystem } from "./parse";

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
