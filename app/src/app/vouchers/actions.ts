"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { giftVouchers } from "@/lib/db/schema";
import { logActivity } from "@/lib/queries";
import { genVoucherCode } from "@/lib/utils";

const voucherSchema = z.object({
  purchaserName: z.string().min(1),
  purchaserEmail: z.string().email().optional().or(z.literal("")),
  purchaserClientId: z.coerce.number().int().positive().optional(),
  recipientName: z.string().optional().or(z.literal("")),
  recipientClientId: z.coerce.number().int().positive().optional(),
  therapyId: z.string().optional(),
  valueEur: z.coerce.number().positive(),
  expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function optionalId(raw: FormDataEntryValue | null) {
  return raw && String(raw).length > 0 ? raw : undefined;
}

export async function createVoucherAction(formData: FormData) {
  await requireUser();
  const parsed = voucherSchema.parse({
    purchaserName: formData.get("purchaserName"),
    purchaserEmail: formData.get("purchaserEmail"),
    purchaserClientId: optionalId(formData.get("purchaserClientId")),
    recipientName: formData.get("recipientName"),
    recipientClientId: optionalId(formData.get("recipientClientId")),
    therapyId: formData.get("therapyId"),
    valueEur: formData.get("valueEur"),
    expiryDate: formData.get("expiryDate"),
  });

  // Generate a unique code
  let code = genVoucherCode();
  while (db.select().from(giftVouchers).where(eq(giftVouchers.code, code)).get()) {
    code = genVoucherCode();
  }

  db.insert(giftVouchers)
    .values({
      code,
      purchaserName: parsed.purchaserName,
      purchaserEmail: parsed.purchaserEmail || null,
      purchaserClientId: parsed.purchaserClientId ?? null,
      recipientName: parsed.recipientName || null,
      recipientClientId: parsed.recipientClientId ?? null,
      therapyId: parsed.therapyId ? Number(parsed.therapyId) : null,
      valueEur: parsed.valueEur,
      balanceEur: parsed.valueEur, // starts at full value; deducted per use
      isRedeemed: false,
      purchaseDate: new Date().toISOString().slice(0, 10),
      expiryDate: parsed.expiryDate,
    })
    .run();

  await logActivity(
    "voucher.new",
    `Voucher ${code} sold to ${parsed.purchaserName}`,
    { code },
  );

  revalidatePath("/vouchers");
  redirect("/vouchers");
}
