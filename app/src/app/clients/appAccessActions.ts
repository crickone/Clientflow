"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { getCurrentMembership, requireAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import {
  assignNutrition,
  assignWorkout,
  createClientCredential,
  enableClientLogin,
  getClientLogin,
  removeClientLogin,
  resetClientPassword,
  setClientLoginActive,
  unassignNutrition,
  unassignWorkout,
  type LoginResult,
} from "@/lib/clientAccess";
import { sendClientAppInvite } from "@/lib/clientPasswordReset";
import {
  isEmailConfigured,
  renderEmailShell,
  sendEmail,
  textToParagraphs,
} from "@/lib/email";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";
import { fireTrigger } from "@/lib/automations";

const id = z.coerce.number().int().positive();

/**
 * Email the client a one-tap link to the mobile app, with their login email and a
 * freshly-issued temporary password (they can change it after signing in).
 */
export async function sendClientLoginEmailAction(clientId: number): Promise<LoginResult> {
  await requireUser();
  const cid = id.parse(clientId);
  const login = getClientLogin(cid);
  if (!login) return { ok: false, error: "Enable the client's app login first." };
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't set up yet — connect Gmail or Resend in Settings → Email." };
  }

  const temp = "cf-" + crypto.randomBytes(4).toString("hex");
  const reset = resetClientPassword(cid, temp);
  if (!reset.ok) return reset;

  const business = getBusinessProfile().businessName;
  const accent = getTheme().accent;
  const link = `${getAppBaseUrl()}/app/login`;
  const bodyHtml = `
    ${textToParagraphs(`Hi, here's your access to the ${business} app — where you'll find your plans, book classes, and track your progress.`)}
    <p style="margin:0 0 22px;">
      <a href="${link}" style="display:inline-block;background:${accent};color:#0a0a0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">Open the app</a>
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;margin:0 0 16px;">
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Link</td><td><a href="${link}" style="color:#374151;">${link}</a></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Email</td><td><strong>${login.email}</strong></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#6b7280;">Temporary password</td><td><strong>${temp}</strong></td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#6b7280;">You can change your password after signing in.</p>`;
  const html = renderEmailShell({
    businessName: business,
    accent,
    heading: `Your ${business} app`,
    bodyHtml,
    footer: `Sent by ${business}. If you didn't expect this, you can ignore it.`,
  });

  const res = await sendEmail({ to: login.email, subject: `Your ${business} app login`, html });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/clients/${cid}`);
  return { ok: true };
}

/**
 * Migration bulk-invite: for the given clients (or ALL when `clientIds` is null)
 * that have an email and no existing app credential, mint a credential and email
 * a "set your password" link. Tenant is the authed admin's — never client-supplied.
 * Skips: no email, email already used by another login, or already has a login.
 */
export async function bulkInviteMembersAction(
  clientIds: number[] | null,
): Promise<{ ok: true; sent: number; skipped: number } | { ok: false; error: string }> {
  await requireAdmin();
  const m = getCurrentMembership();
  if (!m) return { ok: false, error: "Not signed in." };
  const tenantId = m.tenant.id;
  if (!isEmailConfigured()) {
    return { ok: false, error: "Email isn't set up yet — connect Gmail or Resend in Settings → Email." };
  }

  const ids = Array.isArray(clientIds)
    ? clientIds.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : null;

  let rows: Array<{ id: number; email: string | null }>;
  if (ids === null) {
    rows = db.select({ id: clients.id, email: clients.email }).from(clients).all();
  } else if (ids.length === 0) {
    rows = [];
  } else {
    rows = db.select({ id: clients.id, email: clients.email }).from(clients).where(inArray(clients.id, ids)).all();
  }

  let sent = 0;
  let skipped = 0;
  for (const c of rows) {
    const email = (c.email ?? "").trim();
    if (!email.includes("@")) {
      skipped++;
      continue;
    }
    const cred = createClientCredential(tenantId, c.id, email);
    if (!cred.ok || !cred.created) {
      // email taken by another login, invalid, or the member already has a login
      skipped++;
      continue;
    }
    const res = await sendClientAppInvite(tenantId, cred.credentialId, email);
    if (res.ok) sent++;
    else skipped++;
  }

  revalidatePath("/clients");
  return { ok: true, sent, skipped };
}

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
  await fireTrigger("nutrition_plan_added", c.data);
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
  await fireTrigger("workout_plan_added", c.data);
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
