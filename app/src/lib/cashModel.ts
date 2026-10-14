/**
 * Money taken, by day, for Reports. Days are Irish calendar days (a payment
 * at 00:30 on 1 November counts on 1 November, not 31 October in UTC).
 * Pure, so the bucketing can be tested.
 */

export function dublinDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/** Sum amounts into each day from `start` to `end` (ISO dates, inclusive), zero-filled. */
export function bucketByDay(rows: { at: number; amount: number }[], start: string, end: string): { day: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const d = dublinDay(r.at);
    if (d < start || d > end) continue;
    totals.set(d, (totals.get(d) ?? 0) + r.amount);
  }
  const out: { day: string; total: number }[] = [];
  const cur = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    const key = cur.toISOString().slice(0, 10);
    out.push({ day: key, total: Math.round((totals.get(key) ?? 0) * 100) / 100 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Millisecond bounds wide enough to cover every Irish day in [start, end]; bucketByDay trims the edges. */
export function rangeBoundsMs(start: string, end: string): { from: number; to: number } {
  const DAY = 86_400_000;
  return { from: Date.parse(`${start}T00:00:00Z`) - DAY, to: Date.parse(`${end}T23:59:59Z`) + DAY };
}
