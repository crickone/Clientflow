"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { resendVoucherEmails } from "@/lib/vouchers/deliver";
import { isEmail } from "@/lib/vouchers/model";
import { getVoucherById, orderForVoucher, setRecipientEmail } from "@/lib/vouchers/store";

type Result = { ok: true } | { ok: false; error: string };

/** A resend within this window of the last send is refused, so a double click can't send twice. */
const RESEND_COOLDOWN_MS = 60_000;

/** Send the gift email again (or, for a voucher sent to the buyer, the receipt). */
export async function resendVoucherAction(voucherId: number): Promise<Result> {
  await requireUser();
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  if (order.deliveredAt && Date.now() - order.deliveredAt < RESEND_COOLDOWN_MS) {
    return { ok: false, error: "That was just sent. Try again in a minute." };
  }
  const to = order.deliverTo === "recipient" ? order.recipientEmail : order.buyerEmail;
  const r = await resendVoucherEmails(getCurrentTenant().id, order.id);
  await logActivity(
    "voucher.resend",
    `Voucher ${v.code} resent to ${to ?? "unknown address"} ${r.ok ? "(sent)" : `(failed: ${r.error})`}`,
    { voucherId: v.id, orderId: order.id, to, sent: r.ok },
  );
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  revalidatePath("/vouchers");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** A typo in the recipient's address: fix it, then Resend. Admin only: it re-routes the voucher code to a new address. */
export async function changeRecipientEmailAction(voucherId: number, email: string): Promise<Result> {
  await requireAdmin();
  const clean = String(email ?? "").trim().toLowerCase();
  if (!isEmail(clean)) return { ok: false, error: "Enter a full email address." };
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  if (order.deliverTo !== "recipient") return { ok: false, error: "This voucher was sent to the buyer." };
  const previous = order.recipientEmail ?? "none";
  setRecipientEmail(order.id, clean);
  await logActivity(
    "voucher.recipient_email",
    `Recipient email for voucher ${v.code} changed from ${previous} to ${clean}`,
    { voucherId: v.id, orderId: order.id, from: previous, to: clean },
  );
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  return { ok: true };
}
