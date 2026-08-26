import "server-only";

import {
  listCompetitors,
  replaceCompetitorPages,
  setCompetitorContentScannedAt,
  setCompetitorContentTopics,
  listAllCompetitorPagesWithCompetitor,
  type NewCompetitorPage,
  type StoredCompetitorPage,
} from "./store";
import { discoverUrls, fetchPage, politeDelay } from "./crawl";
import { extractSeo } from "./seo";
import { deriveSiteTopics } from "./topics";
import { computeContentGaps, type ContentGap } from "./gaps";
import { getResearchKeywords } from "./keywords";

/**
 * Content-gap analysis's scan orchestrator — ties crawl.ts + seo.ts +
 * topics.ts + store.ts together into the one call the "Scan competitor
 * sites" button (`scanContentAction`, app/marketing/research/actions.ts)
 * makes, and separately exposes `getContentGaps`, the read-only function
 * the Content gaps UI section renders from (never spends, never crawls —
 * plain store/KV reads + the pure `computeContentGaps`).
 *
 * `scanCompetitorContent(tenantId)`:
 *  - Candidates: every TRACKED, non-muted competitor with a `websiteUri` on
 *    file — `listCompetitors({trackedOnly:true})`, which (unlike most other
 *    callers in this module tree) deliberately does NOT pass
 *    `excludeSelf:true`: the tenant's own site needs its own topic set
 *    derived exactly the same way a competitor's does, so `getContentGaps`
 *    has something to compare everyone else against (own topics = the
 *    `isSelf` row's `contentTopicsJson` — see gaps.ts's `computeContentGaps`
 *    doc). A competitor with no `websiteUri` yet contributes nothing and is
 *    silently skipped (not a failure) — there's no site to crawl.
 *  - Bounded to `MAX_COMPETITORS_PER_SCAN` (~8) per scan, nearest-first
 *    (`listCompetitors`' own ordering) — the tracked watchlist is already
 *    small by design (Market Research P1), so this is a defensive ceiling,
 *    not an expected-to-bind limit.
 *  - Per competitor: `discoverUrls` -> `fetchPage` each (paced with
 *    `politeDelay` between calls — crawl.ts's own internal requests pace
 *    themselves; THIS loop is the other half, since it lives outside that
 *    file) -> `extractSeo` -> one `replaceCompetitorPages` wholesale swap ->
 *    ONE `deriveSiteTopics` call for the whole site -> cache the topics
 *    (`setCompetitorContentTopics`) and stamp `setCompetitorContentScannedAt`.
 *    Per-page topic mapping is NOT attempted (see schema.ts's module doc on
 *    `competitor_pages.topic`) — every inserted page's `topic` is left
 *    unset (stored NULL); only the SITE-level topic set is derived.
 *  - Fail-soft PER COMPETITOR: any exception scanning one site (a crawl
 *    error, a store write failure) is caught, logged, counted in
 *    `failures`, and the loop moves on — one bad site never aborts the
 *    scan, matching refresh.ts's exact "partial failure resilient"
 *    contract. `scanned` only counts a competitor that completed without
 *    throwing (even if it yielded zero pages — a real site that robots.txt
 *    fully blocks, say, is a valid empty result, not a failure).
 *  - Never throws — always resolves to the counts, for the action's toast.
 *
 * `getContentGaps(tenantId)`:
 *  - Reads every tracked competitor (including self, same reasoning as
 *    above) + their cached `contentTopicsJson` + their crawled pages
 *    (`listAllCompetitorPagesWithCompetitor`, one tenant-wide join instead
 *    of N per-competitor reads) + the tenant's seed keyword list
 *    (`getResearchKeywords`, already fail-soft internally — see keywords.ts)
 *    -> `computeContentGaps`. Plain reads only, same "always free to browse"
 *    contract as the rest of `/marketing/research` (page.tsx's own doc
 *    comment) — never crawls, never calls the AI.
 *  - `tenantId` is accepted for symmetry with `scanCompetitorContent` (and
 *    for a future caller that needs it explicitly) but isn't otherwise used
 *    here today — every read below already goes through the ambient
 *    tenant-scoped `db` proxy.
 */

// The tracked watchlist is already small (Market Research P1's own design);
// this is a defensive ceiling on one scan's total crawl+AI cost, not a
// limit expected to bind in practice.
const MAX_COMPETITORS_PER_SCAN = 8;

