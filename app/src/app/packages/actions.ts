"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { giftVouchers, payments } from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import { onPaymentRecorded } from "@/lib/pipeline/stage";
import { createPackage } from "@/lib/packages";

const sellSchema = z.object({
  clientId: z.coerce.number().int().positive(),
  therapyId: z.coerce.number().int().positive(),
  totalSessions: z.coerce.number().int().positive(),
  pricePaidEur: z.coerce.number().nonnegative(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod: z.enum(["cash", "card", "bank_transfer"]),
  packageName: z.string().min(1),
  notes: z.string().optional(),
  voucherCode: z.string().optional(),
});

export interface VoucherLookupResult {
  ok: boolean;
  error?: string;
  code?: string;
  voucherId?: number;
  balanceEur?: number;
  valueEur?: number;
  therapyId?: number | null;
  expiryDate?: string;
}

export async function lookupVoucherAction(
  rawCode: string,
  opts: { clientId?: number; therapyId?: number },
): Promise<VoucherLookupResult> {
  await requireUser();
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a voucher code." };

  const v = db
    .select()
    .from(giftVouchers)
    .where(eq(giftVouchers.code, code))
    .get();
  if (!v) return { ok: false, error: "Voucher not found." };

  const today = new Date().toISOString().slice(0, 10);
  if (v.expiryDate < today) return { ok: false, error: "Voucher has expired." };
  if (v.balanceEur <= 0) return { ok: false, error: "Voucher has no balance left." };
  if (v.therapyId != null && opts.therapyId != null && v.therapyId !== opts.therapyId) {
    return {
      ok: false,
      error: "Voucher is restricted to a different therapy.",
    };
  }
  if (
    v.recipientClientId != null &&
    opts.clientId != null &&
    v.recipientClientId !== opts.clientId
  ) {
    return {
      ok: false,
      error: "Voucher belongs to a different client.",
    };
  }
  if (
    v.recipientClientId == null &&
    v.redeemedByClientId != null &&
    opts.clientId != null &&
    v.redeemedByClientId !== opts.clientId
  ) {
    return {
      ok: false,
      error: "Voucher has already been used by another client.",
    };
  }

  return {
    ok: true,
    code: v.code,
    voucherId: v.id,
    balanceEur: v.balanceEur,
    valueEur: v.valueEur,
    therapyId: v.therapyId,
    expiryDate: v.expiryDate,
  };
}

export async function sellPackageAction(formData: FormData) {
  await requireUser();
  const parsed = sellSchema.parse({
    clientId: formData.get("clientId"),
    therapyId: formData.get("therapyId"),
    totalSessions: formData.get("totalSessions"),
    pricePaidEur: formData.get("pricePaidEur"),
    expiryDate: formData.get("expiryDate"),
    paymentMethod: formData.get("paymentMethod"),
    packageName: formData.get("packageName"),
    notes: formData.get("notes") || undefined,
    voucherCode: formData.get("voucherCode") || undefined,
  });

  // Optional voucher redemption — re-validate server-side.
  let voucherApplied = 0;
  let voucherRow: { id: number; code: string; balanceEur: number } | null = null;
  if (parsed.voucherCode) {
    const code = parsed.voucherCode.trim().toUpperCase();
    const v = db
      .select()
      .from(giftVouchers)
      .where(eq(giftVouchers.code, code))
      .get();
    if (!v) throw new Error("Voucher not found.");
    const today = new Date().toISOString().slice(0, 10);
    if (v.expiryDate < today) throw new Error("Voucher has expired.");
    if (v.balanceEur <= 0) throw new Error("Voucher has no balance left.");
    if (v.therapyId != null && v.therapyId !== parsed.therapyId) {
      throw new Error("Voucher is restricted to a different therapy.");
    }
    if (
      v.recipientClientId != null &&
      v.recipientClientId !== parsed.clientId
    ) {
      throw new Error("Voucher belongs to a different client.");
    }
    if (
      v.recipientClientId == null &&
      v.redeemedByClientId != null &&
      v.redeemedByClientId !== parsed.clientId
    ) {
      throw new Error("Voucher has already been used by another client.");
    }
    voucherApplied = Math.min(v.balanceEur, parsed.pricePaidEur);
    voucherRow = { id: v.id, code: v.code, balanceEur: v.balanceEur };
  }

  const remainder = Math.max(0, parsed.pricePaidEur - voucherApplied);

  const packageId = createPackage({
    clientId: parsed.clientId,
    therapyId: parsed.therapyId,
    packageName: parsed.packageName,
    totalSessions: parsed.totalSessions,
    pricePaidEur: parsed.pricePaidEur,
    expiryDate: parsed.expiryDate,
    notes: parsed.notes ?? null,
  });

  // Voucher payment row (if any)
  if (voucherRow && voucherApplied > 0) {
    const newBalance = Math.max(0, voucherRow.balanceEur - voucherApplied);
    db.update(giftVouchers)
      .set({
        balanceEur: newBalance,
        isRedeemed: newBalance === 0,
        redeemedAt: newBalance === 0 ? new Date() : undefined,
        redeemedByClientId: sql`COALESCE(${giftVouchers.redeemedByClientId}, ${parsed.clientId})`,
      })
      .where(eq(giftVouchers.id, voucherRow.id))
      .run();

    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        packageId,
        voucherId: voucherRow.id,
        amountEur: voucherApplied,
        paymentMethod: "voucher",
        notes: `Voucher ${voucherRow.code} applied to package: ${parsed.packageName}`,
      })
      .run();
  }

  // Remaining payment via chosen method (only if there's a balance to collect)
  if (remainder > 0) {
    db.insert(payments)
      .values({
        clientId: parsed.clientId,
        packageId,
        amountEur: remainder,
        paymentMethod: parsed.paymentMethod,
        notes: `Package: ${parsed.packageName}${
          voucherApplied > 0 ? ` (after €${voucherApplied} voucher)` : ""
        }`,
      })
      .run();
  }

  await logActivity(
    "package.sold",
    `Package sold: ${parsed.packageName}${
      voucherApplied > 0 ? ` (€${voucherApplied} voucher)` : ""
    }`,
    { packageId, clientId: parsed.clientId, voucherId: voucherRow?.id ?? null },
  );

  try {
    onPaymentRecorded(parsed.clientId);
  } catch (err) {
    console.error("[pipeline] package payment hook failed:", err);
  }

  revalidatePath("/packages");
  revalidatePath("/vouchers");
  revalidatePath(`/clients/${parsed.clientId}`);
  redirect(`/clients/${parsed.clientId}`);
}
