import "server-only";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { giftVouchers, payments, therapies, voucherRedemptions } from "@/lib/db/schema";
import { dublinDate, formatEuro, splitPayment, toCents, voucherState, type VoucherKind, type VoucherState } from "./model";
import { getVoucherByCode } from "./store";

/**
 * Taking a voucher at the desk. Every use is one voucher_redemptions row, and
 * the voucher's balance_eur moves in the same transaction as that row and
 * the payment rows, so balance always equals value less the redemptions.
 * Ambient `db` (a staff request).
 */

export interface VoucherLookup {
  id: number;
  code: string;
  kind: VoucherKind;
  therapyId: number | null;
  therapyName: string | null;
  purchaserName: string;
  recipientName: string | null;
  valueEur: number;
  balanceEur: number;
  expiryDate: string;
  state: VoucherState;
  /** Past its date: staff are warned, and may still take it. */
  expired: boolean;
}

export function lookupVoucher(code: string, today = dublinDate(Date.now())): VoucherLookup | null {
  const v = getVoucherByCode(code);
  if (!v) return null;
  const therapy = v.therapyId ? db.select({ name: therapies.name }).from(therapies).where(eq(therapies.id, v.therapyId)).get() : undefined;
  return {
    id: v.id,
    code: v.code,
    kind: v.kind,
    therapyId: v.therapyId,
    therapyName: therapy?.name ?? null,
    purchaserName: v.purchaserName,
    recipientName: v.recipientName,
    valueEur: v.valueEur,
    balanceEur: v.balanceEur,
    expiryDate: v.expiryDate,
    state: voucherState(v, today),
    expired: v.expiryDate < today,
  };
}

type OtherMethod = "cash" | "card" | "bank_transfer";
const OTHER_METHODS: readonly string[] = ["cash", "card", "bank_transfer"];

export interface VoucherUse {
  voucherId: number;
  /** Taken off the balance. */
  redemptionEur: number;
  /** The "voucher" payment row's amount. */
  paymentEur: number;
  clientId: number;
  appointmentId: number | null;
  packageId: number | null;
  userId: number | null;
  note: string | null;
  /** The rest of the price, paid another way, recorded as a second payment. */
  remainder: { amountEur: number; method: OtherMethod; note: string } | null;
}

/** The voucher no longer holds what this use takes. Thrown inside the transaction, so nothing is kept. */
export class VoucherBalanceError extends Error {
  constructor() {
    super("The voucher does not have enough balance left.");
    this.name = "VoucherBalanceError";
  }
}

/**
 * Payment rows, the redemption and the new balance, all or nothing. The
 * balance update only applies while the stored balance still covers the use,
 * so two uses can never overspend; otherwise it throws VoucherBalanceError
 * and the whole transaction is rolled back.
 */
export function recordVoucherUse(u: VoucherUse, now = Date.now()): { paymentId: number } {
  return db.transaction((tx) => {
    const [pay] = tx
      .insert(payments)
      .values({
        clientId: u.clientId,
        appointmentId: u.appointmentId,
        packageId: u.packageId,
        voucherId: u.voucherId,
        amountEur: u.paymentEur,
        paymentMethod: "voucher",
        notes: u.note,
      })
      .returning({ id: payments.id })
      .all();
    if (u.remainder && toCents(u.remainder.amountEur) > 0) {
      tx.insert(payments)
        .values({
          clientId: u.clientId,
          appointmentId: u.appointmentId,
          packageId: u.packageId,
          voucherId: null,
          amountEur: u.remainder.amountEur,
          paymentMethod: u.remainder.method,
          notes: u.remainder.note,
        })
        .run();
    }
    tx.insert(voucherRedemptions)
      .values({
        voucherId: u.voucherId,
        amountEur: u.redemptionEur,
        appointmentId: u.appointmentId,
        paymentId: pay!.id,
        redeemedByUserId: u.userId,
        createdAt: now,
      })
      .run();
    const updated = tx
      .update(giftVouchers)
      .set({
        balanceEur: sql`max(0, round((${giftVouchers.balanceEur} - ${u.redemptionEur}) * 100) / 100.0)`,
        isRedeemed: sql`case when round((${giftVouchers.balanceEur} - ${u.redemptionEur}) * 100) <= 0 then 1 else 0 end`,
        redeemedByClientId: sql`coalesce(${giftVouchers.redeemedByClientId}, ${u.clientId})`,
        redeemedAt: new Date(now),
      })
      .where(and(eq(giftVouchers.id, u.voucherId), sql`round(${giftVouchers.balanceEur} * 100) >= ${toCents(u.redemptionEur)}`))
      .run();
    if (updated.changes !== 1) throw new VoucherBalanceError();
    return { paymentId: pay!.id };
  });
}

