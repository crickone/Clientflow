import "server-only";

import crypto from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, lt } from "drizzle-orm";

import { getBilling } from "@/lib/billing/engine";
import { authDb, SESSION_COOKIE } from "@/lib/db/control";
import { resolveSessionTenant } from "@/lib/db/tenant";
import {
  authSessions,
  memberships,
  tenants,
  users,
  type Tenant,
  type User,
} from "@/lib/db/schema";

export { SESSION_COOKIE };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type Role = "admin" | "staff";

// Password hashing/verification lives in the leaf module `@/lib/password`
// (pure node:crypto, no react/next imports) so it can be shared with
// `@/lib/platform/auth.ts`, which must stay importable under the plain-tsx
// test runner (this file pulls in react's `cache` + next/headers' `cookies`,
// which don't resolve outside Next's bundler).
export { hashPassword, verifyPassword } from "@/lib/password";

export async function createSession(
  userId: number,
  activeTenantId: number | null = null,
): Promise<string> {
  const id = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await authDb
    .insert(authSessions)
    .values({ id, userId, activeTenantId, expiresAt });
  cookies().set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return id;
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) {
    await authDb.delete(authSessions).where(eq(authSessions.id, token));
  }
  cookies().delete(SESSION_COOKIE);
}

export interface CurrentMembership {
  user: User;
  tenant: Tenant;
  role: Role;
}

/**
 * The per-request source of truth: identity + active tenant + role, resolved from
 * the session cookie and validated against a LIVE membership. Memoised per
 * request. Returns null when:
 *  - unauthenticated (no cookie / unknown or expired session / inactive user);
 *  - the session has no resolvable active tenant — a user with 0 or >1 active
 *    memberships who hasn't chosen one (→ /select-account). A user with exactly
 *    one active membership auto-resolves to it, so single-clinic users never need
 *    to choose even if the session predates the active-tenant column;
 *  - the active membership no longer exists or was deactivated (revoked access →
 *    fail closed, even if the session cookie is still valid).
 * Sync (better-sqlite3 is synchronous); safe to call from server components,
 * actions, and route handlers within a request scope.
 */
export const getCurrentMembership = cache((): CurrentMembership | null => {
  let token: string | undefined;
  try {
    token = cookies().get(SESSION_COOKIE)?.value;
  } catch {
    return null; // outside a request scope (background job)
  }
  if (!token) return null;

  const session = authDb
    .select({
      userId: authSessions.userId,
      activeTenantId: authSessions.activeTenantId,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(eq(authSessions.id, token))
    .get();
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  const user = authDb
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user || !user.isActive) return null;

  // Resolve + authorize the active tenant (auto-resolve a single-membership
  // session, validate a LIVE membership). Shared with the db-proxy resolution
  // in lib/db/tenant so authorization and DB routing can never drift apart.
  const resolved = resolveSessionTenant(user.id, session.activeTenantId);
  if (!resolved) return null;

  const tenant = authDb
    .select()
    .from(tenants)
    .where(eq(tenants.id, resolved.tenantId))
    .get();
  if (!tenant || !tenant.isActive) return null;

  return { user, tenant, role: resolved.role };
});

export interface MembershipOption {
  tenantId: number;
  slug: string;
  name: string;
  role: Role;
}

/**
 * A user's active memberships (active clinics only), with tenant name + role.
 * Powers the account selector and the in-app switcher.
 */
export async function listActiveMemberships(
  userId: number,
): Promise<MembershipOption[]> {
  return authDb
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.isActive, true),
        eq(tenants.isActive, true),
      ),
    )
    .all();
}

/**
 * Identity-level session check (does NOT require a resolved tenant/membership).
 * Returns the user with their EFFECTIVE role in the active clinic when one is
 * resolved, else the legacy user.role. Page guards use this to tell "no identity"
 * (→ /login) apart from "valid identity, no active clinic" (→ /select-account).
 */
