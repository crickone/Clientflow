"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  adjustPackageCredits,
  assignPackage,
  createPackagePlan,
  deletePackagePlan,
  getPurchasedPackage,
  setClientPackageStatus,
  updatePackagePlan,
  type PackageInput,
  type PurchasedPackageDetail,
} from "@/lib/sessionPackages";

const ISODATE = /^\d{4}-\d{2}-\d{2}$/;

const packageSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  category: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  priceCents: z.coerce.number().int().min(0).max(10_000_00),
  unlimitedSessions: z.coerce.boolean(),
  sessionsQuantity: z.coerce.number().int().min(1).max(1000),
  unlimitedDuration: z.coerce.boolean(),
  expirationCount: z.coerce.number().int().min(1).max(52),
  expirationInterval: z.enum(["week", "month", "year"]),
  singlePurchase: z.coerce.boolean(),
  activateOnFirstBooking: z.coerce.boolean(),
  autoRenewal: z.coerce.boolean(),
  restrictToMembers: z.coerce.boolean(),
  visibility: z.enum(["all", "private"]),
  openAccess: z.coerce.boolean(),
  priorityBooking: z.coerce.boolean(),
  forSale: z.coerce.boolean(),
});

export type PackageResult = { ok: true } | { ok: false; error: string };

const idSchema = z.coerce.number().int().positive();

function revalidate() {
  revalidatePath("/session-packages");
}

export async function createPackageAction(raw: unknown): Promise<PackageResult> {
  await requireUser();
  const parsed = packageSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  createPackagePlan(parsed.data as PackageInput);
  revalidate();
  return { ok: true };
}

export async function updatePackageAction(id: number, raw: unknown): Promise<PackageResult> {
  await requireUser();
  const pid = idSchema.safeParse(id);
  const parsed = packageSchema.safeParse(raw);
  if (!pid.success || !parsed.success) {
    return { ok: false, error: parsed.success ? "Invalid id." : parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  updatePackagePlan(pid.data, parsed.data as PackageInput);
  revalidate();
  return { ok: true };
}

export async function deletePackageAction(id: number) {
  await requireUser();
  const pid = idSchema.safeParse(id);
  if (!pid.success) return;
  deletePackagePlan(pid.data);
  revalidate();
}

export async function assignPackageAction(
  packageId: number,
  clientId: number,
  startDate: string,
): Promise<PackageResult> {
  await requireUser();
  const pid = idSchema.safeParse(packageId);
  const cid = idSchema.safeParse(clientId);
  const date = z.string().regex(ISODATE).safeParse(startDate);
  if (!pid.success || !cid.success || !date.success) {
    return { ok: false, error: "Invalid input." };
  }
  const res = assignPackage({ packageId: pid.data, clientId: cid.data, startDate: date.data });
  revalidate();
  return res;
}

export async function setClientPackageStatusAction(
  id: number,
  status: "active" | "expired" | "cancelled",
) {
  await requireUser();
  const cpid = idSchema.safeParse(id);
  const st = z.enum(["active", "expired", "cancelled"]).safeParse(status);
  if (!cpid.success || !st.success) return;
  setClientPackageStatus(cpid.data, st.data);
  revalidate();
}

export async function adjustPackageCreditsAction(id: number, delta: number) {
  await requireUser();
  const cpid = idSchema.safeParse(id);
  const d = z.coerce.number().int().min(-1).max(1).safeParse(delta);
  if (!cpid.success || !d.success) return;
  adjustPackageCredits(cpid.data, d.data);
  revalidate();
}

export async function getPurchasedPackageAction(id: number): Promise<PurchasedPackageDetail | null> {
  await requireUser();
  const cpid = idSchema.safeParse(id);
  if (!cpid.success) return null;
  return getPurchasedPackage(cpid.data);
}
