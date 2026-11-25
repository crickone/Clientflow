import "server-only";

import { and, eq, inArray, isNull, notLike, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { giftVouchers, payments, voucherRedemptions } from "@/lib/db/schema";

/**
 * Remove the payment a booking recorded, when the booking is cancelled or
 * deleted.
 *
 * A desk booking writes its payment row the moment it is made, before any
 * money changes hands. Cancelling or deleting the booking used to leave that
 * row behind, so a cancelled €80 "voucher" booking still counted as €80 spent
 * and moved the client to Repeat customer. A coded gift voucher it drew on
 * gets that amount back. Online payments (Stripe, "Online: ..." notes) are
 * never touched: that money really was taken.
 *
 * Returns how many payment rows were removed.
 */
export function voidBookingPayments(appointmentId: number): number {
  return db.transaction((tx) => {
    const rows = tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.appointmentId, appointmentId), or(isNull(payments.notes), notLike(payments.notes, "Online:%"))))
      .all();
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    const uses = tx.select().from(voucherRedemptions).where(inArray(voucherRedemptions.paymentId, ids)).all();
    for (const u of uses) {
      tx.update(giftVouchers)
        .set({
          balanceEur: sql`round((${giftVouchers.balanceEur} + ${u.amountEur}) * 100) / 100.0`,
          isRedeemed: false,
        })
        .where(eq(giftVouchers.id, u.voucherId))
        .run();
    }
    if (uses.length) tx.delete(voucherRedemptions).where(inArray(voucherRedemptions.paymentId, ids)).run();
    tx.delete(payments).where(inArray(payments.id, ids)).run();
    return ids.length;
  });
}
