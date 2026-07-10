"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  assignMembership,
  createMembership,
  deleteMembership,
  getPurchasedMembership,
  setClientMembershipStatus,
  updateMembership,
  type MembershipInput,
  type PurchasedDetail,
} from "@/lib/memberships";

const ISODATE = /^\d{4}-\d{2}-\d{2}$/;

const membershipSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  category: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  priceCents: z.coerce.number().int().min(0).max(10_000_00),
  billingInterval: z.enum(["week", "month", "year"]),
  billingCount: z.coerce.number().int().min(1).max(52),
  unlimitedSessions: z.coerce.boolean(),
  sessionsQuantity: z.coerce.number().int().min(1).max(1000),
  visibility: z.enum(["all", "private"]),
  joiningFeeCents: z.coerce.number().int().min(0).max(10_000_00),
  openAccess: z.coerce.boolean(),
  priorityBooking: z.coerce.boolean(),
  forSale: z.coerce.boolean(),
});

export type MembershipResult = { ok: true } | { ok: false; error: string };

const idSchema = z.coerce.number().int().positive();

function revalidate() {
  revalidatePath("/memberships");
}

export async function createMembershipAction(raw: unknown): Promise<MembershipResult> {
  await requireUser();
  const parsed = membershipSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  createMembership(parsed.data as MembershipInput);
  revalidate();
  return { ok: true };
}

export async function updateMembershipAction(id: number, raw: unknown): Promise<MembershipResult> {
  await requireUser();
  const mid = idSchema.safeParse(id);
  const parsed = membershipSchema.safeParse(raw);
  if (!mid.success || !parsed.success) {
    return { ok: false, error: parsed.success ? "Invalid id." : parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  updateMembership(mid.data, parsed.data as MembershipInput);
  revalidate();
  return { ok: true };
}

export async function deleteMembershipAction(id: number) {
  await requireUser();
  const mid = idSchema.safeParse(id);
  if (!mid.success) return;
  deleteMembership(mid.data);
  revalidate();
}

export async function assignMembershipAction(
  membershipId: number,
  clientId: number,
  startDate: string,
): Promise<MembershipResult> {
  await requireUser();
  const mid = idSchema.safeParse(membershipId);
  const cid = idSchema.safeParse(clientId);
  const date = z.string().regex(ISODATE).safeParse(startDate);
  if (!mid.success || !cid.success || !date.success) {
    return { ok: false, error: "Invalid input." };
  }
  const res = assignMembership({ membershipId: mid.data, clientId: cid.data, startDate: date.data });
  revalidate();
  return res;
}

export async function getPurchasedDetailAction(id: number): Promise<PurchasedDetail | null> {
  await requireUser();
  const cmid = idSchema.safeParse(id);
  if (!cmid.success) return null;
  return getPurchasedMembership(cmid.data);
}

export async function setClientMembershipStatusAction(
  id: number,
  status: "active" | "expired" | "cancelled",
) {
  await requireUser();
  const cmid = idSchema.safeParse(id);
  const st = z.enum(["active", "expired", "cancelled"]).safeParse(status);
  if (!cmid.success || !st.success) return;
  setClientMembershipStatus(cmid.data, st.data);
  revalidate();
}
