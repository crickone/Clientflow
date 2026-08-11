import "server-only";

import { eq, sql } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { contacts, suppressions } from "@/lib/db/schema";

/**
 * Hard do-not-email gate (Task 6). `suppressions` is append-mostly and
 * irreversible from this module's point of view — once an email lands here
 * it stays a do-not-email, forever, regardless of how many times or for
 * which reason it's suppressed again later (see the `onConflictDoNothing`
 * below: a second call is a no-op, the FIRST reason recorded wins). Shared,
 * explicit-tenantId entry point for every path that can suppress an email:
 * the public unsubscribe route (`/u/[token]`, this task) and the Mailgun
 * webhook (Task 7, background/detached — no request, no cookie, no session).
 *
 * Always resolves the tenant DB via getTenantDbById(tenantId) — NEVER the
 * ambient request-scoped `db` proxy — mirroring lib/marketing/domains.ts and
 * lib/imapEmail.ts's recordSentMessage: this function must stay safe to call
 * from a background job / public route with no request context at all, where
 * the ambient `db` proxy would silently resolve to the wrong tenant (or the
 * default tenant).
 */

export type SuppressionReason = "unsubscribe" | "bounce" | "complaint" | "manual";

/** Maps a suppression reason to the `contacts.status` it should set. */
const CONTACT_STATUS_BY_REASON: Record<SuppressionReason, "unsubscribed" | "bounced" | "complained"> = {
  unsubscribe: "unsubscribed",
  bounce: "bounced",
  complaint: "complained",
  manual: "unsubscribed",
};

/**
 * Suppress an email address for a tenant: upsert into `suppressions` (unique
 * on `lower(email)` — a repeat call is a no-op, `ON CONFLICT DO NOTHING`)
 * and, if a matching contact exists, flip its `status` to the reason's
 * mapped status (case-insensitive match on `lower(email)` — a contact's
 * stored email casing is whatever it was imported/typed as, but suppression
 * is always case-insensitive). `unsubscribed_at` is set only when the
 * mapped status is `'unsubscribed'` (reasons 'unsubscribe' and 'manual'),
 * left untouched for 'bounce'/'complaint'.
 *
 * Idempotent: calling this twice with the same (or a different) reason for
 * the same email never errors, never duplicates the suppressions row, and
 * always leaves the contact's status at the mapped value. A no-op (still
 * inserts nothing, updates nothing) when `email` is blank.
 */
export function suppress(tenantId: number, email: string, reason: SuppressionReason): void {
  const clean = email.trim().toLowerCase();
  if (!clean) return;

  const tdb = getTenantDbById(tenantId);

  tdb.insert(suppressions).values({ email: clean, reason }).onConflictDoNothing().run();

  const status = CONTACT_STATUS_BY_REASON[reason];
  const patch: Partial<typeof contacts.$inferInsert> = { status, updatedAt: new Date() };
  if (status === "unsubscribed") patch.unsubscribedAt = new Date();

  tdb
    .update(contacts)
    .set(patch)
    .where(eq(sql`lower(${contacts.email})`, clean))
    .run();
}
