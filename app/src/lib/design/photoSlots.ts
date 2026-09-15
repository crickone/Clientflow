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
 * Slot 1 is also reachable by its indexed spelling, "{{PHOTO:1}}": a model
 * taught that "{{PHOTO:2}}" exists reaches for "{{PHOTO:1}}" by the same
 * symmetry, and REPORTING that as slot 1 while FILLING recognised only the
 * bare spelling used to be exactly the gap -- the raw indexed token survived
 * to satori and drew an empty box. Both spellings resolve to the one slot,
 * so a design that mixes them (rather than always writing the bare form) is
 * not an error: it gets the one photograph, wherever either spelling sits.
 * See spellingsForSlot, below tokenForSlot.
 *
 * Pure and dependency-free: it runs in the browser (the editor asks whether a
 * slide has a photo slot) and on the server (the renderer fills them).
 *
 * This module matches the token TEXTUALLY, wherever it appears -- inside an
 * HTML comment or a text node counts as "used" too. That is deliberate: real
 * HTML parsing is not this module's job. What keeps the token confined to an
 * `<img src>` is the prompt that generates the markup in the first place, not
 * anything enforced here.
 *
 * Slot-count ownership is split three ways, and each piece only knows its own
 * part:
 *   - THIS module (photoSlotsUsed / slotsOverCap) only REPORTS which slots the
 *     markup asks for, including ones past MAX_PHOTO_SLOTS -- it does not
 *     reject anything. Silently dropping an out-of-range slot here would hide
 *     the exact thing the audit exists to catch.
 *   - The slide audit (checkDesigns, in src/lib/ai/designPost.parse.ts) is
 *     what REJECTS markup where slotsOverCap(html) is non-empty, or where
 *     multiSlotImgTags(html) finds an <img> carrying more than one slot.
 *   - The renderer (fillPhotoSlots, below) only ever leaves a slot with no
 *     photograph empty; it has no opinion on whether that slot should have
 *     existed at all.
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

/**
 * Every literal spelling that FILLS a given slot -- as opposed to tokenForSlot,
 * which is the one spelling this module HANDS OUT when generating a new token.
 * Slot 1 has two: the bare form (tokenForSlot's answer, and what every stored
 * slide already contains) and its indexed twin "{{PHOTO:1}}". photoSlotsUsed
 * already reads "{{PHOTO:1}}" as slot 1 -- SLOT_RE treats "1" as a canonical
 * index, same as "2" -- so a model that has just been taught "{{PHOTO:2}}"
 * exists reaches for "{{PHOTO:1}}" by the same symmetry, and REPORTING it as
 * slot 1 while FILLING only recognised the bare spelling was exactly the gap:
 * fillPhotoSlots would search the tag for "{{PHOTO}}", find nothing, and leave
 * "{{PHOTO:1}}" to reach satori as an unfilled empty box. Every other slot has
 * exactly one spelling, since only slot 1 is bare.
 */
function spellingsForSlot(slot: number): string[] {
  return slot === 1 ? [PHOTO_TOKEN, "{{PHOTO:1}}"] : [tokenForSlot(slot)];
}

/**
 * Slot numbers this markup uses, ascending and deduplicated -- including any
 * past MAX_PHOTO_SLOTS (see the ownership note in the module doc comment: the
 * audit rejects those, not this function).
 *
 * A non-canonical spelling like "{{PHOTO:007}}" is NOT a slot at all, not
 * "slot 7": Number("007") === 7 would otherwise silently alias a mistyped,
 * fixed-width index onto slot 7 with no way to tell the two spellings apart
 * in the raw markup. Rejecting it outright is more useful than accepting it,
 * because the only realistic way to type "007" is by mistake -- nothing
 * generates a zero-padded slot number on purpose.
 */
