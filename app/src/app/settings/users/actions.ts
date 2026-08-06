"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { authDb } from "@/lib/db/control";
import { memberships, users } from "@/lib/db/schema";
import { getCurrentMembership, hashPassword, requireAdmin } from "@/lib/auth";
import { createInvite, sendInviteEmail } from "@/lib/invites";

export type Role = "admin" | "staff";
export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult =
  | { ok: true; note?: string }
  | { ok: false; error: string };

/**
 * The acting admin's identity + active clinic. requireAdmin already throws unless
 * the caller is an admin in the active tenant, so getCurrentMembership is non-null
 * here. Every action below is scoped to THIS tenant — an admin manages only the
 * roster of the clinic they're currently in.
 */
async function adminContext(): Promise<{
  meId: number;
  meName: string | null;
  tenantId: number;
}> {
  const me = await requireAdmin();
  const current = getCurrentMembership();
  if (!current) throw new Error("UNAUTHENTICATED");
  return { meId: me.id, meName: me.name, tenantId: current.tenant.id };
}

/** Count active admin memberships in a tenant other than `exceptUserId`. */
function otherActiveAdmins(tenantId: number, exceptUserId: number): number {
  return authDb
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenantId),
        eq(memberships.role, "admin"),
        eq(memberships.isActive, true),
        ne(memberships.userId, exceptUserId),
      ),
    )
    .all().length;
}

/**
 * Does an identity with this email already exist, and is it already a member of
 * the active clinic? Powers the Add-user dialog: it reveals name/password fields
 * only for a brand-new email, and warns when the person is already in the clinic.
 */
export async function lookupIdentityAction(
  email: string,
): Promise<
  | { ok: true; exists: boolean; name: string | null; alreadyMember: boolean }
  | { ok: false; error: string }
> {
  const { tenantId } = await adminContext();
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return { ok: false, error: "Invalid email" };
  const e = parsed.data.trim().toLowerCase();

  const identity = authDb
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, e))
    .get();
  if (!identity) return { ok: true, exists: false, name: null, alreadyMember: false };

  const mem = authDb
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.userId, identity.id), eq(memberships.tenantId, tenantId)),
    )
    .get();
  return { ok: true, exists: true, name: identity.name, alreadyMember: !!mem };
}

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "staff"]),
  name: z.string().max(120).optional(),
  password: z.string().optional(),
  // "invite" (default) emails a set-password link; "password" sets one manually.
  mode: z.enum(["invite", "password"]).optional(),
});

/**
 * Add someone to the active clinic. If the email already exists as an identity,
 * grant a membership (no password — they already have one). Otherwise create the
 * identity (name + temp password, must-change) AND the membership.
 */
export async function createUserAction(input: {
  email: string;
  role: Role;
  name?: string;
  password?: string;
  mode?: "invite" | "password";
}): Promise<CreateResult> {
  const { meId, meName, tenantId } = await adminContext();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const email = parsed.data.email.trim().toLowerCase();
  const mode = parsed.data.mode ?? "invite";
  const role = parsed.data.role;

  const existing = authDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existing) {
    const already = authDb
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, existing.id), eq(memberships.tenantId, tenantId)))
      .get();
    if (already) return { ok: false, error: "Already in this clinic" };
    authDb
      .insert(memberships)
      .values({ userId: existing.id, tenantId, role, isActive: true })
      .run();
    revalidatePath("/settings/users");
    // They already have a login — nothing to email; they can sign in as usual.
    return { ok: true, note: "Existing user added — they use their current login." };
  }

  const name = parsed.data.name?.trim() || null;

  // Manual-password path: admin sets a temporary password to hand over.
  if (mode === "password") {
    if (!name) return { ok: false, error: "Name is required for a new user" };
    const password = parsed.data.password;
    if (!password || password.length < 8) {
      return { ok: false, error: "Password must be at least 8 characters" };
    }
    authDb.transaction((tx) => {
      const created = tx
        .insert(users)
        .values({
          email,
          name,
          passwordHash: hashPassword(password),
          role,
          mustChangePassword: true,
          isActive: true,
        })
        .returning({ id: users.id })
        .get();
      tx
        .insert(memberships)
        .values({ userId: created.id, tenantId, role, isActive: true })
        .run();
    });
    revalidatePath("/settings/users");
    return { ok: true };
  }

  // Invite path: create the identity with an unusable random password, then email
  // a set-password link. must_change_password stays true until they accept.
  const created = authDb.transaction((tx) => {
    const u = tx
      .insert(users)
      .values({
        email,
        name,
        passwordHash: hashPassword(crypto.randomBytes(24).toString("hex")),
        role,
        mustChangePassword: true,
        isActive: true,
      })
      .returning({ id: users.id })
      .get();
    tx
      .insert(memberships)
      .values({ userId: u.id, tenantId, role, isActive: true })
      .run();
    return u;
  });

  const token = createInvite({ email, tenantId, userId: created.id, role, invitedByUserId: meId });
  const sent = await sendInviteEmail({ email, token, role, inviterName: meName });
  revalidatePath("/settings/users");
  if (!sent.ok) {
    return {
      ok: true,
      note: `User added, but the invite email failed to send (${sent.error}). Use "Resend invite" once email is configured.`,
    };
  }
  return { ok: true, note: `Invite email sent to ${email}.` };
}

