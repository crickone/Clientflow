import "server-only";

import crypto from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { authSessions, memberships, userInvites, userPasswordResets, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/password";
import { createInvite, inviteAcceptUrl, sendInviteEmail } from "@/lib/invites";
import { createUserResetToken } from "@/lib/userPasswordReset";
import { runWithTenant } from "@/lib/db/tenant";

/**
 * Who can get into a business, seen and changed from the platform console.
 *
 * The same work the tenant's own Settings > Users page does, but for an
 * EXPLICIT tenant rather than whichever one the caller is signed into. The
 * tenant page's server actions all start from `adminContext()` -- the
 * session's own tenant -- so they cannot be called from here at all; what is
 * shared instead is the layer underneath: `createInvite`, `sendInviteEmail`,
 * `createUserResetToken`, `hashPassword`. Those are the parts with the
 * subtle rules in them (token lifetimes, email shells, one live invite per
 * address), and duplicating any of them would be how the two paths drift.
 *
 * Everything here reads and writes the CONTROL plane: users, memberships,
 * invites, resets and sessions all live there, because a person can belong
 * to more than one business.
 */

export type TenantRole = "admin" | "staff";

export interface TenantPerson {
  userId: number;
  email: string;
  name: string | null;
  role: TenantRole;
  /** The membership row's own flag: revoked access without deleting the person. */
  membershipActive: boolean;
  /** The user account itself: a disabled account cannot sign into anything. */
  accountActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  /** Live sessions for this person, in THIS business. */
  activeSessions: number;
  isPlatformStaff: boolean;
}

export interface PendingInvite {
  id: number;
  email: string;
  role: TenantRole;
  invitedByEmail: string | null;
  expiresAt: number;
  expired: boolean;
  createdAt: number;
}

export interface OpenReset {
  userId: number;
  email: string;
  expiresAt: number;
  createdAt: number;
}

export interface TenantPeople {
  people: TenantPerson[];
  invites: PendingInvite[];
  resets: OpenReset[];
}

export function listTenantPeople(tenantId: number): TenantPeople {
  const now = Date.now();

  const rows = authDb
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      membershipActive: memberships.isActive,
      accountActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(users.email)
    .all();

  // Live sessions per person, scoped to this business: a user signed into
  // another of their businesses is not "in" this one.
  const sessions = authDb
    .select({ userId: authSessions.userId })
    .from(authSessions)
    .where(and(eq(authSessions.activeTenantId, tenantId), gt(authSessions.expiresAt, new Date(now))))
    .all();
  const sessionCount = new Map<number, number>();
  for (const s of sessions) sessionCount.set(s.userId, (sessionCount.get(s.userId) ?? 0) + 1);

  const inviteRows = authDb
    .select({
      id: userInvites.id,
      email: userInvites.email,
      role: userInvites.role,
      invitedByUserId: userInvites.invitedByUserId,
      expiresAt: userInvites.expiresAt,
      createdAt: userInvites.createdAt,
    })
    .from(userInvites)
    .where(and(eq(userInvites.tenantId, tenantId), isNull(userInvites.acceptedAt)))
    .orderBy(desc(userInvites.createdAt))
    .all();

  const inviterEmails = new Map<number, string>();
  for (const id of new Set(inviteRows.map((i) => i.invitedByUserId).filter((x): x is number => x != null))) {
    const u = authDb.select({ email: users.email }).from(users).where(eq(users.id, id)).get();
    if (u) inviterEmails.set(id, u.email);
  }

  // Open resets, only for people who belong to THIS business -- a reset is a
  // property of the account, but the console shows it in a tenant's context.
  const memberIds = new Set(rows.map((r) => r.userId));
  const resets = authDb
    .select({
      userId: userPasswordResets.userId,
      expiresAt: userPasswordResets.expiresAt,
      createdAt: userPasswordResets.createdAt,
    })
    .from(userPasswordResets)
    .where(and(isNull(userPasswordResets.usedAt), gt(userPasswordResets.expiresAt, new Date(now))))
    .all()
    .filter((r) => memberIds.has(r.userId));
  const emailById = new Map(rows.map((r) => [r.userId, r.email]));

  return {
    people: rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      role: r.role as TenantRole,
      membershipActive: Boolean(r.membershipActive),
      accountActive: Boolean(r.accountActive),
      mustChangePassword: Boolean(r.mustChangePassword),
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.getTime() : null,
      createdAt: r.createdAt.getTime(),
      activeSessions: sessionCount.get(r.userId) ?? 0,
      isPlatformStaff: Boolean(r.isPlatformAdmin),
    })),
    invites: inviteRows.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role as TenantRole,
      invitedByEmail: i.invitedByUserId != null ? (inviterEmails.get(i.invitedByUserId) ?? null) : null,
      expiresAt: i.expiresAt.getTime(),
      expired: i.expiresAt.getTime() < now,
      createdAt: i.createdAt.getTime(),
    })),
    resets: resets.map((r) => ({
      userId: r.userId,
      email: emailById.get(r.userId) ?? "",
      expiresAt: r.expiresAt.getTime(),
      createdAt: r.createdAt.getTime(),
    })),
  };
}