export function photoSlotsUsed(html: string): number[] {
  const seen = new Set<number>();
  for (const m of html.matchAll(SLOT_RE)) {
    if (m[1] == null) {
      seen.add(1);
      continue;
    }
    if (m[1] !== String(Number(m[1]))) continue; // non-canonical -- not a slot
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 1) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function usesPhoto(html: string): boolean {
  return photoSlotsUsed(html).length > 0;
}

/** Slots this markup asks for that no photograph can ever fill. */
export function slotsOverCap(html: string): number[] {
  return photoSlotsUsed(html).filter((slot) => slot > MAX_PHOTO_SLOTS);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Finds the full extent of every `<img ...>` (or self-closing `<img ... />`)
 * tag in html, tracking quote state (single AND double) so a literal `>`
 * inside a quoted attribute value -- legal, unescaped HTML, e.g.
 * `alt="Before > After"` -- cannot be mistaken for the tag's close. This is
 * the same shape as `buttonTags` in
 * src/components/content-studio/emphasisBudget.test.ts, minus the
 * backslash-escape and comment handling that file needs for JSX/TS source:
 * HTML attribute values don't have backslash escapes, so plain quote-toggling
 * is enough here.
 *
 * A naive `<img[^>]*TOKEN[^>]*>` regex is what this replaces: `[^>]*` cannot
 * cross a quoted `>`, so it used to stop at "Before >" and never see the
 * token, leaving the raw placeholder in the output -- exactly the empty-box
 * bug this module exists to prevent.
 */
function findImgTags(html: string): { start: number; end: number; text: string }[] {
  const tags: { start: number; end: number; text: string }[] = [];
  const openRe = /<img\b/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html))) {
    const start = m.index;
    let i = start + m[0].length;
    let quote: string | null = null;
    let end = -1;
    while (i < html.length) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        i++;
        continue;
      }
      if (c === ">") {
        end = i + 1;
        break;
      }
      i++;
    }
    if (end === -1) {
      // Unterminated tag (malformed input) -- leave it for the audit rather
      // than guessing where it ends.
      openRe.lastIndex = start + m[0].length;
      continue;
    }
    tags.push({ start, end, text: html.slice(start, end) });
    openRe.lastIndex = end;
  }
  return tags;
}

/**
 * `<img>` tags that carry more than one slot token -- malformed, since an
 * `<img>` has exactly one `src`. Built on the same quote-aware scan as
 * `fillPhotoSlots`, so a quoted `>` in an earlier attribute (legal HTML, e.g.
 * `alt="Before > After"`) cannot hide a second token the way the naive
 * `<img[^>]*>` form used to: that regex stopped at the first `>`, wherever it
 * fell, and never reached a token sitting past it.
 *
 * A slot repeated within one tag (the same token twice) is not flagged here --
 * that fills once, same as `fillPhotoSlots` treats it; only DISTINCT slots
 * sharing one element are malformed.
 */
export function multiSlotImgTags(html: string): { start: number; end: number; text: string }[] {
  return findImgTags(html).filter((tag) => photoSlotsUsed(tag.text).length > 1);
}

/** The box an <img> declares for itself, in CSS pixels. */
export interface PhotoSlotBox {
  width: number;
  height: number;
}

/** A `width`/`height` declaration in px, as a whole declaration rather than a
 *  substring -- `max-width:100%` and `background-size` both contain "width",
 *  and matching them would size a grade off a number that is not the box. */
const PX_DECL = {
  width: /^\s*width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*$/i,
  height: /^\s*height\s*:\s*(\d+(?:\.\d+)?)\s*px\s*$/i,
} as const;

function pxDeclaration(style: string, property: "width" | "height"): number | null {
  for (const decl of style.split(";")) {
    const m = PX_DECL[property].exec(decl);
    if (m) {
      const n = Math.round(Number(m[1]));
      if (Number.isFinite(n) && n >= 1) return n;
    }
  }
  return null;
}

/** The `style` attribute's value, quote-aware for both quote characters. */
function styleOf(tag: string): string {
  const m = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
  return m ? (m[2] ?? m[3] ?? "") : "";
}

/**
 * The pixel box each slot's <img> declares, for the slots that declare one in
 * px on BOTH axes.
 *
 * Why it exists: the renderer used to grade every slot at the whole canvas, so
 * a stacked comparison embedded two full-canvas JPEGs in one slide and pushed
 * both through satori. Grading each slot at its own box is the same picture at
 * a quarter of the bytes -- and a better one, since sharp's cover-crop then
 * matches the box's aspect instead of being stretched into it by satori.
 *
 * ONLY px on both axes. A percentage, a flex-grown box or a missing axis
 * cannot be resolved without laying the design out, which is satori's job and
 * not this module's -- those slots are simply absent from the map, and the
 * caller falls back to the canvas exactly as before. That fallback is what
 * keeps a full-bleed slide (the common one-photograph slide, written as
 * `width:100%;height:100%` or as the canvas's own pixel size) rendering
 * byte-for-byte as it did.
 *
 * A slot appearing in more than one <img> is malformed in the same family as
 * multiSlotImgTags, and the FIRST tag wins rather than the last: a caller
 * grading one box while satori lays out another is the failure to avoid, and
 * either choice risks it, so the deterministic one is the useful one.
 */
