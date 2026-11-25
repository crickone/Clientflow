/**
 * Pure: what a gift voucher typed at the desk pays towards this booking.
 * The same sum the server does in lib/vouchers/redeem (redeemAtBooking):
 * a money voucher up to its balance; a treatment voucher the session price up
 * to the treatment's listed price, and only for that treatment.
 */

/** GET /api/vouchers/<code> */
export interface VoucherLookupResponse {
  ok: boolean;
  empty?: boolean;
  cancelled?: boolean;
  expired?: boolean;
  kind?: "amount" | "treatment";
  balanceEur?: number;
  therapyId?: number | null;
  therapyName?: string | null;
  recipientName?: string | null;
  expiryDate?: string;
}

export type VoucherInfo =
  | { state: "idle" | "invalid" | "empty" | "cancelled" }
  | {
      state: "valid";
      kind: "amount" | "treatment";
      balance: number;
      therapyId: number | null;
      therapyName: string | null;
      recipientName: string | null;
      expiryDate: string;
      expired: boolean;
    };

export function voucherInfoFrom(d: VoucherLookupResponse): VoucherInfo {
  if (!d.ok) return { state: "invalid" };
  if (d.cancelled) return { state: "cancelled" };
  if (d.empty) return { state: "empty" };
  return {
    state: "valid",
    kind: d.kind === "treatment" ? "treatment" : "amount",
    balance: d.balanceEur ?? 0,
    therapyId: d.therapyId ?? null,
    therapyName: d.therapyName ?? null,
    recipientName: d.recipientName ?? null,
    expiryDate: d.expiryDate ?? "",
    expired: d.expired === true,
  };
}

export interface VoucherCoverage {
  /** Euros the voucher pays towards this session. */
  covers: number;
  /** A treatment voucher for some other treatment. */
  wrongTreatment: boolean;
  /** A treatment voucher whose treatment has no listed price: the server refuses it. */
  noPrice: boolean;
  /** The voucher pays part; the rest needs a second payment method. */
  needsSplit: boolean;
}

export function voucherCoverage(info: VoucherInfo, therapyId: number | null, price: number, listPrice: number): VoucherCoverage {
  if (info.state !== "valid") return { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false };
  const wrongTreatment = info.kind === "treatment" && info.therapyId !== therapyId;
  const covers = info.kind === "treatment" ? (wrongTreatment ? 0 : Math.min(price, listPrice)) : Math.min(info.balance, price);
  const noPrice = info.kind === "treatment" && !wrongTreatment && covers <= 0;
  const needsSplit = !wrongTreatment && !noPrice && price > 0 && covers < price;
  return { covers, wrongTreatment, noPrice, needsSplit };
}
