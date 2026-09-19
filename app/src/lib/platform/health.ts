import "server-only";

import fs from "node:fs";
import path from "node:path";

import { findDuplicateSiteSlugs } from "@/lib/cms/siteSlugs";
import { controlSqlite, getCronState } from "@/lib/db/control";
import { getTenantDbById, runWithTenant } from "@/lib/db/tenant";
import { TENANT_MIGRATIONS } from "@/lib/db/migrations";

/**
 * Is anything broken for this business?
 *
 * The console could say a great deal about what a tenant is PAYING and
 * nothing about whether their software is working. This answers the second
 * question from what the system already records: the shape of their
 * database, whether every migration has reached it, how much work is stuck
 * in a queue, and when the background jobs last ran.
 *
 * Everything here is a READ, and every read is wrapped so one broken tenant
 * cannot take the page down for the rest -- a health view that goes blank
 * when something is wrong is the opposite of useful.
 */

export type AlertLevel = "ok" | "warn" | "bad";

export interface HealthAlert {
  level: Exclude<AlertLevel, "ok">;
  message: string;
}

export interface QueueDepth {
  key: string;
  label: string;
  due: number;
  waiting: number;
  failed: number;
  /** What a non-zero `failed` means here, in the operator's terms. */
  note: string | null;
}

export interface TenantHealth {
  tenantId: number;
  /** Bytes. The write-ahead log matters separately: a large one means checkpoints are not landing. */
  dbBytes: number;
  walBytes: number;
  dbExists: boolean;
  integrity: "ok" | "failed" | "unknown";
  integrityDetail: string | null;
  migrations: { applied: number; expected: number; missing: string[] };
  queues: QueueDepth[];
  /** Designs whose generation says "writing" but started long enough ago to be dead. */
  stuckGenerations: number;
  schedulers: { key: string; label: string; lastRun: string | null }[];
  alerts: HealthAlert[];
}

const STALE_GENERATION_MS = 15 * 60 * 1000;

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** The tenant's database file on disk, from the registry's `db_file`. */
function dbPathFor(tenantId: number): string | null {
  const row = controlSqlite.prepare("SELECT db_file FROM tenants WHERE id = ?").get(tenantId) as
    | { db_file: string }
    | undefined;
  if (!row) return null;
  return path.isAbsolute(row.db_file) ? row.db_file : path.join(process.cwd(), "data", row.db_file);
}

/**
 * One tenant's health. `deep` runs SQLite's own integrity check, which reads
 * the whole file -- fine on demand, too slow for a fleet sweep, so the
 * nightly/list path leaves it out and reports "unknown".
 */