export type PeopleResult = { ok: true; note?: string; link?: string } | { ok: false; error: string };

/** The admins of a business who can still sign in. Used to refuse leaving one with none. */
function activeAdminIds(tenantId: number): number[] {
  return authDb
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "admin"), eq(memberships.isActive, true), eq(users.isActive, true)))
    .all()
    .map((r) => r.userId);
}

/**
 * Invite someone into a business, or add them if they already have an
 * account. Mirrors the tenant page's own rule: an existing account is added
 * to the business and keeps its current login, rather than being sent a
 * "set your password" link it does not need.
 *
 * The invite email is sent in the TENANT's scope, so it carries their
 * business name, their accent colour and their sending identity rather than
 * whatever tenant the console happens to have touched last.
 */
export async function inviteToTenant(input: {
  tenantId: number;
  email: string;
  role: TenantRole;
  name?: string | null;
  invitedByUserId: number;
  inviterName: string | null;
}): Promise<PeopleResult> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || email.length < 5) return { ok: false, error: "That does not look like an email address." };

  const existing = authDb.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.email, email)).get();

  if (existing) {
    const already = authDb
      .select({ id: memberships.id, isActive: memberships.isActive })
      .from(memberships)
      .where(and(eq(memberships.userId, existing.id), eq(memberships.tenantId, input.tenantId)))
      .get();
    if (already?.isActive) return { ok: false, error: "They already have access to this business." };
    if (already) {
      authDb.update(memberships).set({ role: input.role, isActive: true }).where(eq(memberships.id, already.id)).run();
      return { ok: true, note: "Access restored — they use their existing login." };
    }
    authDb.insert(memberships).values({ userId: existing.id, tenantId: input.tenantId, role: input.role, isActive: true }).run();
    return { ok: true, note: "Existing account added — they use their current login." };
  }

  // A brand-new person: a shell account with an unusable password, plus an
  // invite token that lets them set a real one. The random hash is not a
  // password anybody holds -- it exists so the row is never login-able
  // before the invite is accepted.
  const created = authDb
    .insert(users)
    .values({
      email,
      name: input.name?.trim() || null,
      passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")),
      role: input.role,
      isActive: true,
    })
    .returning({ id: users.id })
    .get();
  authDb.insert(memberships).values({ userId: created.id, tenantId: input.tenantId, role: input.role, isActive: true }).run();

  const token = createInvite({
    email,
    tenantId: input.tenantId,
    userId: created.id,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
  });

  const sent = await runWithTenant(input.tenantId, () =>
    sendInviteEmail({ email, token, role: input.role, inviterName: input.inviterName }),
  );
  // A failed send must not lose the invite: the link is handed back so the
  // staff member can pass it on themselves.
  return sent.ok
    ? { ok: true, note: "Invite sent." }
    : { ok: true, note: "Account created, but the invite email could not be sent. Send them this link.", link: inviteAcceptUrl(token) };
}

/** Re-issue an invite for someone who has not accepted yet. */
export async function resendTenantInvite(input: {
  tenantId: number;
  email: string;
  invitedByUserId: number;
  inviterName: string | null;
}): Promise<PeopleResult> {
  const email = input.email.trim().toLowerCase();
  const pending = authDb
    .select({ role: userInvites.role, userId: userInvites.userId })
    .from(userInvites)
    .where(and(eq(userInvites.tenantId, input.tenantId), eq(userInvites.email, email), isNull(userInvites.acceptedAt)))
    .get();
  if (!pending) return { ok: false, error: "There is no pending invite for that address." };

  const token = createInvite({
    email,
    tenantId: input.tenantId,
    userId: pending.userId ?? 0,
    role: pending.role as TenantRole,
    invitedByUserId: input.invitedByUserId,
  });
  const sent = await runWithTenant(input.tenantId, () =>
    sendInviteEmail({ email, token, role: pending.role as TenantRole, inviterName: input.inviterName }),
  );
  return sent.ok
    ? { ok: true, note: "Invite re-sent." }
    : { ok: true, note: "Could not send the email. Send them this link.", link: inviteAcceptUrl(token) };
}

export function cancelTenantInvite(tenantId: number, inviteId: number): PeopleResult {
  const row = authDb
    .select({ id: userInvites.id })
    .from(userInvites)
    .where(and(eq(userInvites.id, inviteId), eq(userInvites.tenantId, tenantId), isNull(userInvites.acceptedAt)))
    .get();
  if (!row) return { ok: false, error: "That invite is no longer pending." };
  authDb.delete(userInvites).where(eq(userInvites.id, inviteId)).run();
  return { ok: true, note: "Invite cancelled." };
}

/**
 * Change someone's role inside a business. Refuses to remove the last admin
 * who can still sign in: a business with no admin cannot manage its own
 * staff, billing or settings, and only the console could rescue it.
 */
