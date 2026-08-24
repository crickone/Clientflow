// Run: npm test -- src/lib/research/summary.test.ts
//
// Task 8 of Market Research P1 (lib/research/summary.ts): two AI helpers —
// competitorThemes (per-competitor review themes) and landscapeSummary (a
// read of the tracked competitor set). Both are metered on the EXISTING AI
// cap and must NEVER throw — over cap / AI-unavailable / any error all fall
// back to a static, locally-computed string; neither may fabricate. Covers:
//
//   1. Pure helpers, plain literals, no shim/tenant/network needed:
//      buildThemesFallback, parseThemeLines, buildLandscapeDigest,
//      buildLandscapeFallback.
//   2. competitorThemes / landscapeSummary against a REAL scratch-tenant
//      SQLite file (not mocked — same reasoning as store.test.ts/
//      discovery.test.ts):
//        - no reviews / no competitors -> the exact static string, before
//          either getCurrentTenant() or meteredCreate is ever touched.
//        - a genuinely OVER-CAP tenant (recordUsage pushes it there, same
//          trick as draftFollowup.test.ts/altText.test.ts) trips the REAL
//          assertAiAllowed inside meteredCreate.
//        - this test environment deliberately has no ANTHROPIC_API_KEY
//          (same as every other AI-call test in this repo — see
//          altText.test.ts's note), so a call made BEFORE that cap push
//          exercises the real "AI unavailable" branch too (getAnthropic()
//          throws) — a second, distinct failure mode landing in the same
//          catch.
//      Both failure modes must return the exact static fallback text and
//      must NOT write a cache entry (themesJson stays null).
//
// A true "happy path" (a real model reply gets parsed + cached) can't be
// exercised without live Claude credentials, which no generator's test in
// this repo has (see draftFollowup.test.ts/altText.test.ts). Compensating:
// parseThemeLines — the exact logic a real reply is run through — is
// unit-tested directly against realistic literal model output below, and
// the cache write it feeds (setCompetitorThemes) already has round-trip
// coverage in store.test.ts.
//
// adAngle (Market Research P2, Task 5, below) gets a genuine happy-path test
// instead: `@/lib/ai/metered` is added to this file's require-shim as a thin
// dispatcher — real `meteredCreate` by default (so competitorThemes's and
// landscapeSummary's real AI-unavailable/over-cap assertions above are
// completely unaffected), swapped for a canned successful reply for exactly
// one call via the module-scoped `mockMeteredCreateImpl` variable. This is
// the same require-interception TRICK the react/next-navigation stubs below
// already use, just aimed at a module this file's tests want to control
// instead of one they just need to not crash on.
//
// ./summary -> @/lib/db/tenant (react `cache`) and -> ./store -> @/lib/db ->
// ./tenant -> @/lib/tenants -> @/lib/auth -> next/navigation; also ->
// @/lib/ai/metered -> @/lib/ai/usage -> @/lib/db/control (draftFollowup.test.ts
// exercises this exact second chain for real already). Same two-part shim as
// store.test.ts/draftFollowup.test.ts, for the same reason: under the
// runner's `--conditions=react-server`, npm's react "react-server" entry
// throws on load, so `cache` needs stubbing; next/navigation's real module
// drags in Next's client-router internals we don't have reason to load here.
// Installed via a dynamic require (below) rather than a static import, since
// a static `import ... from "./summary"` would be hoisted and evaluated
// before this shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
type MeteredCreateFn = (...args: unknown[]) => unknown;
// Section 5c (adAngle) sets this to a fake `meteredCreate` for exactly ONE
// call. `null` — the default, and what every OTHER section in this file runs
// under — means "@/lib/ai/metered" resolves to the REAL module below,
// completely transparently.
let mockMeteredCreateImpl: MeteredCreateFn | null = null;
let realMeteredCreate: MeteredCreateFn | null = null;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in summary.test.ts");
      },
    };
  }
  if (request === "@/lib/ai/metered") {
    if (!realMeteredCreate) {
      const real = realLoad.call(this, request, ...rest) as { meteredCreate: MeteredCreateFn };
      realMeteredCreate = real.meteredCreate;
    }
    return {
      meteredCreate: (...callArgs: unknown[]) => (mockMeteredCreateImpl ?? realMeteredCreate!)(...callArgs),
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const {
    buildThemesFallback,
    parseThemeLines,
    buildLandscapeDigest,
    buildLandscapeFallback,
    buildSelfClause,
    competitorThemes,
    landscapeSummary,
    buildAdAngleFallback,
    adAngle,
  } = requireLocal("./summary") as typeof import("./summary");
  type StoredReview = import("./store").StoredReview;
  type Metric = import("./store").Metric;
  type CompetitorRow = import("./store").CompetitorRow;
  type StoredAd = import("./store").StoredAd;

  const review = (ratingMilli: number | null, text = "Review text"): StoredReview => ({
    externalReviewId: `r-${Math.random()}`,
    author: "Reviewer",
    ratingMilli,
    text,
    publishedAt: null,
  });
  const metric = (ratingMilli: number | null, reviewCount: number | null): Metric => ({
    id: 0,
    competitorId: 0,
    capturedAt: "2026-08-01",
    ratingMilli,
    reviewCount,
  });
  const competitor = (id: number, name: string): CompetitorRow => ({
    id,
    siteId: null,
    placeId: `places/${id}`,
    name,
    address: "1 Main St",
    lat: 0,
    lng: 0,
    distanceKm: 1,
    source: "google",
    tracked: true,
    muted: false,
    isSelf: false,
    themesJson: null,
    themesAt: null,
    adAngleJson: null,
    adAngleAt: null,
    addedBy: "manual",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastRefreshedAt: null,
  });
  const storedAd = (id: number, bodies: string[] = ["Ad body"]): StoredAd => ({
    id,
    competitorId: 0,
    adId: `ad-${id}`,
    bodies,
    linkTitle: null,
    linkCaption: null,
    platforms: ["facebook"],
    snapshotUrl: "https://example.com/ad",
    startedAt: null,
    stoppedAt: null,
    active: true,
    imageUrl: null,
    pageName: "",
    pageId: "",
    firstSeenAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  });

  // ── 1. buildThemesFallback ──────────────────────────────────────────
  {
    assert.equal(
      buildThemesFallback([review(5000), review(3000), review(4000)]),
      "3 reviews, avg 4.0★ — connect AI for theme analysis.",
    );
    assert.equal(
      buildThemesFallback([review(5000)]),
      "1 review, avg 5.0★ — connect AI for theme analysis.",
      "singular 'review', not 'reviews'",
    );
    assert.equal(
      buildThemesFallback([review(null), review(null)]),
      "2 reviews, rating unavailable — connect AI for theme analysis.",
    );
    assert.equal(
      buildThemesFallback([review(5000), review(null)]),
      "2 reviews, avg 5.0★ — connect AI for theme analysis.",
      "the average is over RATED reviews only — a null-rating review isn't treated as a 0",
    );
    assert.equal(
      buildThemesFallback([]),
      "0 reviews, rating unavailable — connect AI for theme analysis.",
      "defensive: never crashes on an empty sample even though competitorThemes short-circuits before calling this with one",
    );
  }

  // ── 1b. buildAdAngleFallback ────────────────────────────────────────
  {
    assert.equal(
      buildAdAngleFallback([storedAd(1), storedAd(2), storedAd(3)]),
      "3 active ads — connect AI for their angle.",
    );
    assert.equal(
      buildAdAngleFallback([storedAd(1)]),
      "1 active ad — connect AI for their angle.",
      "singular 'ad', not 'ads'",
    );
    assert.equal(
      buildAdAngleFallback([]),
      "0 active ads — connect AI for their angle.",
      "defensive: never crashes on an empty sample even though adAngle short-circuits before calling this with one",
    );
  }

  // ── 2. parseThemeLines ───────────────────────────────────────────────
  {
    assert.deepEqual(
      parseThemeLines("Clean equipment and friendly staff\nParking is tight at peak times"),
      ["Clean equipment and friendly staff", "Parking is tight at peak times"],
    );
    assert.deepEqual(
      parseThemeLines("- Clean equipment and friendly staff\n- Parking is tight at peak times"),
      ["Clean equipment and friendly staff", "Parking is tight at peak times"],
      "a leading bullet marker is stripped even though the prompt asks the model not to add one",
    );
    assert.deepEqual(
      parseThemeLines("1. Clean equipment\n2) Tight parking"),
      ["Clean equipment", "Tight parking"],
      "leading numbering (both '1.' and '2)' styles) is stripped",
    );
    assert.deepEqual(
      parseThemeLines("one\ntwo\nthree\nfour"),
      ["one", "two", "three"],
      "capped to 3 lines",
    );
    assert.deepEqual(parseThemeLines("one\n\n\ntwo"), ["one", "two"], "blank lines are dropped");
    assert.deepEqual(parseThemeLines(""), [], "empty input -> no lines");
    assert.deepEqual(parseThemeLines("   \n  \n"), [], "whitespace-only input -> no lines");
    const longLine = "x".repeat(500);
    const parsedLong = parseThemeLines(longLine);
    assert.equal(parsedLong.length, 1);
    assert.equal(parsedLong[0].length, 200, "a single very long line is truncated to the max");
  }

  // ── 3. buildLandscapeDigest ──────────────────────────────────────────
  {
    const empty = buildLandscapeDigest([], new Map());
    assert.deepEqual(empty, {
      count: 0,
      rows: [],
      ratedCount: 0,
      minRating: null,
      avgRating: null,
      maxRating: null,
      strongest: null,
      weakest: null,
      mostReviews: null,
      self: null,
    });

    const alpha = competitor(1, "Alpha Gym");
    const beta = competitor(2, "Beta Gym");
    const gamma = competitor(3, "Gamma Gym"); // no metric captured yet
    const metricsById = new Map<number, Metric | null>([
      [1, metric(4500, 40)],
      [2, metric(3800, 120)],
      [3, null],
    ]);
    const d = buildLandscapeDigest([alpha, beta, gamma], metricsById);
    assert.equal(d.count, 3);
    assert.equal(d.ratedCount, 2, "Gamma (no metric row) is excluded from ratedCount");
    assert.equal(d.minRating, 3.8);
    assert.equal(d.maxRating, 4.5);
    assert.equal(d.avgRating, 4.15);
    assert.deepEqual(d.strongest, { name: "Alpha Gym", ratingStars: 4.5 });
    assert.deepEqual(d.weakest, { name: "Beta Gym", ratingStars: 3.8 });
    assert.deepEqual(
      d.mostReviews,
      { name: "Beta Gym", reviewCount: 120 },
      "the review-volume leader is computed independently of the rating leader",
    );
    const gammaRow = d.rows.find((r) => r.name === "Gamma Gym")!;
    assert.equal(gammaRow.ratingStars, null);
    assert.equal(gammaRow.reviewCount, null);

    // A tie keeps the FIRST row — deterministic, not arbitrary.
    const tieMetrics = new Map<number, Metric | null>([
      [1, metric(4000, 10)],
      [2, metric(4000, 10)],
    ]);
    const tied = buildLandscapeDigest([alpha, beta], tieMetrics);
    assert.equal(tied.strongest!.name, "Alpha Gym", "a rating tie keeps the first row");
    assert.equal(tied.weakest!.name, "Alpha Gym");
    assert.equal(tied.mostReviews!.name, "Alpha Gym", "a review-count tie also keeps the first row");

    // A single rated competitor -> strongest === weakest, no crash.
    const single = buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, metric(4500, 40)]]));
    assert.equal(single.strongest!.name, "Alpha Gym");
    assert.equal(single.weakest!.name, "Alpha Gym");
    assert.equal(single.minRating, single.maxRating);

    // self (Market Research P1.1 you-vs-them) — kept OUT of rows/count/highlights.
    const noSelf = buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, metric(4500, 40)]]));
    assert.equal(noSelf.self, null, "self defaults to null when the caller doesn't pass one (no match found yet)");

    const withSelf = buildLandscapeDigest(
      [alpha],
      new Map<number, Metric | null>([[1, metric(4200, 50)]]),
      { name: "Inspire Health and Fitness", ratingStars: 4.7, reviewCount: 90 },
    );
    assert.deepEqual(withSelf.self, { name: "Inspire Health and Fitness", ratingStars: 4.7, reviewCount: 90 });
    assert.equal(withSelf.count, 1, "self is never counted among competitors");
    assert.equal(withSelf.strongest!.name, "Alpha Gym", "self never wins strongest/weakest -- those stay competitor-only");
    assert.deepEqual(
      withSelf.rows.map((r) => r.name),
      ["Alpha Gym"],
      "self never appears in rows either",
    );

    const selfNoRating = buildLandscapeDigest(
      [alpha],
      new Map<number, Metric | null>([[1, metric(4200, 50)]]),
      { name: "Inspire Health and Fitness", ratingStars: null, reviewCount: null },
    );
    assert.deepEqual(
      selfNoRating.self,
      { name: "Inspire Health and Fitness", ratingStars: null, reviewCount: null },
      "a self match with no rating captured yet still passes through as-is (not fabricated, not dropped)",
    );

    const explicitNullSelf = buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, metric(4200, 50)]]), null);
    assert.equal(explicitNullSelf.self, null, "an explicit null self is the same as omitting the argument");
  }

  // ── 3b. buildSelfClause ─────────────────────────────────────────────
  {
    const alpha = competitor(1, "Alpha Gym");
    const metricsById = new Map<number, Metric | null>([[1, metric(4200, 50)]]); // avg 4.2

    const noSelfDigest = buildLandscapeDigest([alpha], metricsById);
    assert.equal(buildSelfClause(noSelfDigest), "", "no self match -> empty clause");

    const noRatingDigest = buildLandscapeDigest([alpha], metricsById, {
      name: "Inspire",
      ratingStars: null,
      reviewCount: 12,
    });
    assert.equal(buildSelfClause(noRatingDigest), "", "self matched but no rating yet -> empty clause (nothing real to say)");

    const fullDigest = buildLandscapeDigest([alpha], metricsById, {
      name: "Inspire",
      ratingStars: 4.8,
      reviewCount: 120,
    });
    assert.equal(
      buildSelfClause(fullDigest),
      " You: 4.8★ (120 reviews) vs pack avg 4.2★.",
      "states the self rating, review count (correct singular/plural), and the pack average -- all real numbers already in the digest",
    );

    const singleReviewDigest = buildLandscapeDigest([alpha], metricsById, {
      name: "Inspire",
      ratingStars: 5.0,
      reviewCount: 1,
    });
    assert.equal(buildSelfClause(singleReviewDigest), " You: 5.0★ (1 review) vs pack avg 4.2★.", "singular 'review'");

    const noReviewCountDigest = buildLandscapeDigest([alpha], metricsById, {
      name: "Inspire",
      ratingStars: 4.5,
      reviewCount: null,
    });
    assert.equal(
      buildSelfClause(noReviewCountDigest),
      " You: 4.5★ vs pack avg 4.2★.",
      "a null self reviewCount is omitted, never shown as 0",
    );

    const noPackAvgDigest = buildLandscapeDigest([alpha], new Map([[1, null]]), {
      name: "Inspire",
      ratingStars: 4.5,
      reviewCount: 30,
    });
    assert.equal(
      buildSelfClause(noPackAvgDigest),
      " You: 4.5★ (30 reviews).",
      "no pack average available (no competitor ratings captured yet) -> the vs-pack part is omitted, not fabricated",
    );
  }

  // ── 4. buildLandscapeFallback ────────────────────────────────────────
  {
    assert.equal(buildLandscapeFallback(buildLandscapeDigest([], new Map())), "No competitors tracked yet.");

    const alpha = competitor(1, "Alpha Gym");
    const noRatings = buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, null]]));
    assert.equal(
      buildLandscapeFallback(noRatings),
      "1 competitor tracked, no ratings captured yet — connect AI for a fuller read.",
      "singular 'competitor'",
    );

    const beta = competitor(2, "Beta Gym");
    const twoRated = buildLandscapeDigest(
      [alpha, beta],
      new Map<number, Metric | null>([
        [1, metric(4200, 10)],
        [2, metric(4600, 5)],
      ]),
    );
    const twoRatedFallback = buildLandscapeFallback(twoRated);
    assert.ok(twoRatedFallback.startsWith("2 competitors tracked, ratings 4.2"), twoRatedFallback);
    assert.ok(twoRatedFallback.includes("4.6★"), twoRatedFallback);
    assert.ok(twoRatedFallback.includes("(avg 4.4★)"), twoRatedFallback);
    assert.ok(twoRatedFallback.endsWith("connect AI for a fuller read."), twoRatedFallback);

    const sameRating = buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, metric(4500, 10)]]));
    assert.equal(
      buildLandscapeFallback(sameRating),
      "1 competitor tracked, ratings 4.5★ (avg 4.5★) — connect AI for a fuller read.",
      "a single rating shows once (no A–B range) when min === max",
    );

    // With a self match, the fallback appends buildSelfClause's you-vs-them
    // sentence end-to-end (Market Research P1.1) — the AI-unavailable path
    // still gets a real, data-only comparison, not just the competitor set.
    const withSelfFallback = buildLandscapeFallback(
      buildLandscapeDigest([alpha, beta], new Map<number, Metric | null>([[1, metric(4200, 10)], [2, metric(4600, 5)]]), {
        name: "Inspire Health and Fitness",
        ratingStars: 4.9,
        reviewCount: 200,
      }),
    );
    assert.equal(
      withSelfFallback,
      "2 competitors tracked, ratings 4.2–4.6★ (avg 4.4★) — connect AI for a fuller read. You: 4.9★ (200 reviews) vs pack avg 4.4★.",
    );

    // Self matched but no ratings captured for the COMPETITOR set yet — the
    // no-ratings branch also gets the self clause appended.
    const withSelfNoCompetitorRatings = buildLandscapeFallback(
      buildLandscapeDigest([alpha], new Map<number, Metric | null>([[1, null]]), {
        name: "Inspire Health and Fitness",
        ratingStars: 4.9,
        reviewCount: 200,
      }),
    );
    assert.equal(
      withSelfNoCompetitorRatings,
      "1 competitor tracked, no ratings captured yet — connect AI for a fuller read. You: 4.9★ (200 reviews).",
    );
  }

  console.log("research/summary.test.ts: pure-helper assertions passed");

  // ── 5. competitorThemes / landscapeSummary — real scratch tenant ─────
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const {
    upsertCompetitor,
    replaceReviews,
    listCompetitors,
    appendMetric,
    getReviews,
    upsertAd,
    listAds,
  } = requireLocal("./store") as typeof import("./store");
  const { recordUsage } = requireLocal("../ai/usage") as typeof import("../ai/usage");
  const { MODELS } = requireLocal("../ai/client") as typeof import("../ai/client");

  function makeScratchTenant(slug: string): { tid: number; cleanup: () => void } {
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, dbFile) as { id: number };
    const tid = t.id;
    const cleanup = () => {
      controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    };
    return { tid, cleanup };
  }

  // ── 5a. competitorThemes ──
  {
    const { tid, cleanup } = makeScratchTenant("research-summary-themes-test");
    try {
      // No reviews -> the exact static string, no AI call, nothing cached.
      const bareId = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "places/BARE", name: "Bare Gym", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      const noReviewsResult = await runWithTenant(tid, async () => competitorThemes(bareId));
      assert.equal(noReviewsResult, "No reviews captured yet.");
      let bareRow = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === bareId)!;
      assert.equal(bareRow.themesJson, null, "the no-reviews short-circuit never touches themesJson");

      // Reviews present. Set up the competitor + its review sample.
      const compId = runWithTenant(tid, () =>
        upsertCompetitor({
          placeId: "places/AI-TEST",
          name: "Testable Gym",
          address: "x",
          lat: 0,
          lng: 0,
          distanceKm: 1,
        }),
      );
      runWithTenant(tid, () =>
        replaceReviews(
          compId,
          [
            { externalReviewId: "r1", author: "Sam", ratingMilli: 5000, text: "Loved the equipment", publishedAt: null },
            { externalReviewId: "r2", author: "Jo", ratingMilli: 3000, text: "Parking was a hassle", publishedAt: null },
          ],
          "2026-08-01",
        ),
      );
      const sample = runWithTenant(tid, () => getReviews(compId));
      const expectedFallback = buildThemesFallback(sample);
      assert.equal(expectedFallback, "2 reviews, avg 4.0★ — connect AI for theme analysis.");

      // NOT over cap yet -- this test environment deliberately has no
      // ANTHROPIC_API_KEY, so meteredCreate's real getAnthropic() throws
      // "ANTHROPIC_API_KEY is not set" -- a real, non-contrived "AI
      // unavailable" failure, caught -> the exact static fallback.
      const underCapResult = await runWithTenant(tid, async () => competitorThemes(compId));
      assert.equal(underCapResult, expectedFallback, "AI-unavailable falls back to the exact static formula");
      let row = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === compId)!;
      assert.equal(row.themesJson, null, "a fallback response must never be cached as if it were a real answer");

      // Genuinely OVER cap -- the real assertAiAllowed (inside meteredCreate)
      // throws AiCapError BEFORE any network attempt. 2,000,000 output
      // tokens on sonnet ($15/1M out) -> 3000c, over the 2500c default cap.
      recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });
      const overCapResult = await runWithTenant(tid, async () => competitorThemes(compId));
      assert.equal(overCapResult, expectedFallback, "over-cap falls back to the same static formula, still never throwing");
      row = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === compId)!;
      assert.equal(row.themesJson, null, "still not cached after the over-cap attempt");

      console.log("research/summary.test.ts: competitorThemes assertions passed");
    } finally {
      cleanup();
    }
  }

  // ── 5b. landscapeSummary ──
  {
    const { tid, cleanup } = makeScratchTenant("research-summary-landscape-test");
    try {
      // 0 tracked competitors -> the exact static string, no AI call.
      const emptyResult = await runWithTenant(tid, async () => landscapeSummary());
      assert.equal(emptyResult, "No competitors tracked yet.");

      // Two competitors with clean (non-rounding) numbers so the expected
      // fallback sentence can be asserted exactly.
      const compA = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "places/LS-A", name: "Landscape Alpha", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      const compB = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "places/LS-B", name: "Landscape Beta", address: "x", lat: 0, lng: 0, distanceKm: 2 }),
      );
      runWithTenant(tid, () => appendMetric(compA, 4600, 80, "2026-08-01"));
      runWithTenant(tid, () => appendMetric(compB, 4000, 200, "2026-08-01"));
      const expectedFallback =
        "2 competitors tracked, ratings 4.0–4.6★ (avg 4.3★) — connect AI for a fuller read.";

      // NOT over cap -- same "AI unavailable" reality as 5a (no API key in
      // this test env) exercises the real error-catch branch for landscapeSummary.
      const underCapResult = await runWithTenant(tid, async () => landscapeSummary());
      assert.equal(underCapResult, expectedFallback, "AI-unavailable falls back to the exact data-only sentence");

      // Genuinely OVER cap -- same trick as 5a, proving landscapeSummary's
      // catch handles the real AiCapError path too, not just a generic error.
      recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });
      const overCapResult = await runWithTenant(tid, async () => landscapeSummary());
      assert.equal(overCapResult, expectedFallback, "over-cap falls back to the same static sentence, still never throwing");

      console.log("research/summary.test.ts: landscapeSummary assertions passed");
    } finally {
      cleanup();
    }
  }

  // ── 5c. adAngle ──
  {
    const { tid, cleanup } = makeScratchTenant("research-summary-adangle-test");
    try {
      // No active ads -> the exact static string, no AI call, nothing cached.
      const bareId = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "places/AD-BARE", name: "Bare Ads Gym", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      const noAdsResult = await runWithTenant(tid, async () => adAngle(bareId));
      assert.equal(noAdsResult, "No active ads found.");
      let bareRow = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === bareId)!;
      assert.equal(bareRow.adAngleJson, null, "the no-ads short-circuit never touches adAngleJson");

      // Ads present. Set up the competitor + one active ad.
      const compId = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "places/AD-TEST", name: "Ad Testable Gym", address: "x", lat: 0, lng: 0, distanceKm: 1 }),
      );
      runWithTenant(tid, () =>
        upsertAd(
          compId,
          {
            adId: "meta-ad-1",
            bodies: ["Join today and get your first month free"],
            linkTitle: "Limited spots",
            linkCaption: "Sign up now",
            platforms: ["facebook"],
            snapshotUrl: "https://example.com/ad/1",
            pageName: "Ad Testable Gym",
            pageId: "",
          },
          "2026-08-01T00:00:00.000Z",
        ),
      );
      const sample = runWithTenant(tid, () => listAds(compId, { activeOnly: true }));
      const expectedFallback = buildAdAngleFallback(sample);
      assert.equal(expectedFallback, "1 active ad — connect AI for their angle.");

      // NOT over cap yet -- same "AI unavailable" reality as 5a/5b (no API
      // key in this test env) exercises the real error-catch branch for
      // adAngle too (mockMeteredCreateImpl is still null here).
      const underCapResult = await runWithTenant(tid, async () => adAngle(compId));
      assert.equal(underCapResult, expectedFallback, "AI-unavailable falls back to the exact static formula");
      let row = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === compId)!;
      assert.equal(row.adAngleJson, null, "a fallback response must never be cached as if it were a real answer");

      // Genuinely OVER cap -- same trick as 5a/5b: the real assertAiAllowed
      // (inside the REAL meteredCreate, still reached since the mock is off)
      // throws AiCapError BEFORE any network attempt.
      recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });
      const overCapResult = await runWithTenant(tid, async () => adAngle(compId));
      assert.equal(overCapResult, expectedFallback, "over-cap falls back to the same static formula, still never throwing");
      row = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === compId)!;
      assert.equal(row.adAngleJson, null, "still not cached after the over-cap attempt");

      // Happy path -- unlike competitorThemes/landscapeSummary above (no live
      // Claude credentials in this test env), adAngle CAN get a genuine
      // successful-reply test: swap in a canned `meteredCreate` for exactly
      // one call via mockMeteredCreateImpl (see the require-shim at the top
      // of this file), proving the model's text is both cached via
      // setCompetitorAdAngle AND returned verbatim. The tenant is still over
      // cap from the previous step, which is irrelevant here -- the mock
      // REPLACES meteredCreate entirely, so the real assertAiAllowed never
      // runs for this one call.
      mockMeteredCreateImpl = async () => ({
        content: [{ type: "text", text: "They're pushing a free first month to get new members in the door fast." }],
      });
      let happyResult: string;
      try {
        happyResult = await runWithTenant(tid, async () => adAngle(compId));
      } finally {
        mockMeteredCreateImpl = null; // never leak the mock past this one call
      }
      assert.equal(happyResult, "They're pushing a free first month to get new members in the door fast.");
      row = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === compId)!;
      assert.ok(row.adAngleJson, "a successful model reply IS cached");
      const cached = JSON.parse(row.adAngleJson!) as { angle: string; at: string };
      assert.equal(cached.angle, happyResult);
      assert.equal(typeof cached.at, "string");
      assert.equal(row.adAngleAt, cached.at, "the adAngleAt column matches the cached JSON's own at field");

      console.log("research/summary.test.ts: adAngle assertions passed");
    } finally {
      cleanup();
    }
  }

  console.log("research/summary.test.ts: all assertions passed");
})();
