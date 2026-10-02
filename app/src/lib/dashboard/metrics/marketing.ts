/**
 * Marketing preset pure helpers (no DB, no server imports; tested in
 * marketing.test.ts). The loaders live in marketingQueries.ts.
 */

/** Cost per customer in whole cents; null when nobody converted. */
export function cacCents(spendCents: number, converts: number): number | null {
  return converts > 0 ? Math.round(spendCents / converts) : null;
}

/** Revenue / spend as a ratio rounded to one decimal; null when there is no spend. */
export function roasRatio(revenueCents: number, spendCents: number): number | null {
  return spendCents > 0 ? Math.round((revenueCents / spendCents) * 10) / 10 : null;
}

/** utm_source wins, then the referrer domain, else "Direct". */
export function sourceLabel(utm: string, referrer: string): string {
  return utm.trim() || referrer.trim() || "Direct";
}

export type UpcomingItem = { name: string; atMs: number; kind: "post" | "email" };

/** Merge scheduled social posts and emails by time and keep the soonest `limit`. */
export function mergeUpcoming(
  posts: { name: string; atMs: number }[],
  emails: { name: string; atMs: number }[],
  limit: number,
): UpcomingItem[] {
  return [
    ...posts.map((p): UpcomingItem => ({ ...p, kind: "post" })),
    ...emails.map((e): UpcomingItem => ({ ...e, kind: "email" })),
  ]
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, limit);
}

export type MoneyScore = { adSpendCents: number; converts: number; upfrontCashCents: number; mrrCents: number };

/**
 * Totals for the blended CAC and ROAS tiles. Only campaigns with recorded ad
 * spend count, so customers from an unspent campaign do not dilute either.
 */
export function blendedTotals(scores: MoneyScore[]): {
  spendCents: number;
  converts: number;
  revenueCents: number;
  campaigns: number;
} {
  const paid = scores.filter((s) => s.adSpendCents > 0);
  return {
    spendCents: paid.reduce((a, s) => a + s.adSpendCents, 0),
    converts: paid.reduce((a, s) => a + s.converts, 0),
    revenueCents: paid.reduce((a, s) => a + s.upfrontCashCents + s.mrrCents, 0),
    campaigns: paid.length,
  };
}
