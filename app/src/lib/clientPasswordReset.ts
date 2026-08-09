import "server-only";

import crypto from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { clientCredentials, clientPasswordResets, clientSessions } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import {
  renderEmailShell,
  sendEmailForTenant,
  textToParagraphs,
  type SendResult,
} from "@/lib/email";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";

/**
 * Client-app password resets + first-password invites. A single-use, expiring
 * token bound to a client_credentials row (control plane). Used by:
 *  - the migration bulk-invite ("set your password" onboarding link), and
 *  - the client-app forgot-password flow.
 * The tenant is ALWAYS resolved from the credential row — never from a request
 * cookie — so the forgot-password flow (unauthenticated, no tenant context)
 * still emails from the correct business.
 */

const RESET_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — forgot-password
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — first-password onboarding

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Mint a fresh single-use token for a credential, superseding any prior unused
 * token for it (so a re-send invalidates old links). Returns the raw token.
 */
export function createClientResetToken(credentialId: number, ttlMs = RESET_TTL_MS): string {
  authDb
    .delete(clientPasswordResets)
    .where(
      and(
        eq(clientPasswordResets.credentialId, credentialId),
        isNull(clientPasswordResets.usedAt),
      ),
    )
    .run();
  const token = newToken();
  authDb
    .insert(clientPasswordResets)
    .values({ credentialId, token, expiresAt: new Date(Date.now() + ttlMs) })
    .run();
  return token;
}

export type ResetTokenView =
  | { status: "valid"; email: string; businessName: string }
  | { status: "expired" | "used" | "invalid" };

/** Resolve a token for the /app/reset page. Never throws. */
export function verifyResetToken(token: string): ResetTokenView {
  const row = authDb
    .select()
    .from(clientPasswordResets)
    .where(eq(clientPasswordResets.token, token))
    .get();
  if (!row) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };
  const cred = authDb
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.id, row.credentialId))
    .get();
  if (!cred) return { status: "invalid" };
  return {
    status: "valid",
    email: cred.email,
    businessName: getBusinessProfileForTenant(cred.tenantId).businessName,
  };
}

export type ResetResult = { ok: true } | { ok: false; error: string };

/**
 * Set a new password from a token: single-use + expiry enforced. Clears
 * must_change_password and (re)activates the login. The token is the bearer of
 * authority here (no session required).
 */
export function completeClientReset(token: string, newPassword: string): ResetResult {
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const row = authDb
    .select()
    .from(clientPasswordResets)
    .where(eq(clientPasswordResets.token, token))
    .get();
  if (!row) return { ok: false, error: "This link is invalid." };
  if (row.usedAt) return { ok: false, error: "This link has already been used." };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This link has expired. Request a new one." };
  }

  // A reset link must NOT silently re-enable a login an admin has disabled
  // (member left / fraud / GDPR). If the credential is no longer active, burn
  // the token and refuse — admin revocation stays durable against a pending
  // link, and we never flip isActive back on.
  const cred = authDb
    .select({ isActive: clientCredentials.isActive })
    .from(clientCredentials)
    .where(eq(clientCredentials.id, row.credentialId))
    .get();
  if (!cred || !cred.isActive) {
    authDb
      .update(clientPasswordResets)
      .set({ usedAt: new Date() })
      .where(eq(clientPasswordResets.id, row.id))
      .run();
    return { ok: false, error: "This account is no longer active. Please contact your gym." };
  }

  authDb.transaction((tx) => {
    tx
      // Only the password + first-login flag change — never isActive (the
      // credential is already active; a reset must not reactivate a disabled one).
      .update(clientCredentials)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
      .where(eq(clientCredentials.id, row.credentialId))
      .run();
    tx
      .update(clientPasswordResets)
      .set({ usedAt: new Date() })
      .where(eq(clientPasswordResets.id, row.id))
      .run();
    // Revoke every existing app session for this credential. This flow is
    // token-bearer-authenticated, not cookie-authenticated, so there's no
    // "current session" to preserve — a password reset/first-set should log
    // out any other device using the old (or, for an invite, a not-yet-known)
    // password.
    tx
      .delete(clientSessions)
      .where(eq(clientSessions.credentialId, row.credentialId))
      .run();
  });
  return { ok: true };
}

/**
 * Forgot-password entrypoint. ALWAYS returns success-shaped to avoid email
 * enumeration — the caller can't tell whether an account existed. When an active
 * credential is found, a reset link is emailed from that credential's tenant.
 */
export async function requestClientReset(email: string): Promise<{ ok: true }> {
  const normEmail = (email ?? "").trim().toLowerCase();
  if (!normEmail.includes("@")) return { ok: true };
  const cred = authDb
    .select()
    .from(clientCredentials)
    .where(eq(clientCredentials.email, normEmail))
    .get();
  if (!cred || !cred.isActive) return { ok: true };
  const token = createClientResetToken(cred.id, RESET_TTL_MS);
  // Fire-and-forget the email so the response returns at the same speed whether
  // or not the account exists — awaiting the outbound mail API here would leak
  // (via latency) whether an address belongs to a client of this clinic.
  void sendClientResetEmail(cred.tenantId, cred.email, token, "reset").catch((err) => {
    console.error("[clientPasswordReset] reset email failed:", err);
  });
  return { ok: true };
}

/**
 * Bulk-invite entrypoint: mint an onboarding token for an existing credential
 * and email the "set your password" link. Explicit tenant (the authed admin's).
 */
export async function sendClientAppInvite(
  tenantId: number,
  credentialId: number,
  email: string,
): Promise<SendResult> {
  const token = createClientResetToken(credentialId, INVITE_TTL_MS);
  return sendClientResetEmail(tenantId, email, token, "invite");
}

async function sendClientResetEmail(
  tenantId: number,
  email: string,
  token: string,
  mode: "reset" | "invite",
): Promise<SendResult> {
  const business = getBusinessProfileForTenant(tenantId).businessName;
  const accent = getThemeForTenant(tenantId).accent;
  const link = `${getAppBaseUrl()}/app/reset?token=${encodeURIComponent(token)}`;

  const heading = mode === "invite" ? `Your ${business} app` : `Reset your password`;
  const intro =
    mode === "invite"
      ? `You've been invited to the ${business} app — where you'll find your plans, book classes, and track your progress. Set a password to get started.`
      : `We received a request to reset the password for your ${business} app account.`;
  const cta = mode === "invite" ? "Set your password" : "Reset password";
  const expiryNote =
    mode === "invite"
      ? "This link expires in 14 days."
      : "This link expires in 2 hours. If you didn't request this, you can safely ignore this email.";
  const subject = mode === "invite" ? `Your ${business} app login` : `Reset your ${business} password`;

  const bodyHtml = `
    ${textToParagraphs(intro)}
    <p style="margin:0 0 24px;">
      <a href="${link}" style="display:inline-block;background:${accent};color:#0a0a0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">${cta}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Or paste this link into your browser:<br/><span style="color:#6b7280;word-break:break-all;">${link}</span></p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">${expiryNote}</p>`;
  const html = renderEmailShell({
    businessName: business,
    accent,
    heading,
    bodyHtml,
    footer: `Sent by ${business}.`,
  });
  return sendEmailForTenant(tenantId, { to: email, subject, html });
}

/** Housekeeping: drop expired, unused tokens (safe to call from schedulers). */
export function purgeExpiredClientResets(): void {
  authDb
    .delete(clientPasswordResets)
    .where(and(lt(clientPasswordResets.expiresAt, new Date()), isNull(clientPasswordResets.usedAt)))
    .run();
}
