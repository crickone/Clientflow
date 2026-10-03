/**
 * Pure helpers for the Social dashboard: follower change from the daily
 * snapshots, the follower chart series, and post engagement totals. No I/O.
 */

export interface FollowerRow {
  day: string; // YYYY-MM-DD
  channel: string; // "facebook" | "instagram"
  followers: number;
}

/**
 * Followers at the end of a window and the change across it: the last snapshot
 * on or before `toDay` against the last snapshot before `fromDay` (or the
 * earliest one inside the window when tracking started mid-window). Null when
 * there is no snapshot at all.
 */
export function followerChange(rows: FollowerRow[], channel: string, fromDay: string, toDay: string): { now: number; change: number | null; sinceDay: string | null } | null {
  const mine = rows.filter((r) => r.channel === channel && r.day <= toDay).sort((a, b) => a.day.localeCompare(b.day));
  if (mine.length === 0) return null;
  const end = mine[mine.length - 1];
  const before = mine.filter((r) => r.day < fromDay).pop();
  const base = before ?? mine.find((r) => r.day >= fromDay && r.day !== end.day) ?? null;
  return { now: end.followers, change: base ? end.followers - base.followers : null, sinceDay: base ? base.day : null };
}

/** One point per day with a column per channel, for SeriesChart. */
export function followerSeries(rows: FollowerRow[], fromDay: string, toDay: string): Array<Record<string, string | number>> {
  const byDay = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    if (r.day < fromDay || r.day > toDay) continue;
    const point = byDay.get(r.day) ?? { label: r.day.slice(5) };
    point[r.channel] = r.followers;
    byDay.set(r.day, point);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p);
}

export interface PostLike {
  channel: "facebook" | "instagram";
  engagement: number;
  createdAt: number;
}

export function postTotals(posts: PostLike[]): { posts: number; engagement: number; average: number | null; byChannel: Record<"facebook" | "instagram", { posts: number; engagement: number }> } {
  const byChannel = { facebook: { posts: 0, engagement: 0 }, instagram: { posts: 0, engagement: 0 } };
  for (const p of posts) {
    byChannel[p.channel].posts += 1;
    byChannel[p.channel].engagement += p.engagement;
  }
  const engagement = byChannel.facebook.engagement + byChannel.instagram.engagement;
  return { posts: posts.length, engagement, average: posts.length ? Math.round((engagement / posts.length) * 10) / 10 : null, byChannel };
}

/** The best posts by engagement, ties broken by recency. */
export function topPosts<T extends PostLike>(posts: T[], n: number): T[] {
  return posts.slice().sort((a, b) => b.engagement - a.engagement || b.createdAt - a.createdAt).slice(0, n);
}

/** A UTC YYYY-MM-DD for a timestamp. */
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
