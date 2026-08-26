import { normaliseTopic } from "@/lib/research/gaps";
import type { ContentGapPerCompetitor } from "@/lib/research/contentScan";
import type { StoredCompetitorPage } from "@/lib/research/store";

/**
 * Content-gap analysis UI: which of a competitor's crawled pages is most
 * likely "about" a given gap topic? Per-page `topic` is always null today
 * (no per-page AI mapping — see contentScan.ts's own doc comment on
 * `competitor_pages.topic`), so this is a best-effort, client-side text
 * match: title, then h1, then h2s, in that priority order — the first page
 * satisfying a tier wins (pages checked in their existing crawl/insertion
 * order, i.e. `ContentGapPerCompetitor.pages`' own order). Loose,
 * case-insensitive, and deliberately reuses gaps.ts's own `normaliseTopic`
 * rather than a second ad-hoc normalisation, so a gap topic of "membership"
 * matches an h1 of "Memberships" the exact same way `computeContentGaps`
 * already treats the two as equivalent.
 *
 * Pure + zero React/Next import (mirrors buildCampaignSeed.ts's own
 * "must load under the plain-tsx test runner" contract — see that file's
 * header comment) — `ContentGapPerCompetitor`/`StoredCompetitorPage` are
 * type-only imports (erased at compile time), so importing from
 * lib/research/contentScan.ts and lib/research/store.ts (both
 * `import "server-only"`) here is safe: nothing of either module actually
 * loads at runtime. `normaliseTopic` (lib/research/gaps.ts) is a genuine
 * value import, but gaps.ts itself has zero imports of its own — pure all
 * the way down.
 */

/** No match at any tier -> null (never guesses). */
export function findExamplePage(pages: StoredCompetitorPage[], topic: string): StoredCompetitorPage | null {
  const key = normaliseTopic(topic);
  if (!key) return null;

  const isMatch = (text: string | null | undefined): boolean => {
    if (!text) return false;
    const norm = normaliseTopic(text);
    return !!norm && (norm.includes(key) || key.includes(norm));
  };

  return (
    pages.find((p) => isMatch(p.title)) ??
    pages.find((p) => isMatch(p.h1)) ??
    pages.find((p) => p.h2s.some((h2) => isMatch(h2))) ??
    null
  );
}

export type ExampleLink = {
  competitorName: string;
  url: string;
  /** True when no crawled page matched the topic well enough — `url` falls
   *  back to the competitor's site root (`websiteUri`) rather than a
   *  specific page. */
  isFallback: boolean;
};

/**
 * Resolves a gap's `exampleCompetitor` (a plain name, per gaps.ts's
 * `ContentGap.exampleCompetitor`) to an actual link: looks the competitor up
 * in `perCompetitor` by name, finds its best-matching crawled page
 * (`findExamplePage`), and falls back to the competitor's `websiteUri` when
 * no page matches well enough. Null whenever there's nothing to link to at
 * all — no example competitor, an unknown name (stale data — treated the
 * same as absent rather than throwing), or a competitor with neither a
 * matching page nor a `websiteUri` on file.
 */
export function findExampleLink(
  perCompetitor: ContentGapPerCompetitor[],
  exampleCompetitorName: string | undefined,
  topic: string,
): ExampleLink | null {
  if (!exampleCompetitorName) return null;
  const competitor = perCompetitor.find((c) => c.competitorName === exampleCompetitorName);
  if (!competitor) return null;

  const page = findExamplePage(competitor.pages, topic);
  if (page) return { competitorName: competitor.competitorName, url: page.url, isFallback: false };
  if (competitor.websiteUri) return { competitorName: competitor.competitorName, url: competitor.websiteUri, isFallback: true };
  return null;
}
