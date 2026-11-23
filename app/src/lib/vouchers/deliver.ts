import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import type { SendResult } from "@/lib/email";
import type { Voucher, VoucherOrder } from "@/lib/db/schema";
import { isDeliveryDue, parseColourway, voucherTitle } from "./model";
import {
  claimDelivery,
  failDelivery,
  getVoucherById,
  getVoucherOrder,
  markDelivered,
  pendingGiftOrders,
  resetDelivery,
  therapyName,
} from "./store";
import { renderGiftEmail, renderReceiptEmail, sendVoucherEmail, voucherBrand, type VoucherMailer } from "./email";

/**
 * Gift emails to recipients. Sent at once when the buyer chose "now", and
 * otherwise by the minute dispatch ticker at 09:00 Irish time on the chosen
 * day. Each send is claimed first (claimDelivery), so the purchase and the
 * ticker can't both send it. A failure is kept on the order for staff, who
 * see it on the voucher with a Resend button; it is not retried by itself,
 * so a bad address doesn't get an email a minute.
 */
export async function deliverGift(
  tenantId: number,
  orderId: number,
  send: VoucherMailer = sendVoucherEmail,
  now = Date.now(),
): Promise<"sent" | "failed" | "skipped"> {
  return runWithTenant(tenantId, async () => {
    const order = getVoucherOrder(orderId);
    if (!order || order.status !== "paid" || order.deliverTo !== "recipient" || !order.recipientEmail || !order.giftVoucherId) return "skipped";
    const voucher = getVoucherById(order.giftVoucherId);
    const colourway = parseColourway(voucher?.colourway ?? order.colourway);
    if (!voucher || !voucher.viewToken || !colourway || voucher.cancelledAt) return "skipped";
    if (!claimDelivery(order.id, now)) return "skipped";

    let r: SendResult;
    try {
      const { subject, html } = renderGiftEmail({
        brand: voucherBrand(tenantId, order.siteId, order.siteUrl),
        colourway,
        fromName: order.fromName,
        toName: order.recipientName,
        message: order.message,
        title: voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) }),
        code: voucher.code,
        expiry: voucher.expiryDate,
        revealUrl: `${order.siteUrl}/v/${voucher.viewToken}`,
      });
      r = await send(tenantId, { to: order.recipientEmail, subject, html });
    } catch (err) {
      r = { ok: false, error: err instanceof Error ? err.message : "The gift email could not be sent." };
    }
    if (r.ok) return "sent";
    failDelivery(order.id, r.error);
    await logActivity("voucher_gift_failed", `The gift email for voucher ${voucher.code} to ${order.recipientEmail} failed: ${r.error}`, {
      orderId: order.id,
      voucherId: voucher.id,
    });
    return "failed";
  });
}

/** The ticker's pass for one business: every gift whose day and hour have come. Returns how many went. */
export async function dispatchDueVoucherGifts(tenantId: number, now = Date.now(), send: VoucherMailer = sendVoucherEmail): Promise<number> {
  const due = runWithTenant(tenantId, () => pendingGiftOrders().filter((o) => isDeliveryDue(o.deliverOn, now)));
  let sent = 0;
  for (const o of due) {
    if ((await deliverGift(tenantId, o.id, send, now)) === "sent") sent++;
  }
  return sent;
}

/**
 * Staff: send it again. A gift for a recipient goes to the recipient (now,
 * whatever date was chosen); a voucher sent to the buyer re-sends the
 * receipt, which carries the voucher link.
 */
export async function resendVoucherEmails(tenantId: number, orderId: number, send: VoucherMailer = sendVoucherEmail): Promise<SendResult> {
  const order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  if (!order || order.status !== "paid" || !order.giftVoucherId) return { ok: false, error: "This voucher has no paid online order." };
  if (order.deliverTo === "recipient") {
    runWithTenant(tenantId, () => resetDelivery(order.id));
    const r = await deliverGift(tenantId, order.id, send);
    if (r === "sent") return { ok: true, id: "" };
    const after = runWithTenant(tenantId, () => getVoucherOrder(order.id));
    return { ok: false, error: after?.deliveryError || "The gift email could not be sent." };
  }
  return runWithTenant(tenantId, async () => {
    const voucher = getVoucherById(order.giftVoucherId!);
    if (!voucher) return { ok: false as const, error: "The voucher is missing." };
    const r = await sendReceipt(tenantId, order, voucher, send);
    if (r.ok) markDelivered(order.id);
    return r;
  });
}

/** The buyer's receipt with the voucher link. Never throws. */
export async function sendReceipt(tenantId: number, order: VoucherOrder, voucher: Voucher, send: VoucherMailer = sendVoucherEmail): Promise<SendResult> {
  try {
    const colourway = parseColourway(voucher.colourway ?? order.colourway);
    if (!colourway || !voucher.viewToken) return { ok: false as const, error: "The voucher is missing its card or link." };
    const { subject, html } = renderReceiptEmail({
      brand: voucherBrand(tenantId, order.siteId, order.siteUrl),
      colourway,
      buyerName: order.buyerName,
      toName: order.recipientName,
      title: voucherTitle({ kind: order.kind, valueEur: order.valueCents / 100, therapyName: therapyName(order.therapyId) }),
      paidEur: order.valueCents / 100,
      code: voucher.code,
      expiry: voucher.expiryDate,
      revealUrl: `${order.siteUrl}/v/${voucher.viewToken}`,
      deliverTo: order.deliverTo,
      recipientEmail: order.recipientEmail,
      deliverOn: order.deliverOn,
    });
    const r = await send(tenantId, { to: order.buyerEmail, subject, html });
    if (!r.ok) console.error(`[vouchers] receipt for order ${order.id} failed:`, r.error);
    return r;
  } catch (err) {
    console.error(`[vouchers] receipt for order ${order.id} failed:`, err);
    return { ok: false as const, error: err instanceof Error ? err.message : "The receipt could not be sent." };
  }
}

