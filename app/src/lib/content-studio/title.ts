/**
 * What a design is CALLED, derived from what it was STARTED with.
 *
 * A design's name is whatever went into the topic box, and since the idea
 * picker composes that box (see ideaToTopic) the name is usually a whole
 * brief, not a title:
 *
 *   What's actually in your sweat after an infrared session (and what isn't)
 *
 *   What it should teach: sweat is mostly water and electrolytes...
 *   It rests on: the composition of eccrine sweat.
 *
 * Storing that verbatim (and hard-slicing it at 80 characters) is what put
 * "...(and what isn't) What i" on the Content Studio cards. The hook — the
 * first paragraph — is the title; everything after it is instructions to the
 * generator and belongs nowhere near a card.
 *
 * Pure and dependency-free: it runs at creation time in the browser AND on the
 * server when the grid is built, so both ends agree on the same name.
 */

/**
 * The lead-ins ideaToTopic() writes between the paragraphs. A name stored
 * before this module existed was sliced mid-brief, so it can end in a fragment
 * of one ("... What i"); the first-paragraph rule can't help there because the
 * newline was destroyed by the slice. Stripping a trailing partial of a phrase
 * we ourselves wrote is safe, and it cleans the rows already in the database.
 */
const LEAD_INS = ["What it should teach:", "It rests on:"];

/**
 * The width the name used to be hard-sliced to. A stored name of EXACTLY this
 * length that doesn't end on sentence punctuation was produced by that slice,
 * so its last word is a fragment ("...and why 'eat more c"). Dropping it and
 * marking the cut is the honest reading of a row we can't un-truncate.
 */
const LEGACY_SLICE = 80;

/** Drop a trailing fragment of one of our own lead-in phrases, if present. */
function stripDanglingLeadIn(s: string): string {
  for (const phrase of LEAD_INS) {
    for (let len = phrase.length; len >= 1; len--) {
      const tail = ` ${phrase.slice(0, len)}`;
      if (s.endsWith(tail)) return s.slice(0, -tail.length).trimEnd();
    }
  }
  return s;
}

/**
 * A single-line title from a topic, brief, or stored name: the first
 * paragraph, whitespace collapsed, cut on a word boundary rather than
 * mid-word.
 */
export function titleFrom(raw: string, max = 90): string {
  const firstParagraph = raw.trim().split(/\n\s*\n|\n/)[0] ?? "";
  const collapsed = firstParagraph.replace(/\s+/g, " ").trim();
  const oneLine = stripDanglingLeadIn(collapsed);
  if (
    oneLine === collapsed &&
    oneLine.length === LEGACY_SLICE &&
    !/[.!?)"'\u201d\u2019]$/.test(oneLine)
  ) {
    return truncate(oneLine, LEGACY_SLICE - 1);
  }
  if (oneLine.length <= max) return oneLine;
  return truncate(oneLine, max);
}

/** Cut to `max` on a word boundary, marked with an ellipsis. */
function truncate(oneLine: string, max: number): string {
  const cut = oneLine.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // A word boundary only helps while it leaves most of the budget intact —
  // one very long word shouldn't collapse the title to nothing.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.—-]+$/, "")}…`;
}
