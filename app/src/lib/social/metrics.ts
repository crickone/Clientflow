import "server-only";

import { gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { socialFollowersDaily } from "@/lib/db/schema";
import { GRAPH_BASE } from "@/lib/facebook/graph";
import { getPostingPage } from "@/lib/facebook/pages";
import { getPreferredPostingPageId } from "./publisher";

/**
 * Facebook Page + Instagram metrics for the dashboard and Adonis, read live
 * from the Graph API with the connected Page's token (read_insights,
 * instagram_manage_insights, instagram_basic). FAIL-SOFT: Meta renames and
 * retires insight metrics regularly, and a permission may not be granted yet,
 * so every call returns null / [] on failure instead of throwing, and the
 * widgets say "not available" rather than break the dashboard. Results are
 * cached in-process for 10 minutes per tenant + query.
 */

export interface SocialPost {
  channel: "facebook" | "instagram";
  id: string;
  text: string;
  createdAt: number;
  permalink: string | null;
  likes: number;
  comments: number;
  shares: number;
  /** likes + comments + shares: the like-for-like engagement count across both. */
  engagement: number;
}

export interface SocialAccounts {
  facebook: { pageId: string; name: string | null; followers: number | null } | null;
  instagram: { igUserId: string; username: string | null; followers: number | null; mediaCount: number | null } | null;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();

async function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

async function get<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${path}?` + new URLSearchParams({ ...params, access_token: token }));
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function page(tenantId: number) {
  return getPostingPage(tenantId, getPreferredPostingPageId(tenantId));
}

/** Whether the tenant has a connected Page to read metrics from. */
export function hasSocialConnection(tenantId: number): boolean {
  return page(tenantId) !== null;
}

export async function getSocialAccounts(tenantId: number): Promise<SocialAccounts> {
  const p = page(tenantId);
  if (!p) return { facebook: null, instagram: null };
  return memo(`${tenantId}:accounts`, async () => {
    const fb = await get<{ name?: string; followers_count?: number; fan_count?: number }>(p.pageId, p.pageAccessToken, { fields: "name,followers_count,fan_count" });
    let instagram: SocialAccounts["instagram"] = null;
    if (p.igUserId) {
      const ig = await get<{ username?: string; followers_count?: number; media_count?: number }>(p.igUserId, p.pageAccessToken, { fields: "username,followers_count,media_count" });
      instagram = { igUserId: p.igUserId, username: ig?.username ?? null, followers: ig?.followers_count ?? null, mediaCount: ig?.media_count ?? null };
    }
    return {
      facebook: { pageId: p.pageId, name: fb?.name ?? p.pageName ?? null, followers: fb?.followers_count ?? fb?.fan_count ?? null },
      instagram,
    };
  });
}

type Count = { summary?: { total_count?: number } };

/** Posts from both accounts published in [fromMs, toMs), newest first (capped at 100 per account). */
export async function getSocialPosts(tenantId: number, fromMs: number, toMs: number): Promise<SocialPost[]> {
  const p = page(tenantId);
  if (!p) return [];
  return memo(`${tenantId}:posts:${fromMs}:${toMs}`, async () => {
    const since = String(Math.floor(fromMs / 1000));
    const until = String(Math.floor(toMs / 1000));
    const out: SocialPost[] = [];

    const fb = await get<{ data?: Array<{ id: string; message?: string; created_time: string; permalink_url?: string; reactions?: Count; comments?: Count; shares?: { count?: number } }> }>(
      `${p.pageId}/posts`,
      p.pageAccessToken,
      { fields: "id,message,created_time,permalink_url,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares", since, until, limit: "100" },
    );
    for (const post of fb?.data ?? []) {
      const likes = post.reactions?.summary?.total_count ?? 0;
      const comments = post.comments?.summary?.total_count ?? 0;
      const shares = post.shares?.count ?? 0;
      out.push({ channel: "facebook", id: post.id, text: post.message ?? "", createdAt: Date.parse(post.created_time), permalink: post.permalink_url ?? null, likes, comments, shares, engagement: likes + comments + shares });
    }

    if (p.igUserId) {
      const ig = await get<{ data?: Array<{ id: string; caption?: string; timestamp: string; permalink?: string; like_count?: number; comments_count?: number }> }>(
        `${p.igUserId}/media`,
        p.pageAccessToken,
        { fields: "id,caption,timestamp,permalink,like_count,comments_count", since, until, limit: "100" },
      );
      for (const m of ig?.data ?? []) {
        const at = Date.parse(m.timestamp);
        if (at < fromMs || at >= toMs) continue;
        const likes = m.like_count ?? 0;
        const comments = m.comments_count ?? 0;
        out.push({ channel: "instagram", id: m.id, text: m.caption ?? "", createdAt: at, permalink: m.permalink ?? null, likes, comments, shares: 0, engagement: likes + comments });
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  });
}

export interface ReachSummary {
  /** Instagram accounts reached in the period (null when Meta did not report it). */
  instagramReach: number | null;
  instagramProfileViews: number | null;
  /** Facebook Page: times its content was viewed in the period (null when not available). */
  facebookViews: number | null;
}

/** Sum a daily total_value metric over a window, in Meta's max-30-day chunks. */
async function sumInsight(objectId: string, token: string, metric: string, fromMs: number, toMs: number, extra: Record<string, string>): Promise<number | null> {
  const DAY = 86_400_000;
  let total = 0;
  let any = false;
  for (let start = fromMs; start < toMs; start += 30 * DAY) {
    const end = Math.min(toMs, start + 30 * DAY);
    const r = await get<{ data?: Array<{ name: string; total_value?: { value?: number }; values?: Array<{ value?: number }> }> }>(`${objectId}/insights`, token, {
      metric,
      period: "day",
      since: String(Math.floor(start / 1000)),
      until: String(Math.floor(end / 1000)),
      ...extra,
    });
    const row = r?.data?.[0];
    if (!row) continue;
    any = true;
    total += row.total_value?.value ?? (row.values ?? []).reduce((s, v) => s + (Number(v.value) || 0), 0);
  }
  return any ? total : null;
}

export async function getReach(tenantId: number, fromMs: number, toMs: number): Promise<ReachSummary> {
  const p = page(tenantId);
  if (!p) return { instagramReach: null, instagramProfileViews: null, facebookViews: null };
  return memo(`${tenantId}:reach:${fromMs}:${toMs}`, async () => {
    const [instagramReach, instagramProfileViews, facebookViews] = await Promise.all([
      p.igUserId ? sumInsight(p.igUserId, p.pageAccessToken, "reach", fromMs, toMs, { metric_type: "total_value" }) : Promise.resolve(null),
      p.igUserId ? sumInsight(p.igUserId, p.pageAccessToken, "profile_views", fromMs, toMs, { metric_type: "total_value" }) : Promise.resolve(null),
      // Meta replaced Page impressions with media views (2025); try the new
      // metric first and fall back for Pages still reporting the old one.
      sumInsight(p.pageId, p.pageAccessToken, "page_media_view", fromMs, toMs, {}).then((v) => v ?? sumInsight(p.pageId, p.pageAccessToken, "page_impressions", fromMs, toMs, {})),
    ]);
    return { instagramReach, instagramProfileViews, facebookViews };
  });
}

/**
 * Store today's follower counts (UTC day) for the ambient tenant. Called by the
 * daily job and on dashboard load; one row per day per channel, last write wins.
 */
export async function recordFollowerSnapshot(tenantId: number): Promise<void> {
  const accounts = await getSocialAccounts(tenantId);
  const day = new Date().toISOString().slice(0, 10);
  const rows: Array<{ channel: string; followers: number }> = [];
  if (accounts.facebook?.followers != null) rows.push({ channel: "facebook", followers: accounts.facebook.followers });
  if (accounts.instagram?.followers != null) rows.push({ channel: "instagram", followers: accounts.instagram.followers });
  for (const r of rows) {
    db.insert(socialFollowersDaily)
      .values({ day, ...r })
      .onConflictDoUpdate({ target: [socialFollowersDaily.day, socialFollowersDaily.channel], set: { followers: r.followers } })
      .run();
  }
}

/** Follower snapshots from `sinceDay` (inclusive) on, for the ambient tenant. */
export function listFollowerRows(sinceDay: string): Array<{ day: string; channel: string; followers: number }> {
  return db.select().from(socialFollowersDaily).where(gte(socialFollowersDaily.day, sinceDay)).all();
}
