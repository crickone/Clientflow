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
 *   - The slide audit (src/lib/design/htmlAudit.ts) is what REJECTS markup
 *     where slotsOverCap(html) is non-empty.
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

/** Replaces every token in `remaining` within one text segment, in a single pass. */
function substituteTokens(
  text: string,
  remaining: number[],
  values: Map<number, string | null>,
): string {
  if (remaining.length === 0) return text;
  const tokenRe = new RegExp(remaining.map((s) => escapeRegExp(tokenForSlot(s))).join("|"), "g");
  return text.replace(tokenRe, (matched) => {
    const slot = remaining.find((s) => tokenForSlot(s) === matched);
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

    const tokensInTag = slots.filter((s) => tag.text.includes(tokenForSlot(s)));
    if (tokensInTag.length > 1) {
      out += tag.text; // malformed (two slots, one element) -- leave for the audit
    } else if (tokensInTag.length === 1) {
      const slot = tokensInTag[0];
      const value = values.get(slot);
      out += value == null ? "" : tag.text.split(tokenForSlot(slot)).join(value);
    } else {
      out += tag.text; // no photo token in this tag -- nothing to do
    }
    cursor = tag.end;
  }
  out += substituteTokens(html.slice(cursor), remaining, values);
  return out;
}
