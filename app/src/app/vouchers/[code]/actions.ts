"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { resendVoucherEmails } from "@/lib/vouchers/deliver";
import { isEmail } from "@/lib/vouchers/model";
import { getVoucherById, orderForVoucher, setRecipientEmail } from "@/lib/vouchers/store";

type Result = { ok: true } | { ok: false; error: string };

/** Send the gift email again (or, for a voucher sent to the buyer, the receipt). */
export async function resendVoucherAction(voucherId: number): Promise<Result> {
  await requireUser();
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  const r = await resendVoucherEmails(getCurrentTenant().id, order.id);
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  revalidatePath("/vouchers");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** A typo in the recipient's address: fix it, then Resend. */
export async function changeRecipientEmailAction(voucherId: number, email: string): Promise<Result> {
  await requireUser();
  const clean = String(email ?? "").trim().toLowerCase();
  if (!isEmail(clean)) return { ok: false, error: "Enter a full email address." };
  const v = getVoucherById(voucherId);
  const order = v ? orderForVoucher(v) : null;
  if (!v || !order) return { ok: false, error: "This voucher wasn't bought online." };
  if (order.deliverTo !== "recipient") return { ok: false, error: "This voucher was sent to the buyer." };
  setRecipientEmail(order.id, clean);
  await logActivity("voucher.recipient_email", `Recipient email for voucher ${v.code} changed to ${clean}`, { voucherId: v.id });
  revalidatePath(`/vouchers/${encodeURIComponent(v.code)}`);
  return { ok: true };
}
