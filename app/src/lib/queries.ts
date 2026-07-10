import "server-only";
import { and, desc, eq, gte, inArray, like, lte, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  activityLog,
  appointments,
  clients,
  giftVouchers,
  leads,
  packages,
  payments,
  sessions,
  therapies,
  type Therapy,
} from "./db/schema";

export async function listTherapies(): Promise<Therapy[]> {
  return db.select().from(therapies).where(eq(therapies.isActive, true)).all();
}

export async function getTherapyMap() {
  const all = await listTherapies();
  return new Map(all.map((t) => [t.id, t]));
}

export type ClientListFilter = "all" | "active" | "inactive";

export async function listClients(opts: {
  q?: string;
  filter?: ClientListFilter;
} = {}) {
  const { q, filter = "all" } = opts;
  const where = [];
  if (q) {
    const like_ = `%${q.toLowerCase()}%`;
    where.push(
      or(
        like(sql`lower(${clients.firstName} || ' ' || ${clients.lastName})`, like_),
        like(sql`lower(${clients.email})`, like_),
        like(clients.phone, `%${q}%`),
      ),
    );
  }
  const rows = db
    .select()
    .from(clients)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(clients.createdAt))
    .all();

  if (filter === "all") return rows;

  // Active = appointment within last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const activeIds = new Set(
    db
      .select({ id: appointments.clientId })
      .from(appointments)
      .where(gte(appointments.date, cutoffIso))
      .all()
      .map((r) => r.id),
  );
  return rows.filter((c) =>
    filter === "active" ? activeIds.has(c.id) : !activeIds.has(c.id),
  );
}

export async function getClient(id: number) {
  return db.select().from(clients).where(eq(clients.id, id)).get();
}

export async function getClientStats(id: number) {
  const totalSessions = db
    .select({ c: sql<number>`count(*)` })
    .from(sessions)
    .where(eq(sessions.clientId, id))
    .get()?.c ?? 0;

  const totalSpend = db
    .select({ s: sql<number>`coalesce(sum(${payments.amountEur}), 0)` })
    .from(payments)
    .where(eq(payments.clientId, id))
    .get()?.s ?? 0;

  const firstVisit = db
    .select({ d: sql<string>`min(${appointments.date})` })
    .from(appointments)
    .where(and(eq(appointments.clientId, id), eq(appointments.status, "completed")))
    .get()?.d ?? null;

  const lastVisit = db
    .select({ d: sql<string>`max(${appointments.date})` })
    .from(appointments)
    .where(and(eq(appointments.clientId, id), eq(appointments.status, "completed")))
    .get()?.d ?? null;

  const favTherapy = db
    .select({
      therapyId: sessions.therapyId,
      n: sql<number>`count(*)`,
    })
    .from(sessions)
    .where(eq(sessions.clientId, id))
    .groupBy(sessions.therapyId)
    .orderBy(desc(sql`count(*)`))
    .limit(1)
    .get();

  let favouriteTherapy: string | null = null;
  if (favTherapy) {
    const t = db
      .select()
      .from(therapies)
      .where(eq(therapies.id, favTherapy.therapyId))
      .get();
    favouriteTherapy = t?.name ?? null;
  }

  return {
    totalSessions,
    totalSpend,
    firstVisit,
    lastVisit,
    favouriteTherapy,
  };
}

export async function listClientAppointments(clientId: number) {
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.clientId, clientId))
    .orderBy(desc(appointments.date), desc(appointments.startTime))
    .all();
}

export async function listClientSessions(clientId: number) {
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.clientId, clientId))
    .orderBy(desc(sessions.date))
    .all();
}

export async function listClientPackages(clientId: number) {
  return db
    .select()
    .from(packages)
    .where(eq(packages.clientId, clientId))
    .orderBy(desc(packages.purchaseDate))
    .all();
}

export async function listClientPayments(clientId: number) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.clientId, clientId))
    .orderBy(desc(payments.createdAt))
    .all();
}

/* -------------------- appointments -------------------- */

export async function listAppointmentsBetween(startIso: string, endIso: string) {
  return db
    .select()
    .from(appointments)
    .where(and(gte(appointments.date, startIso), lte(appointments.date, endIso)))
    .orderBy(appointments.date, appointments.startTime)
    .all();
}

export async function listAppointmentsForDate(dateIso: string) {
  return db
    .select()
    .from(appointments)
    .where(eq(appointments.date, dateIso))
    .orderBy(appointments.startTime)
    .all();
}