/** Re-send (regenerate) a pending invite for a member who hasn't accepted yet. */
export async function resendInviteAction(userId: number): Promise<ActionResult> {
  const { meId, meName, tenantId } = await adminContext();
  const person = authDb
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!person) return { ok: false, error: "User not found" };
  const mem = authDb
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .get();
  if (!mem) return { ok: false, error: "Not a member of this clinic" };

  const token = createInvite({
    email: person.email,
    tenantId,
    userId,
    role: mem.role,
    invitedByUserId: meId,
  });
  const sent = await sendInviteEmail({
    email: person.email,
    token,
    role: mem.role,
    inviterName: meName,
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true };
}

const updateSchema = z.object({
  role: z.enum(["admin", "staff"]),
  isActive: z.boolean(),
});

/**
 * Update a member's per-clinic role / active flag. Name + email are identity-level
 * (shared across clinics) and are NOT editable here.
 */
export async function updateUserAction(
  userId: number,
  input: { role: Role; isActive: boolean },
): Promise<ActionResult> {
  const { tenantId } = await adminContext();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const mem = authDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .get();
  if (!mem) return { ok: false, error: "Not a member of this clinic" };

  // Don't let the last active admin of this clinic be demoted or deactivated.
  const losingAdmin =
    mem.role === "admin" && (parsed.data.role !== "admin" || !parsed.data.isActive);
  if (losingAdmin && otherActiveAdmins(tenantId, userId) === 0) {
    return {
      ok: false,
      error: "This is the only active admin — promote another admin first.",
    };
  }

  authDb
    .update(memberships)
    .set({ role: parsed.data.role, isActive: parsed.data.isActive })
    .where(eq(memberships.id, mem.id))
    .run();
  revalidatePath("/settings/users");
  return { ok: true };
}

const resetSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  mustChange: z.boolean().optional(),
});

/**
 * Reset a member's password. The password is identity-level (one per person), so
 * this is gated on the target being a member of the acting admin's clinic.
 */
export async function resetPasswordAction(
  userId: number,
  input: { password: string; mustChange?: boolean },
): Promise<ActionResult> {
  const { tenantId } = await adminContext();
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }

  const mem = authDb
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .get();
  if (!mem) return { ok: false, error: "Not a member of this clinic" };

  authDb
    .update(users)
    .set({
      passwordHash: hashPassword(parsed.data.password),
      mustChangePassword: parsed.data.mustChange ?? true,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .run();
  revalidatePath("/settings/users");
  return { ok: true };
}

/**
 * Remove a person from the active clinic: deletes the MEMBERSHIP, never the
 * identity. They keep their login and any other clinics. (Deleting the orphaned
 * identity is a separate, deliberate step, not done here.)
 */
export async function removeMembershipAction(userId: number): Promise<ActionResult> {
  const { meId, tenantId } = await adminContext();
  if (meId === userId) {
    return { ok: false, error: "You can't remove yourself from a clinic" };
  }

  const mem = authDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .get();
  if (!mem) return { ok: false, error: "Not a member of this clinic" };

  if (mem.role === "admin" && mem.isActive && otherActiveAdmins(tenantId, userId) === 0) {
    return { ok: false, error: "Cannot remove the only active admin" };
  }

  authDb.delete(memberships).where(eq(memberships.id, mem.id)).run();
  revalidatePath("/settings/users");
  return { ok: true };
}
