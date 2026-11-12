import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getFleetHealth } from "./health";
import { collectAlertCandidates, buildFleetCandidates, planFleetSync } from "./alertSources";

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

export { buildFleetCandidates, planFleetSync };

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
  const plan = collectAlertCandidates(fleet, now);
  const r = syncPlatformAlerts(plan.candidates, now, { tenantIds: plan.tenantIds, platform: true });
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

export interface PlatformAlertRow {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  key: string;
  level: "warn" | "bad";
  title: string;
  detail: string | null;
  href: string | null;
  openedAt: number;
  lastSeenAt: number;
  resolvedAt: number | null;
  acknowledgedAt: number | null;
  acknowledgedBy: number | null;
  snoozedUntil: number | null;
  assignedTo: number | null;
}

type RawAlert = {
  id: number; tenant_id: number | null; tenant_name: string | null; key: string; level: "warn" | "bad"; title: string; detail: string | null;
  href: string | null; opened_at: number; last_seen_at: number; resolved_at: number | null; acknowledged_at: number | null;
  acknowledged_by: number | null; snoozed_until: number | null; assigned_to: number | null;
};
const toAlert = (r: RawAlert): PlatformAlertRow => ({
  id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, key: r.key, level: r.level, title: r.title, detail: r.detail, href: r.href,
  openedAt: r.opened_at, lastSeenAt: r.last_seen_at, resolvedAt: r.resolved_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by,
  snoozedUntil: r.snoozed_until, assignedTo: r.assigned_to,
});
const SELECT = `SELECT a.*, t.name AS tenant_name FROM platform_alerts a LEFT JOIN tenants t ON t.id = a.tenant_id`;

/** Open alerts, bad first, then oldest first. Snoozed ones are included when `includeSnoozed`. */
export function listOpenAlerts(opts: { tenantId?: number; includeSnoozed?: boolean; now?: number } = {}): PlatformAlertRow[] {
  const now = opts.now ?? Date.now();
  const where = ["a.resolved_at IS NULL"];
  const args: unknown[] = [];
  if (opts.tenantId !== undefined) { where.push("a.tenant_id = ?"); args.push(opts.tenantId); }
  if (!opts.includeSnoozed) { where.push("(a.snoozed_until IS NULL OR a.snoozed_until <= ?)"); args.push(now); }
  const rows = controlSqlite
    .prepare(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY CASE a.level WHEN 'bad' THEN 0 ELSE 1 END, a.acknowledged_at IS NOT NULL, a.opened_at`)
    .all(...args) as RawAlert[];
  return rows.map(toAlert);
}

export function listAlertHistory(tenantId: number, limit = 50): PlatformAlertRow[] {
  return (controlSqlite.prepare(`${SELECT} WHERE a.tenant_id = ? ORDER BY a.opened_at DESC LIMIT ?`).all(tenantId, limit) as RawAlert[]).map(toAlert);
}

export type AlertOp =
  | { op: "ack" }
  | { op: "unack" }
  | { op: "snooze"; until: number }
  | { op: "assign"; userId: number | null };

export function alertAction(id: number, op: AlertOp, actorUserId: number, now: number = Date.now()): { ok: true } | { ok: false; error: string } {
  const exists = controlSqlite.prepare("SELECT id FROM platform_alerts WHERE id = ? AND resolved_at IS NULL").get(id);
  if (!exists) return { ok: false, error: "That alert is closed or does not exist." };
  switch (op.op) {
    case "ack":
      controlSqlite.prepare("UPDATE platform_alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?").run(now, actorUserId, id);
      return { ok: true };
    case "unack":
      controlSqlite.prepare("UPDATE platform_alerts SET acknowledged_at = NULL, acknowledged_by = NULL WHERE id = ?").run(id);
      return { ok: true };
    case "snooze":
      if (op.until <= now) return { ok: false, error: "Snooze until a time in the future." };
      controlSqlite.prepare("UPDATE platform_alerts SET snoozed_until = ? WHERE id = ?").run(op.until, id);
      return { ok: true };
    case "assign":
      controlSqlite.prepare("UPDATE platform_alerts SET assigned_to = ? WHERE id = ?").run(op.userId, id);
      return { ok: true };
  }
}

export function countOpenAlerts(now: number = Date.now()): { bad: number; warn: number } {
  const rows = controlSqlite
    .prepare("SELECT level, count(*) AS n FROM platform_alerts WHERE resolved_at IS NULL AND (snoozed_until IS NULL OR snoozed_until <= ?) GROUP BY level")
    .all(now) as Array<{ level: "warn" | "bad"; n: number }>;
  return { bad: rows.find((r) => r.level === "bad")?.n ?? 0, warn: rows.find((r) => r.level === "warn")?.n ?? 0 };
}