export type ScanContentResult = { scanned: number; pages: number; failures: number };

export async function scanCompetitorContent(tenantId: number): Promise<ScanContentResult> {
  let scanned = 0;
  let pages = 0;
  let failures = 0;

  try {
    const candidates = listCompetitors({ trackedOnly: true }).filter((c) => !!c.websiteUri);
    const targets = candidates.slice(0, MAX_COMPETITORS_PER_SCAN);

    for (const comp of targets) {
      // Re-narrow inside the loop (the `.filter` above proved it truthy, but
      // TS can't carry that across the slice/loop) — unreachable in
      // practice, but keeps `discoverUrls` fed a real `string`, not
      // `string | null`.
      const websiteUri = comp.websiteUri;
      if (!websiteUri) continue;
      try {
        const urls = await discoverUrls(websiteUri);

        const fetchedPages: NewCompetitorPage[] = [];
        for (const url of urls) {
          const fetched = await fetchPage(url);
          if (fetched) {
            const seo = extractSeo(fetched.html, fetched.url);
            let path = "/";
            try {
              path = new URL(fetched.url).pathname || "/";
            } catch {
              // keep the "/" default — an unparseable url here would already
              // have been dropped by crawl.ts's own filtering, so this is
              // just defensive.
            }
            fetchedPages.push({ url: fetched.url, path, ...seo });
          }
          await politeDelay();
        }

        const now = new Date();
        replaceCompetitorPages(comp.id, fetchedPages, now);
        pages += fetchedPages.length;

        const topics = await deriveSiteTopics(
          tenantId,
          comp.name,
          fetchedPages.map((p) => ({ title: p.title, h1: p.h1 })),
        );
        setCompetitorContentTopics(comp.id, JSON.stringify(topics));
        setCompetitorContentScannedAt(comp.id, now);

        scanned++;
      } catch (err) {
        console.error(`[research/contentScan] scan failed for competitor ${comp.id} (${comp.name}):`, err);
        failures++;
      }
    }
  } catch (err) {
    console.error("[research/contentScan] scanCompetitorContent failed:", err);
  }

  return { scanned, pages, failures };
}

export type ContentGapPerCompetitor = {
  competitorId: number;
  competitorName: string;
  isSelf: boolean;
  websiteUri: string | null;
  /** Epoch ms, or null if this site has never been scanned. */
  lastScannedAt: number | null;
  topics: string[];
  pages: StoredCompetitorPage[];
};

export type GetContentGapsResult = {
  gaps: ContentGap[];
  perCompetitor: ContentGapPerCompetitor[];
  seedKeywords: string[];
};

function parseTopicsJson(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getContentGaps(tenantId: number): Promise<GetContentGapsResult> {
  void tenantId; // kept for API symmetry with scanCompetitorContent — see this file's module doc; every read below is already ambient-tenant-scoped.
  const competitors = listCompetitors({ trackedOnly: true });

  const pagesByCompetitor = new Map<number, StoredCompetitorPage[]>();
  for (const { competitorName: _competitorName, isSelf: _isSelf, ...page } of listAllCompetitorPagesWithCompetitor()) {
    // Drop the join's own competitorName/isSelf columns here — they're
    // already carried once at the ContentGapPerCompetitor level below; a
    // page entry only needs its own StoredCompetitorPage fields.
    const list = pagesByCompetitor.get(page.competitorId) ?? [];
    list.push(page);
    pagesByCompetitor.set(page.competitorId, list);
  }

  const perCompetitor: ContentGapPerCompetitor[] = competitors.map((c) => ({
    competitorId: c.id,
    competitorName: c.name,
    isSelf: c.isSelf,
    websiteUri: c.websiteUri,
    lastScannedAt: c.contentScannedAt ? c.contentScannedAt.getTime() : null,
    topics: parseTopicsJson(c.contentTopicsJson),
    pages: pagesByCompetitor.get(c.id) ?? [],
  }));

  const seedKeywords = await getResearchKeywords();

  const gaps = computeContentGaps({
    competitors: perCompetitor.map((c) => ({ name: c.competitorName, isSelf: c.isSelf, topics: c.topics })),
    seedKeywords,
  });

  return { gaps, perCompetitor, seedKeywords };
}
