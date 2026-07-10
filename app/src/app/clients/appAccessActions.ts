"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  assignNutrition,
  assignWorkout,
  enableClientLogin,
  removeClientLogin,
  resetClientPassword,
  setClientLoginActive,
  unassignNutrition,
  unassignWorkout,
  type LoginResult,
} from "@/lib/clientAccess";

const id = z.coerce.number().int().positive();

export async function enableClientLoginAction(clientId: number, email: string, password: string): Promise<LoginResult> {
  await requireUser();
  const p = id.safeParse(clientId);
  if (!p.success) return { ok: false, error: "Invalid client." };
  const res = enableClientLogin(p.data, String(email ?? ""), String(password ?? ""));
  revalidatePath(`/clients/${p.data}`);
  return res;
}

export async function resetClientPasswordAction(clientId: number, password: string): Promise<LoginResult> {
  await requireUser();
  const p = id.safeParse(clientId);
  if (!p.success) return { ok: false, error: "Invalid client." };
  const res = resetClientPassword(p.data, String(password ?? ""));
  revalidatePath(`/clients/${p.data}`);
  return res;
}

export async function setClientLoginActiveAction(clientId: number, active: boolean) {
  await requireUser();
  const p = id.safeParse(clientId);
  if (!p.success) return;
  setClientLoginActive(p.data, Boolean(active));
  revalidatePath(`/clients/${p.data}`);
}

export async function removeClientLoginAction(clientId: number) {
  await requireUser();
  const p = id.safeParse(clientId);
  if (!p.success) return;
  removeClientLogin(p.data);
  revalidatePath(`/clients/${p.data}`);
}

// ── assignment ────────────────────────────────────────────────────────────────

export async function assignNutritionAction(clientId: number, planId: number) {
  await requireUser();
  const c = id.safeParse(clientId);
  const pl = id.safeParse(planId);
  if (!c.success || !pl.success) return;
  assignNutrition(c.data, pl.data);
  revalidatePath(`/clients/${c.data}`);
}
export async function unassignNutritionAction(clientId: number, planId: number) {
  await requireUser();
  const c = id.safeParse(clientId);
  const pl = id.safeParse(planId);
  if (!c.success || !pl.success) return;
  unassignNutrition(c.data, pl.data);
  revalidatePath(`/clients/${c.data}`);
}
export async function assignWorkoutAction(clientId: number, programId: number) {
  await requireUser();
  const c = id.safeParse(clientId);
  const pr = id.safeParse(programId);
  if (!c.success || !pr.success) return;
  assignWorkout(c.data, pr.data);
  revalidatePath(`/clients/${c.data}`);
}
export async function unassignWorkoutAction(clientId: number, programId: number) {
  await requireUser();
  const c = id.safeParse(clientId);
  const pr = id.safeParse(programId);
  if (!c.success || !pr.success) return;
  unassignWorkout(c.data, pr.data);
  revalidatePath(`/clients/${c.data}`);
}
