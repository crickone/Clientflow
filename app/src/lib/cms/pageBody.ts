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
 * ALGORITHM: one left-to-right pass over the string (scan(), below). At each
 * position it finds whichever comes first — an HTML comment opener "<!--" or
 * a <style>/<script>/<link> token — and consumes that construct whole before
 * continuing from its end. This produces a single ordered item list, and the
 * head/tail zone boundaries are then walked off that list (see
 * splitPageBody). A <script> or <style> body is consumed AS A UNIT because
 * script and style content is "raw text" in the HTML spec: a browser's
 * tokenizer never looks for comments (or any other markup) inside it, so a
 * literal "<!--" sitting in a script's own text is not a comment opener and
 * must never reach a separate comment scan. An earlier two-pass version
 * (comment ranges computed over the raw string, then tokens matched
 * separately) got this wrong: it saw a "<!--" inside a live <script> body,
 * found no later "-->" and treated the remainder of the document as
 * commented out, stranding trailing scripts in content. Do not reintroduce a
 * separate comment pass — that is exactly the bug this file was rewritten to
 * close.
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

type ItemType = "comment" | "style" | "link" | "script";

interface Item {
  type: ItemType;
  start: number;
  end: number;
  /**
   * Only meaningful for type "comment". False means this "<!--" has no
   * matching "-->" anywhere after it, so everything from `start` to the end
   * of the string is opaque comment text (mirrors a browser: an unclosed
   * comment runs to EOF). scan() stops producing items once it hits one of
   * these, since nothing after it can be markup.
   */
  terminated: boolean;
}

/**
 * The single left-to-right pass. Walks `html` from position 0, and at each
 * step consumes whichever construct starts first: the next "<!--" (searched
 * with a plain indexOf) or the next <style>/<script>/<link> token (searched
 * by resuming TOKEN from the current position). Whole-token consumption is
 * what keeps a "<!--" inside a script/style body from ever being considered
 * as a comment opener: if a script token starts before an embedded "<!--",
 * the token's start index is naturally earlier, so the token wins the race
 * and the whole tag — comment-lookalike text included — is consumed as one
 * item.
 */
function scan(html: string): Item[] {
  const items: Item[] = [];
  let pos = 0;

  while (pos < html.length) {
    const commentIdx = html.indexOf("<!--", pos);

    TOKEN.lastIndex = pos;
    const tokenMatch = TOKEN.exec(html);
    const tokenIdx = tokenMatch ? tokenMatch.index : -1;

    if (commentIdx === -1 && tokenIdx === -1) break;

    if (tokenIdx !== -1 && (commentIdx === -1 || tokenIdx <= commentIdx)) {
      const raw = tokenMatch![0];
      const type: ItemType =
        raw.slice(0, 7).toLowerCase() === "<script"
          ? "script"
          : raw.slice(0, 6).toLowerCase() === "<style"
            ? "style"
            : "link";
      items.push({ type, start: tokenMatch!.index, end: TOKEN.lastIndex, terminated: true });
      pos = TOKEN.lastIndex;
      continue;
    }

    // A comment opener starts first (or is the only construct left).
    const closeIdx = html.indexOf("-->", commentIdx + 4);
    if (closeIdx === -1) {
      items.push({ type: "comment", start: commentIdx, end: html.length, terminated: false });
      break;
    }
    items.push({ type: "comment", start: commentIdx, end: closeIdx + 3, terminated: true });
    pos = closeIdx + 3;
  }

  return items;
}

/**
 * True if `s` is nothing but whitespace. Items (including comments) are
 * already extracted by scan(), so the gap BETWEEN two items can never itself
 * contain a comment — unlike the old two-pass version, this needs no
 * comment-stripping of its own.
 */
function isBlankGap(s: string): boolean {
  return s.trim() === "";
}

