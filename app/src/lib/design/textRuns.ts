/**
 * The editable text inside a designed slide's markup — found, and patched,
 * without ever parsing and re-serialising the HTML.
 *
 * Why offsets rather than a DOM: the stored `designHtml` is the artefact. A
 * parse/serialise round trip would rewrite quoting, attribute order and
 * whitespace on every edit, so a one-word change would produce a wholly
 * different string — and satori's layout is sensitive enough that "equivalent"
 * markup is not a safe thing to assume. Splicing at offsets changes exactly the
 * bytes the operator changed and nothing else.
 *
 * WHAT COUNTS AS EDITABLE, and why the rule is narrow: an element whose entire
 * content is text, optionally broken by <br>. That is how these designs are
 * actually written (`<span style="...">Some line</span>`), it means the element
 * itself is the thing to highlight and edit, and — critically — the hit map
 * (./hitMap) can colour that element without changing the tree, so its click
 * region is laid out by the real renderer rather than by a guess.
 *
 * Mixed content (text sitting beside child elements) is deliberately NOT
 * editable. Making it so would mean wrapping the text in a new element, and
 * adding a child changes what satori's `prepare` does to the parent's display —
 * the hit boxes would then be measured from a layout that isn't the one on
 * screen. A slightly smaller feature that is always truthful beats a bigger one
 * that lies about where the words are.
 *
 * Pure string work: no I/O, no DOM, no server-only import — so the same
 * functions run in a test, on the server, and (for the client's optimistic
 * update) in the browser.
 */

export interface TextRun {
  /** Stable within one call, and the id the hit map encodes. */
  index: number;
  /** The text as an operator edits it: entities intact, <br> as a newline. */
  text: string;
  /** Offsets of the element's inner content in the source HTML. */
  contentStart: number;
  contentEnd: number;
  /** Offsets of the element's opening tag, for the hit map's style injection. */
  tagStart: number;
  tagEnd: number;
}

/** Inner content that is text plus, at most, <br> breaks. */
const BR = /<br\s*\/?>/gi;
const ONLY_TEXT_AND_BR = /^(?:[^<>]|<br\s*\/?>)*$/i;

/**
 * Every editable text run in the markup, in document order.
 *
 * Whitespace-only content is skipped: the gap between two tags is not
 * something anyone means to click on, and offering it as an empty edit box
 * would be noise.
 */
export function findTextRuns(html: string): TextRun[] {
  const runs: TextRun[] = [];
  let i = 0;
  let index = 0;

  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open === -1) break;

    // Skip anything that isn't an ordinary opening tag: closing tags,
    // comments, doctypes.
    if (html.startsWith("</", open) || html.startsWith("<!", open)) {
      i = open + 1;
      continue;
    }

    const tagEnd = html.indexOf(">", open);
    if (tagEnd === -1) break;

    // A self-closing or void tag has no inner content of its own.
    if (html[tagEnd - 1] === "/") {
      i = tagEnd + 1;
      continue;
    }
    const tagName = /^<\s*([a-zA-Z][\w-]*)/.exec(html.slice(open, tagEnd + 1))?.[1]?.toLowerCase();
    if (!tagName || tagName === "br" || tagName === "img" || tagName === "style" || tagName === "script") {
      i = tagEnd + 1;
      continue;
    }

    const close = html.indexOf(`</${tagName}`, tagEnd + 1);
    if (close === -1) {
      i = tagEnd + 1;
      continue;
    }

    const content = html.slice(tagEnd + 1, close);
    if (ONLY_TEXT_AND_BR.test(content) && content.replace(BR, "").trim().length > 0) {
      runs.push({
        index: index++,
        text: content.replace(BR, "\n"),
        contentStart: tagEnd + 1,
        contentEnd: close,
        tagStart: open,
        tagEnd,
      });
      // Nothing inside this element can itself be a run.
      i = close;
      continue;
    }

    i = tagEnd + 1;
  }

  return runs;
}

/**
 * Replace one run's text, returning the new markup.
 *
 * Newlines become `<br/>`, which is how these designs break a line — the
 * inverse of what `findTextRuns` does when it hands text to an editor, so a
 * value that is opened and saved unchanged produces byte-identical markup.
 *
 * `<` and `>` are escaped. The text arrives from an operator's keyboard, and
 * content must never be able to become markup — the same reason the renderer
 * decodes entities only on text nodes and never on the raw string.
 */
export function replaceRunText(html: string, run: TextRun, next: string): string {
  const escaped = next
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .join("<br/>");
  return html.slice(0, run.contentStart) + escaped + html.slice(run.contentEnd);
}

/** Find a run by index in freshly-scanned markup. Returns null when the markup has moved on. */
export function runAt(html: string, index: number): TextRun | null {
  return findTextRuns(html).find((r) => r.index === index) ?? null;
}
