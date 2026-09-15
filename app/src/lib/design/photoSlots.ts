/**
 * What a photograph's place in a designed slide looks like, and how to fill it.
 *
 * This used to be a bare string constant in lib/ai/designPost.parse.ts, spelled
 * out AGAIN as a literal in three other modules -- the photo route gated on it,
 * the hit map substituted it, and the editor grepped for it to decide which of
 * two routes to call. Adding a second slot in that shape would have meant
 * finding literals that a grep for PHOTO_TOKEN never surfaces.
 *
 * Slot 1 is the BARE token, permanently. Every designed slide already stored
 * contains it, and this is not a deprecated form: a one-photograph slide is
 * still the common case and should not have to say "1".
 *
 * Pure and dependency-free: it runs in the browser (the editor asks whether a
 * slide has a photo slot) and on the server (the renderer fills them).
 */

export const PHOTO_TOKEN = "{{PHOTO}}";

/**
 * Two, and the limit is a design decision rather than a technical one: a
 * comparison is the real use case, and three pictures at feed size is a
 * collage nobody reads.
 */
export const MAX_PHOTO_SLOTS = 2;

/** Matches the bare form and the indexed form, capturing the number when present. */
const SLOT_RE = /\{\{PHOTO(?::(\d+))?\}\}/g;

/** The token text for a slot. Slot 1 is bare so existing markup keeps parsing. */
export function tokenForSlot(slot: number): string {
  return slot <= 1 ? PHOTO_TOKEN : `{{PHOTO:${slot}}}`;
}

/** Slot numbers this markup uses, ascending and deduplicated. */
export function photoSlotsUsed(html: string): number[] {
  const seen = new Set<number>();
  for (const m of html.matchAll(SLOT_RE)) {
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n >= 1) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function usesPhoto(html: string): boolean {
  return photoSlotsUsed(html).length > 0;
}

/**
 * The whole <img> for a slot, so a slot with no photograph can be removed
 * rather than left with a broken src -- satori draws that as an empty box.
 * Built from the token so the two spellings cannot drift apart.
 */
function imgTagFor(slot: number): RegExp {
  const token = tokenForSlot(slot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<img[^>]*${token}[^>]*>`, "gi");
}

/**
 * Fill every slot with the value `valueFor` gives for it. A slot whose value is
 * null loses its <img> entirely.
 */
export function fillPhotoSlots(
  html: string,
  valueFor: (slot: number) => string | null,
): string {
  let out = html;
  for (const slot of photoSlotsUsed(html)) {
    const value = valueFor(slot);
    if (value == null) {
      out = out.replace(imgTagFor(slot), "");
      continue;
    }
    out = out.split(tokenForSlot(slot)).join(value);
  }
  return out;
}
