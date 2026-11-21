import "server-only";

import { and, count, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";

import { addDays, dublinToday } from "@/lib/billing/dates";
import { controlSqlite } from "@/lib/db/control";
import { appointments, classSessions, leads, offerOrders, sessionBookings } from "@/lib/db/schema";
import { getTenantDbById } from "@/lib/db/tenant";
import { getMonthlyUsageCents } from "@/lib/ai/usage";
import { currentMonthKey } from "@/lib/monthlyCap";
import { getSetupSummaryForTenant } from "@/lib/setup/steps";

import { lastStaffLoginAt } from "./churnRisk";

/** One business's week, for the console dashboard's "This week" table. A null means "could not read it", never zero. */
export interface ActivityRow {
  tenantId: number;
  name: string;
  slug: string;
  setup: { done: number; total: number } | null;
  lastLoginAt: number | null;
  membersActive7d: number | null;
  bookings7d: number | null;
  bookingsPrev7d: number | null;
  leads7d: number | null;
  salesCents7d: number | null;
  aiCentsThisMonth: number | null;
}

export interface ActivityResponse {
  rows: ActivityRow[];
  generatedAt: number;
}

const DAY_MS = 86400000;

/** Pure: the two 7-day windows ending at `now` (ms). */
export function weekWindows(now: number): { thisStart: number; prevStart: number; end: number } {
  return { thisStart: now - 7 * DAY_MS, prevStart: now - 14 * DAY_MS, end: now };
}

/** Bookings whose class or appointment falls on a Dublin calendar day in (afterDay, uptoDay]. */
function countBookings(tdb: ReturnType<typeof getTenantDbById>, afterDay: string, uptoDay: string): number {
  const classes =
    tdb
      .select({ c: count() })
      .from(sessionBookings)
      .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
      .where(
        and(
          inArray(sessionBookings.status, ["booked", "attended"]),
          ne(classSessions.status, "cancelled"),
          gt(classSessions.date, afterDay),
          lte(classSessions.date, uptoDay),
        ),
      )
      .get()?.c ?? 0;
  const visits =
    tdb
      .select({ c: count() })
      .from(appointments)
      .where(and(ne(appointments.status, "cancelled"), gt(appointments.date, afterDay), lte(appointments.date, uptoDay)))
      .get()?.c ?? 0;
  return classes + visits;
}

export function getFleetActivity(now: number = Date.now()): ActivityResponse {
  const { thisStart, end } = weekWindows(now);
  const today = dublinToday(new Date(now));
  const day7 = addDays(today, -7);
  const day14 = addDays(today, -14);
  const month = currentMonthKey();

  const tenants = controlSqlite
    .prepare("SELECT id, slug, name FROM tenants WHERE archived_at IS NULL ORDER BY id")
    .all() as Array<{ id: number; slug: string; name: string }>;

  const rows: ActivityRow[] = tenants.map((t) => {
    const row: ActivityRow = {
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      setup: null,
      lastLoginAt: null,
      membersActive7d: null,
      bookings7d: null,
      bookingsPrev7d: null,
      leads7d: null,
      salesCents7d: null,
      aiCentsThisMonth: null,
    };

    // Tenant DB: explicit id, never the request-scoped proxy.
    try {
      const tdb = getTenantDbById(t.id);
      row.bookings7d = countBookings(tdb, day7, today);
      row.bookingsPrev7d = countBookings(tdb, day14, day7);
      row.leads7d = tdb.select({ c: count() }).from(leads).where(and(gte(leads.createdAt, new Date(thisStart)), lt(leads.createdAt, new Date(end)))).get()?.c ?? 0;
      // Paid orders by when they were paid (created time for any row with no paid time).
      row.salesCents7d =
        tdb
          .select({ s: sql<number>`COALESCE(SUM(${offerOrders.amountCents}), 0)` })
          .from(offerOrders)
          .where(
            and(
              eq(offerOrders.status, "paid"),
              sql`COALESCE(${offerOrders.paidAt}, ${offerOrders.createdAt}) >= ${thisStart}`,
              sql`COALESCE(${offerOrders.paidAt}, ${offerOrders.createdAt}) < ${end}`,
            ),
          )
          .get()?.s ?? 0;
    } catch {
      // leave the tenant-DB fields null
    }

    // Control plane.
    try {
      row.lastLoginAt = lastStaffLoginAt(t.id);
    } catch {
      // null
    }
    try {
      // Members who signed in to the client app this week (last sign-in only; there is no per-visit log).
      row.membersActive7d = (
        controlSqlite
          .prepare("SELECT count(*) AS n FROM client_credentials WHERE tenant_id = ? AND is_active = 1 AND last_login_at >= ? AND last_login_at < ?")
          .get(t.id, thisStart, end) as { n: number }
      ).n;
    } catch {
      // null
    }
    try {
      row.aiCentsThisMonth = getMonthlyUsageCents(t.id, month);
    } catch {
      // null
    }
    try {
      const s = getSetupSummaryForTenant(t.id);
      row.setup = { done: s.requiredDone, total: s.requiredTotal };
    } catch {
      // null
    }
    return row;
  });

  return { rows, generatedAt: now };
}
