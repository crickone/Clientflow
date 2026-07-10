import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientPackages, clients, packagePlans, type PackagePlan } from "@/lib/db/schema";
import { addInterval } from "@/lib/memberships";
import { todayIso } from "@/lib/timetable";

// ── helpers ───────────────────────────────────────────────────────────────────

export type Pace = "ahead" | "behind" | "on_track" | "na";

function daysBetween(a: string, b: string) {
  return (
    (new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000
  );
}

/** Compare actual credit usage to the linear-expected pace over the validity window. */
export function expectedUsage(opts: {
  startDate: string;
  endDate: string | null;
  sessionsTotal: number;
  sessionsUsed: number;
  unlimitedSessions: boolean;
  today: string;
}): Pace {
  if (opts.unlimitedSessions || !opts.endDate || opts.sessionsTotal <= 0) return "na";
  const span = daysBetween(opts.startDate, opts.endDate);
  if (span <= 0) return "na";
  const elapsed = Math.min(Math.max(daysBetween(opts.startDate, opts.today), 0), span);
  const expected = (elapsed / span) * opts.sessionsTotal;
  if (opts.sessionsUsed >= expected + 0.75) return "ahead";
  if (opts.sessionsUsed <= expected - 0.75) return "behind";
  return "on_track";
}

export interface PackageInput {
  name: string;
  category?: string | null;
  description?: string | null;
  priceCents: number;
  unlimitedSessions: boolean;
  sessionsQuantity: number;
  unlimitedDuration: boolean;
  expirationCount: number;
  expirationInterval: "week" | "month" | "year";
  singlePurchase: boolean;
  activateOnFirstBooking: boolean;
  autoRenewal: boolean;
  restrictToMembers: boolean;
  visibility: "all" | "private";
  openAccess: boolean;
  priorityBooking: boolean;
  forSale: boolean;
}

export interface PackageWithStats extends PackagePlan {
  activePayments: number;
}

// ── catalog ───────────────────────────────────────────────────────────────────

export function listPackagePlans(): PackageWithStats[] {
  const rows = db
    .select()
    .from(packagePlans)
    .where(eq(packagePlans.isActive, true))
    .orderBy(desc(packagePlans.createdAt))
    .all();

  const counts = db
    .select({ packageId: clientPackages.packageId, n: sql<number>`count(*)` })
    .from(clientPackages)
    .where(eq(clientPackages.status, "active"))
    .groupBy(clientPackages.packageId)
    .all();
  const countMap = new Map(counts.map((c) => [c.packageId, Number(c.n)]));

  return rows.map((p) => ({ ...p, activePayments: countMap.get(p.id) ?? 0 }));
}

export function getPackagePlan(id: number): PackagePlan | undefined {
  return db.select().from(packagePlans).where(eq(packagePlans.id, id)).get();
}

export function createPackagePlan(input: PackageInput): PackagePlan {
  const [row] = db.insert(packagePlans).values({ ...input }).returning().all();
  return row;
}

export function updatePackagePlan(id: number, input: PackageInput) {
  db.update(packagePlans)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(packagePlans.id, id))
    .run();
}

export function deletePackagePlan(id: number) {
  db.update(packagePlans)
    .set({ isActive: false, forSale: false, updatedAt: new Date() })
    .where(eq(packagePlans.id, id))
    .run();
}

// ── purchased packages ────────────────────────────────────────────────────────

export interface PurchasedPackageRow {
  id: number;
  clientId: number;
  clientName: string;
  packageId: number | null;
  packageName: string;
  priceCents: number;
  status: string;
  startDate: string;
  endDate: string | null;
  sessionsUsed: number;
  sessionsTotal: number;
  unlimitedSessions: boolean;
  activated: boolean;
  pace: Pace;
}

