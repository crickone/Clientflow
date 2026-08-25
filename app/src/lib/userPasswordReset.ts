import "server-only";

import crypto from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { authSessions, memberships, tenants, userPasswordResets, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";

/**
 * Staff (operator) password resets — the `users`-table analogue of
 * `clientPasswordReset.ts`. A single-use, expiring token bound to a `users`
 * row (control plane). Powers the signed-out "Forgot password?" flow:
 * /login -> /forgot-password -> emailed link -> /reset-password?token=….
 *
 * Two deliberate deviations from clientPasswordReset.ts's imports, both for
 * the same reason — keeping this module's TOP-LEVEL import graph free of
 * anything that only resolves under Next's own bundler, so it stays
 * importable under this repo's plain-tsx test runner (`scripts/test.mjs`,
 * `--conditions=react-server`):
 *
 *  1. `hashPassword` comes from the leaf module `@/lib/password` (pure
 *     node:crypto) rather than `@/lib/auth` — that module imports `cache`
 *     from "react" and `cookies` from "next/headers" at its top level, which
 *     throw outside Next's bundler (see `@/lib/platform/auth.ts`'s identical
 *     note). Both re-export the SAME function from `@/lib/password`, so the
 *     hash format is unaffected — this is just importing from the original
 *     rather than the facade.
 *  2. The tenant-branded email (which needs `@/lib/email` -> `@/lib/db/tenant`
 *     -> react `cache`, plus `next/headers` via `@/lib/appUrl`) is imported
 *     LAZILY inside `sendUserResetEmail`, reached only once a matching
 *     active user + active membership is found — never during module load.
 *     Fully equivalent at runtime (Next resolves a dynamic import() exactly
 *     like a static one); just deferred so a test that never reaches that
 *     branch never touches the poisoned graph.
 */

const RESET_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const MIN_PASSWORD_LENGTH = 8; // staff — matches acceptInvite's floor (users.mustChangePassword flow)

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Mint a fresh single-use token for a user, superseding any prior unused
 * token for them (so a re-send invalidates old links). Returns the raw token.
 */
export function createUserResetToken(userId: number, ttlMs = RESET_TTL_MS): string {
  authDb
    .delete(userPasswordResets)
    .where(and(eq(userPasswordResets.userId, userId), isNull(userPasswordResets.usedAt)))
    .run();
  const token = newToken();
  authDb
    .insert(userPasswordResets)
    .values({ userId, token, expiresAt: new Date(Date.now() + ttlMs) })
    .run();
  return token;
}

export type UserResetTokenView =
  | { status: "valid"; email: string }
  | { status: "expired" | "used" | "invalid" };

/** Resolve a token for the /reset-password page. Never throws. */
export function verifyUserResetToken(token: string): UserResetTokenView {
  const row = authDb
    .select()
    .from(userPasswordResets)
    .where(eq(userPasswordResets.token, token))
    .get();
  if (!row) return { status: "invalid" };
  if (row.usedAt) return { status: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };
  const user = authDb.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) return { status: "invalid" };
  return { status: "valid", email: user.email };
}

export type UserResetResult = { ok: true } | { ok: false; error: string };

/**
 * Set a new password from a token: single-use + expiry enforced. Clears
 * must_change_password and revokes every other session. The token is the
 * bearer of authority here (no session required).
 */
export function completeUserReset(token: string, newPassword: string): UserResetResult {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const row = authDb
    .select()
    .from(userPasswordResets)
    .where(eq(userPasswordResets.token, token))
    .get();
  if (!row) return { ok: false, error: "This link is invalid." };
  if (row.usedAt) return { ok: false, error: "This link has already been used." };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "This link has expired. Request a new one." };
  }

  // A reset link must NOT silently re-enable an account an admin has disabled
  // (staff offboarded / access revoked). If the user is no longer active,
  // burn the token and refuse — admin revocation stays durable against a
  // pending link, and we never flip isActive back on.
  const user = authDb
    .select({ isActive: users.isActive })
    .from(users)
    .where(eq(users.id, row.userId))
    .get();
  if (!user || !user.isActive) {
    authDb
      .update(userPasswordResets)
      .set({ usedAt: new Date() })
      .where(eq(userPasswordResets.id, row.id))
      .run();
    return { ok: false, error: "This account is no longer active. Please contact an admin." };
  }

  authDb.transaction((tx) => {
    tx
      // Only the password + must-change-password flag change — never isActive
      // (the account is already active; a reset must not reactivate a disabled one).
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
      .where(eq(users.id, row.userId))
      .run();
    tx
      .update(userPasswordResets)
      .set({ usedAt: new Date() })
      .where(eq(userPasswordResets.id, row.id))
      .run();
    // Revoke every existing session for this user. This flow is
    // token-bearer-authenticated, not cookie-authenticated, so there's no
    // "current session" to preserve — a password reset should log out any
    // other device signed in with the old password.
    tx.delete(authSessions).where(eq(authSessions.userId, row.userId)).run();
  });
  return { ok: true };
}

