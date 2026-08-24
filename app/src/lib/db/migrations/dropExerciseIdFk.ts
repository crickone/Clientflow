import type { Database as BetterSqlite3 } from "better-sqlite3";

/**
 * Global Exercise Library — blocking correctness fix (T4, see
 * docs/superpowers/specs/2026-08-24-global-exercise-library-design.md): T1/T2
 * moved exercises to the CONTROL-plane `exercise_library` table, but the 3
 * per-tenant workout-item tables (`workout_exercises`, `workout_items`,
 * `circuit_items`) still declared `exercise_id INTEGER REFERENCES
 * exercise_library(id) ON DELETE SET NULL` against the PER-TENANT
 * `exercise_library` table, with `foreign_keys = ON` (../tenant.ts's
 * openTenantDb). A picked exercise's id is now a control-plane id, generally
 * absent from the tenant's own (legacy) `exercise_library` — so saving a
 * workout with any picked exercise threw an FK violation. This module drops
 * that FK, making `exercise_id` a plain nullable INTEGER: a soft cross-DB
 * reference (already soft in practice — items denormalize `name`/
 * `muscle_groups` and render never re-queries the library). Every other
 * column, the OTHER FKs (day_id/workout_id/circuit_id, all CASCADE), and the
 * indexes are preserved byte-identical.
 *
 * Wired in as TENANT_MIGRATIONS' "0003-drop-exercise-id-fk" (./index.ts) with
 * `transactional: false`: SQLite only honours `PRAGMA foreign_keys` toggles
 * OUTSIDE a pending transaction (see index.ts's `Migration.transactional` doc
 * comment for the full mechanics), so this function manages its own
 * transaction boundaries rather than running inside runMigrations' usual
 * BEGIN IMMEDIATE wrapper.
 *
 * Idempotent by construction, independent of TENANT_MIGRATIONS' own
 * schema_migrations tracking (belt-and-suspenders, same shape as
 * exerciseLibraryBootstrap's row-count guard): each table is only rebuilt if
 * its CURRENT `sqlite_master.sql` still contains `REFERENCES
 * exercise_library`. A fresh tenant created after this fix ships never has
 * that text to begin with (ensureTenantTables' CREATE TABLE IF NOT EXISTS for
 * these 3 tables was updated to the same no-FK shape — see ../tenant.ts), so
 * this is a full no-op for it — the pragma is never even touched.
 */

interface TableRebuildSpec {
  /** Real (post-migration) table name. */
  table: string;
  /** CREATE TABLE body for the NEW (no exercise_id FK) shape, using `newName` as the table name. */
  createNewSql: (newName: string) => string;
  /**
   * Explicit column list, in order, shared by the old and new shape —
   * exercise_id just loses its FK, nothing is added/removed/reordered.
   * Passed to an explicit INSERT INTO ... (cols) SELECT (cols) FROM old, NOT
   * `SELECT *` (whose column order isn't a contract to rely on across a
   * schema change).
   */
  columns: string[];
  /** Re-asserted on the renamed table after rebuild (CREATE INDEX IF NOT EXISTS ...). */
  indexSql: string[];
}

const REBUILDS: TableRebuildSpec[] = [
  {
    table: "workout_exercises",
    columns: [
      "id",
      "day_id",
      "section",
      "exercise_id",
      "name",
      "position",
      "sets",
      "reps",
      "rest_seconds",
      "notes",
      "muscle_groups",
      "created_at",
    ],
    createNewSql: (n) => `
      CREATE TABLE ${n} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
        section TEXT NOT NULL DEFAULT 'workout',
        exercise_id INTEGER,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        sets INTEGER NOT NULL DEFAULT 0,
        reps TEXT,
        rest_seconds INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        muscle_groups TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`,
    indexSql: ["CREATE INDEX IF NOT EXISTS idx_workout_exercises_day ON workout_exercises(day_id)"],
  },
  {
    table: "workout_items",
    columns: [
      "id",
      "workout_id",
      "section",
      "exercise_id",
      "name",
      "position",
      "sets",
      "reps",
      "rest_seconds",
      "notes",
      "muscle_groups",
      "created_at",
    ],
    createNewSql: (n) => `
      CREATE TABLE ${n} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
        section TEXT NOT NULL DEFAULT 'workout',
        exercise_id INTEGER,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        sets INTEGER NOT NULL DEFAULT 0,
        reps TEXT,
        rest_seconds INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        muscle_groups TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`,
    indexSql: ["CREATE INDEX IF NOT EXISTS idx_workout_items_workout ON workout_items(workout_id)"],
  },
  {
    table: "circuit_items",
    columns: [
      "id",
      "circuit_id",
      "exercise_id",
      "name",
      "position",
      "sets",
      "reps",
      "rest_seconds",
      "notes",
      "muscle_groups",
      "created_at",
    ],
    createNewSql: (n) => `
      CREATE TABLE ${n} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        circuit_id INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
        exercise_id INTEGER,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        sets INTEGER NOT NULL DEFAULT 0,
        reps TEXT,
        rest_seconds INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        muscle_groups TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )`,
    indexSql: ["CREATE INDEX IF NOT EXISTS idx_circuit_items_circuit ON circuit_items(circuit_id)"],
  },
];

