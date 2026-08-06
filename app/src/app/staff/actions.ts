"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { createStaff, deleteStaff, updateStaff, type StaffInput } from "@/lib/staff";

const staffSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.string().trim().max(160).optional().nullable(),
  phone: z.string().trim().max(60).optional().nullable(),
  title: z.string().trim().max(80).optional().nullable(),
  payType: z.enum(["per_session", "per_hour", "fixed"]),
  payRateCents: z.coerce.number().int().min(0).max(10_000_00),
  isApproved: z.coerce.boolean(),
  isActive: z.coerce.boolean(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type StaffResult = { ok: true } | { ok: false; error: string };

const idSchema = z.coerce.number().int().positive();

function revalidate() {
  revalidatePath("/staff");
}

export async function createStaffAction(raw: unknown): Promise<StaffResult> {
  await requireAdmin();
  const parsed = staffSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  createStaff(parsed.data as StaffInput);
  revalidate();
  return { ok: true };
}

export async function updateStaffAction(id: number, raw: unknown): Promise<StaffResult> {
  await requireAdmin();
  const sid = idSchema.safeParse(id);
  const parsed = staffSchema.safeParse(raw);
  if (!sid.success || !parsed.success) {
    return { ok: false, error: parsed.success ? "Invalid id." : parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  updateStaff(sid.data, parsed.data as StaffInput);
  revalidate();
  return { ok: true };
}

export async function deleteStaffAction(id: number) {
  await requireAdmin();
  const sid = idSchema.safeParse(id);
  if (!sid.success) return;
  deleteStaff(sid.data);
  revalidate();
}

/** Inline payroll edit from the payroll table. */
export async function setStaffPayAction(
  id: number,
  payType: "per_session" | "per_hour" | "fixed",
  payRateCents: number,
): Promise<StaffResult> {
  await requireAdmin();
  const sid = idSchema.safeParse(id);
  const pt = z.enum(["per_session", "per_hour", "fixed"]).safeParse(payType);
  const rate = z.coerce.number().int().min(0).max(10_000_00).safeParse(payRateCents);
  if (!sid.success || !pt.success || !rate.success) {
    return { ok: false, error: "Invalid input." };
  }
  updateStaff(sid.data, { payType: pt.data, payRateCents: rate.data });
  revalidate();
  return { ok: true };
}
