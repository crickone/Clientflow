import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { MODULE_CATALOG, moduleForPath } from "@/lib/features";

/**
 * Which modules a business actually opens. The root layout calls
 * noteModuleVisit on every staff page render; that only touches a Map. A
 * timer flushes the Map into module_usage once a minute, one row per
 * (tenant, module, day), so a busy day is one UPDATE, not a write per
 * click. Counts are page renders, which is close enough to "did they use it".
 */
const buffer = new Map<string, { tenantId: number; key: string; day: string; hits: number; lastAt: number }>();

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function noteModuleVisit(tenantId: number, pathname: string, now: number = Date.now()): void {
  const mod = moduleForPath(pathname);
  if (!mod) return;
  const day = dayOf(now);
  const k = `${tenantId}|${mod.key}|${day}`;
  const cur = buffer.get(k);
  if (cur) {
    cur.hits++;
    cur.lastAt = Math.max(cur.lastAt, now);
  } else buffer.set(k, { tenantId, key: mod.key, day, hits: 1, lastAt: now });
}

export function flushModuleUsage(now: number = Date.now()): number {
  void now;
  if (buffer.size === 0) return 0;
  const rows = [...buffer.values()];
  buffer.clear();
  const up = controlSqlite.prepare(
    `INSERT INTO module_usage (tenant_id, module_key, day, hits, last_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, module_key, day) DO UPDATE SET hits = hits + excluded.hits, last_at = MAX(last_at, excluded.last_at)`,
  );
  const tx = controlSqlite.transaction(() => {
    for (const r of rows) {
      try { up.run(r.tenantId, r.key, r.day, r.hits, r.lastAt); } catch { /* a tenant purged mid-buffer */ }
    }
  });
  tx();
  return rows.length;
}

export function usageByModule(tenantId: number, days: number, now: number = Date.now()): { key: string; label: string; hits: number; lastAt: number | null; prevHits: number }[] {
  const since = dayOf(now - days * 86400000);
  const prevSince = dayOf(now - 2 * days * 86400000);
  const rows = controlSqlite
    .prepare("SELECT module_key, day, hits, last_at FROM module_usage WHERE tenant_id = ? AND day >= ?")
    .all(tenantId, prevSince) as Array<{ module_key: string; day: string; hits: number; last_at: number }>;
  return MODULE_CATALOG.map((m) => {
    const mine = rows.filter((r) => r.module_key === m.key);
    const cur = mine.filter((r) => r.day >= since);
    const prev = mine.filter((r) => r.day < since);
    return {
      key: m.key,
      label: m.label,
      hits: cur.reduce((n, r) => n + r.hits, 0),
      lastAt: mine.length ? Math.max(...mine.map((r) => r.last_at)) : null,
      prevHits: prev.reduce((n, r) => n + r.hits, 0),
    };
  });
}

const g = globalThis as { __moduleUsageFlusher?: ReturnType<typeof setInterval> };
if (!g.__moduleUsageFlusher && process.env.NEXT_PHASE !== "phase-production-build") {
  g.__moduleUsageFlusher = setInterval(() => {
    try { flushModuleUsage(); } catch (err) { console.error("[usage] flush failed:", err); }
  }, 60 * 1000);
  g.__moduleUsageFlusher.unref();
}
