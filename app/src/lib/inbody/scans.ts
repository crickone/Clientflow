import "server-only";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { bodyScanProfiles, bodyScans, clients, type BodyScan } from "@/lib/db/schema";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { fetchScanResult, measurementsOn } from "@/lib/inbody/api";
import { getInBodyConnection, isInBodyConnected, markInBodySync } from "@/lib/inbody/connection";
import {
  formatInBodyDatetime,
  hasMetrics,
  inbodyToday,
  mergeMetrics,
  parseInBodyDatetime,
  type CsvScan,
  type Metrics,
} from "@/lib/inbody/metrics";

/**
 * Body scans for the CURRENT tenant: every function here uses the ambient
 * `db`, so a caller without a session (the webhook, the ticker) must wrap it
 * in runWithTenant.
 *
 * Matching a scan to a client, in order:
 *   1. the InBody user ID a client was matched by before (body_scan_profiles),
 *   2. the phone number, when exactly one client has it,
 *   otherwise it waits in the "match this scan" list. A manual match is never
 *   undone by a later delivery of the same scan.
 */

export interface ScanView {
  id: number;
  clientId: number | null;
  measuredAt: number;
  source: "inbody" | "csv";
  inbodyUserId: string | null;
  phone: string | null;
  name: string | null;
  matchStatus: BodyScan["matchStatus"];
  resultStatus: BodyScan["resultStatus"];
  metrics: Metrics;
  error: string | null;
}

function toView(r: BodyScan): ScanView {
  let metrics: Metrics = {};
  try {
    metrics = JSON.parse(r.metricsJson) as Metrics;
  } catch {
    /* an unreadable row shows as empty rather than taking the page down */
  }
  return {
    id: r.id,
    clientId: r.clientId,
    measuredAt: r.measuredAt,
    source: r.source,
    inbodyUserId: r.inbodyUserId,
    phone: r.phone,
    name: r.name,
    matchStatus: r.matchStatus,
    resultStatus: r.resultStatus,
    metrics,
    error: r.error,
  };
}

/** The client a scan belongs to, by remembered InBody ID then by phone. */
export function matchClient(who: { userId?: string | null; phone?: string | null }): { clientId: number | null; status: "auto" | "unmatched" | "ambiguous" } {
  const userId = who.userId?.trim();
  if (userId) {
    const p = db.select({ clientId: bodyScanProfiles.clientId }).from(bodyScanProfiles).where(eq(bodyScanProfiles.inbodyUserId, userId)).all();
    if (p.length === 1) return { clientId: p[0].clientId, status: "auto" };
  }
  const phone = normalizePhone(who.phone);
  if (phone.length >= 8) {
    const hits = db
      .select({ id: clients.id, phone: clients.phone })
      .from(clients)
      .all()
      .filter((c) => normalizePhone(c.phone) === phone);
    if (hits.length === 1) return { clientId: hits[0].id, status: "auto" };
    if (hits.length > 1) return { clientId: null, status: "ambiguous" };
  }
  return { clientId: null, status: "unmatched" };
}

export interface IncomingScan {
  measuredAt: number;
  source: "inbody" | "csv";
  userId?: string | null;
  phone?: string | null;
  name?: string | null;
  equipment?: string | null;
  metrics?: Metrics;
  raw?: unknown;
  resultStatus?: "fetched" | "pending" | "error";
  error?: string | null;
}

/**
 * Store a scan, or refresh the one already stored for that moment. Returns
 * the row and whether it is new. Metrics only ever grow: a later delivery that
 * failed to fetch never wipes results already held.
 */
