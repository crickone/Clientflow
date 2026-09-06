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

/** Matches one <style>...</style>, <script>...</script>, or <link ...> token. */
const TOKEN =
  /<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>/gi;

interface Token {
  start: number;
  end: number;
  isScript: boolean;
}

function scan(html: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
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
    if (html.slice(headEnd, tokens[i].start).trim() !== "") break;
    headEnd = tokens[i].end;
  }

  // tail: walk back from the end over SCRIPT tokens only, while everything
  // after each one is whitespace. Font links and styles never move.
  let tailStart = html.length;
  for (let j = tokens.length - 1; j >= i; j--) {
    if (!tokens[j].isScript) break;
    if (html.slice(tokens[j].end, tailStart).trim() !== "") break;
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
