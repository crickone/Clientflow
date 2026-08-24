import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { getCurrentTenant } from "@/lib/db/tenant";
import {
  listCompetitors,
  latestMetric,
  getReviews,
  setCompetitorThemes,
  type CompetitorRow,
  type Metric,
  type StoredReview,
} from "./store";

/**
 * Task 8 of Market Research P1: two AI helpers built on the committed engine
 * (places/distance/spend/store/discovery/changeDetect/refresh, Tasks 1-7) —
 * `competitorThemes` (2-3 recurring themes from one competitor's cached
 * review sample) and `landscapeSummary` (a short read of the whole tracked
 * competitor SET). Both:
 *
 *  - Are metered on the EXISTING AI cap (`meteredCreate` / `@/lib/ai/usage`)
 *    under agentKey "research" — a SEPARATE budget from the Places/Geocoding
 *    research-spend cap in spend.ts, same split as everywhere else in this
 *    module (AI spend vs research spend are different meters).
 *  - NEVER throw. Over-cap (`AiCapError` from `meteredCreate`'s own
 *    `assertAiAllowed`), a missing/misconfigured API key, a network error, or
 *    unparseable model output all land in the same catch block and resolve to
 *    a STATIC, locally-computed fallback string — mirroring
 *    `@/lib/marketing/campaignRadar.ts`'s `getCampaignRadar` (its closest
 *    sibling: small one-shot AI enrichment over local data, same
 *    catch-everything-fall-back-to-pure-function shape) rather than
 *    `draftFollowup`/`draftBlog`'s "propagate AiCapError to an interactive
 *    caller" contract — there is no interactive caller here to show a
 *    "top up your AI credits" error to; a dashboard card just quietly shows
 *    the data-only sentence instead.
 *  - Forbid fabrication: both prompts carry `NO_FABRICATION_RULE` verbatim,
 *    instructing the model to describe ONLY the supplied reviews/metrics —
 *    never invent a rating, quote, count, or claim (HOUSE RULE, matching the
 *    same constraint already enforced in `@/lib/campaigns/prompts.ts` and
 *    `@/lib/ai/draftFollowup.ts`'s "never invent" service references).
 *
 * Testability follows the same split as `discovery.ts`/`campaignRadar.ts`:
 * the arithmetic (fallback text, the landscape digest, parsing the model's
 * theme lines) lives in small pure functions exported for direct unit
 * testing; the two async entry points stay thin wrappers around
 * meteredCreate + a try/catch. See summary.test.ts.
 */

const AGENT_KEY = "research";

/**
 * HOUSE RULE (Inspire) — no fabrication. Shared verbatim by both prompts
 * below so the constraint reads identically everywhere it's enforced, the
 * same reasoning as `@/lib/campaigns/prompts.ts`'s single `HOUSE_RULES`
 * string reused across every campaign-asset prompt.
 */
const NO_FABRICATION_RULE =
  "House rule: describe ONLY what is literally present in the data supplied to you below. Never invent, " +
  "estimate, round up/down, or embellish a rating, review count, quote, or claim — if something isn't in " +
  "the supplied text, leave it out rather than guess at it.";

// ─────────────────────────────────────────────────────────────────────────
// competitorThemes
// ─────────────────────────────────────────────────────────────────────────

// The review sample store.ts holds is already Google's own top-N per place
// (see competitor_reviews' table doc comment) — this just bounds the prompt
// (and the fallback's counted sample) to a "top-5" read even if that ever
// grows, per the brief's "top-5 sample" wording.
const MAX_REVIEWS_FOR_THEMES = 5;
const MAX_THEME_LINES = 3;
const MAX_THEME_LINE_CHARS = 200;

/**
 * The over-cap / AI-unavailable / error fallback for `competitorThemes`:
 * cheap local arithmetic over the same review sample the model would have
 * seen, no AI call. Pure + exported for direct unit testing.
 */
export function buildThemesFallback(reviews: StoredReview[]): string {
  const n = reviews.length;
  const label = `${n} review${n === 1 ? "" : "s"}`;
  const rated = reviews.filter((r) => r.ratingMilli != null);
  if (rated.length === 0) {
    return `${label}, rating unavailable — connect AI for theme analysis.`;
  }
  const avg = rated.reduce((sum, r) => sum + (r.ratingMilli as number), 0) / rated.length / 1000;
  return `${label}, avg ${avg.toFixed(1)}★ — connect AI for theme analysis.`;
}

function buildThemesSystemPrompt(): string {
  return [
    "You read a small sample of a competing local business's Google reviews and summarise recurring themes for the operator who is tracking that competitor.",
    NO_FABRICATION_RULE,
    "Base every theme strictly on the review text supplied in the next message — do not draw on outside knowledge of this or any business.",
  ].join("\n\n");
}

