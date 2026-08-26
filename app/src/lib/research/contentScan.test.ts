// Run: npm test -- src/lib/research/contentScan.test.ts
//
// Content-gap analysis's scan orchestrator (lib/research/contentScan.ts) —
// scanCompetitorContent + getContentGaps. Orchestration over the
// already-tested engine (crawl.ts/seo.ts/topics.ts/gaps.ts/store.ts), so the
// value here is the LOOP/assembly semantics, not re-proving each piece:
//
//   1. A tracked competitor with NO websiteUri is silently skipped (not
//      scanned, not a failure — there's nothing to crawl).
//   2. A tracked competitor with a websiteUri gets crawled + its pages
//      stored (replaceCompetitorPages) + contentScannedAt stamped +
//      contentTopicsJson cached (as "[]" here — this test environment has
//      no ANTHROPIC_API_KEY, so deriveSiteTopics' real fail-soft path
//      exercises for free, same reality summary.test.ts/topics.test.ts rely
//      on).
//   3. isSelf:true is INCLUDED in the scan (unlike most other callers in
//      this module tree, which exclude self) — the tenant's own site needs
//      its own topic set derived too.
//   4. A site that's entirely unreachable still completes as "scanned" with
//      0 pages, not a "failure" — crawl.ts's own discoverUrls/fetchPage
//      never throw by design, so scanCompetitorContent's per-competitor
//      try/catch is genuinely unreachable via this dependency chain today
//      (kept as defense in depth, mirroring the ResearchCapError/AiCapError
//      catches actions.ts's own doc comment documents as the same kind of
//      currently-unreachable belt-and-braces); what's actually provable is
//      that an unreachable site never blocks the NEXT competitor.
//   5. MAX_COMPETITORS_PER_SCAN (8) caps a scan to the nearest 8 tracked,
//      websiteUri-having competitors — the 9th (farthest) is left
//      untouched.
//   6. getContentGaps assembles perCompetitor (pages/SEO/topics/
//      lastScannedAt, including self) + gaps (via the already-proven
//      computeContentGaps) correctly from stored data, and its seedKeywords
//      read is genuinely fail-soft: this test environment can't load
//      @/lib/settings via keywords.ts's dynamic import either (same
//      `--conditions=react-server` reality as topics.ts's AI calls — see
//      keywords.ts's own doc comment), so seedKeywords reads back as `[]`
//      here, proving getContentGaps degrades gracefully rather than
//      throwing when the keyword read fails.
//
// Covered against a REAL scratch-tenant SQLite file (not mocked — same
// reasoning as store.test.ts/refresh.test.ts) with `fetch` mocked exactly
// like refresh.test.ts (save/restore globalThis.fetch; zero live network
// calls). Same two-part Module._load shim as store.test.ts/refresh.test.ts
// (react's cache + next/navigation) — contentScan.ts -> store.ts needs it
// even though crawl.ts/seo.ts/topics.ts/gaps.ts/keywords.ts individually
// don't.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in contentScan.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

type FetchCall = { url: string };

/** Same technique as refresh.test.ts/places.test.ts: swap globalThis.fetch for the duration of `fn`, recording every call, restoring even if `fn` throws. */
async function withMockFetch<T>(
  impl: (url: string) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: unknown) => {
    calls.push({ url: String(url) });
    return impl(String(url));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}
