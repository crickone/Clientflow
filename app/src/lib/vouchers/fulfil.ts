import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { giftVouchers, voucherOrders, type Voucher } from "@/lib/db/schema";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { logActivity } from "@/lib/queries";
import { notifyVoucherSale } from "@/lib/notifications/notify";
import type { CheckoutSession } from "@/lib/stripe/api";
import { codePrefix, dublinDate, expiryDate, voucherTitle } from "./model";
import {
  cancelVoucher,
  getStoreSettings,
  getVoucherById,
  getVoucherOrder,
  markDelivered,
  failDelivery,
  newViewToken,
  newVoucherCode,
  setVoucherOrderStatus,
  therapyName,
  voucherOrderForPaymentIntent,
  voucherOrderForSession,
} from "./store";
import { sendVoucherEmail, type VoucherMailer } from "./email";
import { deliverGift, sendReceipt } from "./deliver";

export type FulfilStatus = "fulfilled" | "already" | "unpaid" | "not_found" | "mismatch";

/**
 * A paid Checkout becomes a gift voucher. Reached from the Stripe webhook AND
 * from the buyer's return to /vouchers, whichever is first. The order is
 * claimed with one conditional UPDATE (pending/expired -> paid) inside the
 * same transaction that writes the voucher, so the two callers can never
 * both make one, and a claim never stands without its voucher.
 *
 * Then: the buyer's receipt (always, with the voucher link), and the gift
 * email at once when the buyer chose "now". A dated gift is left for the
 * dispatch ticker (deliver.ts).
 */
export async function fulfilVoucherCheckout(
  tenantId: number,
  accountId: string,
  session: CheckoutSession,
  send: VoucherMailer = sendVoucherEmail,
  now = Date.now(),
): Promise<{ status: FulfilStatus; orderId?: number; voucherId?: number }> {
  return runWithTenant(tenantId, async () => {
    const order =
      voucherOrderForSession(session.id) ?? (session.client_reference_id ? getVoucherOrder(Number(session.client_reference_id)) : null);
    if (!order || order.stripeAccountId !== accountId) return { status: "not_found" as const };
    if (order.status === "paid" || order.status === "refunded") return { status: "already" as const, orderId: order.id, voucherId: order.giftVoucherId ?? undefined };
    if (session.payment_status !== "paid") return { status: "unpaid" as const, orderId: order.id };
    if (session.amount_total !== order.valueCents || (session.currency ?? "").toLowerCase() !== "eur") {
      console.error(`[vouchers] amount mismatch on order ${order.id}: paid ${session.amount_total} ${session.currency}, expected ${order.valueCents} eur`);
      try {
        await logActivity(
          "voucher_payment_mismatch",
          `Voucher order ${order.id} was paid ${session.amount_total} ${(session.currency ?? "").toLowerCase()} (cents) but expected ${order.valueCents} eur (cents). No voucher was made. Check it in Stripe.`,
          { orderId: order.id, paidCents: session.amount_total, paidCurrency: session.currency, expectedCents: order.valueCents },
        );
      } catch (err) {
        console.error("[vouchers] mismatch log failed", err);
      }
      return { status: "mismatch" as const, orderId: order.id };
    }

    const today = dublinDate(now);
    const years = getStoreSettings().expiryYears;
    const prefix = codePrefix(getBusinessProfileForTenant(tenantId).businessName);
    const voucher = db.transaction((tx): Voucher | null => {
      const claimed = tx
        .update(voucherOrders)
        .set({ status: "paid", paidAt: now, stripeSessionId: session.id, paymentIntentId: session.payment_intent ?? null })
        .where(and(eq(voucherOrders.id, order.id), inArray(voucherOrders.status, ["pending", "expired", "failed"])))
        .run().changes;
      if (claimed !== 1) return null;
      const [v] = tx
        .insert(giftVouchers)
        .values({
          code: newVoucherCode(prefix),
          purchaserName: order.fromName,
          purchaserEmail: order.buyerEmail,
          recipientName: order.recipientName,
          therapyId: order.therapyId,
          valueEur: order.valueCents / 100,
          balanceEur: order.valueCents / 100,
          isRedeemed: false,
          purchaseDate: today,
          expiryDate: expiryDate(today, years),
          source: "online",
          kind: order.kind,
          voucherOrderId: order.id,
          message: order.message,
          colourway: order.colourway,
          viewToken: newViewToken(),
        })
        .returning()
        .all();
      tx.update(voucherOrders).set({ giftVoucherId: v!.id }).where(eq(voucherOrders.id, order.id)).run();
      return v!;
    });
    if (!voucher) return { status: "already" as const, orderId: order.id };

    const paid = getVoucherOrder(order.id)!;
    try {
      await logActivity("voucher_sale", `${order.buyerName} bought a gift voucher online for ${order.recipientName} (${voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) })})`, {
        orderId: order.id,
        voucherId: voucher.id,
      });
    } catch (err) {
      // A log failure must not stop the receipt and gift emails.
      console.error("[vouchers] sale log failed", err);
    }
    // Only this caller won the claim above, so the admins hear about it once.
    notifyVoucherSale({
      orderId: order.id,
      title: order.kind === "treatment" ? `Gift voucher for ${therapyName(order.therapyId) || "a treatment"}` : "Gift voucher",
      cents: order.valueCents,
      buyer: order.buyerName,
      code: voucher.code,
    });

    const receipt = await sendReceipt(tenantId, paid, voucher, send);
    if (paid.deliverTo === "buyer") {
      // Sent to the buyer: the receipt IS the delivery.
      if (receipt.ok) markDelivered(paid.id, now);
      else failDelivery(paid.id, receipt.error);
    } else if (paid.deliverOn === null) {
      await deliverGift(tenantId, paid.id, send, now);
    }
    return { status: "fulfilled" as const, orderId: order.id, voucherId: voucher.id };
  });
}

export function expireVoucherOrder(tenantId: number, sessionId: string): void {
  runWithTenant(tenantId, () => {
    const order = voucherOrderForSession(sessionId);
    if (order) setVoucherOrderStatus(order.id, "expired", ["pending"]);
  });
}

/**
 * Stripe refunded a payment. False when it wasn't a voucher order (the
 * caller then tries the offer orders). An unused voucher is cancelled; a
 * part-used one is left as it is and flagged for staff, because the money
 * already spent on it can't be taken back by cancelling.
 */
export function refundVoucherOrder(tenantId: number, paymentIntentId: string, now = Date.now()): boolean {
  return runWithTenant(tenantId, () => {
    const order = voucherOrderForPaymentIntent(paymentIntentId);
    if (!order) return false;
    if (!setVoucherOrderStatus(order.id, "refunded", ["paid"])) return true;
    const v = order.giftVoucherId ? getVoucherById(order.giftVoucherId) : null;
    if (!v) return true;
    if (Math.round(v.balanceEur * 100) >= Math.round(v.valueEur * 100)) {
      cancelVoucher(v.id, now);
      void logActivity("voucher_refund", `Voucher ${v.code} was refunded in Stripe and has been cancelled.`, { orderId: order.id, voucherId: v.id }).catch((err) => console.error("[vouchers] refund log failed", err));
    } else {
      void logActivity("voucher_refund_part_used", `Voucher ${v.code} was refunded in Stripe after part of it was used. Check it with the buyer.`, {
        orderId: order.id,
        voucherId: v.id,
      }).catch((err) => console.error("[vouchers] refund log failed", err));
    }
    return true;
  });
}
