import "server-only";

import { count, eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { clients, settings } from "@/lib/db/schema";
import { getMonthlyPriceCents } from "@/lib/billing/settings";

/**
 * Read-only projections the platform admin app consumes. Field names here are a
 * wire contract — do NOT rename without updating the admin app. The one
 * exception is `setTenantVenueType` below — a narrow, validated cross-tenant
 * WRITE backing the console's venue-type control.
 */

export interface TenantSummary {
  id: number;
  slug: string;
  name: string;
  /** `null` when never set — do NOT default this to "clinic" (see readVenueType). */
  venueType: string | null;
  isActive: boolean;
  createdAt: number;
  billing: {
    status: string;
    billingExempt: boolean;
    nextRenewalAt: string | null;
    cardLast4: string | null;
  } | null;
}

const SUMMARY_SQL = `
  SELECT t.id, t.slug, t.name, t.is_active, t.created_at,
         b.status AS b_status, b.billing_exempt, b.next_renewal_at, b.card_last4
  FROM tenants t LEFT JOIN tenant_billing b ON b.tenant_id = t.id`;

function toSummary(r: Record<string, unknown>): TenantSummary {
  return {
    id: r.id as number,
    slug: r.slug as string,
    name: r.name as string,
    venueType: readVenueType(r.id as number),
    isActive: Boolean(r.is_active),
    createdAt: r.created_at as number,
    billing: r.b_status
      ? {
          status: r.b_status as string,
          billingExempt: Boolean(r.billing_exempt),
          nextRenewalAt: (r.next_renewal_at as string) ?? null,
          cardLast4: (r.card_last4 as string) ?? null,
        }
      : null,
  };
}

/**
 * venue_type lives in the tenant DB's `settings` table, JSON-encoded (e.g. the
 * literal string `"gym"`). Read it via the same cross-tenant accessor the
 * scheduler uses (`getTenantDbById` → drizzle handle → SELECT). Unset (no
 * row), an unreachable tenant DB, or a present-but-unparseable/non-string
 * value all mean "we don't actually know" — return `null` rather than
 * guessing "clinic" (that silently mislabelled every unset account, e.g.
 * Inspire — a gym — as a clinic in the console). Contrast with the main app's
 * OWN `getVenueType()` (lib/settings.ts), which intentionally still defaults
 * unset to "clinic" to drive that tenant's own vocab/scheduling — this is the
 * platform console's read, which must stay honest instead.
 */
function readVenueType(tenantId: number): string | null {
  try {
    const tdb = getTenantDbById(tenantId);
    const row = tdb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "venue_type"))
      .get();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Cross-tenant venue-type setter for the platform-admin console. Writes into
 * the TARGET tenant's own `settings` table (via `getTenantDbById`, never the
 * request-scoped `db` proxy), JSON-encoded exactly the way `setVenueType()` /
 * `getVenueType()` (lib/settings.ts) write and read it for the ambient
 * tenant — so the change takes effect immediately for that tenant's own app
 * vocab/scheduling, not just the platform console's display. Guarded by the
 * caller (the platform API route's `guardPlatform`); this function only
 * validates the venue type itself.
 */
export function setTenantVenueType(tenantId: number, venueType: "gym" | "clinic"): void {
  if (venueType !== "gym" && venueType !== "clinic") {
    throw new Error(`Invalid venue type: ${String(venueType)}`);
  }
  const tdb = getTenantDbById(tenantId);
  const value = JSON.stringify(venueType);
  tdb
    .insert(settings)
    .values({ key: "venue_type", value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/** COUNT(*) of clients in a tenant's own DB (same accessor as the scheduler). */
function countClientsViaTenantDb(tenantId: number): number {
  const tdb = getTenantDbById(tenantId);
  const row = tdb.select({ c: count() }).from(clients).get();
  return row?.c ?? 0;
}

export function listTenantSummaries(q?: string): TenantSummary[] {
  const rows = (
    q
      ? controlSqlite
          .prepare(
            `${SUMMARY_SQL} WHERE t.name LIKE ? OR t.slug LIKE ? ORDER BY t.created_at DESC`,
          )
          .all(`%${q}%`, `%${q}%`)
      : controlSqlite.prepare(`${SUMMARY_SQL} ORDER BY t.created_at DESC`).all()
  ) as Record<string, unknown>[];
  return rows.map(toSummary);
}

export function getTenantSummary(id: number): TenantSummary | null {
  const r = controlSqlite.prepare(`${SUMMARY_SQL} WHERE t.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? toSummary(r) : null;
}

export function tenantUsage(id: number): { clients: number; staff: number } {
  const staff = (
    controlSqlite
      .prepare(
        "SELECT COUNT(*) c FROM memberships WHERE tenant_id = ? AND is_active = 1",
      )
      .get(id) as { c: number }
  ).c;
  let clients = 0;
  try {
    clients = countClientsViaTenantDb(id);
  } catch {
    /* tenant DB unreachable → 0 */
  }
  return { clients, staff };
}

export function overview() {
  const counts: Record<string, number> = {
    pending_payment: 0,
    active: 0,
    past_due: 0,
    suspended: 0,
    cancelled: 0,
  };
  for (const r of controlSqlite
    .prepare(
      "SELECT status, COUNT(*) c FROM tenant_billing WHERE billing_exempt = 0 GROUP BY status",
    )
    .all() as Array<{ status: string; c: number }>) {
    counts[r.status] = r.c;
  }
  const mrrCents = (counts.active + counts.past_due) * getMonthlyPriceCents();
  const attention = listTenantSummaries().filter(
    (t) =>
      t.billing &&
      !t.billing.billingExempt &&
      ["past_due", "suspended", "pending_payment"].includes(t.billing.status),
  );
  const events = controlSqlite
    .prepare("SELECT * FROM billing_events ORDER BY id DESC LIMIT 30")
    .all();
  return { mrrCents, counts, attention, events };
}
