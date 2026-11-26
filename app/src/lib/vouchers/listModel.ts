/**
 * Pure: the Gift vouchers list. Where each voucher stands (unused, part used,
 * used, expired, cancelled), the figures across the top of the page, and the
 * search and filters. Dates are "YYYY-MM-DD" (expiry) and ms (created), read
 * in Dublin time by the caller. No DB, no server-only.
 */

export type VoucherState = "unused" | "part" | "used" | "expired" | "cancelled";
export type StateFilter = "all" | VoucherState;
export type SourceFilter = "all" | "online" | "staff";

export const STATE_FILTERS: { key: StateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unused", label: "Unused" },
  { key: "part", label: "Part used" },
  { key: "used", label: "Used" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
];

export interface VoucherLike {
  code: string;
  valueEur: number;
  balanceEur: number | null;
  expiryDate: string;
  cancelledAt: number | null;
  createdAt: number;
  source: "staff" | "online";
  purchaserName: string;
  purchaserEmail: string | null;
  recipientName: string | null;
  buyerName?: string | null;
  recipientEmail?: string | null;
}

const EPS = 0.01;
const DAY = 86_400_000;

export const balanceOf = (v: VoucherLike) => v.balanceEur ?? v.valueEur;

export function voucherState(v: VoucherLike, today: string): VoucherState {
  if (v.cancelledAt != null) return "cancelled";
  const balance = balanceOf(v);
  if (balance <= EPS) return "used";
  if (v.expiryDate < today) return "expired";
  return balance < v.valueEur - EPS ? "part" : "unused";
}

/** Days until it expires (0 = today), or null once it is used, cancelled or past. */
export function daysLeft(v: VoucherLike, today: string): number | null {
  const s = voucherState(v, today);
  if (s !== "unused" && s !== "part") return null;
  return Math.round((Date.parse(`${v.expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

export const expiringSoon = (v: VoucherLike, today: string, within = 30) => {
  const d = daysLeft(v, today);
  return d != null && d <= within;
};

export interface VoucherFigures {
  /** Balance left on vouchers that can still be used: treatments the business owes. */
  owedEur: number;
  owedCount: number;
  soldCount: number;
  soldEur: number;
  usedEur: number;
  expiringCount: number;
}

/**
 * The four figures. `monthOf` turns a created time into "YYYY-MM" (Dublin);
 * `usedThisMonthEur` is the month's redemptions, summed by the caller.
 */
export function voucherFigures(vouchers: VoucherLike[], opts: { today: string; month: string; monthOf: (ms: number) => string; usedThisMonthEur: number }): VoucherFigures {
  const f: VoucherFigures = { owedEur: 0, owedCount: 0, soldCount: 0, soldEur: 0, usedEur: opts.usedThisMonthEur, expiringCount: 0 };
  for (const v of vouchers) {
    const s = voucherState(v, opts.today);
    if (s === "unused" || s === "part") {
      f.owedEur += balanceOf(v);
      f.owedCount++;
    }
    if (s !== "cancelled" && opts.monthOf(v.createdAt) === opts.month) {
      f.soldCount++;
      f.soldEur += v.valueEur;
    }
    if (expiringSoon(v, opts.today)) f.expiringCount++;
  }
  f.owedEur = Math.round(f.owedEur * 100) / 100;
  f.soldEur = Math.round(f.soldEur * 100) / 100;
  return f;
}

export function filterVouchers<T extends VoucherLike>(vouchers: T[], opts: { today: string; state?: StateFilter; source?: SourceFilter; expiring?: boolean; q?: string }): T[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return vouchers.filter((v) => {
    if (opts.state && opts.state !== "all" && voucherState(v, opts.today) !== opts.state) return false;
    if (opts.source && opts.source !== "all" && v.source !== opts.source) return false;
    if (opts.expiring && !expiringSoon(v, opts.today)) return false;
    if (!q) return true;
    return [v.code, v.purchaserName, v.purchaserEmail ?? "", v.recipientName ?? "", v.buyerName ?? "", v.recipientEmail ?? ""].join(" ").toLowerCase().includes(q);
  });
}

export function stateCounts(vouchers: VoucherLike[], today: string): Record<StateFilter, number> {
  const out: Record<StateFilter, number> = { all: vouchers.length, unused: 0, part: 0, used: 0, expired: 0, cancelled: 0 };
  for (const v of vouchers) out[voucherState(v, today)]++;
  return out;
}