export type RedeemResult =
  | { ok: true; voucherEur: number; remainderEur: number; paymentId: number; expired: boolean }
  | { ok: false; error: string };

/**
 * A booking paid with a voucher. A money voucher pays up to its balance; a
 * treatment voucher pays for one session of its treatment at today's price
 * and is used up. Anything left is recorded as a second payment by
 * `secondaryMethod`. Nothing is written when it is refused.
 */
export function redeemAtBooking(input: {
  code: string;
  clientId: number;
  appointmentId: number;
  priceEur: number;
  therapyIds: readonly number[];
  secondaryMethod: string | null;
  userId: number | null;
  now?: number;
}): RedeemResult {
  const now = input.now ?? Date.now();
  const v = lookupVoucher(input.code, dublinDate(now));
  if (!v) return { ok: false, error: "Voucher not found." };
  if (v.state === "cancelled") return { ok: false, error: "This voucher was cancelled." };
  if (v.state === "used") return { ok: false, error: "This voucher has been used." };
  if (toCents(input.priceEur) <= 0) return { ok: false, error: "This booking has no price, so there is nothing for the voucher to pay." };

  let treatmentPrice: number | null = null;
  if (v.kind === "treatment") {
    if (!v.therapyId || !input.therapyIds.includes(v.therapyId)) {
      return { ok: false, error: `This voucher is for ${v.therapyName ?? "a different treatment"}.` };
    }
    treatmentPrice = db.select({ p: therapies.defaultPriceEur }).from(therapies).where(eq(therapies.id, v.therapyId)).get()?.p ?? null;
  }
  const split = splitPayment({ kind: v.kind, balanceEur: v.balanceEur }, input.priceEur, treatmentPrice);
  // A treatment voucher whose treatment has no price on file pays nothing: refuse rather than use it up for free.
  if (v.kind === "treatment" && toCents(split.voucherEur) <= 0) {
    return { ok: false, error: "This voucher cannot be applied: the treatment has no price." };
  }
  const method = input.secondaryMethod ?? "";
  if (split.remainderEur > 0 && !OTHER_METHODS.includes(method)) {
    return {
      ok: false,
      error: `The voucher pays ${formatEuro(split.voucherEur)} of ${formatEuro(input.priceEur)}. Choose how the other ${formatEuro(split.remainderEur)} is paid.`,
    };
  }
  let paymentId: number;
  try {
    ({ paymentId } = recordVoucherUse(
    {
      voucherId: v.id,
      redemptionEur: split.redemptionEur,
      paymentEur: split.voucherEur,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      packageId: null,
      userId: input.userId,
      note: `Voucher ${v.code}`,
      remainder: split.remainderEur > 0 ? { amountEur: split.remainderEur, method: method as OtherMethod, note: `Rest after voucher ${v.code}` } : null,
    },
    now,
    ));
  } catch (err) {
    // Another use took the balance since it was read: nothing was written.
    if (err instanceof VoucherBalanceError) return { ok: false, error: "This voucher does not have enough balance left." };
    throw err;
  }
  return { ok: true, voucherEur: split.voucherEur, remainderEur: split.remainderEur, paymentId, expired: v.expired };
}