export function setTenantRole(tenantId: number, userId: number, role: TenantRole): PeopleResult {
  const row = authDb
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .get();
  if (!row) return { ok: false, error: "They do not have access to this business." };
  if (row.role === role) return { ok: true, note: "No change." };

  if (row.role === "admin" && role === "staff") {
    const admins = activeAdminIds(tenantId);
    if (admins.length <= 1 && admins[0] === userId) {
      return { ok: false, error: "This is the only admin. Make someone else an admin first." };
    }
  }
  authDb.update(memberships).set({ role }).where(eq(memberships.id, row.id)).run();
  return { ok: true, note: `Now ${role === "admin" ? "an admin" : "staff"}.` };
}

/**
 * Turn someone's access to a business on or off. This is the membership, not
 * the account: they keep their login and any other business they belong to.
 * Revoking also ends their live sessions in this business, so access stops
 * now rather than whenever their cookie happens to expire.
 */
export function setTenantAccess(tenantId: number, userId: number, active: boolean): PeopleResult {
  const row = authDb
    .select({ id: memberships.id, role: memberships.role, isActive: memberships.isActive })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .get();
  if (!row) return { ok: false, error: "They do not have access to this business." };

  if (!active && row.role === "admin") {
    const admins = activeAdminIds(tenantId);
    if (admins.length <= 1 && admins[0] === userId) {
      return { ok: false, error: "This is the only admin. Make someone else an admin first." };
    }
  }

  authDb.update(memberships).set({ isActive: active }).where(eq(memberships.id, row.id)).run();
  if (!active) revokeTenantSessions(tenantId, userId);
  return { ok: true, note: active ? "Access restored." : "Access revoked and sessions ended." };
}

/** End this person's live sessions in this business. Returns how many were ended. */
export function revokeTenantSessions(tenantId: number, userId: number): number {
  const result = authDb
    .delete(authSessions)
    .where(and(eq(authSessions.userId, userId), eq(authSessions.activeTenantId, tenantId)))
    .run();
  return result.changes;
}

/**
 * Start a password reset for someone. The console never sets or sees a
 * password: it mints the same token the "forgot password" flow uses and
 * hands back the link, so a staff member can read it out on a call when the
 * email does not arrive.
 */
export async function startPasswordReset(tenantId: number, userId: number): Promise<PeopleResult> {
  const user = authDb.select({ email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId)).get();
  if (!user) return { ok: false, error: "No such person." };
  if (!user.isActive) return { ok: false, error: "That account is disabled. Re-enable it first." };

  const token = createUserResetToken(userId);
  const { getAppBaseUrl } = await import("@/lib/appUrl");
  const link = `${getAppBaseUrl()}/reset-password?token=${token}`;

  // Best-effort email in the tenant's own branding; the link is returned
  // either way, which is the part that actually unblocks the person.
  try {
    const [{ sendEmailForTenant, renderEmailShell, textToParagraphs }, { getBusinessProfileForTenant }, { getThemeForTenant }] =
      await Promise.all([import("@/lib/email"), import("@/lib/businessProfile"), import("@/lib/settings")]);
    const business = getBusinessProfileForTenant(tenantId).businessName;
    const accent = getThemeForTenant(tenantId).accent;
    await sendEmailForTenant(tenantId, {
      to: user.email,
      subject: `Reset your ${business} password`,
      html: renderEmailShell({
        businessName: business,
        accent,
        heading: "Reset your password",
        bodyHtml: `${textToParagraphs(
          `Someone at ${business} started a password reset for you. Use the link below to choose a new password. If this was not expected, ignore this email and nothing changes.`,
        )}<p style="margin:0 0 24px;"><a href="${link}" style="display:inline-block;background:${accent};color:#0a0a0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">Set a new password</a></p>`,
        footer: `Sent by ${business}.`,
      }),
      text: `Reset your ${business} password: ${link}`,
    });
  } catch (err) {
    console.error("[platform-people] reset email failed:", err);
  }
  return { ok: true, note: "Reset link created and emailed.", link };
}

/**
 * Make one person the business's admin, and step every other admin down to
 * staff. The "hand this account to someone else" move, which is otherwise
 * several clicks that can leave a business with two owners or none.
 */
export function transferOwnership(tenantId: number, userId: number): PeopleResult {
  const target = authDb
    .select({ id: memberships.id, isActive: memberships.isActive })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId), eq(users.isActive, true)))
    .get();
  if (!target) return { ok: false, error: "That person cannot be made the owner: no active account here." };

  authDb.transaction((tx) => {
    tx.update(memberships).set({ role: "admin", isActive: true }).where(eq(memberships.id, target.id)).run();
    tx.update(memberships)
      .set({ role: "staff" })
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "admin")))
      .run();
    // The line above would have demoted the new owner too, so set them back
    // last: one statement each way is clearer than a NOT-IN clause here.
    tx.update(memberships).set({ role: "admin" }).where(eq(memberships.id, target.id)).run();
  });
  return { ok: true, note: "Ownership transferred; everyone else is now staff." };
}
