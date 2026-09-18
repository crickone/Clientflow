import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { offboardTenant } from "@/lib/billing/engine";

/**
 * A business's end, in three steps rather than one.
 *
 * Offboarding used to archive a copy and delete everything in the same
 * call. That is the right SEQUENCE and the wrong TIMING: a client who
 * cancels in a temper, or whose card fails while they are on holiday, had
 * one click standing between them and a restore that did not exist.
 *
 *   archive   now      logins closed, site not served, nothing charged,
 *                      every byte still there. Reversible.
 *   restore   any time inside the window
 *   purge     day 30   the old behaviour: a checkpointed copy into
 *                      data/archive, then the tenant and its database are
 *                      gone. Owner-only, and irreversible.
 *
 * `offboardTenant` (billing/engine) is unchanged and is now the PURGE step
 * only -- it still takes the backup before it deletes anything, which is
 * why purging is safe to automate at all.
 */

export const PURGE_AFTER_DAYS = 30;
const DAY_MS = 86_400_000;

export interface TenantLifecycle {
  tenantId: number;
  slug: string;
  name: string;
  isActive: boolean;
  archivedAt: number | null;
  /** When the automatic purge will take this business's data, if archived. */
  purgeAt: number | null;
  daysLeft: number | null;
}

export function getTenantLifecycle(tenantId: number): TenantLifecycle | null {
  const row = controlSqlite
    .prepare("SELECT id, slug, name, is_active, archived_at FROM tenants WHERE id = ?")
    .get(tenantId) as { id: number; slug: string; name: string; is_active: number; archived_at: number | null } | undefined;
  if (!row) return null;
  const purgeAt = row.archived_at ? row.archived_at + PURGE_AFTER_DAYS * DAY_MS : null;
  return {
    tenantId: row.id,
    slug: row.slug,
    name: row.name,
    isActive: Boolean(row.is_active),
    archivedAt: row.archived_at,
    purgeAt,
    daysLeft: purgeAt ? Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS)) : null,
  };
}

export type LifecycleResult = { ok: true; note: string } | { ok: false; error: string };

/**
 * Archive a business. Everything it owns stays exactly where it is; what
 * stops is access. Sessions are ended here rather than left to expire,
 * because "their logins are closed" has to be true the moment it is said.
 */
export function archiveTenant(tenantId: number, actor: string, reason: string): LifecycleResult {
  const life = getTenantLifecycle(tenantId);
  if (!life) return { ok: false, error: "No such business." };
  if (life.archivedAt) return { ok: false, error: "That business is already archived." };

  const now = Date.now();
  controlSqlite.transaction(() => {
    controlSqlite.prepare("UPDATE tenants SET archived_at = ?, is_active = 0 WHERE id = ?").run(now, tenantId);
    controlSqlite.prepare("DELETE FROM auth_sessions WHERE active_tenant_id = ?").run(tenantId);
  })();

  logLifecycle(tenantId, "archived", { reason }, actor);
  return {
    ok: true,
    note: `${life.name} is archived. Their data is intact and will be permanently deleted in ${PURGE_AFTER_DAYS} days unless it is restored.`,
  };
}

/** Bring an archived business back. Everything is where they left it. */
export function restoreTenant(tenantId: number, actor: string): LifecycleResult {
  const life = getTenantLifecycle(tenantId);
  if (!life) return { ok: false, error: "No such business." };
  if (!life.archivedAt) return { ok: false, error: "That business is not archived." };

  controlSqlite.prepare("UPDATE tenants SET archived_at = NULL, is_active = 1 WHERE id = ?").run(tenantId);
  logLifecycle(tenantId, "restored", null, actor);
  return { ok: true, note: `${life.name} is back. Their people can sign in again and nothing was lost.` };
}

/**
 * Take the backup and delete the business. Irreversible.
 *
 * `offboardTenant` does the work it always did: checkpoint the database,
 * copy it and a manifest into data/archive, then remove the tenant and its
 * control-plane rows. What changed is who calls it and when -- an owner
 * deliberately, or the purge job once the window has passed.
 */
export function purgeTenant(tenantId: number, actor: string): LifecycleResult & { archiveDir?: string } {
  const life = getTenantLifecycle(tenantId);
  if (!life) return { ok: false, error: "No such business." };
  try {
    const { archiveDir } = offboardTenant(tenantId, actor);
    return {
      ok: true,
      note: `${life.name} is permanently deleted. A backup was written to ${archiveDir} first.`,
      archiveDir,
    };
  } catch (err) {
    // offboardTenant archives BEFORE it deletes and propagates any failure,
    // so a throw here means nothing was deleted.
    return { ok: false, error: err instanceof Error ? err.message : "The purge failed; nothing was deleted." };
  }
}

/** Businesses whose window has passed, oldest first. */
export function listDueForPurge(now: number = Date.now()): TenantLifecycle[] {
  const cutoff = now - PURGE_AFTER_DAYS * DAY_MS;
  return (
    controlSqlite
      .prepare("SELECT id FROM tenants WHERE archived_at IS NOT NULL AND archived_at <= ? ORDER BY archived_at")
      .all(cutoff) as Array<{ id: number }>
  )
    .map((r) => getTenantLifecycle(r.id))
    .filter((l): l is TenantLifecycle => l !== null);
}

/**
 * Purge every business whose 30 days are up. Run once a day by the daily
 * scheduler. One failure does not stop the rest, and a failure means that
 * business is simply purged on a later run -- never half-deleted, because
 * the backup comes first.
 */
export function runDuePurges(now: number = Date.now()): { purged: number; failed: number } {
  let purged = 0;
  let failed = 0;
  for (const t of listDueForPurge(now)) {
    const result = purgeTenant(t.tenantId, "system");
    if (result.ok) {
      purged++;
      console.log(`[lifecycle] purged ${t.slug} (archived ${new Date(t.archivedAt!).toISOString()})`);
    } else {
      failed++;
      console.error(`[lifecycle] purge of ${t.slug} failed, will retry tomorrow: ${result.error}`);
    }
  }
  return { purged, failed };
}

/**
 * Record a lifecycle step on the tenant's own billing history as well as the
 * console audit log the caller writes. Best-effort: a purge must not fail
 * because its note could not be written, and after a purge the tenant row is
 * gone anyway.
 */
function logLifecycle(tenantId: number, type: string, detail: unknown, actor: string): void {
  try {
    controlSqlite
      .prepare("INSERT INTO billing_events (tenant_id, type, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(tenantId, type, detail == null ? null : JSON.stringify(detail), actor, Date.now());
  } catch (err) {
    console.error(`[lifecycle] could not log ${type} for tenant ${tenantId}:`, err);
  }
}