export function photoSlotBoxes(html: string): Map<number, PhotoSlotBox> {
  const boxes = new Map<number, PhotoSlotBox>();
  for (const tag of findImgTags(html)) {
    const slots = photoSlotsUsed(tag.text);
    // Exactly one: a tag carrying two DISTINCT slots is malformed markup the
    // audit rejects, and sizing either slot off it would be a guess.
    if (slots.length !== 1) continue;
    const slot = slots[0];
    if (boxes.has(slot)) continue;
    const style = styleOf(tag.text);
    const width = pxDeclaration(style, "width");
    const height = pxDeclaration(style, "height");
    if (width != null && height != null) boxes.set(slot, { width, height });
  }
  return boxes;
}

/** Replaces every token in `remaining` within one text segment, in a single pass. */
function substituteTokens(
  text: string,
  remaining: number[],
  values: Map<number, string | null>,
): string {
  if (remaining.length === 0) return text;
  // Every spelling of every remaining slot goes into one map, so "{{PHOTO}}"
  // and "{{PHOTO:1}}" both resolve to slot 1's value -- see spellingsForSlot.
  const spellingToSlot = new Map<string, number>();
  for (const s of remaining) {
    for (const spelling of spellingsForSlot(s)) spellingToSlot.set(spelling, s);
  }
  const tokenRe = new RegExp([...spellingToSlot.keys()].map(escapeRegExp).join("|"), "g");
  return text.replace(tokenRe, (matched) => {
    const slot = spellingToSlot.get(matched);
    return slot != null ? (values.get(slot) as string) : matched;
  });
}

/**
 * Fill every slot with the value `valueFor` gives for it. A slot whose value is
 * null loses its <img> entirely -- a broken src draws an empty box in satori.
 *
 * Two slots inside the SAME <img> is malformed markup (one element, one src).
 * If one of those slots were nulled, removing the element would silently
 * throw away the other slot's value while the caller believes it was placed.
 * Rather than guess, that element is left completely untouched -- both raw
 * tokens survive so the slide audit rejects the markup instead of this
 * function quietly discarding half of it.
 *
 * Every slot's value is resolved once, up front, and substituted in a single
 * pass per text segment. That means a value that happens to contain another
 * slot's token text verbatim (e.g. `"xxx{{PHOTO:2}}yyy"`) is inserted as
 * inert text and is never re-scanned or rewritten by a later slot's pass.
 */
export function fillPhotoSlots(
  html: string,
  valueFor: (slot: number) => string | null,
): string {
  const slots = photoSlotsUsed(html);
  if (slots.length === 0) return html;

  const values = new Map<number, string | null>();
  for (const slot of slots) values.set(slot, valueFor(slot));
  const remaining = slots.filter((s) => values.get(s) != null);

  const tags = findImgTags(html);
  let out = "";
  let cursor = 0;
  for (const tag of tags) {
    out += substituteTokens(html.slice(cursor, tag.start), remaining, values);

    // photoSlotsUsed, not a tokenForSlot-only check: it already folds every
    // spelling of a slot (bare "{{PHOTO}}" and indexed "{{PHOTO:1}}" both) into
    // that slot's number, so a tag holding both spellings of slot 1 reads as
    // ONE slot here -- the same as a tag holding the same literal token twice
    // already did -- rather than being mistaken for two DISTINCT slots sharing
    // one <img>.
    const tokensInTag = photoSlotsUsed(tag.text);
    if (tokensInTag.length > 1) {
      out += tag.text; // malformed (two DISTINCT slots, one element) -- leave for the audit
    } else if (tokensInTag.length === 1) {
      const slot = tokensInTag[0];
      const value = values.get(slot);
      if (value == null) {
        out += "";
      } else {
        // split/join per spelling, not a regex-with-string replace: a string
        // replacement interprets "$&"/"$1"/"$$" specially, and a value is
        // arbitrary caller-provided text (e.g. a data URI) that must land
        // byte-for-byte. Looping spellings handles slot 1's two spellings
        // (and any duplicate occurrences of either) in one pass each.
        let replaced = tag.text;
        for (const spelling of spellingsForSlot(slot)) {
          replaced = replaced.split(spelling).join(value);
        }
        out += replaced;
      }
    } else {
      out += tag.text; // no photo token in this tag -- nothing to do
    }
    cursor = tag.end;
  }
  out += substituteTokens(html.slice(cursor), remaining, values);
  return out;
}
