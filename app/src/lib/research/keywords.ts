// Content-gap analysis's tenant-provided seed keyword list — no new table,
// stored as a settings KV (`researchKeywords`, a JSON string[]) via
// @/lib/settings' readKey/setKey, the SAME KV pattern
// lib/campaigns/buildModel.ts uses for `campaignBuildModel`.
//
// `@/lib/settings` is imported DYNAMICALLY inside the two async functions
// below (not at module scope), for the EXACT reason buildModel.ts's own
// header comment documents: it transitively imports React's server-only
// `cache()`, whose npm "react-server" entry throws on load under the pure
// test runner's `--conditions=react-server`. Deferring the import keeps the
// pure `sanitizeResearchKeywords` importable (and directly unit-testable —
// see keywords.test.ts) without that crash, no test shim needed. In
// production (real Next.js react-server runtime) the dynamic import always
// resolves; these two getters are only ever called from async
// request/action/server-component paths (lib/research/contentScan.ts's
// getContentGaps, and page.tsx directly for the UI's editable list).
//
// `getResearchKeywords` is deliberately fail-soft (try/catch -> `[]`) —
// UNLIKE settings.ts's own readKey (which lets a genuine DB/tenant error
// propagate) and unlike `setResearchKeywords` below. A seed-keyword READ
// backs a page render (content-gap analysis's whole "gaps" section, via
// getContentGaps) that must degrade gracefully rather than 500 the page —
// same reasoning as every other read in lib/research never throwing. A
// WRITE, by contrast, is an explicit admin action
// (saveResearchKeywordsAction) — if it genuinely fails, the admin who just
// clicked "save" needs to be told so (that action's own try/catch already
// surfaces a friendly error), not have the failure silently swallowed here
// and made to look like it saved.

const RESEARCH_KEYWORDS_KEY = "researchKeywords";
const MAX_KEYWORDS = 30;
const MAX_KEYWORD_LENGTH = 80; // generous per-keyword cap — defensive against a pasted paragraph landing in one "keyword"

/**
 * Trim (+ length-cap) each entry, drop empties, dedupe case-insensitively
 * (first-seen casing wins), cap the list at `MAX_KEYWORDS`. Pure, exported
 * for direct unit testing — the whole reason `getResearchKeywords`/
 * `setResearchKeywords` stay thin wrappers around this.
 */
export function sanitizeResearchKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, MAX_KEYWORD_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** The current tenant's target keyword list, sanitised. Never throws — any failure (including this test runner's documented dynamic-import quirk above) degrades to `[]`, same "no keywords configured" shape as a tenant who never set any. */
export async function getResearchKeywords(): Promise<string[]> {
  try {
    const { readKey } = await import("@/lib/settings");
    const raw = readKey<unknown>(RESEARCH_KEYWORDS_KEY, []);
    const strings = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    return sanitizeResearchKeywords(strings);
  } catch (err) {
    console.error("[research/keywords] getResearchKeywords failed, defaulting to []:", err);
    return [];
  }
}

/** Admin setter (saveResearchKeywordsAction is the intended caller). Sanitises before storing. Does NOT catch its own errors — a genuine write failure propagates so the caller's own try/catch can tell the admin the save didn't work, rather than silently no-op. */
export async function setResearchKeywords(list: string[]): Promise<void> {
  const { setKey } = await import("@/lib/settings");
  setKey(RESEARCH_KEYWORDS_KEY, sanitizeResearchKeywords(list));
}
