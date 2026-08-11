import "server-only";

import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { authSessions, memberships, userInvites, users } from "@/lib/db/schema";
import { getTenantById } from "@/lib/db/tenant";
import { hashPassword } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import {
  getEmailSender,
  renderEmailShell,
  sendPlatformEmail,
  textToParagraphs,
  type SendResult,
} from "@/lib/email";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Create (or refresh) an invite for a person in a tenant. Supersedes any prior
 * unaccepted invite for the same email+tenant so a re-send invalidates old links.
 */
export function createInvite(opts: {
  email: string;
  tenantId: number;
  userId: number;
  role: "admin" | "staff";
  invitedByUserId: number;
}): string {
  const email = opts.email.trim().toLowerCase();
  authDb
    .delete(userInvites)
    .where(
      and(
        eq(userInvites.email, email),
        eq(userInvites.tenantId, opts.tenantId),
        isNull(userInvites.acceptedAt),
      ),
    )
    .run();
  const token = newToken();
  authDb
    .insert(userInvites)
    .values({
      token,
      email,
      tenantId: opts.tenantId,
      userId: opts.userId,
      role: opts.role,
      invitedByUserId: opts.invitedByUserId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .run();
  return token;
}

export type InviteView = {
  token: string;
  email: string;
  tenantId: number;
  tenantName: string;
  role: "admin" | "staff";
  name: string | null;
  status: "valid" | "expired" | "accepted" | "invalid";
};

/** Resolve a token for the accept page. Never throws. */
export function getInviteByToken(token: string): InviteView {
  const inv = authDb
    .select()
    .from(userInvites)
    .where(eq(userInvites.token, token))
    .get();
  if (!inv) {
    return {
      token,
      email: "",
      tenantId: 0,
      tenantName: "",
      role: "staff",
      name: null,
      status: "invalid",
    };
  }
  const tenant = getTenantById(inv.tenantId);
  const person = inv.userId
    ? authDb.select({ name: users.name }).from(users).where(eq(users.id, inv.userId)).get()
    : null;
  let status: InviteView["status"] = "valid";
  if (inv.acceptedAt) status = "accepted";
  else if (inv.expiresAt.getTime() < Date.now()) status = "expired";
  return {
    token,
    email: inv.email,
    tenantId: inv.tenantId,
    tenantName: tenant?.name ?? "the account",
    role: inv.role,
    name: person?.name ?? null,
    status,
  };
}

/** All emails with a live (unaccepted, unexpired) invite in a tenant. */
export function listPendingInviteEmails(tenantId: number): Set<string> {
  const rows = authDb
    .select({ email: userInvites.email })
    .from(userInvites)
    .where(
      and(
        eq(userInvites.tenantId, tenantId),
        isNull(userInvites.acceptedAt),
        gt(userInvites.expiresAt, new Date()),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.email));
}

export type AcceptResult = { ok: true } | { ok: false; error: string };

/** Accept an invite: set the person's name + password and activate them. */
export function acceptInvite(
  token: string,
  input: { name: string; password: string },
): AcceptResult {
  const inv = authDb.select().from(userInvites).where(eq(userInvites.token, token)).get();
  if (!inv) return { ok: false, error: "This invite link is invalid." };
  if (inv.acceptedAt) return { ok: false, error: "This invite has already been used." };
  if (inv.expiresAt.getTime() < Date.now())
    return { ok: false, error: "This invite has expired. Ask an admin to re-send it." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Please enter your name." };
  if (input.password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters." };
  if (!inv.userId) return { ok: false, error: "This invite is missing its account." };

  authDb.transaction((tx) => {
    tx
      .update(users)
      .set({
        name,
        passwordHash: hashPassword(input.password),
        mustChangePassword: false,
        isActive: true,
      })
      .where(eq(users.id, inv.userId!))
      .run();
    // Make sure their membership in this tenant is active.
    tx
      .update(memberships)
      .set({ isActive: true })
      .where(and(eq(memberships.userId, inv.userId!), eq(memberships.tenantId, inv.tenantId)))
      .run();
    tx
      .update(userInvites)
      .set({ acceptedAt: new Date() })
      .where(eq(userInvites.id, inv.id))
      .run();
    // This is a token-bearer flow (unauthenticated), not a cookie session, so
    // there's no "current session" to spare — an invite can also be a re-invite
    // for an existing identity (e.g. re-activated staff), so revoke any
    // sessions that predate this password being set.
    tx.delete(authSessions).where(eq(authSessions.userId, inv.userId!)).run();
  });
  return { ok: true };
}

/**
 * The public accept-invite URL for a token — the exact link the email embeds.
 * Exposed so callers can hand it over manually (copy/share) when email isn't
 * set up for the tenant yet; the invite exists regardless of how it's delivered.
 */
export function inviteAcceptUrl(token: string): string {
  return `${getAppBaseUrl()}/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * Email the invite link. Uses the CURRENT tenant's sender identity (the admin
 * runs this from within their account). Returns the send result so the caller
 * can warn if the email couldn't go out (the invite still exists either way).
 */
export async function sendInviteEmail(opts: {
  email: string;
  token: string;
  role: "admin" | "staff";
  inviterName: string | null;
}): Promise<SendResult> {
  const business = getBusinessProfile().businessName;
  const link = inviteAcceptUrl(opts.token);
  const accent = getTheme().accent;
  const intro = opts.inviterName
    ? `${opts.inviterName} has invited you to join ${business} on AdonisAgent as ${roleLabel(opts.role)}.`
    : `You've been invited to join ${business} on AdonisAgent as ${roleLabel(opts.role)}.`;
  const bodyHtml = `
    ${textToParagraphs(intro)}
    <p style="margin:0 0 20px;">Click below to set your password and get started.</p>
    <p style="margin:0 0 24px;">
      <a href="${link}" style="display:inline-block;background:${accent};color:#0a0a0c;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;font-size:14px;">Set your password</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">Or paste this link into your browser:<br/><span style="color:#6b7280;word-break:break-all;">${link}</span></p>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">This link expires in 7 days.</p>`;
  const html = renderEmailShell({
    businessName: business,
    accent,
    heading: `Join ${business}`,
    bodyHtml,
    footer: `You're receiving this because someone at ${business} added you as a team member. If you weren't expecting it, you can ignore this email.`,
  });
  // Staff invites are a PLATFORM email (joining a business ON AdonisAgent), so they
  // always go from AdonisAgent's verified domain — reliable for every tenant, even
  // one that hasn't set up its own email. The from-name still carries the business
  // ("<Business> via AdonisAgent") and replies route to the business if it has an
  // address configured.
  const sender = getEmailSender();
  const replyTo = sender.replyTo || sender.fromEmail || undefined;
  return sendPlatformEmail({
    to: opts.email,
    subject: `You've been invited to ${business}`,
    html,
    fromName: `${business} via AdonisAgent`,
    replyTo,
  });
}

function roleLabel(role: "admin" | "staff"): string {
  return role === "admin" ? "an admin" : "a staff member";
}
