/**
 * Pure, dependency-free HTML → on-page-SEO extraction — content-gap
 * analysis's "read what a page says about itself" step. Regex-only, NO
 * cheerio/jsdom (per the brief: no new npm dependency, the Docker image is
 * slim) — a deliberate step down from a real HTML parser, acceptable
 * because every input field just needs "close enough" text, not a spec-
 * correct DOM.
 *
 * Zero imports, zero framework dependency (no `server-only`, no @/lib/*) —
 * this file is safe to import from anywhere, including a plain test runner
 * with no shimming at all (mirrors gaps.ts's same "PURE" contract). The
 * caller (lib/research/contentScan.ts) is the only place this ever touches
 * real (external, untrusted) HTML.
 *
 * Never throws: a malformed/truncated/empty document degrades every field
 * to null/[]/0 rather than raising — a competitor's broken markup must
 * never abort a scan (same fail-soft contract as every other file in
 * lib/research that reads an external source).
 */

export type PageSeo = {
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  wordCount: number;
};

const MAX_H2S = 10;

// A small, deliberately incomplete named-entity table (per the brief: "a
// few common" ones) — enough to make real-world titles/meta/h1/word-counts
// read cleanly without pulling in a full HTML-entity library.
const ENTITY_RE = /&(amp|#39|apos|quot|lt|gt|nbsp);/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&#39;": "'",
  "&apos;": "'",
  "&quot;": '"',
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (m) => ENTITIES[m] ?? m);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strips tags from an already-extracted inner-HTML fragment down to plain, decoded, whitespace-collapsed text. Empty/tags-only input -> "". */
function textFromFragment(fragment: string): string {
  return collapseWhitespace(decodeEntities(fragment.replace(/<[^>]*>/g, " ")));
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const text = textFromFragment(m[1]);
  return text.length > 0 ? text : null;
}

/** Case/attr-order tolerant: matches `<meta name="description" content="…">` OR `<meta content="…" name="description">`, single or double quoted. Only the FIRST such tag counts (matches how a browser/crawler would read it). */
function extractMetaDescription(html: string): string | null {
  const metaTagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaTagRe.exec(html))) {
    const tag = m[0];
    if (!/\bname\s*=\s*["']description["']/i.test(tag)) continue;
    const contentMatch = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (!contentMatch) continue;
    const raw = contentMatch[1] ?? contentMatch[2] ?? "";
    const text = textFromFragment(raw);
    return text.length > 0 ? text : null;
  }
  return null;
}

function extractH1(html: string): string | null {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  const text = textFromFragment(m[1]);
  return text.length > 0 ? text : null;
}

function extractH2s(html: string): string[] {
  const out: string[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < MAX_H2S) {
    const text = textFromFragment(m[1]);
    if (text.length > 0) out.push(text);
  }
  return out;
}

/** Strips script/style blocks (their text isn't page copy) before stripping tags, then counts whitespace-separated words. */
function countWords(html: string): number {
  const withoutNonContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = textFromFragment(withoutNonContent);
  return text.length > 0 ? text.split(" ").filter(Boolean).length : 0;
}

/**
 * `url` is accepted for API symmetry with the crawler (`fetchPage` returns
 * `{url, html}` together, and a future extraction step — e.g. resolving a
 * relative canonical link — may need it) but is currently unused: nothing
 * in `PageSeo` needs URL resolution today.
 */
export function extractSeo(html: string, _url: string): PageSeo {
  try {
    return {
      title: extractTitle(html),
      metaDescription: extractMetaDescription(html),
      h1: extractH1(html),
      h2s: extractH2s(html),
      wordCount: countWords(html),
    };
  } catch {
    // Never throw — a pathological input (e.g. catastrophic regex backtrack
    // on some adversarial string) degrades to the same "nothing extracted"
    // shape a plain empty document would produce.
    return { title: null, metaDescription: null, h1: null, h2s: [], wordCount: 0 };
  }
}