function buildThemesUserPrompt(reviews: StoredReview[]): string {
  const lines = reviews.map((r, i) => {
    const stars = r.ratingMilli != null ? `${(r.ratingMilli / 1000).toFixed(1)}★` : "unrated";
    return `${i + 1}. (${stars}) ${r.text}`;
  });
  return [
    "Reviews:",
    ...lines,
    "",
    "List 2-3 short recurring themes from these reviews — what people praise and/or complain about. " +
      "One short line per theme. Reply with ONLY the theme lines: no numbering, no heading, no preamble, no closing remarks.",
  ].join("\n");
}

/**
 * Parses the model's raw text reply into up to 3 clean theme lines: split on
 * newlines, strip a leading bullet/number marker if the model added one
 * despite being asked not to, trim, drop empty lines, cap length. Pure —
 * exported so the parsing logic is testable with plain string literals
 * without a network call.
 */
export function parseThemeLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/^[\s\-*•\d.)]+/, "").trim().slice(0, MAX_THEME_LINE_CHARS))
    .filter((line) => line.length > 0)
    .slice(0, MAX_THEME_LINES);
}

/**
 * 2-3 short bullet themes from a competitor's cached review sample.
 *
 * No reviews yet -> "No reviews captured yet." with NO model call (nothing
 * to summarise, so there's no reason to spend). Otherwise: metered call to
 * CONTENT_MODEL asking for themes strictly grounded in the supplied text;
 * the parsed themes are cached via `setCompetitorThemes` (so the dashboard
 * doesn't re-spend on every render) and the display text is returned. Any
 * failure along the way — over cap, AI unavailable, network error, or the
 * model returning nothing parseable — falls back to `buildThemesFallback`
 * over the SAME sample, never throws, and never caches a non-answer (a
 * capped tenant should retry with real AI next time, not get stuck showing
 * a stale "connect AI" fallback string forever).
 */
