/**
 * Content & Social preset pure helpers (no DB, no server imports; tested in
 * content.test.ts). The loaders live in contentQueries.ts.
 */

const CHANNEL_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook" };
const CHANNEL_ORDER = ["instagram", "facebook"];

/** Channels from the scheduled_posts JSON column; anything malformed is an empty list. */
export function parseChannels(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Posts per channel, largest first. A post on two channels counts once on each. */
export function channelCounts(channelColumns: (string | null | undefined)[]): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const col of channelColumns) {
    for (const c of new Set(parseChannels(col))) by.set(c, (by.get(c) ?? 0) + 1);
  }
  return [...by]
    .map(([c, value]) => ({ label: CHANNEL_LABELS[c] ?? c, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

const rank = (c: string) => (CHANNEL_ORDER.includes(c) ? CHANNEL_ORDER.indexOf(c) : CHANNEL_ORDER.length);

/** "Instagram and Facebook" for a post's channels column. */
export function channelsLabel(text: string | null | undefined): string {
  const names = [...new Set(parseChannels(text))]
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => CHANNEL_LABELS[c] ?? c);
  if (names.length === 0) return "no channel";
  return names.join(" and ");
}

export type CalendarItem = { kind: "post" | "blog"; name: string; atMs: number; channels?: string };

/** Merge scheduled posts and scheduled blog posts by time, soonest first. */
export function mergeCalendar(
  posts: { name: string; atMs: number; channels: string }[],
  blogs: { name: string; atMs: number }[],
  limit: number,
): CalendarItem[] {
  return [
    ...posts.map((p): CalendarItem => ({ kind: "post", ...p })),
    ...blogs.map((b): CalendarItem => ({ kind: "blog", ...b })),
  ]
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, limit);
}

/** Cut text to `max` characters, ending in an ellipsis when it was cut. */
export function truncateText(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** What a design's generation status means to an operator. */
export function generationLabel(status: string | null | undefined): string {
  if (status === "writing") return "Generating";
  if (status === "failed") return "Generation failed";
  return "Ready";
}