export function getTenantHealth(tenantId: number, opts: { deep?: boolean } = {}): TenantHealth {
  const dbPath = dbPathFor(tenantId);
  const dbExists = dbPath ? fs.existsSync(dbPath) : false;
  const dbBytes = dbPath ? fileSize(dbPath) : 0;
  const walBytes = dbPath ? fileSize(`${dbPath}-wal`) : 0;

  let integrity: TenantHealth["integrity"] = "unknown";
  let integrityDetail: string | null = null;
  const migrations = { applied: 0, expected: TENANT_MIGRATIONS.length, missing: [] as string[] };
  const queues: QueueDepth[] = [];
  let stuckGenerations = 0;

  if (dbExists) {
    try {
      const tdb = getTenantDbById(tenantId);
      // Drizzle has no PRAGMA/raw escape hatch here, so the raw handle is
      // reached through the same registry the app uses everywhere else.
      const raw = (tdb as unknown as { $client?: { prepare: (sql: string) => { get: () => unknown; all: () => unknown[] } } }).$client;

      if (raw) {
        const applied = (raw.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((r) => r.id);
        migrations.applied = applied.length;
        migrations.missing = TENANT_MIGRATIONS.map((m) => m.id).filter((id) => !applied.includes(id));

        if (opts.deep) {
          const result = raw.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
          const value = result?.integrity_check ?? "unknown";
          integrity = value === "ok" ? "ok" : "failed";
          integrityDetail = value === "ok" ? null : value;
        }

        const now = Date.now();
        const count = (sql: string, ...args: unknown[]): number => {
          try {
            const r = raw.prepare(sql) as unknown as { get: (...a: unknown[]) => { n: number } | undefined };
            return r.get(...args)?.n ?? 0;
          } catch {
            // A table this tenant's database has not been migrated to yet.
            return 0;
          }
        };

        queues.push({
          key: "nurture",
          label: "Nurture messages",
          due: count("SELECT count(*) AS n FROM automation_queue WHERE status = 'queued' AND due_at <= ?", now),
          waiting: count("SELECT count(*) AS n FROM automation_queue WHERE status = 'queued' AND due_at > ?", now),
          failed: count("SELECT count(*) AS n FROM automation_queue WHERE status = 'failed'"),
          note: "Failed messages are usually a missing email provider.",
        });
        queues.push({
          key: "posts",
          label: "Scheduled posts",
          due: count("SELECT count(*) AS n FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_for <= ?", now),
          waiting: count("SELECT count(*) AS n FROM scheduled_posts WHERE status = 'scheduled' AND scheduled_for > ?", now),
          failed: count("SELECT count(*) AS n FROM scheduled_posts WHERE status = 'failed'"),
          note: "A post due but not sent is normally waiting on the Facebook connection.",
        });
        queues.push({
          key: "calls",
          label: "Voice call queue",
          due: count("SELECT count(*) AS n FROM voice_call_queue WHERE status = 'queued'"),
          waiting: 0,
          failed: count("SELECT count(*) AS n FROM voice_call_queue WHERE status = 'failed'"),
          note: null,
        });

        stuckGenerations = count(
          "SELECT count(*) AS n FROM carousel_sets WHERE generation_status = 'writing' AND (generation_started_at IS NULL OR generation_started_at < ?)",
          now - STALE_GENERATION_MS,
        );
      }
    } catch (err) {
      integrity = "failed";
      integrityDetail = err instanceof Error ? err.message : "The database could not be opened.";
    }
  }

  const schedulers = [
    { key: "last_daily_run", label: "Daily jobs", lastRun: safeCron("last_daily_run") },
    { key: "lapse_last_run", label: "Lapsed-member sweep", lastRun: safeCron("lapse_last_run") },
    { key: "billing_last_run", label: "Billing run", lastRun: safeCron("billing_last_run") },
  ];

  const alerts: HealthAlert[] = [];
  if (!dbExists) alerts.push({ level: "bad", message: "The database file is missing." });
  if (integrity === "failed") alerts.push({ level: "bad", message: `Integrity check failed: ${integrityDetail ?? "unknown"}` });
  if (migrations.missing.length > 0) {
    alerts.push({ level: "warn", message: `${migrations.missing.length} migration(s) have not run: ${migrations.missing.join(", ")}` });
  }
  // A WAL that has grown past the database itself means checkpoints are not
  // landing -- usually a connection held open by something that crashed.
  if (walBytes > 8 * 1024 * 1024 && walBytes > dbBytes) {
    alerts.push({ level: "warn", message: "The write-ahead log is larger than the database; checkpoints may not be landing." });
  }
  for (const q of queues) {
    if (q.failed > 0) alerts.push({ level: "warn", message: `${q.failed} failed in ${q.label.toLowerCase()}.` });
  }
  if (stuckGenerations > 0) {
    alerts.push({ level: "warn", message: `${stuckGenerations} design(s) stuck mid-generation.` });
  }

  return {
    tenantId,
    dbBytes,
    walBytes,
    dbExists,
    integrity,
    integrityDetail,
    migrations,
    queues,
    stuckGenerations,
    schedulers,
    alerts,
  };
}

function safeCron(key: string): string | null {
  try {
    return getCronState(key);
  } catch {
    return null;
  }
}

export interface FleetHealthRow {
  tenantId: number;
  name: string;
  slug: string;
  dbBytes: number;
  alerts: HealthAlert[];
}

/**
 * Every active tenant's alerts, for the fleet page. Shallow by design: no
 * integrity check, because that reads every byte of every database.
 */
export function getFleetHealth(): {
  tenants: FleetHealthRow[];
  schedulers: TenantHealth["schedulers"];
  duplicateSiteSlugs: Array<{ slug: string; owners: string[]; servedBy: string }>;
} {
  const rows = controlSqlite
    .prepare("SELECT id, name, slug FROM tenants WHERE is_active = 1 ORDER BY name")
    .all() as Array<{ id: number; name: string; slug: string }>;

  const tenants: FleetHealthRow[] = [];
  let schedulers: TenantHealth["schedulers"] = [];
  for (const t of rows) {
    try {
      const h = getTenantHealth(t.id);
      schedulers = h.schedulers; // fleet-wide, identical for every tenant
      tenants.push({ tenantId: t.id, name: t.name, slug: t.slug, dbBytes: h.dbBytes, alerts: h.alerts });
    } catch (err) {
      tenants.push({
        tenantId: t.id,
        name: t.name,
        slug: t.slug,
        dbBytes: 0,
        alerts: [{ level: "bad", message: err instanceof Error ? err.message : "Health could not be read." }],
      });
    }
  }
  // A site slug is the public URL, and the renderer serves the first active
  // tenant holding it, so a slug in two tenants means one of those websites
  // cannot be reached at all. It is invisible from inside either business —
  // both open normally in the CMS — which is why it belongs on the fleet
  // board, where somebody is looking across tenants in the first place.
  const duplicateSiteSlugs = findDuplicateSiteSlugs().map((d) => ({
    slug: d.slug,
    owners: d.owners.map((o) => `${o.tenantName} (${o.tenantSlug}#${o.tenantId})`),
    servedBy: `${d.owners[0].tenantName} (${d.owners[0].tenantSlug}#${d.owners[0].tenantId})`,
  }));

  return { tenants, schedulers, duplicateSiteSlugs };
}

export type HealthActionResult = { ok: true; note: string } | { ok: false; error: string };

/**
 * Clear designs stuck mid-generation. The run that owned them died with the
 * process that started it, so nothing will ever finish them; this marks them
 * failed, which is what the editor already shows for a lost run, and lets the
 * operator generate again.
 */
export function clearStuckGenerations(tenantId: number): HealthActionResult {
  try {
    return runWithTenant(tenantId, () => {
      const tdb = getTenantDbById(tenantId);
      const raw = (tdb as unknown as { $client?: { prepare: (sql: string) => { run: (...a: unknown[]) => { changes: number } } } }).$client;
      if (!raw) return { ok: false as const, error: "Could not reach that database." };
      const result = raw
        .prepare(
          `UPDATE carousel_sets
             SET generation_status = 'failed',
                 generation_error = 'The app restarted while these slides were being written. Generate again.',
                 generation_stage = NULL
           WHERE generation_status = 'writing' AND (generation_started_at IS NULL OR generation_started_at < ?)`,
        )
        .run(Date.now() - STALE_GENERATION_MS);
      return result.changes === 0
        ? { ok: true as const, note: "Nothing was stuck." }
        : { ok: true as const, note: `Cleared ${result.changes} stuck design${result.changes === 1 ? "" : "s"}.` };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not clear them." };
  }
}

/**
 * Put failed queue items back in the queue. Only what a retry can actually
 * fix: a nurture message whose send failed, a post whose publish failed.
 */
export function retryFailedQueue(tenantId: number, queue: "nurture" | "posts"): HealthActionResult {
  try {
    return runWithTenant(tenantId, () => {
      const tdb = getTenantDbById(tenantId);
      const raw = (tdb as unknown as { $client?: { prepare: (sql: string) => { run: (...a: unknown[]) => { changes: number } } } }).$client;
      if (!raw) return { ok: false as const, error: "Could not reach that database." };
      const sql =
        queue === "nurture"
          ? "UPDATE automation_queue SET status = 'queued', error = NULL WHERE status = 'failed'"
          : "UPDATE scheduled_posts SET status = 'scheduled', error = NULL WHERE status = 'failed'";
      const result = raw.prepare(sql).run();
      return result.changes === 0
        ? { ok: true as const, note: "Nothing was failed." }
        : { ok: true as const, note: `Re-queued ${result.changes} item${result.changes === 1 ? "" : "s"}. They go out on the next tick.` };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not re-queue them." };
  }
}
