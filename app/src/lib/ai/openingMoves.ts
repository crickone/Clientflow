/**
 * Opening moves: a compositional direction for SLIDE ONE, rotated between
 * generations.
 *
 * The problem this solves is not variation within a post — DESIGN_RULES
 * already pushes for that, and it works. It is variation ACROSS posts. Every
 * generation is an independent call with a byte-identical prompt, so the model
 * settles on its favourite opening and every post starts to look like the last
 * one. Temperature doesn't fix it: the pull is the prompt, not the sampling.
 *
 * This is deliberately NOT the archetype grammar that was tried and deleted.
 * That version handed the model a layout to fill in, which produced exactly
 * the templated look the designed-post work exists to escape. A move here is
 * one sentence of DIRECTION — what dominates, where the weight sits, what the
 * eye hits first — and the model still composes the slide. It names a
 * starting point, not a structure.
 *
 * Consecutive posts are GUARANTEED to differ rather than merely likely to: the
 * last move used is remembered per tenant and excluded from the next pick. A
 * random choice from eight lands on the same one about one time in eight,
 * which is often enough to be noticed and complained about.
 *
 * Pure — the caller owns reading and writing the "last used" value.
 */

export interface OpeningMove {
  key: string;
  /**
   * A noun phrase describing the composition, NOT a sentence — so each caller
   * can frame it for its own context ("open on X" for slide one, "take this
   * slide toward X" for a regenerate) without either reading oddly.
   */
  directive: string;
  /** Moves built around a photograph are unusable when the tenant has none. */
  needsPhoto: boolean;
}

export const OPENING_MOVES: OpeningMove[] = [
  {
    key: "photo-overlap",
    directive:
      "a full-bleed photograph with the heading overlapping it low in the frame, on a scrim that keeps the type readable",
    needsPhoto: true,
  },
  {
    key: "photo-band",
    directive:
      "the photograph as a band across part of the canvas rather than the whole frame, with the heading on flat ground beyond it",
    needsPhoto: true,
  },
  {
    key: "oversized-crop",
    directive:
      "a single oversized word or number, large enough that the canvas edge crops it, with the rest of the line quiet beneath",
    needsPhoto: false,
  },
  {
    key: "asymmetric-split",
    directive:
      "an asymmetric split, a band of a second ground cutting across the first, with the heading held in the smaller of the two",
    needsPhoto: false,
  },
  {
    key: "anchored-low",
    directive:
      "everything anchored to the bottom of the frame with a large quiet field above it",
    needsPhoto: false,
  },
  {
    key: "rule-crossing",
    directive:
      "a rule crossing the full width of the composition, the heading sitting hard against it",
    needsPhoto: false,
  },
  {
    key: "type-only",
    directive:
      "type alone — the heading at display size filling most of the frame, one short line beneath it, nothing else",
    needsPhoto: false,
  },
  {
    key: "corner-weight",
    directive:
      "the weight in one corner, heading and supporting line stacked tight in the lower left, the rest of the canvas empty",
    needsPhoto: false,
  },
];

export const OPENING_MOVE_KEYS = OPENING_MOVES.map((m) => m.key);

/**
 * Choose the opening move for this generation.
 *
 * `lastKey` is the move the previous post used — excluded so consecutive posts
 * cannot open the same way. `hasPhoto` filters out the moves that need a
 * photograph, since a tenant without one is told not to write an <img> at all
 * and a directive asking for a full-bleed image would put the model in direct
 * conflict with that rule.
 *
 * `random` is injected so a test can pin the choice; callers use Math.random.
 */
export function pickOpeningMove(
  lastKey: string | null,
  hasPhoto: boolean,
  random: () => number = Math.random,
): OpeningMove {
  const usable = OPENING_MOVES.filter((m) => hasPhoto || !m.needsPhoto);
  const candidates = usable.filter((m) => m.key !== lastKey);
  // Falling back to `usable` matters when exclusion empties the list — a
  // single-move set would otherwise have nothing to return.
  const pool = candidates.length > 0 ? candidates : usable;
  const i = Math.min(pool.length - 1, Math.floor(random() * pool.length));
  return pool[i];
}
