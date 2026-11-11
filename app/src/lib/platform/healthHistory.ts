import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getFleetHealth } from "./health";

/**
 * Health over time. `snapshotFleetHealth` runs hourly: one row per active
 * business in health_snapshots, and the platform_alerts list reconciled
 * against what the health sweep reports right now. An alert is one row from
 * the hour it appears to the hour it stops appearing; the console reads
 * open rows as the inbox and resolved rows as history.
 */
export interface AlertCandidate {
  tenantId: number | null;
  key: string;
  level: "warn" | "bad";
  title: string;
  detail?: string | null;
  href?: string | null;
}

export interface HealthSnapshotRow {
  at: number;
  dbBytes: number;
  walBytes: number;
  queueDue: number;
  queueFailed: number;
  stuck: number;
  alertsBad: number;
  alertsWarn: number;
}

/**
 * Reconcile: open what is new, touch what is still there, resolve what has
 * gone. `scope.tenantIds` limits the resolve step to those tenants (plus
 * platform-wide alerts when `scope.platform` is true), so a sync that only
 * looked at some tenants cannot resolve the others' alerts. With no scope,
 * every open alert is in play.
 */
export function syncPlatformAlerts(
  candidates: AlertCandidate[],
  now: number = Date.now(),
  scope?: { tenantIds?: number[]; platform?: boolean },
): { opened: number; resolved: number; seen: number } {
  const seenKeys = new Set<string>();
  candidates = candidates.filter((c) => {
    const k = `${c.tenantId ?? 0}|${c.key}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
  const openRows = controlSqlite
    .prepare("SELECT id, tenant_id, key, level FROM platform_alerts WHERE resolved_at IS NULL")
    .all() as Array<{ id: number; tenant_id: number | null; key: string; level: string }>;
  const idOf = (tenantId: number | null, key: string) => `${tenantId ?? 0}|${key}`;
  const open = new Map(openRows.map((r) => [idOf(r.tenant_id, r.key), r]));
  const inScope = (tenantId: number | null) =>
    !scope ||
    (tenantId === null ? scope.platform === true : (scope.tenantIds ?? []).includes(tenantId));

  let opened = 0;
  let seen = 0;
  const kept = new Set<string>();
  const tx = controlSqlite.transaction(() => {
    for (const c of candidates) {
      const k = idOf(c.tenantId, c.key);
      kept.add(k);
      const existing = open.get(k);
      if (existing) {
        controlSqlite
          .prepare("UPDATE platform_alerts SET last_seen_at = ?, level = ?, title = ?, detail = ?, href = ? WHERE id = ?")
          .run(now, c.level, c.title, c.detail ?? null, c.href ?? null, existing.id);
        seen++;
      } else {
        controlSqlite
          .prepare(
            `INSERT INTO platform_alerts (tenant_id, key, level, title, detail, href, opened_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(c.tenantId, c.key, c.level, c.title, c.detail ?? null, c.href ?? null, now, now);
        opened++;
      }
    }
    let resolved = 0;
    for (const r of openRows) {
      const k = idOf(r.tenant_id, r.key);
      if (kept.has(k) || !inScope(r.tenant_id)) continue;
      controlSqlite.prepare("UPDATE platform_alerts SET resolved_at = ? WHERE id = ?").run(now, r.id);
      resolved++;
    }
    return resolved;
  });
  const resolved = tx();
  return { opened, resolved, seen };
}

/** Alert candidates from one fleet sweep: each business's own alerts (an unreadable business raises health:unreadable) plus platform-wide ones. */
export function buildFleetCandidates(fleet: ReturnType<typeof getFleetHealth>): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (const row of fleet.tenants) {
    for (const a of row.alerts) {
      candidates.push({
        tenantId: row.tenantId,
        key: `health:${a.key}`,
        level: a.level,
        title: a.message,
        href: `/gyms/${row.tenantId}/health`,
      });
    }
  }
  for (const d of fleet.duplicateSiteSlugs) {
    candidates.push({
      tenantId: null,
      key: `site_slug:${d.slug}`,
      level: "bad",
      title: `Site slug "${d.slug}" is used by ${d.owners.length} businesses; only ${d.servedBy} is reachable.`,
      href: "/health",
    });
  }
  return candidates;
}

/** One snapshot per readable business (one health sweep), then the alert list reconciled. */
export function snapshotFleetHealth(now: number = Date.now()): { tenants: number; opened: number; resolved: number } {
  const fleet = getFleetHealth();
  const insert = controlSqlite.prepare(
    `INSERT INTO health_snapshots (tenant_id, at, db_bytes, wal_bytes, queue_due, queue_failed, stuck, alerts_bad, alerts_warn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of fleet.tenants) {
    if (!row.readable) continue;
    insert.run(
      row.tenantId, now, row.dbBytes, row.walBytes, row.queueDue, row.queueFailed, row.stuck,
      row.alerts.filter((a) => a.level === "bad").length,
      row.alerts.filter((a) => a.level === "warn").length,
    );
  }
  const r = syncPlatformAlerts(buildFleetCandidates(fleet), now, {
    tenantIds: fleet.tenants.map((t) => t.tenantId),
    platform: true,
  });
  return { tenants: fleet.tenants.length, opened: r.opened, resolved: r.resolved };
}

export function listHealthHistory(tenantId: number, sinceMs: number): HealthSnapshotRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT at, db_bytes, wal_bytes, queue_due, queue_failed, stuck, alerts_bad, alerts_warn
       FROM health_snapshots WHERE tenant_id = ? AND at >= ? ORDER BY at`,
    )
    .all(tenantId, sinceMs) as Array<{
    at: number; db_bytes: number; wal_bytes: number; queue_due: number; queue_failed: number; stuck: number; alerts_bad: number; alerts_warn: number;
  }>;
  return rows.map((r) => ({
    at: r.at, dbBytes: r.db_bytes, walBytes: r.wal_bytes, queueDue: r.queue_due, queueFailed: r.queue_failed,
    stuck: r.stuck, alertsBad: r.alerts_bad, alertsWarn: r.alerts_warn,
  }));
}
