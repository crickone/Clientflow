import "server-only";

import crypto from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { authDb } from "@/lib/db/control";
import { getCurrentTenant } from "@/lib/db/tenant";
import {
  clientCredentials,
  clientNutritionPlans,
  clientWorkoutPrograms,
  nutritionPlans,
  workoutPrograms,
} from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";

// ── client app login (control plane, scoped to current tenant) ────────────────

export interface ClientLoginInfo {
  email: string;
  isActive: boolean;
  lastLoginAt: number | null;
}

export function getClientLogin(clientId: number): ClientLoginInfo | null {
  const tenantId = getCurrentTenant().id;
  const c = authDb
    .select()
    .from(clientCredentials)
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.clientId, clientId)))
    .get();
  if (!c) return null;
  return { email: c.email, isActive: c.isActive, lastLoginAt: c.lastLoginAt?.getTime() ?? null };
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export function enableClientLogin(clientId: number, email: string, password: string): LoginResult {
  const tenantId = getCurrentTenant().id;
  const normEmail = email.trim().toLowerCase();
  if (!normEmail.includes("@")) return { ok: false, error: "Enter a valid email." };
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  const existing = authDb.select().from(clientCredentials).where(eq(clientCredentials.email, normEmail)).get();
  if (existing && !(existing.tenantId === tenantId && existing.clientId === clientId)) {
    return { ok: false, error: "That email is already used by another login." };
  }
  const passwordHash = hashPassword(password);
  if (existing) {
    authDb
      .update(clientCredentials)
      .set({ passwordHash, isActive: true, tenantId, clientId })
      .where(eq(clientCredentials.id, existing.id))
      .run();
  } else {
    authDb.insert(clientCredentials).values({ email: normEmail, passwordHash, tenantId, clientId, isActive: true }).run();
  }
  return { ok: true };
}

export type CreateCredentialResult =
  | { ok: true; credentialId: number; created: boolean }
  | { ok: false; reason: "no-email" | "email-taken" };

/**
 * Ensure a client has an app credential in the given tenant, for bulk onboarding.
 * If they already have one (this tenant + client), returns it with created:false.
 * Otherwise mints one with a RANDOM (unknowable) temp password and
 * must_change_password=1 — the member sets a real password via the reset/invite
 * link. tenantId is always supplied by the caller (the authed admin's tenant),
 * never client-supplied. Refuses when the email is already taken by a DIFFERENT
 * login (client_credentials.email is globally unique).
 */
export function createClientCredential(
  tenantId: number,
  clientId: number,
  email: string,
): CreateCredentialResult {
  const normEmail = email.trim().toLowerCase();
  if (!normEmail.includes("@")) return { ok: false, reason: "no-email" };

  const existingForClient = authDb
    .select()
    .from(clientCredentials)
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.clientId, clientId)))
    .get();
  if (existingForClient) {
    return { ok: true, credentialId: existingForClient.id, created: false };
  }

  const existingEmail = authDb
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.email, normEmail))
    .get();
  if (existingEmail) return { ok: false, reason: "email-taken" };

  const tempPassword = "cf-" + crypto.randomBytes(24).toString("hex");
  const [row] = authDb
    .insert(clientCredentials)
    .values({
      email: normEmail,
      passwordHash: hashPassword(tempPassword),
      tenantId,
      clientId,
      isActive: true,
      mustChangePassword: true,
    })
    .returning({ id: clientCredentials.id })
    .all();
  return { ok: true, credentialId: row.id, created: true };
}

export function resetClientPassword(clientId: number, password: string): LoginResult {
  const tenantId = getCurrentTenant().id;
  if (password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  authDb
    .update(clientCredentials)
    .set({ passwordHash: hashPassword(password) })
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.clientId, clientId)))
    .run();
  return { ok: true };
}

export function setClientLoginActive(clientId: number, active: boolean) {
  const tenantId = getCurrentTenant().id;
  authDb
    .update(clientCredentials)
    .set({ isActive: active })
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.clientId, clientId)))
    .run();
}

export function removeClientLogin(clientId: number) {
  const tenantId = getCurrentTenant().id;
  authDb
    .delete(clientCredentials)
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.clientId, clientId)))
    .run();
}

// ── plan / program assignment (tenant DB) ─────────────────────────────────────

export interface AssignedItem {
  id: number;
  title: string;
  type: string;
}

export function assignedNutrition(clientId: number): AssignedItem[] {
  return db
    .select({ id: nutritionPlans.id, title: nutritionPlans.title, type: nutritionPlans.type })
    .from(clientNutritionPlans)
    .innerJoin(nutritionPlans, eq(nutritionPlans.id, clientNutritionPlans.planId))
    .where(eq(clientNutritionPlans.clientId, clientId))
    .orderBy(desc(clientNutritionPlans.assignedAt))
    .all();
}

export function availableNutrition(): AssignedItem[] {
  return db
    .select({ id: nutritionPlans.id, title: nutritionPlans.title, type: nutritionPlans.type })
    .from(nutritionPlans)
    .where(eq(nutritionPlans.status, "active"))
    .orderBy(asc(nutritionPlans.title))
    .all();
}

export function assignNutrition(clientId: number, planId: number) {
  db.insert(clientNutritionPlans).values({ clientId, planId }).onConflictDoNothing().run();
}
export function unassignNutrition(clientId: number, planId: number) {
  db.delete(clientNutritionPlans)
    .where(and(eq(clientNutritionPlans.clientId, clientId), eq(clientNutritionPlans.planId, planId)))
    .run();
}

export function assignedWorkouts(clientId: number): AssignedItem[] {
  return db
    .select({ id: workoutPrograms.id, title: workoutPrograms.title, type: workoutPrograms.type })
    .from(clientWorkoutPrograms)
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, clientWorkoutPrograms.programId))
    .where(eq(clientWorkoutPrograms.clientId, clientId))
    .orderBy(desc(clientWorkoutPrograms.assignedAt))
    .all();
}

export function availableWorkouts(): AssignedItem[] {
  return db
    .select({ id: workoutPrograms.id, title: workoutPrograms.title, type: workoutPrograms.type })
    .from(workoutPrograms)
    .where(eq(workoutPrograms.status, "active"))
    .orderBy(asc(workoutPrograms.title))
    .all();
}

export function assignWorkout(clientId: number, programId: number) {
  db.insert(clientWorkoutPrograms).values({ clientId, programId }).onConflictDoNothing().run();
}
export function unassignWorkout(clientId: number, programId: number) {
  db.delete(clientWorkoutPrograms)
    .where(and(eq(clientWorkoutPrograms.clientId, clientId), eq(clientWorkoutPrograms.programId, programId)))
    .run();
}
