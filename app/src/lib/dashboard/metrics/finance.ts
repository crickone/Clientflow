/**
 * Finance preset pure helpers (no DB, no server imports; tested in
 * finance.test.ts). The loaders live in financeQueries.ts.
 */
import { bucketIndex, pct, type Bucket } from "./stats";

export type PaymentMethod = "cash" | "card" | "voucher" | "bank_transfer" | "package";

/** Methods that are money received. Voucher and package payments are redemptions of money counted when sold. */
export const REVENUE_METHODS: readonly PaymentMethod[] = ["cash", "card", "bank_transfer"];

export function isRevenueMethod(method: string): boolean {
  return (REVENUE_METHODS as readonly string[]).includes(method);
}

export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  voucher: "Voucher redeemed",
  package: "Package credit",
};

export type PaymentRow = { clientId: number; amount: number; method: string; atMs: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sum and count of revenue payments, plus distinct paying clients. */
export function revenueSummary(rows: PaymentRow[]): { total: number; count: number; clients: number } {
  let total = 0;
  let count = 0;
  const clients = new Set<number>();
  for (const r of rows) {
    if (!isRevenueMethod(r.method)) continue;
    total += r.amount;
    count++;
    clients.add(r.clientId);
  }
  return { total: round2(total), count, clients: clients.size };
}

/** Revenue per bucket, in bucket order. */
export function revenueByBucket(rows: PaymentRow[], buckets: Bucket[]): number[] {
  const out = new Array<number>(buckets.length).fill(0);
  for (const r of rows) {
    if (!isRevenueMethod(r.method)) continue;
    const i = bucketIndex(buckets, r.atMs);
    if (i >= 0) out[i] += r.amount;
  }
  return out.map(round2);
}

/** All payments grouped by method (largest first), labelled for people. */
export function methodTotals(rows: PaymentRow[]): { label: string; value: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.method, (by.get(r.method) ?? 0) + r.amount);
  return [...by]
    .map(([m, v]) => ({ label: METHOD_LABELS[m] ?? m, value: round2(v) }))
    .sort((a, b) => b.value - a.value);
}

/** Revenue per client, largest first, capped at `limit`. */
export function topSpenders(rows: PaymentRow[], limit: number): { clientId: number; total: number }[] {
  const by = new Map<number, number>();
  for (const r of rows) {
    if (isRevenueMethod(r.method)) by.set(r.clientId, (by.get(r.clientId) ?? 0) + r.amount);
  }
  return [...by]
    .map(([clientId, total]) => ({ clientId, total: round2(total) }))
    .sort((a, b) => b.total - a.total || a.clientId - b.clientId)
    .slice(0, limit);
}

/** Therapy ids from a JSON text column; anything malformed is an empty list. */
export function parseTherapyIds(text: string | null | undefined): number[] {
  if (!text) return [];
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

/** Split an amount evenly across therapies; no therapies puts it all on a null id. Parts sum to the total. */
export function splitAcrossTherapies(total: number, ids: number[]): { id: number | null; amount: number }[] {
  if (ids.length === 0) return [{ id: null, amount: round2(total) }];
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / ids.length);
  const extra = cents - base * ids.length;
  return ids.map((id, i) => ({ id, amount: (base + (i < extra ? 1 : 0)) / 100 }));
}

/** Memberships that ended in the period as a share of those active at its start. */
export function churnPct(ended: number, activeAtStart: number): number | null {
  return pct(ended, activeAtStart);
}

/** Whether a membership was active at an instant (created before it, not yet ended). */
export function wasActiveAt(m: { createdAtMs: number; endedAtMs: number | null }, atMs: number): boolean {
  return m.createdAtMs < atMs && (m.endedAtMs === null || m.endedAtMs >= atMs);
}

/** Memberships gained (created) and lost (ended) per bucket. */
export function gainedLostByBucket(
  created: number[],
  ended: number[],
  buckets: Bucket[],
): { label: string; Gained: number; Lost: number }[] {
  const out = buckets.map((b) => ({ label: b.label, Gained: 0, Lost: 0 }));
  for (const ms of created) {
    const i = bucketIndex(buckets, ms);
    if (i >= 0) out[i].Gained++;
  }
  for (const ms of ended) {
    const i = bucketIndex(buckets, ms);
    if (i >= 0) out[i].Lost++;
  }
  return out;
}