function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
}
function html(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const {
    upsertCompetitor,
    listCompetitors,
    setCompetitorWebsite,
    setCompetitorContentTopics,
    replaceCompetitorPages,
    listCompetitorPages,
  } = requireLocal("./store") as typeof import("./store");
  const { scanCompetitorContent, getContentGaps } = requireLocal("./contentScan") as typeof import("./contentScan");

  function makeScratchTenant(slug: string): number {
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, dbFile) as { id: number };
    return t.id;
  }

  function cleanupScratchTenant(slug: string, tid: number): void {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 1-4. scanCompetitorContent: skip-no-website, crawl+store+cache, self
  //      included, an unreachable site doesn't block the next competitor.
  // ════════════════════════════════════════════════════════════════════
  await (async () => {
    const slug = "contentscan-test-happy";
    const tid = makeScratchTenant(slug);
    try {
      const idNoSite = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-nosite", name: "No Website Gym", address: "x", lat: 0, lng: 0, distanceKm: 0.5 }),
      );
      const idUnreachable = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-unreachable", name: "Unreachable Gym", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      runWithTenant(tid, () => setCompetitorWebsite(idUnreachable, "https://unreachable.test"));
      const idGood = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-good", name: "Good Gym", address: "x", lat: 0, lng: 0, distanceKm: 2 }),
      );
      runWithTenant(tid, () => setCompetitorWebsite(idGood, "https://good.test"));
      const idSelf = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-self", name: "My Own Gym", address: "x", lat: 0, lng: 0, distanceKm: 0, isSelf: true }),
      );
      runWithTenant(tid, () => setCompetitorWebsite(idSelf, "https://myowngym.test"));

      await withMockFetch(
        (url) => {
          if (url.startsWith("https://unreachable.test")) return notFound();
          if (url === "https://good.test/robots.txt") return notFound();
          if (url === "https://good.test/sitemap.xml") {
            return xml(`<urlset><url><loc>https://good.test/services</loc></url></urlset>`);
          }
          if (url === "https://good.test/services") {
            return html(`<html><head><title>Our Services</title></head><body><h1>Services</h1><p>Great stuff here.</p></body></html>`);
          }
          if (url === "https://myowngym.test/robots.txt") return notFound();
          if (url === "https://myowngym.test/sitemap.xml") {
            return xml(`<urlset><url><loc>https://myowngym.test/about</loc></url></urlset>`);
          }
          if (url === "https://myowngym.test/about") {
            return html(`<html><head><title>About Us</title></head><body><h1>About</h1></body></html>`);
          }
          throw new Error(`unexpected fetch in contentScan happy-path test: ${url}`);
        },
        async () => {
          const result = await runWithTenant(tid, async () => scanCompetitorContent(tid));

          check("happy path: scanned counts every websiteUri-having competitor (unreachable + good + self = 3)", result.scanned === 3);
          check("happy path: failures stays 0 (an unreachable site is a valid empty result, not a failure)", result.failures === 0);
          check("happy path: pages counts only the reachable sites' pages (1 + 1 = 2)", result.pages === 2);

          const rows = runWithTenant(tid, () => listCompetitors());
          const noSiteRow = rows.find((r) => r.id === idNoSite)!;
          check("no-website competitor: never scanned, contentScannedAt stays null", noSiteRow.contentScannedAt === null);
          check("no-website competitor: contentTopicsJson stays null", noSiteRow.contentTopicsJson === null);

          const unreachableRow = rows.find((r) => r.id === idUnreachable)!;
          check("unreachable competitor: STILL gets contentScannedAt stamped (scanned, just empty)", unreachableRow.contentScannedAt instanceof Date);
          check("unreachable competitor: contentTopicsJson is '[]' (no pages -> deriveSiteTopics short-circuits, no AI call)", unreachableRow.contentTopicsJson === "[]");

          const goodRow = rows.find((r) => r.id === idGood)!;
          check("good competitor: contentScannedAt stamped", goodRow.contentScannedAt instanceof Date);
          check(
            "good competitor: contentTopicsJson is '[]' too (this test env has no ANTHROPIC_API_KEY -> AI-unavailable fail-soft, see topics.test.ts)",
            goodRow.contentTopicsJson === "[]",
          );

          const selfRow = rows.find((r) => r.id === idSelf)!;
          check("self (isSelf:true) IS included in the scan", selfRow.contentScannedAt instanceof Date);

          const goodPages = runWithTenant(tid, () => listCompetitorPages(idGood));
          check("good competitor: exactly 1 page stored", goodPages.length === 1);
          check("good competitor: the stored page's title matches the crawled HTML", goodPages[0]?.title === "Our Services");
          check("good competitor: the stored page's h1 matches", goodPages[0]?.h1 === "Services");
          check("good competitor: the stored page's url round-trips", goodPages[0]?.url === "https://good.test/services");
          check("good competitor: the stored page's path is the URL's pathname", goodPages[0]?.path === "/services");
          check("good competitor: wordCount is a positive number", (goodPages[0]?.wordCount ?? 0) > 0);

          const selfPages = runWithTenant(tid, () => listCompetitorPages(idSelf));
          check("self: exactly 1 page stored, distinct from the competitor's", selfPages.length === 1 && selfPages[0]?.title === "About Us");

          const unreachablePages = runWithTenant(tid, () => listCompetitorPages(idUnreachable));
          check("unreachable competitor: zero pages stored", unreachablePages.length === 0);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  })();

  // ════════════════════════════════════════════════════════════════════
  // 5. MAX_COMPETITORS_PER_SCAN caps a scan to the nearest 8
  // ════════════════════════════════════════════════════════════════════
  await (async () => {
    const slug = "contentscan-test-cap";
    const tid = makeScratchTenant(slug);
    try {
      const ids: number[] = [];
      for (let i = 0; i < 9; i++) {
        const id = runWithTenant(tid, () =>
          upsertCompetitor({ placeId: `place-cap-${i}`, name: `Cap Gym ${i}`, address: "x", lat: 0, lng: 0, distanceKm: i }),
        );
        runWithTenant(tid, () => setCompetitorWebsite(id, `https://cap-site-${i}.test`));
        ids.push(id);
      }

      await withMockFetch(
        () => notFound(), // every robots.txt/sitemap.xml/homepage request 404s -- 0 pages for everyone, keeps this scenario minimal
        async () => {
          const result = await runWithTenant(tid, async () => scanCompetitorContent(tid));
          check("cap: exactly MAX_COMPETITORS_PER_SCAN (8) competitors scanned, not all 9", result.scanned === 8);

          const rows = runWithTenant(tid, () => listCompetitors());
          const nearest8 = ids.slice(0, 8); // distanceKm 0..7 -- listCompetitors is nearest-first
          const farthest = ids[8]; // distanceKm 8
          check(
            "cap: every one of the nearest 8 got scanned (contentScannedAt set)",
            nearest8.every((id) => rows.find((r) => r.id === id)!.contentScannedAt instanceof Date),
          );
          check(
            "cap: the farthest (9th) competitor was left untouched",
            rows.find((r) => r.id === farthest)!.contentScannedAt === null,
          );
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  })();

  // ════════════════════════════════════════════════════════════════════
  // 6. getContentGaps: assembly from stored data (competitors + pages +
  //    topics), including self, plus its fail-soft seedKeywords read.
  // ════════════════════════════════════════════════════════════════════
  await (async () => {
    const slug = "contentscan-test-gaps";
    const tid = makeScratchTenant(slug);
    try {
      const idSelf = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-gaps-self", name: "My Gym", address: "x", lat: 0, lng: 0, distanceKm: 0, isSelf: true }),
      );
      const idAlpha = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-gaps-alpha", name: "Alpha Gym", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      const idBeta = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-gaps-beta", name: "Beta Gym", address: "x", lat: 0, lng: 0, distanceKm: 2 }),
      );

      runWithTenant(tid, () => setCompetitorContentTopics(idSelf, JSON.stringify(["Personal Training"])));
      runWithTenant(tid, () => setCompetitorContentTopics(idAlpha, JSON.stringify(["Personal Training", "Sports Massage"])));
      runWithTenant(tid, () => setCompetitorContentTopics(idBeta, JSON.stringify(["Sports Massage", "Nutrition Coaching"])));

      const fetchedAt = new Date("2026-08-20T00:00:00.000Z");
      runWithTenant(tid, () =>
        replaceCompetitorPages(
          idAlpha,
          [
            {
              url: "https://alpha.test/massage",
              path: "/massage",
              title: "Sports Massage",
              metaDescription: "Book a sports massage",
              h1: "Sports Massage",
              h2s: ["Why choose us"],
              wordCount: 240,
            },
          ],
          fetchedAt,
        ),
      );

      const result = await runWithTenant(tid, async () => getContentGaps(tid));

      check("getContentGaps: perCompetitor includes all 3 tracked competitors (incl. self)", result.perCompetitor.length === 3);
      const selfEntry = result.perCompetitor.find((c) => c.competitorId === idSelf)!;
      check("getContentGaps: self entry has isSelf:true", selfEntry.isSelf === true);
      check("getContentGaps: self entry's topics round-trip", JSON.stringify(selfEntry.topics) === JSON.stringify(["Personal Training"]));
      check("getContentGaps: a competitor never scanned has lastScannedAt null", selfEntry.lastScannedAt === null);

      const alphaEntry = result.perCompetitor.find((c) => c.competitorId === idAlpha)!;
      check("getContentGaps: alpha's topics round-trip", JSON.stringify(alphaEntry.topics) === JSON.stringify(["Personal Training", "Sports Massage"]));
      check("getContentGaps: alpha's crawled page shows up with its full SEO read", alphaEntry.pages.length === 1 && alphaEntry.pages[0]?.title === "Sports Massage");
      check("getContentGaps: alpha's page h2s round-trip", JSON.stringify(alphaEntry.pages[0]?.h2s) === JSON.stringify(["Why choose us"]));
      check("getContentGaps: alpha's page fetchedAt matches (epoch ms)", alphaEntry.pages[0]?.fetchedAt === fetchedAt.getTime());

      const betaEntry = result.perCompetitor.find((c) => c.competitorId === idBeta)!;
      check("getContentGaps: beta has no crawled pages yet -> []", JSON.stringify(betaEntry.pages) === "[]");

      // Gap math: self covers "Personal Training" -> excluded. "Sports
      // Massage" (Alpha + Beta, 2 competitors) and "Nutrition Coaching"
      // (Beta, 1 competitor) are gaps, ranked by count.
      check(
        "getContentGaps: gaps reflect computeContentGaps over the assembled topics (own-covered topic excluded, ranked by count)",
        JSON.stringify(result.gaps.map((g) => g.topic)) === JSON.stringify(["Sports Massage", "Nutrition Coaching"]),
      );
      check("getContentGaps: top gap's competitorCount is 2", result.gaps[0]?.competitorCount === 2);

      // This test environment can't load @/lib/settings via keywords.ts's
      // dynamic import either (same --conditions=react-server reality as
      // topics.ts's meteredCreate — see keywords.ts's own doc comment), so
      // getResearchKeywords() genuinely fails here and getContentGaps'
      // fail-soft handling of that (baked into getResearchKeywords itself)
      // is what's actually being proven: seedKeywords reads back as [],
      // and — critically — the call above did NOT throw.
      check("getContentGaps: seedKeywords fails soft to [] in this test env (proves the read never throws the whole function)", JSON.stringify(result.seedKeywords) === "[]");
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  })();

  console.log(`\ncontentScan: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