export function listPurchasedPackages(opts: {
  status?: string;
  q?: string;
  pace?: string;
}): PurchasedPackageRow[] {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(clientPackages.status, opts.status as "active"));
  }
  const rows = db
    .select({
      id: clientPackages.id,
      clientId: clientPackages.clientId,
      firstName: clients.firstName,
      lastName: clients.lastName,
      packageId: clientPackages.packageId,
      packageName: clientPackages.packageName,
      priceCents: clientPackages.priceCents,
      status: clientPackages.status,
      startDate: clientPackages.startDate,
      endDate: clientPackages.endDate,
      sessionsUsed: clientPackages.sessionsUsed,
      sessionsTotal: clientPackages.sessionsTotal,
      unlimitedSessions: clientPackages.unlimitedSessions,
      activated: clientPackages.activated,
    })
    .from(clientPackages)
    .innerJoin(clients, eq(clients.id, clientPackages.clientId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(clientPackages.startDate))
    .all();

  const today = todayIso();
  let out: PurchasedPackageRow[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: `${r.firstName} ${r.lastName ?? ""}`.trim(),
    packageId: r.packageId,
    packageName: r.packageName,
    priceCents: r.priceCents,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    sessionsUsed: r.sessionsUsed,
    sessionsTotal: r.sessionsTotal,
    unlimitedSessions: r.unlimitedSessions,
    activated: r.activated,
    pace: expectedUsage({
      startDate: r.startDate,
      endDate: r.endDate,
      sessionsTotal: r.sessionsTotal,
      sessionsUsed: r.sessionsUsed,
      unlimitedSessions: r.unlimitedSessions,
      today,
    }),
  }));

  const q = opts.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) => r.clientName.toLowerCase().includes(q) || r.packageName.toLowerCase().includes(q),
    );
  }
  if (opts.pace && opts.pace !== "all") out = out.filter((r) => r.pace === opts.pace);
  return out;
}

export function assignPackage(input: {
  packageId: number;
  clientId: number;
  startDate: string;
}): { ok: true } | { ok: false; error: string } {
  const p = getPackagePlan(input.packageId);
  if (!p) return { ok: false, error: "Package not found." };

  if (p.singlePurchase) {
    const prior = db
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(
        and(
          eq(clientPackages.clientId, input.clientId),
          eq(clientPackages.packageId, input.packageId),
        ),
      )
      .get();
    if (prior) return { ok: false, error: "This is a single-purchase package — already bought." };
  }

  const activateNow = !p.activateOnFirstBooking;
  const endDate = p.unlimitedDuration
    ? null
    : addInterval(input.startDate, p.expirationInterval, p.expirationCount);

  db.insert(clientPackages)
    .values({
      packageId: p.id,
      clientId: input.clientId,
      packageName: p.name,
      priceCents: p.priceCents,
      sessionsTotal: p.sessionsQuantity,
      unlimitedSessions: p.unlimitedSessions,
      sessionsUsed: 0,
      status: "active",
      startDate: input.startDate,
      endDate,
      activated: activateNow,
    })
    .run();
  return { ok: true };
}

export function setClientPackageStatus(id: number, status: "active" | "expired" | "cancelled") {
  db.update(clientPackages).set({ status }).where(eq(clientPackages.id, id)).run();
}

/** Manual credit adjustment (+1 / −1), clamped to ≥ 0. */
export function adjustPackageCredits(id: number, delta: number) {
  const cp = db.select().from(clientPackages).where(eq(clientPackages.id, id)).get();
  if (!cp) return;
  const next = Math.max(0, cp.sessionsUsed + delta);
  db.update(clientPackages)
    .set({ sessionsUsed: next, activated: cp.activated || next > 0 })
    .where(eq(clientPackages.id, id))
    .run();
}

export interface PurchasedPackageDetail extends PurchasedPackageRow {
  clientEmail: string | null;
}

export function getPurchasedPackage(id: number): PurchasedPackageDetail | null {
  const cp = db.select().from(clientPackages).where(eq(clientPackages.id, id)).get();
  if (!cp) return null;
  const client = db
    .select({ first: clients.firstName, last: clients.lastName, email: clients.email })
    .from(clients)
    .where(eq(clients.id, cp.clientId))
    .get();
  const today = todayIso();
  return {
    id: cp.id,
    clientId: cp.clientId,
    clientName: `${client?.first ?? ""} ${client?.last ?? ""}`.trim(),
    clientEmail: client?.email ?? null,
    packageId: cp.packageId,
    packageName: cp.packageName,
    priceCents: cp.priceCents,
    status: cp.status,
    startDate: cp.startDate,
    endDate: cp.endDate,
    sessionsUsed: cp.sessionsUsed,
    sessionsTotal: cp.sessionsTotal,
    unlimitedSessions: cp.unlimitedSessions,
    activated: cp.activated,
    pace: expectedUsage({
      startDate: cp.startDate,
      endDate: cp.endDate,
      sessionsTotal: cp.sessionsTotal,
      sessionsUsed: cp.sessionsUsed,
      unlimitedSessions: cp.unlimitedSessions,
      today,
    }),
  };
}

export function listAssignableClients() {
  return db
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
    .from(clients)
    .orderBy(clients.firstName)
    .all();
}
