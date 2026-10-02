/**
 * Competitors preset pure helpers (no DB, no server imports; tested in
 * competitors.test.ts). The loaders live in competitorsQueries.ts.
 */
import { addDaysIso, dublinIso, weekBounds } from "./stats";

/** Mean of the non-null counts, or null when there is nothing to average. */
export function averageCount(counts: (number | null)[]): number | null {
  const xs = counts.filter((c): c is number => c !== null);
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** "4 stars" / "1 star" / "4.5 stars" from a milli rating; empty when unrated. */
export function starsLabel(ratingMilli: number | null): string {
  if (ratingMilli === null) return "";
  const stars = Math.round(ratingMilli / 100) / 10;
  return `${stars} ${stars === 1 ? "star" : "stars"}`;
}

/** Events of one type whose ISO `occurredAt` falls in [fromMs, toMs). */
export function eventsInRange(events: { type: string; occurredAt: string }[], type: string, fromMs: number, toMs: number): number {
  let n = 0;
  for (const e of events) {
    if (e.type !== type) continue;
    const ms = Date.parse(e.occurredAt);
    if (Number.isFinite(ms) && ms >= fromMs && ms < toMs) n++;
  }
  return n;
}

/**
 * Reviews gained across a range: the latest review count at or before `toMs`
 * minus the baseline. The baseline is the latest count at or before `fromMs`;
 * when the competitor was not tracked that early, the earliest capture inside
 * the range stands in and `sinceTracked` is true. Null when fewer than two
 * captures exist in or before the range.
 */
export function reviewsGained(
  history: { capturedAt: string; reviewCount: number | null }[],
  fromMs: number,
  toMs: number,
): { gained: number; sinceTracked: boolean } | null {
  const pts: { ms: number; n: number }[] = [];
  for (const h of history) {
    if (h.reviewCount === null) continue;
    const ms = Date.parse(h.capturedAt);
    if (Number.isFinite(ms) && ms <= toMs) pts.push({ ms, n: h.reviewCount });
  }
  if (pts.length < 2) return null;
  pts.sort((a, b) => a.ms - b.ms);
  const end = pts[pts.length - 1];
  let startIdx = -1;
  pts.forEach((p, i) => {
    if (p.ms <= fromMs) startIdx = i;
  });
  const sinceTracked = startIdx === -1;
  const start = sinceTracked ? pts[0] : pts[startIdx];
  if (start === end) return null;
  return { gained: end.n - start.n, sinceTracked };
}

/** Signed count for display: "+4", "0", "-2". */
export function signedCount(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

export type RatingSeries = { name: string; points: { capturedAt: string; rating: number }[] };

/**
 * Merge several rating histories into one chart table, one row per Dublin
 * week (Monday ISO date in `week`, short label in `label`), ascending. A
 * competitor with several captures in a week keeps the latest. Duplicate
 * names get a numeric suffix so they stay separate lines.
 */
export function mergeRatingSeries(series: RatingSeries[]): { data: Record<string, string | number>[]; names: string[] } {
  const seen = new Map<string, number>();
  const names = series.map((s) => {
    const n = (seen.get(s.name) ?? 0) + 1;
    seen.set(s.name, n);
    return n === 1 ? s.name : `${s.name} (${n})`;
  });
  const weeks = new Map<string, Record<string, string | number>>();
  const latest = new Map<string, number>();
  series.forEach((s, i) => {
    for (const p of s.points) {
      const ms = Date.parse(p.capturedAt);
      if (!Number.isFinite(ms)) continue;
      const week = weekBounds(dublinIso(ms)).mon;
      const row = weeks.get(week) ?? { week, label: weekLabel(week) };
      const k = `${i}|${week}`;
      if (latest.get(k) === undefined || ms >= latest.get(k)!) {
        row[names[i]] = p.rating;
        latest.set(k, ms);
      }
      weeks.set(week, row);
    }
  });
  const data = [...weeks.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)));
  return { data, names };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function weekLabel(iso: string): string {
  const d = new Date(`${addDaysIso(iso, 0)}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Newest `limit` items by ISO `publishedAt`; items with no date go last. */
export function newestReviews<T extends { publishedAt: string | null }>(items: T[], limit: number): T[] {
  const t = (x: T) => (x.publishedAt ? Date.parse(x.publishedAt) || 0 : -1);
  return [...items].sort((a, b) => t(b) - t(a)).slice(0, limit);
}