export function upsertScan(input: IncomingScan): { scan: ScanView; created: boolean } {
  const now = Date.now();
  const existing = db.select().from(bodyScans).where(eq(bodyScans.measuredAt, input.measuredAt)).get();
  const incomingMetrics = input.metrics ?? {};
  if (existing) {
    const held = toView(existing).metrics;
    const metrics = mergeMetrics(incomingMetrics, held);
    const keepMatch = existing.matchStatus === "manual" || existing.clientId !== null;
    const match = keepMatch ? null : matchClient({ userId: input.userId ?? existing.inbodyUserId, phone: input.phone ?? existing.phone });
    db.update(bodyScans)
      .set({
        inbodyUserId: input.userId?.trim() || existing.inbodyUserId,
        phone: input.phone?.trim() || existing.phone,
        name: input.name?.trim() || existing.name,
        equipment: input.equipment?.trim() || existing.equipment,
        metricsJson: JSON.stringify(metrics),
        rawJson: input.raw !== undefined ? JSON.stringify(input.raw) : existing.rawJson,
        resultStatus: hasMetrics(metrics) ? "fetched" : (input.resultStatus ?? existing.resultStatus),
        error: hasMetrics(metrics) ? null : (input.error ?? existing.error),
        ...(match ? { clientId: match.clientId, matchStatus: match.status } : {}),
        updatedAt: now,
      })
      .where(eq(bodyScans.id, existing.id))
      .run();
    return { scan: toView(db.select().from(bodyScans).where(eq(bodyScans.id, existing.id)).get()!), created: false };
  }
  const match = matchClient({ userId: input.userId, phone: input.phone });
  const inserted = db
    .insert(bodyScans)
    .values({
      clientId: match.clientId,
      measuredAt: input.measuredAt,
      source: input.source,
      inbodyUserId: input.userId?.trim() || null,
      phone: input.phone?.trim() || null,
      name: input.name?.trim() || null,
      equipment: input.equipment?.trim() || null,
      matchStatus: match.status,
      resultStatus: hasMetrics(incomingMetrics) ? "fetched" : (input.resultStatus ?? "pending"),
      metricsJson: JSON.stringify(incomingMetrics),
      rawJson: input.raw !== undefined ? JSON.stringify(input.raw) : null,
      error: input.error ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { scan: toView(inserted), created: true };
}

/** Look a stored scan's results up from InBody and save them. */
export async function fetchAndStore(tenantId: number, scan: { measuredAt: number; inbodyUserId: string | null; phone: string | null }): Promise<ScanView> {
  const res = await fetchScanResult(tenantId, { userId: scan.inbodyUserId, phone: scan.phone }, formatInBodyDatetime(scan.measuredAt));
  if (res.ok && hasMetrics(res.data.metrics)) {
    return upsertScan({ measuredAt: scan.measuredAt, source: "inbody", metrics: res.data.metrics, raw: res.data.raw }).scan;
  }
  const error = res.ok ? "InBody had no results for this scan yet." : res.error;
  return upsertScan({ measuredAt: scan.measuredAt, source: "inbody", resultStatus: "error", error }).scan;
}

/** A webhook notification: store the scan straight away, then fetch its results. */
export async function ingestNotification(tenantId: number, payload: Record<string, unknown>): Promise<{ ok: boolean; reason?: string; scan?: ScanView }> {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(payload).find((x) => x.toLowerCase() === k.toLowerCase());
      if (hit && payload[hit] !== null && payload[hit] !== undefined && String(payload[hit]).trim()) return String(payload[hit]).trim();
    }
    return "";
  };
  const datetimes = get("TestDatetimes", "Datetimes", "DateTimes");
  const measuredAt = parseInBodyDatetime(datetimes);
  // InBody's "Send test" posts a sample with no real scan in it. It must get
  // a 200 for the webhook to be saved, so it is acknowledged and dropped.
  if (measuredAt === null) return { ok: true, reason: "no scan time in the notification" };
  if (get("IsTempData").toLowerCase() === "true") return { ok: true, reason: "temporary scan" };
  const userId = get("UserID");
  const phone = get("TelHP", "UserToken", "Phone");
  const { scan } = upsertScan({
    measuredAt,
    source: "inbody",
    userId,
    phone,
    name: get("Name"),
    equipment: [get("Equip"), get("EquipSerial")].filter(Boolean).join(" "),
  });
  if (!isInBodyConnected(tenantId)) return { ok: true, scan };
  const fetched = await fetchAndStore(tenantId, { measuredAt, inbodyUserId: userId || null, phone: phone || null });
  return { ok: true, scan: fetched };
}

