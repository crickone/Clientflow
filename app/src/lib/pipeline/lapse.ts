import "server-only";

import { and, eq, gt, inArray, sql } from "drizzle-orm";

import { schema } from "@/lib/db";
import { openTenantDb, type TenantDb } from "@/lib/db/tenant";
import { listTenants } from "@/lib/tenants";

const LAPSE_DAYS = 90;

/**
 * A client counts as "active" if they have any appointment dated within the
 * window (past visit or upcoming booking) OR a payment within the window.
 * Using both avoids flagging a fresh customer (recent payment, no completed
 * visit yet) as lapsed.
 */
function isActive(
  conn: TenantDb,
  clientId: number,
  cutoffIso: string,
  cutoffMs: number,
): boolean {
  const appt = conn
    .select({ d: sql<string | null>`max(${schema.appointments.date})` })
    .from(schema.appointments)
    .where(eq(schema.appointments.clientId, clientId))
    .get();
  if (appt?.d && appt.d >= cutoffIso) return true;

  const pay = conn
    .select({ t: sql<number | null>`max(${schema.payments.createdAt})` })
    .from(schema.payments)
    .where(eq(schema.payments.clientId, clientId))
    .get();
  return !!pay?.t && Number(pay.t) >= cutoffMs;
}

function paidCount(conn: TenantDb, clientId: number): number {
  const row = conn
    .select({ n: sql<number>`count(*)` })
    .from(schema.payments)
    .where(
      and(eq(schema.payments.clientId, clientId), gt(schema.payments.amountEur, 0)),
    )
    .get();
  return Number(row?.n ?? 0);
}

/**
 * Write a lapse/reactivation stage change directly on a tenant connection. The
 * lapse job runs from a background timer (no request context), so it cannot use
 * the request-scoped `db` proxy or the shared stage helpers — it operates on the
 * explicit connection passed in.
 */
function writeLapseStage(
  conn: TenantDb,
  leadId: number,
  stage: "lapsed" | "sale" | "repeat_customer",
): void {
  conn
    .update(schema.leads)
    .set({ pipelineStage: stage, updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  conn
    .insert(schema.activityLog)
    .values({
      type: "pipeline.stage",
      message: `Lead ${stage === "lapsed" ? "lapsed" : "re-activated"} (auto)`,
      meta: JSON.stringify({ leadId }),
    })
    .run();
}

/**
 * Daily recompute of the reversible `lapsed` state for ONE tenant:
 *  - customers (`sale`/`repeat_customer`) with no activity in 90 days → `lapsed`
 *  - `lapsed` leads who became active again → revert to `repeat_customer` (≥2
 *    payments) or `sale`.
 * Idempotent — safe to run repeatedly. The caller supplies the tenant connection
 * (the scheduler iterates all tenants).
 */
export function recomputeLapsed(conn: TenantDb): {
  lapsed: number;
  reactivated: number;
} {
  const now = Date.now();
  const cutoffMs = now - LAPSE_DAYS * 86_400_000;
  const cutoffIso = new Date(cutoffMs).toISOString().slice(0, 10);
  let lapsed = 0;
  let reactivated = 0;

  const customers = conn
    .select({ id: schema.leads.id, clientId: schema.leads.clientId })
    .from(schema.leads)
    .where(inArray(schema.leads.pipelineStage, ["sale", "repeat_customer"]))
    .all();
  for (const l of customers) {
    if (l.clientId == null) continue;
    if (!isActive(conn, l.clientId, cutoffIso, cutoffMs)) {
      writeLapseStage(conn, l.id, "lapsed");
      lapsed++;
    }
  }

  const lapsedLeads = conn
    .select({ id: schema.leads.id, clientId: schema.leads.clientId })
    .from(schema.leads)
    .where(eq(schema.leads.pipelineStage, "lapsed"))
    .all();
  for (const l of lapsedLeads) {
    if (l.clientId == null) continue;
    if (isActive(conn, l.clientId, cutoffIso, cutoffMs)) {
      writeLapseStage(
        conn,
        l.id,
        paidCount(conn, l.clientId) >= 2 ? "repeat_customer" : "sale",
      );
      reactivated++;
    }
  }

  return { lapsed, reactivated };
}

/**
 * Run the lapse recompute across every active tenant. Used by the daily
 * scheduler and the internal recompute endpoint — both run outside any single
 * tenant's request context, so they fan out explicitly.
 */
export function recomputeLapsedAllTenants(): {
  tenants: number;
  lapsed: number;
  reactivated: number;
} {
  const totals = { tenants: 0, lapsed: 0, reactivated: 0 };
  for (const tenant of listTenants()) {
    if (!tenant.isActive) continue;
    const { db } = openTenantDb(tenant.dbFile);
    const r = recomputeLapsed(db);
    totals.tenants++;
    totals.lapsed += r.lapsed;
    totals.reactivated += r.reactivated;
  }
  return totals;
}
