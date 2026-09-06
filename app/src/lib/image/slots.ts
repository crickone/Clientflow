/**
 * Where a slide lives inside a design.
 *
 * A design holds several independent "slots", each keyed by a carousel
 * template id, so one design can carry a tips carousel, a cover carousel and a
 * single post side by side. Every single image lives in the shared "default"
 * slot.
 *
 * The editor decides whether a slot belongs to the Carousels tab purely from
 * its key, so every producer of a slot key — the create route, the generator,
 * the Start screen, "Add slide" — has to agree on the test. It lives here once
 * rather than as four copies, because when those copies drifted the seed slide
 * landed in "default" while the Start screen sent the user to the Carousels
 * tab, which then reported every slot EMPTY and the slide looked lost.
 */

/** What a design is: a series of slides, or one image. */
export type DesignKind = "carousel" | "single";

/** The slot every single image shares. */
export const DEFAULT_SLOT = "default";

/** The slot a brand-new carousel goes into. */
export const DEFAULT_CAROUSEL_SLOT = "carousel-content";

/**
 * "question-hook" is a carousel template whose id predates the "carousel-"
 * prefix, so it has to be named explicitly.
 */
export function isCarouselSlot(slotKey: string): boolean {
  return slotKey.startsWith("carousel-") || slotKey === "question-hook";
}

/** A slot key is usable if it's the single-image slot or a carousel slot. */
export function isValidSlotKey(slotKey: string): boolean {
  return slotKey === DEFAULT_SLOT || isCarouselSlot(slotKey);
}

/**
 * Apply a new within-slot order to the flat list of every slide in a design.
 *
 * Slide order is per-slot, so dragging a slide may only move slides in that
 * slot. Everything in another slot has to come back in exactly the position it
 * was in — the flat array's head feeds unrelated things like the default topic
 * offered to the generator, so quietly rotating it would change behaviour
 * nowhere near the drag.
 *
 * Returns null when `orderedIds` isn't a permutation of the slot's slides —
 * a stale drag, or IDs from somewhere else — so the caller can leave the list
 * alone rather than drop slides on the floor.
 */
export function applySlotOrder<T extends { id: number; slotKey: string }>(
  slides: T[],
  slotKey: string,
  orderedIds: number[],
): T[] | null {
  const inSlot = slides.filter((s) => s.slotKey === slotKey);
  if (orderedIds.length !== inSlot.length) return null;

  const byId = new Map(inSlot.map((s) => [s.id, s]));
  const reordered: T[] = [];
  for (const id of orderedIds) {
    const slide = byId.get(id);
    if (!slide) return null; // not in this slot
    byId.delete(id); // and never twice
    reordered.push(slide);
  }

  let next = 0;
  return slides.map((s) => (s.slotKey === slotKey ? reordered[next++] : s));
}

/**
 * The template a new slide in `slotKey` should use, given how many slides the
 * slot already holds.
 *
 * The first slide of a carousel takes the slot's own template (so a
 * "carousel-cover" slot opens on a cover); every slide after it is a content
 * slide. Outside a carousel there's nothing to follow, so the caller's
 * fallback stands.
 */
export function templateForNewSlide(
  slotKey: string,
  existingCount: number,
  fallbackTemplateId: string,
): string {
  if (!isCarouselSlot(slotKey)) return fallbackTemplateId;
  return existingCount === 0 ? slotKey : DEFAULT_CAROUSEL_SLOT;
}
