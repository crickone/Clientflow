import "server-only";

import { count, eq, gte } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import {
  classSchedules,
  clientMemberships,
  clients,
  leads,
  membershipPlans,
  payments,
  settings,
} from "@/lib/db/schema";
import { getMonthlyPriceCents } from "@/lib/billing/settings";
import { addDays, dublinToday } from "@/lib/billing/dates";

/**
 * Platform analytics: a cross-tenant business-intelligence projection the admin
 * dashboard charts. It combines (a) platform billing metrics from the control
 * plane (MRR/ARR, gym status counts, invoices collected, gym growth) with (b)
 * each gym's OWN business figures pulled defensively from its tenant DB
 * (members, active memberships, monthly membership GMV, this-month payment
 * revenue, leads, classes) — so the admin sees "how all our gyms are doing".
 *
 * The field names below are a WIRE CONTRACT the admin dashboard is built to —
 * do NOT rename without updating the admin app.
 *
 * Cross-tenant reads go ONLY through getTenantDbById (never the request-scoped
 * `db` proxy), and every per-tenant metric is wrapped so a missing table/column
 * or any error yields 0 for that metric rather than throwing — tenant DBs are
 * heterogeneous (renova is a CLINIC that may lack gym data; fresh test gyms are
 * near-empty). One bad tenant never fails the whole endpoint.
 */

// ── Europe/Dublin calendar helpers (months must not depend on the server TZ) ──

const DUBLIN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dublinParts(ms: number) {
  const p = DUBLIN_PARTS.formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}

/** The Europe/Dublin calendar month ("YYYY-MM") a UTC-ms instant falls in. */
function dublinMonthOf(ms: number): string {
  const { y, mo } = dublinParts(ms);
  return `${y}-${mo}`;
}

/** UTC-ms instant of Dublin-midnight on the 1st of `month` ("YYYY-MM"). */
function dublinMonthStartMs(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const guess = Date.UTC(y, m - 1, 1, 0, 0, 0);
  const p = dublinParts(guess);
  const asUtc = Date.UTC(Number(p.y), Number(p.mo) - 1, Number(p.d), Number(p.h), Number(p.mi), Number(p.s));
  const offset = asUtc - guess; // ms Dublin is ahead of UTC at that instant
  return guess - offset;
}

