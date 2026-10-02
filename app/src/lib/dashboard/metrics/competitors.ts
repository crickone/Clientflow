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
 * minus the latest at or before `fromMs`. Null when either bound has no
 * captured count (the competitor was not tracked that early).
 */
export function reviewsGained(history: { capturedAt: string; reviewCount: number | null }[], fromMs: number, toMs: number): number | null {
  const at = (limit: number): number | null => {
    let best: { ms: number; n: number } | null = null;
    for (const h of history) {
      if (h.reviewCount === null) continue;
      const ms = Date.parse(h.capturedAt);
      if (!Number.isFinite(ms) || ms > limit) continue;
      if (best === null || ms >= best.ms) best = { ms, n: h.reviewCount };
    }
    return best === null ? null : best.n;
  };
  const end = at(toMs);
  const start = at(fromMs);
  return end === null || start === null ? null : end - start;
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
