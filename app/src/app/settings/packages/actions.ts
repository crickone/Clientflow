"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { packageTemplates } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1, "Name is required."),
  therapyId: z.coerce.number().int().positive(),
  totalSessions: z.coerce.number().int().positive(),
  priceEur: z.coerce.number().nonnegative(),
  validityMonths: z.coerce.number().int().positive(),
  notes: z.string().optional(),
  isActive: z.coerce.boolean().optional().default(true),
});

function parse(formData: FormData) {
  return schema.parse({
    name: formData.get("name"),
    therapyId: formData.get("therapyId"),
    totalSessions: formData.get("totalSessions"),
    priceEur: formData.get("priceEur"),
    validityMonths: formData.get("validityMonths"),
    notes: formData.get("notes") || undefined,
    isActive:
      formData.get("isActive") == null
        ? true
        : formData.get("isActive") === "true" ||
          formData.get("isActive") === "on" ||
          formData.get("isActive") === "1",
  });
}

export async function createPackageTemplateAction(formData: FormData) {
  await requireAdmin();
  const v = parse(formData);
  db.insert(packageTemplates)
    .values({
      name: v.name,
      therapyId: v.therapyId,
      totalSessions: v.totalSessions,
      priceEur: v.priceEur,
      validityMonths: v.validityMonths,
      notes: v.notes ?? null,
      isActive: v.isActive ?? true,
    })
    .run();
  revalidatePath("/settings/packages");
  revalidatePath("/packages/new");
}

export async function updatePackageTemplateAction(id: number, formData: FormData) {
  await requireAdmin();
  const v = parse(formData);
  db.update(packageTemplates)
    .set({
      name: v.name,
      therapyId: v.therapyId,
      totalSessions: v.totalSessions,
      priceEur: v.priceEur,
      validityMonths: v.validityMonths,
      notes: v.notes ?? null,
      isActive: v.isActive ?? true,
      updatedAt: new Date(),
    })
    .where(eq(packageTemplates.id, id))
    .run();
  revalidatePath("/settings/packages");
  revalidatePath("/packages/new");
}

export async function deletePackageTemplateAction(id: number) {
  await requireAdmin();
  db.delete(packageTemplates).where(eq(packageTemplates.id, id)).run();
  revalidatePath("/settings/packages");
  revalidatePath("/packages/new");
}