export async function getAppointment(id: number) {
  return db.select().from(appointments).where(eq(appointments.id, id)).get();
}

/* -------------------- packages -------------------- */

export async function listPackages(filter?: "active" | "expiring" | "expired" | "all") {
  const all = db
    .select()
    .from(packages)
    .orderBy(desc(packages.purchaseDate))
    .all();
  if (!filter || filter === "all") return all;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const in30 = new Date(today);
  in30.setDate(today.getDate() + 30);
  const in30Iso = in30.toISOString().slice(0, 10);
  return all.filter((p) => {
    if (filter === "expired") return p.expiryDate < todayIso;
    if (filter === "expiring")
      return (
        p.isActive &&
        p.expiryDate >= todayIso &&
        p.expiryDate <= in30Iso
      );
    return p.isActive && p.expiryDate >= todayIso;
  });
}

export async function listPackagesForClient(clientId: number, therapyId?: number) {
  const where = [eq(packages.clientId, clientId), eq(packages.isActive, true)];
  if (therapyId) where.push(eq(packages.therapyId, therapyId));
  return db
    .select()
    .from(packages)
    .where(and(...where))
    .orderBy(desc(packages.purchaseDate))
    .all();
}

/* -------------------- vouchers -------------------- */

export async function listVouchers() {
  return db
    .select()
    .from(giftVouchers)
    .orderBy(desc(giftVouchers.createdAt))
    .all();
}

export async function getVoucherByCode(code: string) {
  return db
    .select()
    .from(giftVouchers)
    .where(eq(giftVouchers.code, code.trim()))
    .get();
}

/* -------------------- dashboard -------------------- */

export async function dashboardKpis() {
  const today = new Date().toISOString().slice(0, 10);
  const todays = db
    .select()
    .from(appointments)
    .where(eq(appointments.date, today))
    .all();
  const todaysCount = todays.length;
  const confirmed = todays.filter((a) => a.status === "confirmed").length;
  const pending = todays.filter((a) => a.status === "scheduled").length;

  // ─── REVENUE — three views ───────────────────────────────────────────
  // earnings (accrual): completed sessions today
  // cash:               payments recorded today regardless of session date
  // deferred:           prepaid obligations — unused package credits +
  //                     unredeemed vouchers
  const todaysEarnings = db
    .select({ s: sql<number>`coalesce(sum(${appointments.totalPriceEur}),0)` })
    .from(appointments)
    .where(
      and(
        eq(appointments.date, today),
        eq(appointments.status, "completed"),
      ),
    )
    .get()?.s ?? 0;

  const todaysCash = db
    .select({ s: sql<number>`coalesce(sum(${payments.amountEur}),0)` })
    .from(payments)
    .where(
      sql`date(${payments.createdAt} / 1000, 'unixepoch') = ${today}`,
    )
    .get()?.s ?? 0;

  const deferredFromPackages = db
    .select({
      s: sql<number>`coalesce(sum(
        (${packages.totalSessions} - ${packages.sessionsUsed}) *
        (${packages.pricePaidEur} * 1.0 / ${packages.totalSessions})
      ),0)`,
    })
    .from(packages)
    .where(
      and(
        eq(packages.isActive, true),
        gte(packages.expiryDate, today),
        sql`${packages.sessionsUsed} < ${packages.totalSessions}`,
      ),
    )
    .get()?.s ?? 0;

  // Use balance_eur (remaining), not value_eur — partial redemptions need
  // to subtract what's already been used.
  const deferredFromVouchers = db
    .select({ s: sql<number>`coalesce(sum(${giftVouchers.balanceEur}),0)` })
    .from(giftVouchers)
    .where(
      and(
        eq(giftVouchers.isRedeemed, false),
        gte(giftVouchers.expiryDate, today),
        sql`${giftVouchers.balanceEur} > 0`,
      ),
    )
    .get()?.s ?? 0;

  const deferredRevenue = deferredFromPackages + deferredFromVouchers;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const activeClients = db
    .select({ c: sql<number>`count(distinct ${appointments.clientId})` })
    .from(appointments)
    .where(gte(appointments.date, cutoffIso))
    .get()?.c ?? 0;

  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30Iso = in30.toISOString().slice(0, 10);
  const expiringSoon = db
    .select({ c: sql<number>`count(*)` })
    .from(packages)
    .where(
      and(
        eq(packages.isActive, true),
        gte(packages.expiryDate, today),
        lte(packages.expiryDate, in30Iso),
      ),
    )
    .get()?.c ?? 0;

  return {
    todaysCount,
    confirmed,
    pending,
    todaysEarnings,
    todaysCash,
    deferredRevenue,
    activeClients,
    expiringSoon,
  };
}

