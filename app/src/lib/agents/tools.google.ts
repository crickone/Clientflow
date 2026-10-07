import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  GoogleApiError,
  getGoogleBusinessConnection,
  getProfileSeries,
  getReviewSummary,
  getSearchConsoleRows,
  getSearchKeywords,
  getAnalyticsDaily,
  listStoredReviews,
  replyToGoogleReview,
  syncGoogleReviews,
} from "@/lib/google/business";
import { profileTotals } from "@/lib/google/businessApi";
import { fenceUntrusted, type ToolContext, type ToolResult } from "@/lib/agents/toolKit";

/**
 * Adonis's Google tools. Reads run freely: the Business Profile numbers,
 * Search Console and Analytics for a period, and the reviews. Replying to a
 * review is PUBLIC and goes through the approval gate (WRITE_TOOL_META).
 * Posting to Google is not here: it is a channel on schedule_social_post /
 * publish_social_post.
 */
export const GOOGLE_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_google_metrics",
    description:
      "The business's Google numbers for the last N days (default 30), each with the previous period of the same length: Business Profile views in Search and Maps, calls, website clicks and direction requests from the listing, last month's search terms that showed it, and, when connected, Search Console clicks and top searches to the website and Google Analytics visits. Parts that are not connected or not yet approved by Google come back with the reason.",
    input_schema: { type: "object", properties: { days: { type: "integer", description: "1-90, default 30." } } },
  },
  {
    name: "list_google_reviews",
    description:
      "The business's Google reviews, newest first, with the rating, what they wrote and the business's reply if there is one, plus the average rating. Set unansweredOnly to list only reviews without a reply. Refreshes from Google first.",
    input_schema: {
      type: "object",
      properties: {
        unansweredOnly: { type: "boolean" },
        limit: { type: "integer", description: "1-50, default 20." },
      },
    },
  },
  {
    name: "reply_to_google_review",
    description:
      "Post (or replace) the business's PUBLIC reply to a Google review (id from list_google_reviews). Show the operator the exact reply first. Rules: thank them, refer to what they said, never argue, never discuss health conditions or outcomes, never offer discounts or incentives, invite unhappy reviewers to contact the business directly, plain text, no emojis, sign off with the business name.",
    input_schema: {
      type: "object",
      properties: {
        reviewId: { type: "integer" },
        text: { type: "string", description: "The reply exactly as it should appear on Google." },
        reviewer: { type: "string", description: "Optional: the reviewer's name, purely for the approval card." },
      },
      required: ["reviewId", "text"],
    },
  },
];

const why = (err: unknown) => (err instanceof GoogleApiError ? err.message : "Google did not answer.");

export async function getGoogleMetricsTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const conn = getGoogleBusinessConnection(ctx.tenantId);
  if (!conn) return { text: JSON.stringify({ error: "Google is not connected. Connect it in Settings > Integrations > Google." }) };
  const days = Math.min(90, Math.max(1, Math.round(Number(input.days) || 30)));
  const to = Date.now();
  const from = to - days * 86_400_000;
  const prevFrom = from - days * 86_400_000;
  const settle = async <T,>(fn: () => Promise<T>) => {
    try {
      return { ok: true as const, value: await fn() };
    } catch (err) {
      return { ok: false as const, error: why(err) };
    }
  };
  const [cur, prev, keywords, sc, scPrev, ga, gaPrev] = await Promise.all([
    settle(async () => profileTotals(await getProfileSeries(ctx.tenantId, from, to))),
    settle(async () => profileTotals(await getProfileSeries(ctx.tenantId, prevFrom, from))),
    settle(() => getSearchKeywords(ctx.tenantId)),
    conn.searchConsoleSite ? settle(() => getSearchConsoleRows(ctx.tenantId, from, to, "query", 15)) : Promise.resolve(null),
    conn.searchConsoleSite ? settle(() => getSearchConsoleRows(ctx.tenantId, prevFrom, from, "date", 400)) : Promise.resolve(null),
    conn.ga4Property ? settle(() => getAnalyticsDaily(ctx.tenantId, from, to)) : Promise.resolve(null),
    conn.ga4Property ? settle(() => getAnalyticsDaily(ctx.tenantId, prevFrom, from)) : Promise.resolve(null),
  ]);
  const total = <T,>(r: { ok: true; value: T[] } | { ok: false; error: string } | null, pick: (x: T) => number) =>
    r && r.ok ? r.value.reduce((a, x) => a + pick(x), 0) : null;
  return {
    text: fenceUntrusted(
      JSON.stringify({
        periodDays: days,
        listing: conn.locationTitle,
        businessProfile: cur.ok ? { thisPeriod: cur.value, previousPeriod: prev.ok ? prev.value : null } : { error: cur.error },
        searchTermsLastMonth: keywords.ok ? { month: keywords.value.month, terms: keywords.value.rows.slice(0, 15) } : { error: keywords.error },
        searchConsole: sc
          ? sc.ok
            ? { site: conn.searchConsoleSite, topSearches: sc.value, clicks: total(sc, (r) => r.clicks), previousPeriodClicks: total(scPrev, (r) => r.clicks) }
            : { error: sc.error }
          : "not connected",
        analytics: ga
          ? ga.ok
            ? { property: conn.ga4PropertyName, visits: total(ga, (r) => r.sessions), people: total(ga, (r) => r.users), previousPeriodVisits: total(gaPrev, (r) => r.sessions) }
            : { error: ga.error }
          : "not connected",
        notes: "Google's profile numbers lag by a few days. Search terms with small counts are reported as 'under N'.",
      }),
    ),
  };
}

export async function listGoogleReviewsTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  if (!getGoogleBusinessConnection(ctx.tenantId)?.locationName) {
    return { text: JSON.stringify({ error: "No Google Business Profile listing is connected. Connect it in Settings > Integrations > Google." }) };
  }
  let refreshNote: string | null = null;
  try {
    await syncGoogleReviews(ctx.tenantId);
  } catch (err) {
    refreshNote = `Could not refresh from Google (${why(err)}); showing the last copy.`;
  }
  const limit = Math.min(50, Math.max(1, Math.round(Number(input.limit) || 20)));
  const rows = listStoredReviews(ctx.tenantId)
    .filter((r) => (input.unansweredOnly ? !r.reply : true))
    .slice(0, limit);
  const summary = getReviewSummary(ctx.tenantId);
  return {
    text: fenceUntrusted(
      JSON.stringify({
        averageRating: summary?.average ?? null,
        totalReviews: summary?.total ?? null,
        reviews: rows.map((r) => ({
          id: r.id,
          reviewer: r.reviewer,
          rating: r.rating,
          text: r.comment || "(rating only)",
          date: r.reviewedAt.toISOString().slice(0, 10),
          reply: r.reply,
        })),
        note: refreshNote,
      }),
    ),
  };
}

/** WRITE: post a public reply to a review. Approve-gated. */
export async function replyToGoogleReviewTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const reviewId = Number(input.reviewId);
  const text = String(input.text ?? "").trim();
  if (!reviewId || !text) return { text: JSON.stringify({ error: "reviewId and text are required." }) };
  try {
    await replyToGoogleReview(ctx.tenantId, reviewId, text);
    return { text: JSON.stringify({ result: "Reply posted on Google.", reviewId }) };
  } catch (err) {
    return { text: JSON.stringify({ error: `Not posted: ${why(err)}` }) };
  }
}