export async function getSessionUser(): Promise<User | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await authDb
    .select({
      user: users,
      expiresAt: authSessions.expiresAt,
      activeTenantId: authSessions.activeTenantId,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(eq(authSessions.id, token))
    .get();

  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await authDb.delete(authSessions).where(eq(authSessions.id, token));
    return null;
  }
  if (!row.user.isActive) return null;

  let role = row.user.role;
  if (row.activeTenantId != null) {
    const m = authDb
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, row.user.id),
          eq(memberships.tenantId, row.activeTenantId),
          eq(memberships.isActive, true),
        ),
      )
      .get();
    if (m) role = m.role;
  }
  return { ...row.user, role };
}

/**
 * Billing enforcement at the AUTH layer, so it covers every API route (via
 * guard()) and every server action (which call requireUser/requireAdmin
 * directly) — not just page navigations. Previously suspension was only a
 * layout redirect that explicitly exempted /api/* and never ran for server
 * actions, so a suspended tenant's staff could keep reading/writing all data.
 *
 * Blocks `suspended` and `pending_payment` (matching the page gate). Platform
 * admins bypass — they administer suspended tenants. The billing pages
 * themselves and /api/billing/capture/start use requireUserPage /
 * getCurrentMembership directly, so the payment path stays reachable.
 */
function assertTenantBillingActive(m: CurrentMembership): void {
  if (m.user.isPlatformAdmin) return;
  const billing = getBilling(m.tenant.id);
  if (
    billing &&
    !billing.billingExempt &&
    (billing.status === "suspended" || billing.status === "pending_payment")
  ) {
    throw new Error("TENANT_SUSPENDED");
  }
}

export async function requireUser(): Promise<User> {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  assertTenantBillingActive(m);
  return { ...m.user, role: m.role };
}

export async function requireAdmin(): Promise<User> {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  if (m.role !== "admin") throw new Error("FORBIDDEN");
  assertTenantBillingActive(m);
  return { ...m.user, role: m.role };
}

/** Platform super-admin: may manage tenants across the whole control plane. */
export async function requirePlatformAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.isPlatformAdmin) throw new Error("FORBIDDEN");
  return user;
}

/**
 * Use at the top of admin-only page server components. Redirects unauthenticated
 * users to /login, and non-admin users to /dashboard.
 */
export async function requireAdminPage(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const m = getCurrentMembership();
  if (!m) redirect("/select-account");
  if (m.role !== "admin") redirect("/dashboard");
  return { ...m.user, role: m.role };
}

/**
 * Use at the top of any signed-in page server component to ensure the visitor
 * is authenticated. Redirects to /login when there's no identity, to
 * /change-password when a reset is pending, and to /select-account when the
 * identity is valid but no clinic is active (a multi-clinic user mid-login).
 */
export async function requireUserPage(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  const m = getCurrentMembership();
  if (!m) redirect("/select-account");
  return { ...m.user, role: m.role };
}

/**
 * Set the active clinic for the current session, after validating that the
 * session user holds a live membership in the target tenant. The authority for a
 * switch — the selector UI / sidebar dropdown are conveniences that always defer
 * to this check. Returns an error result rather than throwing so callers can
 * surface it in the UI.
 */
export async function setActiveTenant(
  tenantId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return { ok: false, error: "Not signed in" };

  const session = await authDb
    .select({ userId: authSessions.userId, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .where(eq(authSessions.id, token))
    .get();
  if (!session) return { ok: false, error: "Not signed in" };
  if (session.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: "Session expired" };
  }

  const membership = await authDb
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, session.userId),
        eq(memberships.tenantId, tenantId),
        eq(memberships.isActive, true),
      ),
    )
    .get();
  if (!membership) return { ok: false, error: "No access to that account" };

  await authDb
    .update(authSessions)
    .set({ activeTenantId: tenantId })
    .where(eq(authSessions.id, token));
  return { ok: true };
}

export async function purgeExpiredSessions(): Promise<void> {
  await authDb.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}