export async function recentActivity(limit = 10) {
  return db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit)
    .all();
}

export async function logActivity(type: string, message: string, meta?: object) {
  db.insert(activityLog)
    .values({
      type,
      message,
      meta: meta ? JSON.stringify(meta) : null,
    })
    .run();
}

export async function revenueByDay(days = 30) {
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  const startIso = start.toISOString().slice(0, 10);

  // Revenue per day = sum of completed appointments dated that day. Matches
  // the dashboard "today's revenue" KPI.
  const rows = db
    .select({
      day: appointments.date,
      total: sql<number>`coalesce(sum(${appointments.totalPriceEur}),0)`,
    })
    .from(appointments)
    .where(
      and(
        gte(appointments.date, startIso),
        eq(appointments.status, "completed"),
      ),
    )
    .groupBy(appointments.date)
    .all();

  const map = new Map(rows.map((r) => [r.day, r.total]));
  const out: { day: string; total: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, total: map.get(key) ?? 0 });
  }
  return out;
}

/* -------------------- reports -------------------- */

export async function reportsSummary(startIso: string, endIso: string) {
  const totalRevenue = db
    .select({ s: sql<number>`coalesce(sum(${appointments.totalPriceEur}),0)` })
    .from(appointments)
    .where(
      and(
        gte(appointments.date, startIso),
        lte(appointments.date, endIso),
        eq(appointments.status, "completed"),
      ),
    )
    .get()?.s ?? 0;

  const totalSessions = db
    .select({ c: sql<number>`count(*)` })
    .from(sessions)
    .where(and(gte(sessions.date, startIso), lte(sessions.date, endIso)))
    .get()?.c ?? 0;

  const avgSession = totalSessions > 0 ? totalRevenue / totalSessions : 0;

  const popular = db
    .select({
      therapyId: sessions.therapyId,
      n: sql<number>`count(*)`,
    })
    .from(sessions)
    .where(and(gte(sessions.date, startIso), lte(sessions.date, endIso)))
    .groupBy(sessions.therapyId)
    .orderBy(desc(sql`count(*)`))
    .limit(1)
    .get();

  let mostPopularTherapy: string | null = null;
  if (popular) {
    const t = db
      .select()
      .from(therapies)
      .where(eq(therapies.id, popular.therapyId))
      .get();
    mostPopularTherapy = t?.name ?? null;
  }

  const dayCounts = db
    .select({
      dow: sql<number>`cast(strftime('%w', ${appointments.date}) as integer)`,
      n: sql<number>`count(*)`,
    })
    .from(appointments)
    .where(and(gte(appointments.date, startIso), lte(appointments.date, endIso)))
    .groupBy(sql`strftime('%w', ${appointments.date})`)
    .orderBy(desc(sql`count(*)`))
    .limit(1)
    .get();

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const busiestDay = dayCounts ? dayNames[dayCounts.dow] : null;

  const packagesSold = db
    .select({ c: sql<number>`count(*)` })
    .from(packages)
    .where(and(gte(packages.purchaseDate, startIso), lte(packages.purchaseDate, endIso)))
    .get()?.c ?? 0;

  return {
    totalRevenue,
    totalSessions,
    avgSession,
    mostPopularTherapy,
    busiestDay,
    packagesSold,
  };
}

export async function revenueSeries(startIso: string, endIso: string) {
  return db
    .select({
      day: appointments.date,
      total: sql<number>`coalesce(sum(${appointments.totalPriceEur}),0)`,
    })
    .from(appointments)
    .where(
      and(
        gte(appointments.date, startIso),
        lte(appointments.date, endIso),
        eq(appointments.status, "completed"),
      ),
    )
    .groupBy(appointments.date)
    .orderBy(appointments.date)
    .all();
}

export async function sessionsByTherapy(startIso: string, endIso: string) {
  const rows = db
    .select({
      therapyId: sessions.therapyId,
      n: sql<number>`count(*)`,
    })
    .from(sessions)
    .where(and(gte(sessions.date, startIso), lte(sessions.date, endIso)))
    .groupBy(sessions.therapyId)
    .all();
  if (!rows.length) return [];
  const ts = db
    .select()
    .from(therapies)
    .where(inArray(therapies.id, rows.map((r) => r.therapyId)))
    .all();
  const tm = new Map(ts.map((t) => [t.id, t]));
  return rows.map((r) => ({
    therapyId: r.therapyId,
    name: tm.get(r.therapyId)?.name ?? "Unknown",
    colour: tm.get(r.therapyId)?.colourHex ?? "#888",
    sessions: r.n,
  }));
}

