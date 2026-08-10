import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { authDb } from "@/lib/db/control";
import { memberships, users } from "@/lib/db/schema";

export type ActionResult = { ok: true } | { ok: false; error: string };

const memberEmailSchema = z.string().email();

/**
 * Guards 2–6 of updateMemberEmailAction (tenant-scope, validate/normalize,
 * no-op, uniqueness, update).
 *
 * Deliberately lives in a PLAIN module (no "use server") rather than in
 * settings/users/actions.ts: every export of a "use server" file is compiled
 * into a callable Server Action endpoint, and this helper takes `tenantId`
 * as a caller-supplied argument with no auth check of its own — co-exporting
 * it from actions.ts previously made it a live, effectively-unauthenticated
 * endpoint (any logged-in user could hijack any identity's login email by
 * supplying an arbitrary tenantId+userId). `import "server-only"` guarantees
 * it can never be pulled into a client bundle either.
 *
 * The ONLY caller must be updateMemberEmailAction (settings/users/actions.ts),
 * which derives `tenantId` server-side from the authenticated admin's active
 * membership via adminContext() (requireAdmin + getCurrentMembership) — never
 * from caller input. Do not add "use server" to this file, and do not add a
 * new export that calls this helper without going through that same
 * session-derived tenant check.
 *
 * Living outside actions.ts also means this is callable directly in tests
 * without a request-scoped session/cookie (requireAdmin/getCurrentMembership
 * need `cookies()`, which only resolves under Next's server runtime). See
 * the co-located test file, settings/users/updateMemberEmail.test.ts.
 */
export async function applyMemberEmailUpdate(
  tenantId: number,
  userId: number,
  rawEmail: string,
): Promise<ActionResult> {
  // 2. Tenant-scope the target: an admin may only change the email of someone
  // who is actually a member of THEIR active clinic — never an arbitrary
  // identity elsewhere in the control plane. Joining to `users` here also
  // gets us the current email for the no-op check below in one query.
  const target = authDb
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)))
    .get();
  if (!target) return { ok: false, error: "Not a member of this account" };

  // 3. Validate + normalize.
  const parsed = memberEmailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, error: "Invalid email" };
  const email = parsed.data.trim().toLowerCase();

  // 4. No-op guard: nothing to do.
  if (email === target.email) return { ok: true };

  // 5. Uniqueness: `users.email` is the login identity, globally unique across
  // every tenant. Check it here so a collision is a clean error, not a raw
  // unique-constraint crash (500) — and so we never silently hijack another
  // identity's login email.
  const clash = authDb
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), ne(users.id, userId)))
    .get();
  if (clash) {
    return { ok: false, error: "That email is already in use by another account" };
  }

  // 6. Update the identity. `users.email` is shared by every membership this
  // person has, so this changes their sign-in EVERYWHERE, not just the active
  // clinic — deliberately not touching password/sessions here.
  authDb
    .update(users)
    .set({ email, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .run();
  return { ok: true };
}