/** The last 12 Dublin months (oldest→newest) ending at (and including) `currentMonth`. */
function last12Months(currentMonth: string): string[] {
  const y = Number(currentMonth.slice(0, 4));
  const m = Number(currentMonth.slice(5, 7));
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const safeNum = (fn: () => number): number => {
  try {
    const n = fn();
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

// ── Types (wire contract) ──────────────────────────────────────────────────

export interface PerGymRow {
  tenantId: number;
  name: string;
  slug: string;
  /** `null` when never set — do NOT default this to "clinic" (see readVenueType). */
  venueType: string | null;
  status: string;
  exempt: boolean;
  members: number;
  activeMembers: number;
  gmvCentsMonthly: number;
  revenueCentsThisMonth: number;
}

export interface PlatformAnalytics {
  generatedAt: number;
  platform: {
    mrrCents: number;
    arrCents: number;
    gyms: {
      total: number;
      active: number;
      pastDue: number;
      suspended: number;
      pendingPayment: number;
      cancelled: number;
      exempt: number;
      paying: number;
    };
    collectedByMonth: Array<{ month: string; cents: number }>;
    gymsByMonth: Array<{ month: string; total: number; added: number }>;
  };
  gyms: {
    tenantsCounted: number;
    members: number;
    activeMembers: number;
    gmvCentsMonthly: number;
    estResidualCentsMonthly: number;
    revenueCentsThisMonth: number;
    leads: number;
    classesThisWeek: number;
    perGym: PerGymRow[];
  };
}

// ── Per-tenant metric readers (defensive: any failure → 0 / empty) ──────────

/**
 * venue_type is stored JSON-encoded in the tenant `settings` table (e.g.
 * "gym"). Unset, an unreachable row, or an unparseable/non-string value all
 * mean "we don't actually know" — return `null` rather than guessing
 * "clinic" (that silently mislabelled unset accounts, e.g. Inspire — a gym —
 * as a clinic on the dashboard). The main app's OWN `getVenueType()`
 * (lib/settings.ts) intentionally keeps its "clinic" default — that drives
 * vocab/scheduling for the tenant itself — this is only the platform
 * dashboard's read, which must stay honest instead.
 */
function readVenueType(tdb: TenantDb): string | null {
  try {
    const row = tdb.select({ value: settings.value }).from(settings).where(eq(settings.key, "venue_type")).get();
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Monthly-normalised membership GMV + active-membership count for one gym.
 * MIRRORS lib/dashboard.ts's MRR computation EXACTLY (same select shape, same
 * status='active' predicate, same interval→months normalisation) so a gym's
 * platform figures match the mrr its OWN dashboard shows.
 */
function readMembershipStats(tdb: TenantDb): { gmvCents: number; activeMembers: number } {
  try {
    const active = tdb
      .select({
        clientId: clientMemberships.clientId,
        priceCents: clientMemberships.priceCents,
        interval: membershipPlans.billingInterval,
        count: membershipPlans.billingCount,
      })
      .from(clientMemberships)
      .leftJoin(membershipPlans, eq(membershipPlans.id, clientMemberships.membershipId))
      .where(eq(clientMemberships.status, "active"))
      .all();

    let gmv = 0;
    for (const m of active) {
      const intervalMonths = m.interval === "week" ? 12 / 52 : m.interval === "year" ? 12 : 1;
      const cycleMonths = (m.count ?? 1) * intervalMonths;
      gmv += cycleMonths > 0 ? m.priceCents / cycleMonths : m.priceCents;
    }
    return { gmvCents: Math.round(gmv), activeMembers: active.length };
  } catch {
    return { gmvCents: 0, activeMembers: 0 };
  }
}

/** Sum of payments (in cents) whose created_at falls in the current Dublin month. */
function readRevenueThisMonthCents(tdb: TenantDb, monthStart: Date): number {
  return safeNum(() => {
    const rows = tdb.select({ amount: payments.amountEur }).from(payments).where(gte(payments.createdAt, monthStart)).all();
    const eur = rows.reduce((s, p) => s + p.amount, 0);
    return Math.round(eur * 100);
  });
}

/**
 * Number of class occurrences in the next 7 days, expanded from the recurring
 * `class_schedules` rows (CSV of weekday numbers 0=Sun..6=Sat, bounded by
 * start_date/end_date). Over a 7-day window each listed weekday recurs once.
 */
function readClassesNext7Days(tdb: TenantDb, today: string): number {
  return safeNum(() => {
    const rows = tdb
      .select({
        daysOfWeek: classSchedules.daysOfWeek,
        startDate: classSchedules.startDate,
        endDate: classSchedules.endDate,
        isActive: classSchedules.isActive,
      })
      .from(classSchedules)
      .where(eq(classSchedules.isActive, true))
      .all();

    const window = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      return { date, dow: new Date(`${date}T12:00:00Z`).getUTCDay() };
    });

    let total = 0;
    for (const s of rows) {
      const days = new Set(
        (s.daysOfWeek ?? "")
          .split(",")
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isFinite(n)),
      );
      for (const w of window) {
        if (!days.has(w.dow)) continue;
        if (s.startDate && w.date < s.startDate) continue;
        if (s.endDate && w.date > s.endDate) continue;
        total++;
      }
    }
    return total;
  });
}

// ── Control-plane billing projections ───────────────────────────────────────

function platformBilling(months: string[]) {
  const monthlyPrice = getMonthlyPriceCents();

  // Gym status counts. Status counts span all billing rows (exempt included);
  // `exempt` and `paying` are separate lenses. `paying` (non-exempt active|
  // past_due) is the MRR base — matching lib/platform/queries.ts::overview().
  const gyms = { total: 0, active: 0, pastDue: 0, suspended: 0, pendingPayment: 0, cancelled: 0, exempt: 0, paying: 0 };
  const statusField: Record<string, keyof typeof gyms> = {
    active: "active",
    past_due: "pastDue",
    suspended: "suspended",
    pending_payment: "pendingPayment",
    cancelled: "cancelled",
  };
  const billingRows = controlSqlite
    .prepare("SELECT status, billing_exempt FROM tenant_billing")
    .all() as Array<{ status: string; billing_exempt: number }>;
  for (const r of billingRows) {
    const key = statusField[r.status];
    if (key) gyms[key]++;
    if (r.billing_exempt) gyms.exempt++;
    else if (r.status === "active" || r.status === "past_due") gyms.paying++;
  }
  gyms.total = (controlSqlite.prepare("SELECT COUNT(*) c FROM tenants").get() as { c: number }).c;

  const mrrCents = gyms.paying * monthlyPrice;

  // Collected by month: PAID invoices, bucketed by the Dublin month they were
  // paid in (falling back to the period month if paid_at is unset). Zero-filled.
  const collected = new Map<string, number>(months.map((m) => [m, 0]));
  const paidRows = controlSqlite
    .prepare("SELECT gross_cents, paid_at, period_start FROM billing_invoices WHERE status = 'paid'")
    .all() as Array<{ gross_cents: number; paid_at: number | null; period_start: string }>;
  for (const r of paidRows) {
    const month = r.paid_at != null ? dublinMonthOf(r.paid_at) : r.period_start.slice(0, 7);
    if (collected.has(month)) collected.set(month, collected.get(month)! + r.gross_cents);
  }
  const collectedByMonth = months.map((month) => ({ month, cents: collected.get(month)! }));

  // Gyms by month: cumulative tenant count + new-that-month, from tenants.created_at.
  const tenantMonths = (
    controlSqlite.prepare("SELECT created_at FROM tenants").all() as Array<{ created_at: number }>
  ).map((t) => dublinMonthOf(t.created_at));
  const gymsByMonth = months.map((month) => ({
    month,
    total: tenantMonths.filter((tm) => tm <= month).length,
    added: tenantMonths.filter((tm) => tm === month).length,
  }));

  return { mrrCents, arrCents: mrrCents * 12, gyms, collectedByMonth, gymsByMonth };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function getPlatformAnalytics(): PlatformAnalytics {
  const today = dublinToday();
  const currentMonth = today.slice(0, 7);
  const months = last12Months(currentMonth);
  const monthStart = new Date(dublinMonthStartMs(currentMonth));

  const platform = platformBilling(months);

  // Billing status/exempt per tenant, for the leaderboard rows.
  const billingByTenant = new Map<number, { status: string; exempt: boolean }>();
  for (const r of controlSqlite
    .prepare("SELECT tenant_id, status, billing_exempt FROM tenant_billing")
    .all() as Array<{ tenant_id: number; status: string; billing_exempt: number }>) {
    billingByTenant.set(r.tenant_id, { status: r.status, exempt: Boolean(r.billing_exempt) });
  }

  // Business figures across ALL active tenants (their real app data).
  const activeTenants = controlSqlite
    .prepare("SELECT id, slug, name FROM tenants WHERE is_active = 1 ORDER BY id")
    .all() as Array<{ id: number; slug: string; name: string }>;

  const perGym: PerGymRow[] = [];
  let members = 0;
  let activeMembers = 0;
  let gmvCentsMonthly = 0;
  let revenueCentsThisMonth = 0;
  let leadsTotal = 0;
  let classesThisWeek = 0;

  for (const t of activeTenants) {
    let tdb: TenantDb;
    try {
      tdb = getTenantDbById(t.id);
    } catch (err) {
      // Can't even open the tenant DB — skip it entirely, never fail the endpoint.
      console.error(`[analytics] skipping tenant ${t.id} (${t.slug}): ${String(err)}`);
      continue;
    }

    const gymMembers = safeNum(() => (tdb.select({ c: count() }).from(clients).get()?.c ?? 0));
    const { gmvCents, activeMembers: gymActive } = readMembershipStats(tdb);
    const gymRevenue = readRevenueThisMonthCents(tdb, monthStart);
    const gymLeads = safeNum(() => (tdb.select({ c: count() }).from(leads).get()?.c ?? 0));
    const gymClasses = readClassesNext7Days(tdb, today);

    members += gymMembers;
    activeMembers += gymActive;
    gmvCentsMonthly += gmvCents;
    revenueCentsThisMonth += gymRevenue;
    leadsTotal += gymLeads;
    classesThisWeek += gymClasses;

    const b = billingByTenant.get(t.id);
    perGym.push({
      tenantId: t.id,
      name: t.name,
      slug: t.slug,
      venueType: readVenueType(tdb),
      status: b?.status ?? "none",
      exempt: b?.exempt ?? false,
      members: gymMembers,
      activeMembers: gymActive,
      gmvCentsMonthly: gmvCents,
      revenueCentsThisMonth: gymRevenue,
    });
  }

  // Leaderboard order: biggest monthly membership volume first.
  perGym.sort((a, b) => b.gmvCentsMonthly - a.gmvCentsMonthly || b.revenueCentsThisMonth - a.revenueCentsThisMonth);

  return {
    generatedAt: Date.now(),
    platform,
    gyms: {
      tenantsCounted: perGym.length,
      members,
      activeMembers,
      gmvCentsMonthly,
      estResidualCentsMonthly: Math.round(gmvCentsMonthly * 0.0007),
      revenueCentsThisMonth,
      leads: leadsTotal,
      classesThisWeek,
      perGym,
    },
  };
}