export async function newVsReturning(startIso: string, endIso: string) {
  // For each month in range, count new clients (first appointment that month)
  // vs returning (had earlier appointment).
  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${appointments.date})`,
      clientId: appointments.clientId,
      first: sql<string>`min(${appointments.date})`,
    })
    .from(appointments)
    .where(and(gte(appointments.date, startIso), lte(appointments.date, endIso)))
    .groupBy(sql`strftime('%Y-%m', ${appointments.date})`, appointments.clientId)
    .all();

  // Map first-ever appointment date per client
  const firstEver = new Map<number, string>();
  const firsts = db
    .select({
      clientId: appointments.clientId,
      first: sql<string>`min(${appointments.date})`,
    })
    .from(appointments)
    .groupBy(appointments.clientId)
    .all();
  firsts.forEach((r) => firstEver.set(r.clientId, r.first));

  const buckets = new Map<string, { newClients: number; returning: number }>();
  for (const r of rows) {
    const bucket = buckets.get(r.month) ?? { newClients: 0, returning: 0 };
    if (firstEver.get(r.clientId) === r.first) bucket.newClients += 1;
    else bucket.returning += 1;
    buckets.set(r.month, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

/**
 * Attendance breakdown over a date range. Rates are over completed-or-missed
 * appointments — scheduled/confirmed (still upcoming) are excluded so the
 * denominator only counts appointments that already had a chance to happen.
 */
export async function attendanceStats(startIso: string, endIso: string) {
  const rows = db
    .select({
      status: appointments.status,
      n: sql<number>`count(*)`,
    })
    .from(appointments)
    .where(and(gte(appointments.date, startIso), lte(appointments.date, endIso)))
    .groupBy(appointments.status)
    .all();
  const byStatus = new Map(rows.map((r) => [r.status, r.n]));
  const completed = byStatus.get("completed") ?? 0;
  const noShow = byStatus.get("no_show") ?? 0;
  const cancelled = byStatus.get("cancelled") ?? 0;
  const total = completed + noShow + cancelled;
  const noShowRate = total > 0 ? noShow / total : 0;
  const cancellationRate = total > 0 ? cancelled / total : 0;

  const offenders = db
    .select({
      clientId: appointments.clientId,
      noShows: sql<number>`sum(case when ${appointments.status} = 'no_show' then 1 else 0 end)`,
      cancellations: sql<number>`sum(case when ${appointments.status} = 'cancelled' then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(appointments)
    .where(
      and(
        gte(appointments.date, startIso),
        lte(appointments.date, endIso),
        inArray(appointments.status, ["completed", "no_show", "cancelled"]),
      ),
    )
    .groupBy(appointments.clientId)
    .having(sql`sum(case when ${appointments.status} = 'no_show' then 1 else 0 end) > 0`)
    .orderBy(desc(sql`sum(case when ${appointments.status} = 'no_show' then 1 else 0 end)`))
    .limit(5)
    .all();

  let topNoShowClients: {
    clientId: number;
    name: string;
    noShows: number;
    cancellations: number;
    total: number;
  }[] = [];
  if (offenders.length > 0) {
    const cs = db
      .select()
      .from(clients)
      .where(inArray(clients.id, offenders.map((o) => o.clientId)))
      .all();
    const cm = new Map(cs.map((c) => [c.id, c]));
    topNoShowClients = offenders.map((o) => ({
      clientId: o.clientId,
      name: cm.get(o.clientId)
        ? `${cm.get(o.clientId)!.firstName} ${cm.get(o.clientId)!.lastName}`
        : `Client #${o.clientId}`,
      noShows: o.noShows,
      cancellations: o.cancellations,
      total: o.total,
    }));
  }

  return {
    completed,
    noShow,
    cancelled,
    total,
    noShowRate,
    cancellationRate,
    topNoShowClients,
  };
}

/**
 * Per-active-package utilization. "Stalled" = ≥30 days since purchase, used
 * less than half the sessions, and expires within 60 days.
 */
