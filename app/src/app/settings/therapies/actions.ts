"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  giftVouchers,
  packages,
  sessions,
  therapies,
} from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

const therapySchema = z.object({
  name: z.string().min(1),
  colourHex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  defaultDurationMinutes: z.coerce.number().int().positive(),
  defaultPriceEur: z.coerce.number().nonnegative(),
  description: z.string().optional().or(z.literal("")),
  isActive: z.coerce.boolean().optional(),
});

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    colourHex: String(formData.get("colourHex") ?? "").trim(),
    defaultDurationMinutes: Number(formData.get("defaultDurationMinutes") ?? 0),
    defaultPriceEur: Number(formData.get("defaultPriceEur") ?? 0),
    description: String(formData.get("description") ?? "").trim(),
    isActive: formData.get("isActive") === "on",
  };
}

export async function createTherapyAction(formData: FormData) {
  await requireAdmin();
  const parsed = therapySchema.parse(readForm(formData));
  db.insert(therapies)
    .values({
      name: parsed.name,
      colourHex: parsed.colourHex,
      defaultDurationMinutes: parsed.defaultDurationMinutes,
      defaultPriceEur: parsed.defaultPriceEur,
      description: parsed.description || null,
      isActive: parsed.isActive ?? true,
    })
    .run();
  revalidatePath("/settings/therapies");
}

export async function updateTherapyAction(id: number, formData: FormData) {
  await requireAdmin();
  const parsed = therapySchema.parse(readForm(formData));
  db.update(therapies)
    .set({
      name: parsed.name,
      colourHex: parsed.colourHex,
      defaultDurationMinutes: parsed.defaultDurationMinutes,
      defaultPriceEur: parsed.defaultPriceEur,
      description: parsed.description || null,
      isActive: parsed.isActive ?? true,
    })
    .where(eq(therapies.id, id))
    .run();
  revalidatePath("/settings/therapies");
}

export async function toggleTherapyAction(id: number, isActive: boolean) {
  await requireAdmin();
  db.update(therapies)
    .set({ isActive })
    .where(eq(therapies.id, id))
    .run();
  revalidatePath("/settings/therapies");
  revalidatePath("/appointments/new");
}

/**
 * Hard-delete a therapy. Refuses if any historical row references it
 * (session log, package, voucher). The caller should show the returned
 * message via toast and suggest deactivation instead.
 */
export async function deleteTherapyAction(
  id: number,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await requireAdmin();
  const sessionCount =
    db
      .select({ c: sql<number>`count(*)` })
      .from(sessions)
      .where(eq(sessions.therapyId, id))
      .get()?.c ?? 0;
  const packageCount =
    db
      .select({ c: sql<number>`count(*)` })
      .from(packages)
      .where(eq(packages.therapyId, id))
      .get()?.c ?? 0;
  const voucherCount =
    db
      .select({ c: sql<number>`count(*)` })
      .from(giftVouchers)
      .where(eq(giftVouchers.therapyId, id))
      .get()?.c ?? 0;

  const used = sessionCount + packageCount + voucherCount;
  if (used > 0) {
    const parts: string[] = [];
    if (sessionCount) parts.push(`${sessionCount} session${sessionCount > 1 ? "s" : ""}`);
    if (packageCount) parts.push(`${packageCount} package${packageCount > 1 ? "s" : ""}`);
    if (voucherCount) parts.push(`${voucherCount} voucher${voucherCount > 1 ? "s" : ""}`);
    return {
      ok: false,
      reason: `Can't delete — ${parts.join(", ")} reference this therapy. Deactivate instead.`,
    };
  }

  db.delete(therapies).where(eq(therapies.id, id)).run();
  revalidatePath("/settings/therapies");
  revalidatePath("/appointments/new");
  return { ok: true };
}
