import type { Database as BetterSqlite3 } from "better-sqlite3";
import { DEFAULT_STAGES, LEGACY_KEY_TO_ROLE } from "@/lib/pipeline/roles";
import { runExerciseLibraryBootstrap } from "./exerciseLibraryBootstrap";

/**
 * Versioned, transactional migration runner (Batch 6b —
 * improvement-plan-2026-08.md Theme E1, "biggest scale-maintainability
 * risk"). This does NOT replace `ensureTenantTables` (../tenant.ts) or
 * `ensureControlTables` (../control.ts) — those remain exactly as they are:
 * the idempotent `CREATE TABLE IF NOT EXISTS` + PRAGMA-guarded
 * `ALTER TABLE ... ADD COLUMN` bootstrap that runs on every open. This
 * module is an ADDITIONAL mechanism, layered on top, for schema changes
 * that bootstrap style can't safely express.
 *
 * Division of labour, going forward:
 *   - New tables, new nullable/defaulted columns — anything additive that's
 *     safe to blindly re-run on every boot — keep adding directly to
 *     ensureTenantTables / ensureControlTables, as before.
 *   - Anything NON-additive — rename/retype/drop a column, a constraint on
 *     existing data, a backfill or data transform that must run exactly
 *     once, multi-step changes that must all succeed together — add a
 *     migration here instead. `CREATE TABLE IF NOT EXISTS` can't express
 *     "do this once, in order, and leave no trace if it fails partway";
 *     this runner can.
 *
 * (Distinct from ../migrate.ts's `runBootMigration()`, which is a one-time,
 * already-completed identity copy for the original single-tenant -> control
 * plane swap — unrelated to ongoing schema evolution.)
 *
 * Mechanics: each migration has a unique id, ordered lexicographically (zero
 * -padded numeric prefixes, e.g. "0001-...", "0002-...", so string sort ==
 * intended order). `runMigrations` applies every migration in the given
 * array whose id isn't yet in `schema_migrations`, IN ARRAY ORDER, each
 * inside its own transaction: `up()` runs, then its id + timestamp is
 * inserted, atomically. If `up()` throws, the whole transaction — including
 * any DDL/DML it already issued; SQLite's schema changes are transactional
 * too — rolls back, its id is never recorded, and the error propagates
 * immediately: no later migration in the array is attempted that call. The
 * failed migration (and anything after it) is retried from scratch on the
 * next call (e.g. the next process boot). Already-applied ids are always
 * skipped without invoking `up()` again — safe to call on every boot, same
 * as ensureTenantTables/ensureControlTables.
 */
export interface Migration {
  id: string;
  description: string;
  up: (sqlite: BetterSqlite3) => void;
}

/**
 * Apply every not-yet-applied migration in `migrations`, in array order,
 * each in its own transaction (apply `up()` + record its id atomically).
 * Stops and re-throws on the first failure without attempting later
 * migrations. Idempotent + safe to call on every boot.
 */
export function runMigrations(sqlite: BetterSqlite3, migrations: Migration[]): void {
  // Idempotent, and deliberately redundant with the CREATE also added to
  // ensureTenantTables/ensureControlTables (see their Batch 6b comments) —
  // that way this runner also works standalone (e.g. against a bare
  // in-memory better-sqlite3 handle in tests) without depending on either
  // bootstrap having run first.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const appliedRows = sqlite
    .prepare("SELECT id FROM schema_migrations")
    .all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));

  const insertApplied = sqlite.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    // better-sqlite3's transaction() wraps the callback in BEGIN/COMMIT and,
    // if it throws, automatically issues ROLLBACK before re-throwing the
    // original error — so a migration that fails partway through `up()`
    // (including any CREATE/ALTER it already ran) leaves the DB exactly as
    // it was, and its id is never inserted.
    //
    // Re-checking applied-ness INSIDE the transaction (on top of the cheap
    // `applied` set check above) matters under concurrency: two processes can
    // both read an empty schema_migrations before either commits — e.g.
    // `next build`'s parallel page-data workers each bootstrapping a fresh
    // control.db in the Docker builder (deploy e492f8a9 failed exactly this
    // way). The loser of the lock race re-reads after the winner committed
    // and skips instead of double-applying.
    const applyOne = sqlite.transaction(() => {
      const already = sqlite
        .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
        .get(migration.id);
      if (already) return;
      migration.up(sqlite);
      insertApplied.run(migration.id, Date.now());
    });

    try {
      // BEGIN IMMEDIATE, not the default deferred BEGIN: with deferred, two
      // connections that both hold read locks and both try to upgrade to
      // write hit SQLite's upgrade deadlock, which returns SQLITE_BUSY
      // instantly WITHOUT consulting the busy handler — busy_timeout never
      // gets a say. IMMEDIATE takes the write lock up front, so the second
      // connection just waits out busy_timeout (15s on both planes) while
      // the first finishes, then re-checks and no-ops.
      applyOne.immediate();
    } catch (err) {
      console.error(
        `[db] migration ${migration.id} failed — rolled back and left unapplied, stopping:`,
        err,
      );
      throw err;
    }

    console.log(`[db] migration applied: ${migration.id} — ${migration.description}`);
  }
}