export async function packageUtilization() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db
    .select()
    .from(packages)
    .where(eq(packages.isActive, true))
    .all();

  if (rows.length === 0) {
    return {
      activeCount: 0,
      avgUtilizationPct: 0,
      totalSessionsSold: 0,
      totalSessionsUsed: 0,
      stalled: [],
    };
  }

  const totalSessionsSold = rows.reduce((acc, r) => acc + r.totalSessions, 0);
  const totalSessionsUsed = rows.reduce((acc, r) => acc + r.sessionsUsed, 0);
  const avgUtilizationPct =
    totalSessionsSold > 0 ? totalSessionsUsed / totalSessionsSold : 0;

  const cs = db
    .select()
    .from(clients)
    .where(inArray(clients.id, rows.map((r) => r.clientId)))
    .all();
  const cm = new Map(cs.map((c) => [c.id, c]));
  const tm = await getTherapyMap();

  const sixtyDaysOut = new Date();
  sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
  const sixtyDaysOutIso = sixtyDaysOut.toISOString().slice(0, 10);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10);

  const stalled = rows
    .filter((r) => {
      const usagePct = r.sessionsUsed / r.totalSessions;
      const daysOldEnough = r.purchaseDate <= thirtyDaysAgoIso;
      const expiringSoon = r.expiryDate <= sixtyDaysOutIso;
      const notExpired = r.expiryDate >= today;
      return usagePct < 0.5 && daysOldEnough && expiringSoon && notExpired;
    })
    .map((r) => ({
      packageId: r.id,
      clientId: r.clientId,
      clientName: cm.get(r.clientId)
        ? `${cm.get(r.clientId)!.firstName} ${cm.get(r.clientId)!.lastName}`
        : `Client #${r.clientId}`,
      therapyName: tm.get(r.therapyId)?.name ?? "—",
      packageName: r.packageName,
      sessionsUsed: r.sessionsUsed,
      totalSessions: r.totalSessions,
      utilizationPct: r.sessionsUsed / r.totalSessions,
      expiryDate: r.expiryDate,
    }))
    .sort((a, b) => a.utilizationPct - b.utilizationPct);

  return {
    activeCount: rows.length,
    avgUtilizationPct,
    totalSessionsSold,
    totalSessionsUsed,
    stalled,
  };
}

/**
 * Lead conversion grouped by therapy_interest. Range is by lead createdAt.
 * "Converted" means the lead reached status = 'booked'.
 */
export async function leadConversionByTherapy(
  startIso: string,
  endIso: string,
) {
  const rows = db
    .select({
      therapyInterest: leads.therapyInterest,
      n: sql<number>`count(*)`,
      booked: sql<number>`sum(case when ${leads.status} = 'booked' then 1 else 0 end)`,
      lost: sql<number>`sum(case when ${leads.status} = 'lost' then 1 else 0 end)`,
    })
    .from(leads)
    .where(
      sql`date(${leads.createdAt} / 1000, 'unixepoch') BETWEEN ${startIso} AND ${endIso}`,
    )
    .groupBy(leads.therapyInterest)
    .all();

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.n,
      booked: acc.booked + r.booked,
      lost: acc.lost + r.lost,
    }),
    { total: 0, booked: 0, lost: 0 },
  );
  const overallConversion =
    totals.total > 0 ? totals.booked / totals.total : 0;

  const byTherapy = rows
    .map((r) => ({
      therapy: r.therapyInterest ?? "Unspecified",
      total: r.n,
      booked: r.booked,
      lost: r.lost,
      conversionPct: r.n > 0 ? r.booked / r.n : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return { ...totals, overallConversion, byTherapy };
}

export async function topClientsBySpend(startIso: string, endIso: string, limit = 10) {
  const rows = db
    .select({
      clientId: payments.clientId,
      total: sql<number>`coalesce(sum(${payments.amountEur}),0)`,
    })
    .from(payments)
    .where(
      sql`date(${payments.createdAt} / 1000, 'unixepoch') BETWEEN ${startIso} AND ${endIso}`,
    )
    .groupBy(payments.clientId)
    .orderBy(desc(sql`sum(${payments.amountEur})`))
    .limit(limit)
    .all();
  if (!rows.length) return [];
  const cs = db
    .select()
    .from(clients)
    .where(inArray(clients.id, rows.map((r) => r.clientId)))
    .all();
  const cm = new Map(cs.map((c) => [c.id, c]));
  return rows.map((r) => ({
    clientId: r.clientId,
    name: cm.get(r.clientId)
      ? `${cm.get(r.clientId)!.firstName} ${cm.get(r.clientId)!.lastName}`
      : `Client #${r.clientId}`,
    total: r.total,
  }));
}
