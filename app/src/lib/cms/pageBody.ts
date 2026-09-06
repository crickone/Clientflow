/**
 * The three-zone split of a stored CMS page body.
 *
 * Every bespoke page imported by tools/import-site.cjs stores ONE html block
 * that is really three things glued together: the page's own <style> + font
 * <link>s, the page CONTENT, and the <script> tags that animate it. The Studio
 * only ever edits the middle zone — head and tail are carried around it
 * untouched — so an edit can't lose the stylesheet that IS the site's design.
 * (Before this split, the Studio sanitised the whole body for editing, and the
 * sanitiser drops <style> by design: the canvas rendered unstyled and a save
 * would have written the CSS-less result back over the live page.)
 *
 * Zero imports, so it loads under the plain tsx test runner (mirrors
 * lib/campaigns/plan.ts). joinPageBody(splitPageBody(x)) === x for every
 * input — see pageBody.test.ts.
 */

export interface PageBodyZones {
  /** Leading <link>/<style>/<script> tokens: the page's CSS and fonts. */
  head: string;
  /** The editable page markup — the ONLY zone the Studio reads or writes. */
  content: string;
  /** Trailing <script> tokens: GSAP, Lenis, the inline init. */
  tail: string;
}

/**
 * Matches one <style>...</style>, <script>...</script>, or <link ...> token.
 * The opening-tag part skips over quoted attribute values so a ">" inside a
 * quoted attribute (e.g. data-cfg="a>b") can't end the tag early.
 *
 * The alternatives are mutually exclusive by construction: unquoted text is
 * consumed only by the `[^"'>]*` class, which excludes quote characters, so
 * no substring can be matched two different ways (once as loose characters,
 * once as part of a quoted run). A version that allowed both readings of the
 * same text (an ambiguous `(?:"[^"]*"|'[^']*'|[^>])*`) is catastrophically
 * backtracking on an unterminated tag: the engine retries every split of an
 * attribute run across quoted/unquoted alternatives before giving up.
 */
const OPEN_TAG_TAIL = `(?:[^"'>]*(?:"[^"]*"|'[^']*'))*[^"'>]*`;
const TOKEN = new RegExp(
  `<style\\b${OPEN_TAG_TAIL}>[\\s\\S]*?<\\/style>|<script\\b${OPEN_TAG_TAIL}>[\\s\\S]*?<\\/script>|<link\\b${OPEN_TAG_TAIL}>`,
  "gi",
);

/** An HTML comment. Comments count as blank when checking a zone-boundary gap. */
const COMMENT = /<!--[\s\S]*?-->/g;

/** True if `s` contains nothing but whitespace and/or HTML comments. */
function isBlank(s: string): boolean {
  return s.replace(COMMENT, "").trim() === "";
}

interface Token {
  start: number;
  end: number;
  isScript: boolean;
}

/** True if `index` falls inside one of `ranges` (each a [start, end) pair). */
function isInRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

/**
 * All comment spans in `html`, as [start, end) pairs, closed ones first (in
 * document order, from COMMENT), then — if the document has an unterminated
 * "<!--" left over — one final range from there to the end of the string.
 * That mirrors what a browser does: an opening "<!--" with no matching "-->"
 * comments out everything after it, including anything that looks like a
 * tag. Any "<!--" that DOES have a later "-->" is already covered by a
 * closed range, because the global exec below tries every position in turn,
 * so the first "<!--" not covered by a closed range is guaranteed to have no
 * closing "-->" anywhere after it.
 */
function commentRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  COMMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT.exec(html))) {
    ranges.push([m.index, COMMENT.lastIndex]);
  }

  let openIdx = html.indexOf("<!--");
  while (openIdx !== -1 && isInRanges(openIdx, ranges)) {
    openIdx = html.indexOf("<!--", openIdx + 1);
  }
  if (openIdx !== -1) ranges.push([openIdx, html.length]);

  return ranges;
}

/**
 * Finds <style>/<script>/<link> tokens, but discards any whose start index
 * falls inside a comment (closed or, per commentRanges, unterminated). A
 * commented-out tag — a routine leftover in migrated bespoke HTML — would
 * otherwise produce a phantom token that derails the head/tail boundary
 * walk in splitPageBody.
 */
function scan(html: string): Token[] {
  const comments = commentRanges(html);
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (isInRanges(m.index, comments)) continue;
    out.push({
      start: m.index,
      end: TOKEN.lastIndex,
      isScript: m[0].slice(0, 7).toLowerCase() === "<script",
    });
  }
  return out;
}

export function splitPageBody(
  stored: string | null | undefined,
): PageBodyZones {
  const html = stored ?? "";
  if (!html) return { head: "", content: "", tail: "" };

  const tokens = scan(html);
  if (tokens.length === 0) return { head: "", content: html, tail: "" };

  // head: consume tokens while everything before the next one is whitespace,
  // i.e. while no real content has started yet.
  let headEnd = 0;
  let i = 0;
  for (; i < tokens.length; i++) {
    if (!isBlank(html.slice(headEnd, tokens[i].start))) break;
    headEnd = tokens[i].end;
  }

  // tail: walk back from the end over SCRIPT tokens only, while everything
  // after each one is whitespace. Font links and styles never move.
  let tailStart = html.length;
  for (let j = tokens.length - 1; j >= i; j--) {
    if (!tokens[j].isScript) break;
    if (!isBlank(html.slice(tokens[j].end, tailStart))) break;
    tailStart = tokens[j].start;
  }
  if (tailStart < headEnd) tailStart = headEnd;

  return {
    head: html.slice(0, headEnd),
    content: html.slice(headEnd, tailStart),
    tail: html.slice(tailStart),
  };
}

export function joinPageBody(zones: PageBodyZones): string {
  return `${zones.head}${zones.content}${zones.tail}`;
}

/**
 * Publishing, as a pure function: keep the stored body's head and tail, swap in
 * the new content. Called with the body as it stands AT PUBLISH TIME, so a page
 * re-imported with new CSS under an open draft picks up the new CSS rather than
 * having a stale copy written back over it.
 */
export function rebuildBodyWithContent(
  storedBody: string | null | undefined,
  content: string,
): string {
  return joinPageBody({ ...splitPageBody(storedBody), content });
}