/** The live CREATE TABLE sql sqlite_master has recorded for `table`, or undefined if it doesn't exist. */
function currentTableSql(sqlite: BetterSqlite3, table: string): string | undefined {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  return row?.sql;
}

/** True iff `table` still has the old `REFERENCES exercise_library` FK on exercise_id — i.e. still needs rebuilding. */
function needsRebuild(sqlite: BetterSqlite3, table: string): boolean {
  const sql = currentTableSql(sqlite, table);
  return !!sql && sql.includes("REFERENCES exercise_library");
}

/**
 * Rebuild whichever of the 3 workout-item tables still reference
 * `exercise_library` via FK, dropping just that constraint (exercise_id
 * becomes a plain nullable INTEGER) while preserving every row, every other
 * column, the day_id/workout_id/circuit_id FKs (still CASCADE), and the
 * indexes. Call with the connection in AUTOCOMMIT mode (no pending
 * transaction) — see this module's top comment for why.
 *
 * Idempotent: tables that don't need it (already migrated, or a fresh tenant
 * whose ensureTenantTables already created the no-FK shape) are skipped; if
 * NONE need it, this returns immediately without ever touching the
 * `foreign_keys` pragma.
 */
export function dropWorkoutExerciseIdForeignKeys(sqlite: BetterSqlite3): void {
  const pending = REBUILDS.filter((spec) => needsRebuild(sqlite, spec.table));
  if (pending.length === 0) return;

  // PRAGMA foreign_keys is a documented no-op while a transaction is
  // pending — this MUST run here, before the BEGIN below, with the
  // connection in autocommit mode (guaranteed by this migration being
  // registered `transactional: false` — see index.ts).
  sqlite.pragma("foreign_keys = OFF");
  try {
    const rebuildAll = sqlite.transaction(() => {
      for (const spec of pending) {
        const newName = `${spec.table}_new`;
        sqlite.exec(spec.createNewSql(newName));
        const colList = spec.columns.join(", ");
        sqlite.exec(`INSERT INTO ${newName} (${colList}) SELECT ${colList} FROM ${spec.table}`);
        sqlite.exec(`DROP TABLE ${spec.table}`);
        sqlite.exec(`ALTER TABLE ${newName} RENAME TO ${spec.table}`);
        for (const idx of spec.indexSql) sqlite.exec(idx);
      }

      // Assert the rebuild introduced no violations of the FKs we KEPT
      // (day_id/workout_id/circuit_id) before committing.
      const violations = sqlite.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `dropWorkoutExerciseIdForeignKeys: foreign_key_check found violation(s) after rebuild: ${JSON.stringify(violations)}`,
        );
      }
    });
    // BEGIN IMMEDIATE (not deferred) — same upgrade-deadlock rationale as
    // index.ts's applyOne.immediate(): this connection is about to write.
    rebuildAll.immediate();
  } finally {
    // ALWAYS restore ON — including when the transaction above threw and
    // rolled back — so a failed attempt never leaves this long-lived, cached
    // connection with FK enforcement silently disabled for the rest of the
    // process (tenant.ts's connCache keeps connections open for the process
    // lifetime).
    sqlite.pragma("foreign_keys = ON");
  }
}
