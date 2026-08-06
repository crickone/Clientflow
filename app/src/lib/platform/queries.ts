import "server-only";

import { count, eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { clients, settings } from "@/lib/db/schema";
import { getMonthlyPriceCents } from "@/lib/billing/settings";

/**
 * Read-only projections the platform admin app consumes. Field names here are a
 * wire contract — do NOT rename without updating the admin app.
 */

export interface TenantSummary {
  id: number;
  slug: string;
  name: string;
  venueType: string;
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
 * scheduler uses (`getTenantDbById` → drizzle handle → SELECT). Any failure
 * (missing DB, missing row, bad JSON) falls back to "clinic".
 */
function readVenueType(tenantId: number): string {
  try {
    const tdb = getTenantDbById(tenantId);
    const row = tdb
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "venue_type"))
      .get();
    if (!row?.value) return "clinic";
    const parsed = JSON.parse(row.value);
    return typeof parsed === "string" ? parsed : "clinic";
  } catch {
    return "clinic";
  }
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
