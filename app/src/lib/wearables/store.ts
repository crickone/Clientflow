import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { wearableConnections, wearableDays } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { addDays, dateKey } from "@/lib/trainingProgress";
import { cleanDay, combineDevices, PROVIDERS, type ProviderId, type WearableDay } from "@/lib/wearables/model";
import { fetchDays, isPushProvider, refresh, revoke, WearableError, type Tokens } from "@/lib/wearables/providers";

/**
 * Members' wearables: connections (control plane, so a push can find the
 * member) and their daily readings (in the business's own database). Every
 * function names the tenant explicitly: the callback, the ticker and the
 * Garmin push have no signed-in request.
 */

export type Connection = typeof wearableConnections.$inferSelect;

export function connectionsFor(tenantId: number, clientId: number): Connection[] {
  return controlDb.select().from(wearableConnections).where(and(eq(wearableConnections.tenantId, tenantId), eq(wearableConnections.clientId, clientId))).all();
}

export function saveConnection(tenantId: number, clientId: number, provider: ProviderId, t: Tokens): void {
  const row = {
    tenantId,
    clientId,
    provider,
    accessToken: encryptToken(t.accessToken),
    refreshToken: t.refreshToken ? encryptToken(t.refreshToken) : null,
    expiresAt: t.expiresAt,
    externalUserId: t.externalUserId,
    connectedAt: Date.now(),
    lastSyncAt: null,
    lastError: null,
  };
  controlDb
    .insert(wearableConnections)
    .values(row)
    .onConflictDoUpdate({ target: [wearableConnections.tenantId, wearableConnections.clientId, wearableConnections.provider], set: row })
    .run();
}

export async function disconnect(tenantId: number, clientId: number, provider: ProviderId): Promise<void> {
  const c = connectionsFor(tenantId, clientId).find((x) => x.provider === provider);
  if (!c) return;
  await revoke(provider, safeDecrypt(c.accessToken) ?? "", c.externalUserId);
  controlDb.delete(wearableConnections).where(eq(wearableConnections.id, c.id)).run();
}

function safeDecrypt(v: string | null): string | null {
  if (!v) return null;
  try {
    return decryptToken(v);
  } catch {
    return null;
  }
}

/** Write days into the business's database, replacing what that device said for each day. */
export function storeDays(tenantId: number, clientId: number, provider: ProviderId, days: WearableDay[]): number {
  const tdb = getTenantDbById(tenantId);
  const now = Date.now();
  let n = 0;
  for (const raw of days) {
    const d = cleanDay(raw);
    const vals = {
      steps: d.steps ?? null,
      activeKcal: d.activeKcal ?? null,
      restingHr: d.restingHr ?? null,
      hrvMs: d.hrvMs ?? null,
      sleepMinutes: d.sleepMinutes ?? null,
      sleepScore: d.sleepScore ?? null,
      readiness: d.readiness ?? null,
      weightKg: d.weightKg ?? null,
      bodyFatPct: d.bodyFatPct ?? null,
      updatedAt: now,
    };
    if (Object.entries(vals).every(([k, v]) => k === "updatedAt" || v === null)) continue;
    tdb.insert(wearableDays)
      .values({ clientId, provider, day: d.day, ...vals })
      .onConflictDoUpdate({ target: [wearableDays.clientId, wearableDays.provider, wearableDays.day], set: vals })
      .run();
    n++;
  }
  return n;
}

/** A fresh access token, refreshing (and saving) it when it has expired or is about to. */
async function accessFor(c: Connection): Promise<string> {
  const access = safeDecrypt(c.accessToken);
  const soon = c.expiresAt !== null && c.expiresAt < Date.now() + 5 * 60_000;
  if (access && !soon) return access;
  const rt = safeDecrypt(c.refreshToken);
  if (!rt) throw new WearableError("Signed out: connect again.", 401);
  const t = await refresh(c.provider, rt);
  controlDb
    .update(wearableConnections)
    .set({ accessToken: encryptToken(t.accessToken), refreshToken: t.refreshToken ? encryptToken(t.refreshToken) : c.refreshToken, expiresAt: t.expiresAt })
    .where(eq(wearableConnections.id, c.id))
    .run();
  return t.accessToken;
}

/** Pull one connection: the last 30 days the first time, the last 3 after that. */
export async function syncConnection(c: Connection): Promise<number> {
  if (isPushProvider(c.provider)) return 0;
  const today = dateKey(Date.now());
  const from = addDays(today, c.lastSyncAt ? -2 : -29);
  try {
    const token = await accessFor(c);
    const days = await fetchDays(c.provider, token, c.externalUserId, from, today);
    const n = storeDays(c.tenantId, c.clientId, c.provider, days);
    controlDb.update(wearableConnections).set({ lastSyncAt: Date.now(), lastError: null }).where(eq(wearableConnections.id, c.id)).run();
    return n;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Sync failed";
    controlDb.update(wearableConnections).set({ lastSyncAt: Date.now(), lastError: msg }).where(eq(wearableConnections.id, c.id)).run();
    return 0;
  }
}

/** The ticker's step: each of this business's pulled connections at most hourly. */
export async function syncWearablesIfStale(tenantId: number): Promise<number> {
  const due = controlDb
    .select()
    .from(wearableConnections)
    .where(eq(wearableConnections.tenantId, tenantId))
    .all()
    .filter((c) => !isPushProvider(c.provider) && (!c.lastSyncAt || c.lastSyncAt < Date.now() - 60 * 60_000));
  let n = 0;
  for (const c of due.slice(0, 10)) n += await syncConnection(c);
  return n;
}

/** A Garmin push: find each Garmin user's member and store their days. */
export function storePush(provider: ProviderId, batches: { userId: string; days: WearableDay[] }[]): number {
  let n = 0;
  for (const b of batches) {
    const conns = controlDb.select().from(wearableConnections).where(and(eq(wearableConnections.provider, provider), eq(wearableConnections.externalUserId, b.userId))).all();
    for (const c of conns) {
      n += storeDays(c.tenantId, c.clientId, provider, b.days);
      controlDb.update(wearableConnections).set({ lastSyncAt: Date.now(), lastError: null }).where(eq(wearableConnections.id, c.id)).run();
    }
  }
  return n;
}

/** The member's (or staff's) view: the last `n` days, one value per metric across devices. */
export function recentDays(tenantId: number, clientId: number, n = 14): WearableDay[] {
  const tdb = getTenantDbById(tenantId);
  const since = addDays(dateKey(Date.now()), -(n - 1));
  const rows = tdb.select().from(wearableDays).where(and(eq(wearableDays.clientId, clientId), gte(wearableDays.day, since))).orderBy(desc(wearableDays.day)).all();
  const order = connectionsFor(tenantId, clientId)
    .sort((a, b) => a.connectedAt - b.connectedAt)
    .map((c) => c.provider);
  const all = [...order, ...PROVIDERS.map((p) => p.id).filter((id) => !order.includes(id))];
  return combineDevices(
    rows.map((r) => ({
      provider: r.provider as ProviderId,
      day: r.day,
      steps: r.steps ?? undefined,
      activeKcal: r.activeKcal ?? undefined,
      restingHr: r.restingHr ?? undefined,
      hrvMs: r.hrvMs ?? undefined,
      sleepMinutes: r.sleepMinutes ?? undefined,
      sleepScore: r.sleepScore ?? undefined,
      readiness: r.readiness ?? undefined,
      weightKg: r.weightKg ?? undefined,
      bodyFatPct: r.bodyFatPct ?? undefined,
    })),
    all,
  );
}