/**
 * Forgot-password entrypoint. ALWAYS returns success-shaped to avoid email
 * enumeration — the caller can't tell whether an account existed. When an
 * active user with an active membership is found, a reset link is emailed
 * from their first active tenant's business.
 */
export async function requestUserReset(email: string): Promise<{ ok: true }> {
  const normEmail = (email ?? "").trim().toLowerCase();
  if (!normEmail.includes("@")) return { ok: true };
  const user = authDb.select().from(users).where(eq(users.email, normEmail)).get();
  if (!user || !user.isActive) return { ok: true };

  const token = createUserResetToken(user.id);

  // First active tenant (earliest-granted active membership in an active
  // tenant) — queried directly against memberships/tenants, the same shape
  // /api/auth/login's multi-account resolution uses, rather than calling
  // @/lib/auth's listActiveMemberships: see the file header for why this
  // module avoids importing @/lib/auth at all.
  const membership = authDb
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.isActive, true),
        eq(tenants.isActive, true),
      ),
    )
    .orderBy(memberships.id)
    .get();

  if (membership) {
    // Fire-and-forget the email so the response returns at the same speed
    // whether or not the account exists — awaiting the outbound mail API
    // here would leak (via latency) whether an address belongs to a staff
    // account.
    void sendUserResetEmail(membership.tenantId, user.email, token).catch((err) => {
      console.error("[userPasswordReset] reset email failed:", err);
    });
  }
  // No active membership: skip the email (nothing to brand it with / no
  // business to send "from"), but still report success — enumeration-safety
  // doesn't bend for this edge case either.
  return { ok: true };
}

async function sendUserResetEmail(tenantId: number, email: string, token: string) {
  // Lazily imported — see the file header note on why this module's
  // top-level import graph never touches next/headers or react's `cache`.
  const { sendEmailForTenant, renderEmailShell, textToParagraphs } = await import("@/lib/email");
  const { getBusinessProfileForTenant } = await import("@/lib/businessProfile");
  const { getThemeForTenant } = await import("@/lib/settings");
  const { getAppBaseUrl } = await import("@/lib/appUrl");

  const business = getBusinessProfileForTenant(tenantId).businessName;
  const accent = getThemeForTenant(tenantId).accent;
  const link = `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;

  const bodyHtml = `
    ${textToParagraphs(`We received a request to reset the password for your ${business} team account.`)}
    <p style="margin:0 0 24px;">
      <a href="${link}" style="display:inline-block;background:${accent};color:#0a0a0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">Reset password</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Or paste this link into your browser:<br/><span style="color:#6b7280;word-break:break-all;">${link}</span></p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">This link expires in 2 hours. If you didn't request this, you can safely ignore this email.</p>`;
  const html = renderEmailShell({
    businessName: business,
    accent,
    heading: "Reset your password",
    bodyHtml,
    footer: `Sent by ${business}.`,
  });
  return sendEmailForTenant(tenantId, {
    to: email,
    subject: `Reset your ${business} password`,
    html,
  });
}

/** Housekeeping: drop expired, unused tokens (safe to call from schedulers). */
export function purgeExpiredUserResets(): void {
  authDb
    .delete(userPasswordResets)
    .where(and(lt(userPasswordResets.expiresAt, new Date()), isNull(userPasswordResets.usedAt)))
    .run();
}
