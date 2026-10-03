import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { postTotals, topPosts } from "@/lib/dashboard/metrics/social";
import { getReach, getSocialAccounts, getSocialPosts, hasSocialConnection } from "@/lib/social/metrics";
import { fenceUntrusted, type ToolContext, type ToolResult } from "@/lib/agents/toolKit";

/**
 * READ-ONLY: the business's Facebook Page + Instagram numbers for a period
 * (lib/social/metrics, live from Meta). No approval gate.
 */
export const SOCIAL_METRICS_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_social_metrics",
    description:
      "Facebook Page and Instagram numbers for the last N days (default 30): followers, Instagram reach and profile views, Facebook views, post engagement per channel, and the best posts. Compare against the previous period of the same length when asked how something is trending.",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", description: "1-90, default 30." } },
    },
  },
];

export async function getSocialMetricsTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  if (!hasSocialConnection(ctx.tenantId)) {
    return { text: JSON.stringify({ error: "No Facebook Page is connected. Connect it in Settings > Integrations > Facebook." }) };
  }
  const days = Math.min(90, Math.max(1, Math.round(Number(input.days) || 30)));
  const toMs = Date.now();
  const fromMs = toMs - days * 86_400_000;
  const prevFrom = fromMs - days * 86_400_000;
  const [accounts, reach, prevReach, posts, prevPosts] = await Promise.all([
    getSocialAccounts(ctx.tenantId),
    getReach(ctx.tenantId, fromMs, toMs),
    getReach(ctx.tenantId, prevFrom, fromMs),
    getSocialPosts(ctx.tenantId, fromMs, toMs),
    getSocialPosts(ctx.tenantId, prevFrom, fromMs),
  ]);
  const totals = postTotals(posts);
  const prevTotals = postTotals(prevPosts);
  return {
    text: fenceUntrusted(
      JSON.stringify({
        periodDays: days,
        accounts,
        reach,
        previousPeriodReach: prevReach,
        engagement: totals,
        previousPeriodEngagement: { posts: prevTotals.posts, engagement: prevTotals.engagement },
        bestPosts: topPosts(posts, 5).map((p) => ({
          channel: p.channel,
          text: p.text.slice(0, 200),
          date: new Date(p.createdAt).toISOString().slice(0, 10),
          likes: p.likes,
          comments: p.comments,
          shares: p.shares,
          link: p.permalink,
        })),
        notes: "Numbers Meta did not report are null. Followers are today's count.",
      }),
    ),
  };
}