export function splitPageBody(
  stored: string | null | undefined,
): PageBodyZones {
  const html = stored ?? "";
  if (!html) return { head: "", content: "", tail: "" };

  const items = scan(html);
  if (items.length === 0) return { head: "", content: html, tail: "" };

  // head: walk items left to right, extending a PENDING boundary through any
  // item whose gap since the previous boundary is blank, but only COMMIT
  // that boundary into headEnd when the item is a real style/link/script
  // token. A run of comments only ends up in head when a real head token
  // eventually follows it — that's what makes a leading comment, or a
  // comment sandwiched between two head tokens, belong to head, while a
  // comment with no real token after it (nothing left but content) does
  // not: with no token to confirm it, committing it would risk pulling a
  // comment that actually opens the content zone into head, so the walk
  // leaves it — and everything after it — as content instead (more visible
  // to the editor than lost, the same safe-fallback bias as the unterminated
  // case below).
  //
  // An unterminated comment stops the walk outright, without even
  // advancing the pending boundary: everything from its "<!--" onward is
  // opaque and must fall through to content.
  let headEnd = 0;
  let pendingHeadEnd = 0;
  let i = 0;
  for (; i < items.length; i++) {
    const item = items[i];
    if (item.type === "comment" && !item.terminated) break;
    if (!isBlankGap(html.slice(pendingHeadEnd, item.start))) break;
    pendingHeadEnd = item.end;
    if (item.type !== "comment") headEnd = pendingHeadEnd;
  }

  // tail: the mirror image, walked right to left. A pending boundary
  // advances through any script or (terminated) comment whose gap to the
  // previous boundary is blank, but only commits into tailStart at a real
  // script — so a trailing comment (nothing follows it but the end of the
  // string) is confirmed by the fact that walking further back still finds
  // a real script, while a comment with no such script behind it is left
  // in content. Style/link tokens never enter tail. Never walk back past
  // `i` (the head boundary), so head and tail can't claim the same token.
  let tailStart = html.length;
  let pendingTailStart = html.length;
  for (let j = items.length - 1; j >= i; j--) {
    const item = items[j];
    if (item.type !== "script" && item.type !== "comment") break;
    if (item.type === "comment" && !item.terminated) break;
    if (!isBlankGap(html.slice(item.end, pendingTailStart))) break;
    pendingTailStart = item.start;
    if (item.type !== "comment") tailStart = pendingTailStart;
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
 * The head zone with its `<script>` tags removed, for RENDERING in the Studio
 * canvas. Styles and font links are kept; nothing executable survives.
 *
 * This is not cosmetic. The canvas is server-rendered, so a `<script>` inside
 * `dangerouslySetInnerHTML` is emitted into the HTML response and RUN by the
 * browser's parser during initial parse — the "scripts inserted via innerHTML
 * are inert" rule only holds for client-side innerHTML. The bespoke sites'
 * head zone carries a progressive-enhancement flag
 * (`document.documentElement.className += ' js'`), and their CSS hides
 * scroll-reveal content behind it (`.js [data-rise]{opacity:0}`). The reveal
 * itself is done by GSAP from the TAIL zone, which the canvas never renders —
 * so letting that one flag run left whole sections permanently invisible in
 * the editor while looking perfect on the live site.
 *
 * Display only: the stored body is rebuilt from its own head by
 * rebuildBodyWithContent, so nothing here can strip a script from a saved page.
 */
export function headForCanvas(head: string): string {
  let out = "";
  let pos = 0;
  for (const item of scan(head)) {
    if (item.type === "script") {
      out += head.slice(pos, item.start);
      pos = item.end;
    }
  }
  return out + head.slice(pos);
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

export type StudioEditability = { ok: true } | { ok: false; reason: string };

/**
 * Skips leading whitespace and any run of leading HTML comments (possibly
 * several, possibly separated by whitespace), so something like
 * `<!-- saved from url --><!doctype html>...` can't hide the document marker
 * that follows from the check below. Mirrors scan()'s indexOf-based comment
 * detection above (terminated vs. unterminated) rather than inventing a
 * second comment-scanning approach — an unterminated "<!--" here just means
 * there is no markup left to find, so the loop stops and returns what's left
 * (which then simply fails the marker test).
 */
function skipLeadingCommentsAndWhitespace(s: string): string {
  let rest = s;
  for (;;) {
    rest = rest.replace(/^\s+/, "");
    if (!rest.startsWith("<!--")) return rest;
    const closeIdx = rest.indexOf("-->", 4);
    if (closeIdx === -1) return rest;
    rest = rest.slice(closeIdx + 3);
  }
}

/**
 * Matches a document-shape marker at the very start of a string: `<!doctype`,
 * `<html`, `<head`, or `<body`, each required to be followed by whitespace,
 * "/", ">", or end-of-string — NOT just any character — so an ordinary tag
 * that happens to share the prefix (`<header>`, `<bodytext>`) is never
 * mistaken for one.
 */
const DOCUMENT_MARKER = /^<(!doctype|html|head|body)(?=[\s/>]|$)/i;

/**
 * Not every stored page body fits the three-zone model above. Three shapes
 * are known to break it, all refused rather than guessed at — the Studio
 * must never mangle a page it can't actually model:
 *
 *  - A COMPLETE HTML DOCUMENT stored as the "body" block (an import that kept
 *    its own doctype/html/head wrapper rather than being split into
 *    head/content/tail at import time — e.g. clientflow's adonisagent home
 *    page), OR a document fragment that starts mid-way through one (a
 *    hand-pasted `<head>...</head><body>...` or bare `<body>...</body>`).
 *    The content zone would then hold the doctype, <html>, <head>,
 *    <title>, the stylesheet and every script; a browser's fragment parser
 *    silently drops the doctype and the html/head/body wrappers when that's
 *    set as innerHTML, and the first save would write that flattened result
 *    back over the page permanently. A leading HTML comment (or several) in
 *    front of any of these markers doesn't change that — it's skipped before
 *    the check runs, not treated as ordinary content.
 *  - A content zone that still carries a <style> token, whatever head looks
 *    like. Head/tail are carried around content untouched, but content
 *    itself is exactly what the Studio's edit surface treats as user-editable
 *    markup — a raw <style> element sitting inside that surface is not
 *    something the visual editor round-trips safely, unlike an inert
 *    mid-content <script> (see the "mid-content script stays in content"
 *    case in pageBody.test.ts, which IS safe: a script tag set via innerHTML
 *    never executes and isn't rewritten by editing). This is the real shape
 *    of every clientflow page: head captures a first run of style/link
 *    tokens, but a later <style> block sits deeper in content, after markup
 *    breaks the head walk.
 *  - head came back completely empty AND content contains a <script> token.
 *    An inert mid-content script is only accepted when there's a genuine
 *    head/tail around it (the ordinary bespoke shape); a page with NO head
 *    at all is one the split plainly never applied to.
 */
export function studioEditability(zones: PageBodyZones): StudioEditability {
  const trimmedContent = skipLeadingCommentsAndWhitespace(zones.content);
  if (DOCUMENT_MARKER.test(trimmedContent)) {
    return {
      ok: false,
      reason:
        "This page is stored as a complete HTML document, not a page fragment, so the Studio cannot edit it safely.",
    };
  }
  if (/<style\b/i.test(zones.content)) {
    return {
      ok: false,
      reason:
        "This page's styles are embedded in its content rather than separated out, so the Studio cannot edit it safely.",
    };
  }
  if (zones.head === "" && /<script\b/i.test(zones.content)) {
    return {
      ok: false,
      reason:
        "This page's scripts are embedded in its content rather than separated out, so the Studio cannot edit it safely.",
    };
  }
  return { ok: true };
}