/**
 * The safety net behind the webhook: every hour, ask InBody for today's scans
 * and pick up any we missed, and retry the last week's scans still waiting
 * on results. A no-op for a tenant without an InBody connection.
 */
const SYNC_GAP_MS = 60 * 60 * 1000;
const lastAttempt = new Map<number, number>();

export async function syncInBodyIfStale(tenantId: number): Promise<void> {
  if (!isInBodyConnected(tenantId)) return;
  const conn = getInBodyConnection(tenantId);
  const now = Date.now();
  if (conn?.lastSyncAt && now - conn.lastSyncAt < SYNC_GAP_MS) return;
  if (now - (lastAttempt.get(tenantId) ?? 0) < SYNC_GAP_MS) return;
  lastAttempt.set(tenantId, now);
  markInBodySync(tenantId);

  const today = await measurementsOn(tenantId, inbodyToday(now));
  if (today.ok) {
    for (const m of today.data) {
      const at = parseInBodyDatetime(m.datetimes);
      if (at === null) continue;
      const held = db.select().from(bodyScans).where(eq(bodyScans.measuredAt, at)).get();
      if (held && held.resultStatus === "fetched") continue;
      upsertScan({ measuredAt: at, source: "inbody", userId: m.userId, phone: m.phone });
      await fetchAndStore(tenantId, { measuredAt: at, inbodyUserId: m.userId || null, phone: m.phone || null });
    }
  }
  const waiting = db
    .select()
    .from(bodyScans)
    .where(and(ne(bodyScans.resultStatus, "fetched"), eq(bodyScans.source, "inbody"), sql`${bodyScans.measuredAt} > ${now - 7 * 86_400_000}`))
    .limit(20)
    .all();
  for (const w of waiting) await fetchAndStore(tenantId, w);
}

// ---- CSV import ----------------------------------------------------------

export function importCsvScans(scans: CsvScan[]): { created: number; updated: number; matched: number } {
  let created = 0;
  let updated = 0;
  let matched = 0;
  for (const s of scans) {
    const r = upsertScan({ measuredAt: s.measuredAt, source: "csv", userId: s.userId, phone: s.phone, name: s.name, metrics: s.metrics });
    if (r.created) created++;
    else updated++;
    if (r.scan.clientId !== null) matched++;
  }
  return { created, updated, matched };
}

// ---- Staff ---------------------------------------------------------------

/**
 * Match a scan to a client by hand. The client remembers the scan's InBody ID
 * (if they had none), so their next scans match on their own, and any other
 * waiting scan with the same ID or phone is matched along with it.
 */
export function assignScan(scanId: number, clientId: number): number {
  const scan = db.select().from(bodyScans).where(eq(bodyScans.id, scanId)).get();
  if (!scan) throw new Error("That scan no longer exists.");
  const client = db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).get();
  if (!client) throw new Error("That client no longer exists.");
  const now = Date.now();
  db.update(bodyScans).set({ clientId, matchStatus: "manual", updatedAt: now }).where(eq(bodyScans.id, scanId)).run();
  if (scan.inbodyUserId) {
    const profile = db.select().from(bodyScanProfiles).where(eq(bodyScanProfiles.clientId, clientId)).get();
    if (!profile) db.insert(bodyScanProfiles).values({ clientId, inbodyUserId: scan.inbodyUserId, updatedAt: now }).run();
    else if (!profile.inbodyUserId) db.update(bodyScanProfiles).set({ inbodyUserId: scan.inbodyUserId, updatedAt: now }).where(eq(bodyScanProfiles.clientId, clientId)).run();
  }
  const same = [
    scan.inbodyUserId ? eq(bodyScans.inbodyUserId, scan.inbodyUserId) : undefined,
    scan.phone ? eq(bodyScans.phone, scan.phone) : undefined,
  ].filter(Boolean);
  let alsoMatched = 0;
  if (same.length) {
    const r = db
      .update(bodyScans)
      .set({ clientId, matchStatus: "manual", updatedAt: now })
      .where(and(isNull(bodyScans.clientId), or(...(same as NonNullable<(typeof same)[number]>[]))))
      .run();
    alsoMatched = r.changes;
  }
  return alsoMatched;
}