export async function competitorThemes(competitorId: number): Promise<string> {
  const reviews = getReviews(competitorId).slice(0, MAX_REVIEWS_FOR_THEMES);
  if (reviews.length === 0) return "No reviews captured yet.";

  const tenantId = getCurrentTenant().id;

  try {
    const message = await meteredCreate({ tenantId, agentKey: AGENT_KEY }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 300,
      system: buildThemesSystemPrompt(),
      messages: [{ role: "user", content: buildThemesUserPrompt(reviews) }],
    }));

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const themes = parseThemeLines(text);
    if (themes.length === 0) return buildThemesFallback(reviews);

    // Cache alongside the model call (inside the try): a write failure here
    // is rare (a plain synchronous SQLite write already covered by
    // store.test.ts) and treating it the same as a model failure — fall back
    // rather than return an answer that silently failed to persist — is the
    // simpler, still-never-throws choice.
    const nowIso = new Date().toISOString();
    setCompetitorThemes(competitorId, JSON.stringify({ themes, at: nowIso }), nowIso);
    return themes.join("\n");
  } catch (err) {
    console.error(`[research/summary] competitorThemes(${competitorId}) fallback:`, err);
    return buildThemesFallback(reviews);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// landscapeSummary
// ─────────────────────────────────────────────────────────────────────────

export type LandscapeRow = {
  id: number;
  name: string;
  ratingStars: number | null;
  reviewCount: number | null;
};

export type LandscapeDigest = {
  count: number;
  rows: LandscapeRow[];
  ratedCount: number;
  minRating: number | null;
  avgRating: number | null;
  maxRating: number | null;
  strongest: { name: string; ratingStars: number } | null;
  weakest: { name: string; ratingStars: number } | null;
  mostReviews: { name: string; reviewCount: number } | null;
};

/**
 * Pure: turns the watchlist + each competitor's latest metric snapshot into
 * a compact digest — count, rating min/avg/max, and who's strongest/weakest
 * by rating and who leads on review volume. No fabrication risk here (it's
 * arithmetic over real stored numbers); the fabrication risk this whole
 * module guards against is entirely in what the MODEL is asked to add on
 * top of this digest. Exported for direct unit testing with plain literals.
 */
export function buildLandscapeDigest(
  competitors: CompetitorRow[],
  metricsById: ReadonlyMap<number, Metric | null>,
): LandscapeDigest {
  const rows: LandscapeRow[] = competitors.map((c) => {
    const m = metricsById.get(c.id) ?? null;
    return {
      id: c.id,
      name: c.name,
      ratingStars: m?.ratingMilli != null ? m.ratingMilli / 1000 : null,
      reviewCount: m?.reviewCount ?? null,
    };
  });

  const rated = rows.filter((r): r is LandscapeRow & { ratingStars: number } => r.ratingStars != null);
  const ratings = rated.map((r) => r.ratingStars);
  const minRating = ratings.length > 0 ? Math.min(...ratings) : null;
  const maxRating = ratings.length > 0 ? Math.max(...ratings) : null;
  const avgRating = ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null;

  // reduce with a strict > / < keeps the FIRST row on a tie (stable, deterministic).
  const strongestRow = rated.length > 0 ? rated.reduce((a, b) => (b.ratingStars > a.ratingStars ? b : a)) : null;
  const weakestRow = rated.length > 0 ? rated.reduce((a, b) => (b.ratingStars < a.ratingStars ? b : a)) : null;

  const withReviews = rows.filter((r): r is LandscapeRow & { reviewCount: number } => r.reviewCount != null);
  const mostReviewsRow =
    withReviews.length > 0 ? withReviews.reduce((a, b) => (b.reviewCount > a.reviewCount ? b : a)) : null;

  return {
    count: competitors.length,
    rows,
    ratedCount: rated.length,
    minRating,
    avgRating,
    maxRating,
    strongest: strongestRow ? { name: strongestRow.name, ratingStars: strongestRow.ratingStars } : null,
    weakest: weakestRow ? { name: weakestRow.name, ratingStars: weakestRow.ratingStars } : null,
    mostReviews: mostReviewsRow ? { name: mostReviewsRow.name, reviewCount: mostReviewsRow.reviewCount } : null,
  };
}

/**
 * The over-cap / AI-unavailable / error fallback for `landscapeSummary`, AND
 * the "nothing tracked yet" response — a data-only sentence (count of
 * competitors, rating range), no AI, built from the same digest the model
 * prompt would have used. Pure + exported for direct unit testing.
 */
export function buildLandscapeFallback(digest: LandscapeDigest): string {
  if (digest.count === 0) return "No competitors tracked yet.";
  const label = `${digest.count} competitor${digest.count === 1 ? "" : "s"} tracked`;
  if (digest.minRating == null || digest.maxRating == null || digest.avgRating == null) {
    return `${label}, no ratings captured yet — connect AI for a fuller read.`;
  }
  const range =
    digest.minRating === digest.maxRating
      ? `${digest.minRating.toFixed(1)}★`
      : `${digest.minRating.toFixed(1)}–${digest.maxRating.toFixed(1)}★`;
  return `${label}, ratings ${range} (avg ${digest.avgRating.toFixed(1)}★) — connect AI for a fuller read.`;
}

function buildLandscapeSystemPrompt(): string {
  return [
    "You are a market analyst summarising a set of local competitor businesses for the operator who tracks them.",
    NO_FABRICATION_RULE,
    // P1 does not track the tenant's OWN Google rating (see the Market
    // Research P1 spec) — there is nothing to compare the set against, so
    // the model must never invent or imply a "you vs them" comparison.
    'You are NOT given the operator\'s own rating or review data. Never invent or imply a comparison against "us"/the operator\'s own business — describe the competitor set only.',
  ].join("\n\n");
}

function buildLandscapeUserPrompt(digest: LandscapeDigest): string {
  const lines = digest.rows.map((r) => {
    const rating = r.ratingStars != null ? `${r.ratingStars.toFixed(1)}★` : "no rating yet";
    const reviews = r.reviewCount != null ? `${r.reviewCount} reviews` : "review count unknown";
    return `- ${r.name}: ${rating}, ${reviews}`;
  });
  return [
    `Tracked competitors (${digest.count} total):`,
    ...lines,
    "",
    "Write a 2-3 sentence read of this competitor set: which is strongest/weakest by rating, which leads on " +
      "review volume, and any obvious gap in the pack. Base every claim strictly on the list above.",
  ].join("\n");
}

/**
 * A short paragraph reading the tracked competitor SET (P1 has no
 * tenant-self rating to compare against — see `buildLandscapeSystemPrompt`'s
 * comment — so this deliberately summarises the pack only, never a "you vs
 * them" comparison).
 *
 * No tracked competitors -> "No competitors tracked yet." with NO model
 * call. Otherwise: build the digest locally, ask CONTENT_MODEL for a short
 * read grounded strictly in it. Any failure (over cap, AI unavailable,
 * network error, empty model output) falls back to `buildLandscapeFallback`
 * over the same digest — never throws. Unlike `competitorThemes`, there is
 * no per-call cache column for this (the brief doesn't ask for one); a
 * caller that wants to avoid re-spending on every render should memoize
 * around this call itself, the same way `campaignRadar.ts` memoizes
 * `getCampaignRadar` per tenant/day.
 */
export async function landscapeSummary(): Promise<string> {
  const competitors = listCompetitors({ trackedOnly: true });
  const digest = buildLandscapeDigest(
    competitors,
    new Map(competitors.map((c) => [c.id, latestMetric(c.id)])),
  );

  if (competitors.length === 0) return buildLandscapeFallback(digest); // "No competitors tracked yet." — nothing to summarise, no AI call

  const tenantId = getCurrentTenant().id;

  try {
    const message = await meteredCreate({ tenantId, agentKey: AGENT_KEY }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 400,
      system: buildLandscapeSystemPrompt(),
      messages: [{ role: "user", content: buildLandscapeUserPrompt(digest) }],
    }));

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return text.length > 0 ? text : buildLandscapeFallback(digest);
  } catch (err) {
    console.error("[research/summary] landscapeSummary fallback:", err);
    return buildLandscapeFallback(digest);
  }
}