/**
 * Tenant-plane migrations, applied by openTenantDb() (../tenant.ts) right
 * after ensureTenantTables(). Effectively empty today — there is no pending
 * non-additive change — but "0001-baseline" proves the mechanism end-to-end:
 * its up() re-issues a `CREATE INDEX IF NOT EXISTS` that ensureTenantTables
 * already creates unconditionally (idx_agents_key), so it is a guaranteed
 * no-op at the SQL level on every tenant DB, old or new, while still
 * exercising a real up(sqlite) call inside a real transaction that gets
 * recorded. The NEXT non-additive tenant change is "0002-...".
 */
export const TENANT_MIGRATIONS: Migration[] = [
  {
    id: "0001-baseline",
    description:
      "Baseline: proves the tenant-plane migration runner end-to-end via a harmless no-op (re-asserts idx_agents_key, which ensureTenantTables already creates).",
    up: (sqlite) => {
      sqlite.exec("CREATE INDEX IF NOT EXISTS idx_agents_key ON agents(key)");
    },
  },
  {
    id: "0002-seed-pipeline-stages",
    description:
      "Seed the 9 canonical pipeline_stages (once, if empty) and backfill leads.stage_id from the frozen pipeline_stage text via role.",
    up: (sqlite) => {
      const count = (sqlite.prepare("SELECT count(*) AS n FROM pipeline_stages").get() as { n: number }).n;
      if (count === 0) {
        const insert = sqlite.prepare(
          "INSERT INTO pipeline_stages (name, colour, position, role, created_at) VALUES (?, ?, ?, ?, ?)",
        );
        const now = Date.now();
        for (const s of DEFAULT_STAGES) insert.run(s.name, s.colour, s.position, s.role, now);
      }
      // Backfill: map each lead's old text key → role → the seeded stage of that role.
      const stageIdByRole = new Map<string, number>();
      for (const row of sqlite.prepare("SELECT id, role FROM pipeline_stages").all() as Array<{ id: number; role: string | null }>) {
        if (row.role) stageIdByRole.set(row.role, row.id);
      }
      const setStage = sqlite.prepare("UPDATE leads SET stage_id = ? WHERE id = ?");
      const leads = sqlite.prepare("SELECT id, pipeline_stage FROM leads WHERE stage_id IS NULL").all() as Array<{ id: number; pipeline_stage: string }>;
      for (const l of leads) {
        const role = LEGACY_KEY_TO_ROLE[l.pipeline_stage] ?? "new";
        const stageId = stageIdByRole.get(role) ?? stageIdByRole.get("new");
        if (stageId != null) setStage.run(stageId, l.id);
      }
    },
  },
];

/**
 * Control-plane migrations, applied by rawControl() (../control.ts) right
 * after ensureControlTables(). Same baseline pattern as TENANT_MIGRATIONS:
 * "0001-baseline" re-asserts idx_auth_sessions_user, which
 * ensureControlTables already creates unconditionally — a guaranteed no-op
 * that still proves the runner end-to-end on the control DB.
 */
export const CONTROL_MIGRATIONS: Migration[] = [
  {
    id: "0001-baseline",
    description:
      "Baseline: proves the control-plane migration runner end-to-end via a harmless no-op (re-asserts idx_auth_sessions_user, which ensureControlTables already creates).",
    up: (sqlite) => {
      sqlite.exec("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)");
    },
  },
  {
    id: "0002-exercise-library-bootstrap",
    description:
      "Global Exercise Library bootstrap: import the Inspire tenant's curated exercise_library rows as GLOBAL control rows (tenant_id NULL) and every other active tenant's existing rows as their own customs. See docs/superpowers/specs/2026-08-24-global-exercise-library-design.md and ./exerciseLibraryBootstrap.ts.",
    up: runExerciseLibraryBootstrap,
  },
];