export function unassignScan(scanId: number): void {
  db.update(bodyScans).set({ clientId: null, matchStatus: "unmatched", updatedAt: Date.now() }).where(eq(bodyScans.id, scanId)).run();
}

export function deleteScan(scanId: number): void {
  db.delete(bodyScans).where(eq(bodyScans.id, scanId)).run();
}

export function listClientScans(clientId: number): ScanView[] {
  return db.select().from(bodyScans).where(eq(bodyScans.clientId, clientId)).orderBy(desc(bodyScans.measuredAt)).all().map(toView);
}

export function listUnmatchedScans(limit = 100): ScanView[] {
  return db.select().from(bodyScans).where(isNull(bodyScans.clientId)).orderBy(desc(bodyScans.measuredAt)).limit(limit).all().map(toView);
}

export function listRecentScans(limit = 20): (ScanView & { clientName: string | null })[] {
  const rows = db.select().from(bodyScans).orderBy(desc(bodyScans.measuredAt)).limit(limit).all().map(toView);
  const ids = [...new Set(rows.map((r) => r.clientId).filter((x): x is number => x !== null))];
  const names = new Map<number, string>();
  if (ids.length) {
    for (const c of db.select({ id: clients.id, f: clients.firstName, l: clients.lastName }).from(clients).where(inArray(clients.id, ids)).all()) {
      names.set(c.id, `${c.f} ${c.l}`.trim());
    }
  }
  return rows.map((r) => ({ ...r, clientName: r.clientId !== null ? names.get(r.clientId) ?? null : null }));
}

export function scanCounts(): { total: number; unmatched: number; pending: number } {
  const r = db
    .select({
      total: sql<number>`count(*)`,
      unmatched: sql<number>`sum(case when ${bodyScans.clientId} is null then 1 else 0 end)`,
      pending: sql<number>`sum(case when ${bodyScans.resultStatus} != 'fetched' then 1 else 0 end)`,
    })
    .from(bodyScans)
    .get();
  return { total: Number(r?.total ?? 0), unmatched: Number(r?.unmatched ?? 0), pending: Number(r?.pending ?? 0) };
}

/** Whether to show body scans anywhere: the gym connected InBody, or has scans already. */
export function bodyScansEnabled(tenantId: number): boolean {
  if (getInBodyConnection(tenantId)) return true;
  return db.select({ id: bodyScans.id }).from(bodyScans).limit(1).get() !== undefined;
}

// ---- Client profile ------------------------------------------------------

export function getScanProfile(clientId: number): { inbodyUserId: string | null; consentAt: number | null } {
  const p = db.select().from(bodyScanProfiles).where(eq(bodyScanProfiles.clientId, clientId)).get();
  return { inbodyUserId: p?.inbodyUserId ?? null, consentAt: p?.consentAt ?? null };
}

function upsertProfile(clientId: number, patch: { inbodyUserId?: string | null; consentAt?: number | null }): void {
  const now = Date.now();
  const existing = db.select().from(bodyScanProfiles).where(eq(bodyScanProfiles.clientId, clientId)).get();
  if (existing) db.update(bodyScanProfiles).set({ ...patch, updatedAt: now }).where(eq(bodyScanProfiles.clientId, clientId)).run();
  else db.insert(bodyScanProfiles).values({ clientId, inbodyUserId: patch.inbodyUserId ?? null, consentAt: patch.consentAt ?? null, updatedAt: now }).run();
}

/** Set a client's InBody ID, then pick up any waiting scans that carry it. */
export function setClientInBodyId(clientId: number, inbodyUserId: string): number {
  const id = inbodyUserId.trim() || null;
  upsertProfile(clientId, { inbodyUserId: id });
  if (!id) return 0;
  return db
    .update(bodyScans)
    .set({ clientId, matchStatus: "manual", updatedAt: Date.now() })
    .where(and(isNull(bodyScans.clientId), eq(bodyScans.inbodyUserId, id)))
    .run().changes;
}

export function setScanConsent(clientId: number, consent: boolean): void {
  upsertProfile(clientId, { consentAt: consent ? Date.now() : null });
}

