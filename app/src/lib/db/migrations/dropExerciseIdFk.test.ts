// Run: npm test -- src/lib/db/migrations/dropExerciseIdFk.test.ts
//
// Global Exercise Library — Task 4 (blocking correctness fix; see
// docs/superpowers/specs/2026-08-24-global-exercise-library-design.md):
// covers dropWorkoutExerciseIdForeignKeys (./dropExerciseIdFk.ts), the
// standard-procedure table rebuild that drops the exercise_id -> per-tenant
// exercise_library FK on workout_exercises/workout_items/circuit_items, so a
// picked exercise's now-CONTROL-plane id (T1/T2) can be saved without an FK
// violation.
//
// Block A: an isolated in-memory connection, hand-built with the EXACT
// pre-migration (FK'd) shape of all 7 touched tables — precise control for
// byte-identical before/after row comparisons across all 3 item tables,
// proof the bug exists pre-migration and is gone post-migration, the OTHER
// FKs (day_id/workout_id/circuit_id) still enforcing + cascading, and
// idempotency (calling the function again directly).
//
// Block B + C: "the repo's tenant-DB test approach" (mirrors
// migrations/wiring.test.ts) — B pre-seeds a tenant DB FILE with the OLD
// (FK'd) shape + real data BEFORE the first openTenantDb() call (simulating
// a tenant created before this fix shipped: ensureTenantTables' `CREATE
// TABLE IF NOT EXISTS` leaves the pre-existing table alone, so it's really
// TENANT_MIGRATIONS' "0003-drop-exercise-id-fk" fixing it) and proves the
// REAL call site preserves data end-to-end; C opens a genuinely FRESH tenant
// and asserts ensureTenantTables' updated DDL alone (no migration needed)
// already has no FK.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

import { dropWorkoutExerciseIdForeignKeys } from "./dropExerciseIdFk";
import { TENANT_MIGRATIONS, runMigrations } from "./index";

// lib/db/tenant.ts / control.ts import React's server-only `cache` at module
// load. Under the runner's `--conditions=react-server`, npm's react
// "react-server" entry point is a stub that THROWS on load (same issue + fix
// as migrations/wiring.test.ts / tenant.test.ts). Shim `react` with an
// identity `cache` BEFORE those modules are required.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

// ── 0. Wired in correctly: registered in TENANT_MIGRATIONS, non-transactional ──
{
  const entry = TENANT_MIGRATIONS.find((m) => m.id === "0003-drop-exercise-id-fk");
  assert.ok(entry, "0003-drop-exercise-id-fk is registered in TENANT_MIGRATIONS");
  assert.equal(
    entry?.transactional,
    false,
    "registered transactional: false — required for the PRAGMA foreign_keys toggle inside up() to actually take effect (see index.ts's Migration.transactional doc comment)",
  );
  console.log("dropExerciseIdFk.test.ts: wired into TENANT_MIGRATIONS as non-transactional OK");
}

// ── Block A: isolated connection, exact pre-migration (FK'd) schema ────────
function makeOldSchemaDb(): BetterSqlite3 {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON"); // mirrors tenant.ts openTenantDb()
  db.exec(`
    CREATE TABLE exercise_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      muscle_groups TEXT,
      equipment TEXT,
      video_url TEXT,
      image_url TEXT,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE workout_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Program',
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT,
      summary TEXT,
      content TEXT,
      upload_filename TEXT,
      upload_original_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE workout_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Day 1',
      position INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX idx_workout_days_program ON workout_days(program_id);

    CREATE TABLE workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX idx_workout_exercises_day ON workout_exercises(day_id);

    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Workout',
      tags TEXT,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE workout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX idx_workout_items_workout ON workout_items(workout_id);

    CREATE TABLE circuits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Circuit',
      tags TEXT,
      rounds INTEGER NOT NULL DEFAULT 3,
      rest_between_seconds INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE circuit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circuit_id INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX idx_circuit_items_circuit ON circuit_items(circuit_id);
  `);
  return db;
}

/** Seed a workout day (program+day), a standalone workout, and a circuit — each with several item rows, some with exercise_id set, some NULL. Every value explicit (incl. created_at) so before/after comparisons are truly byte-identical, not time-dependent. */
function seedOldSchemaDb(db: BetterSqlite3): void {
  db.prepare(
    "INSERT INTO exercise_library (id, name, category) VALUES (1, 'Local Squat', 'Legs')",
  ).run();

  db.prepare(
    "INSERT INTO workout_programs (id, title, type, status) VALUES (1, 'Strength Block', 'detailed', 'active')",
  ).run();
  db.prepare("INSERT INTO workout_days (id, program_id, name, position) VALUES (1, 1, 'Day 1', 0)").run();
  db.prepare(
    `INSERT INTO workout_exercises
       (id, day_id, section, exercise_id, name, position, sets, reps, rest_seconds, notes, muscle_groups, created_at)
     VALUES
       (1, 1, 'warmup', 1, 'Squat', 0, 3, '10', 60, 'go slow', 'legs,glutes', 1000),
       (2, 1, 'workout', NULL, 'Custom Move', 1, 4, '8-12', 90, NULL, NULL, 2000)`,
  ).run();

  db.prepare("INSERT INTO workouts (id, name, tags) VALUES (1, 'Full Body', 'strength,gym')").run();
  db.prepare(
    `INSERT INTO workout_items
       (id, workout_id, section, exercise_id, name, position, sets, reps, rest_seconds, notes, muscle_groups, created_at)
     VALUES
       (1, 1, 'workout', 1, 'Squat', 0, 5, '5', 120, NULL, 'legs', 3000),
       (2, 1, 'cooldown', NULL, 'Stretch', 1, 1, '60 seconds', 0, 'hold', NULL, 4000)`,
  ).run();

  db.prepare("INSERT INTO circuits (id, name, rounds) VALUES (1, 'HIIT Circuit', 4)").run();
  db.prepare(
    `INSERT INTO circuit_items
       (id, circuit_id, exercise_id, name, position, sets, reps, rest_seconds, notes, muscle_groups, created_at)
     VALUES
       (1, 1, 1, 'Squat', 0, 1, '20 seconds', 10, NULL, 'legs', 5000),
       (2, 1, NULL, 'Burpees', 1, 1, '20 seconds', 10, 'explosive', 'full body', 6000)`,
  ).run();
}

const ITEM_TABLES = ["workout_exercises", "workout_items", "circuit_items"] as const;

function tableSql(db: BetterSqlite3, table: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (!row) throw new Error(`table ${table} not found`);
  return row.sql;
}

function allRows(db: BetterSqlite3, table: string): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}

{
  const db = makeOldSchemaDb();
  seedOldSchemaDb(db);

  // ── sanity: pre-migration schema really does have the FK (so the "bug
  // reproduced" + "fix confirmed" contrast below is meaningful, not vacuous) ──
  for (const table of ITEM_TABLES) {
    assert.ok(
      tableSql(db, table).includes("REFERENCES exercise_library"),
      `pre-migration: ${table} DDL still has the exercise_library FK`,
    );
  }

  // ── proves the BUG: a control-plane-style exercise_id (not present in
  // this tenant's own exercise_library) throws an FK violation today ──
  assert.throws(
    () => db.prepare("INSERT INTO workout_exercises (day_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift')").run(),
    /FOREIGN KEY constraint failed/,
    "BEFORE migration: workout_exercises insert with an unknown exercise_id throws (reproduces the blocking bug)",
  );
  assert.throws(
    () => db.prepare("INSERT INTO workout_items (workout_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift')").run(),
    /FOREIGN KEY constraint failed/,
    "BEFORE migration: workout_items insert with an unknown exercise_id throws",
  );
  assert.throws(
    () => db.prepare("INSERT INTO circuit_items (circuit_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift')").run(),
    /FOREIGN KEY constraint failed/,
    "BEFORE migration: circuit_items insert with an unknown exercise_id throws",
  );

  const before: Record<string, unknown[]> = {};
  for (const table of ITEM_TABLES) before[table] = allRows(db, table);

  // ── 1. Run the migration; every row + every column value survives
  // byte-identical, row counts unchanged ──
  dropWorkoutExerciseIdForeignKeys(db);

  assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "foreign_keys pragma restored to ON after the migration");

  for (const table of ITEM_TABLES) {
    const sql = tableSql(db, table);
    assert.ok(!sql.includes("REFERENCES exercise_library"), `${table}: exercise_library FK is gone after migration`);
    assert.ok(sql.includes("exercise_id INTEGER"), `${table}: exercise_id column still present`);

    const after = allRows(db, table);
    assert.equal(after.length, before[table].length, `${table}: row count unchanged`);
    assert.deepEqual(after, before[table], `${table}: every row + every column value survives byte-identical`);
  }

  // day_id/workout_id/circuit_id FKs + their indexes are still declared
  assert.ok(tableSql(db, "workout_exercises").includes("day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE"));
  assert.ok(tableSql(db, "workout_items").includes("workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE"));
  assert.ok(tableSql(db, "circuit_items").includes("circuit_id INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE"));
  for (const [idx, table] of [
    ["idx_workout_exercises_day", "workout_exercises"],
    ["idx_workout_items_workout", "workout_items"],
    ["idx_circuit_items_circuit", "circuit_items"],
  ] as const) {
    const found = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?")
      .get(idx, table);
    assert.ok(found, `index ${idx} on ${table} preserved`);
  }

  console.log("dropExerciseIdFk.test.ts: Block A — data survives byte-identical + FK/index shape correct OK");

  // ── 2. Proves the FIX: the exact same "unknown exercise_id" insert that
  // threw pre-migration now SUCCEEDS (simulating a control-plane global id) ──
  const weId = db
    .prepare("INSERT INTO workout_exercises (day_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift') RETURNING id")
    .get() as { id: number };
  const wiId = db
    .prepare("INSERT INTO workout_items (workout_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift') RETURNING id")
    .get() as { id: number };
  const ciId = db
    .prepare("INSERT INTO circuit_items (circuit_id, exercise_id, name) VALUES (1, 999999, 'Global Deadlift') RETURNING id")
    .get() as { id: number };
  assert.ok(weId.id && wiId.id && ciId.id, "AFTER migration: all 3 tables accept a control-plane-style exercise_id with no FK violation");

  console.log("dropExerciseIdFk.test.ts: Block A — new insert with unknown (control-plane) exercise_id now SUCCEEDS on all 3 tables OK");

  // ── 3. The OTHER FKs still enforce ──
  assert.throws(
    () => db.prepare("INSERT INTO workout_exercises (day_id, exercise_id, name) VALUES (999999, NULL, 'Orphan')").run(),
    /FOREIGN KEY constraint failed/,
    "day_id FK on workout_exercises still enforced",
  );
  assert.throws(
    () => db.prepare("INSERT INTO workout_items (workout_id, exercise_id, name) VALUES (999999, NULL, 'Orphan')").run(),
    /FOREIGN KEY constraint failed/,
    "workout_id FK on workout_items still enforced",
  );
  assert.throws(
    () => db.prepare("INSERT INTO circuit_items (circuit_id, exercise_id, name) VALUES (999999, NULL, 'Orphan')").run(),
    /FOREIGN KEY constraint failed/,
    "circuit_id FK on circuit_items still enforced",
  );

  // ... and ON DELETE CASCADE still cascades
  const weBeforeCascade = (db.prepare("SELECT COUNT(*) c FROM workout_exercises WHERE day_id = 1").get() as { c: number }).c;
  assert.ok(weBeforeCascade > 0, "sanity: workout_exercises has rows for day 1 before cascade delete");
  db.prepare("DELETE FROM workout_days WHERE id = 1").run();
  const weAfterCascade = (db.prepare("SELECT COUNT(*) c FROM workout_exercises WHERE day_id = 1").get() as { c: number }).c;
  assert.equal(weAfterCascade, 0, "deleting the parent workout_days row cascades to workout_exercises");

  const wiBeforeCascade = (db.prepare("SELECT COUNT(*) c FROM workout_items WHERE workout_id = 1").get() as { c: number }).c;
  assert.ok(wiBeforeCascade > 0, "sanity: workout_items has rows for workout 1 before cascade delete");
  db.prepare("DELETE FROM workouts WHERE id = 1").run();
  const wiAfterCascade = (db.prepare("SELECT COUNT(*) c FROM workout_items WHERE workout_id = 1").get() as { c: number }).c;
  assert.equal(wiAfterCascade, 0, "deleting the parent workouts row cascades to workout_items");

  const ciBeforeCascade = (db.prepare("SELECT COUNT(*) c FROM circuit_items WHERE circuit_id = 1").get() as { c: number }).c;
  assert.ok(ciBeforeCascade > 0, "sanity: circuit_items has rows for circuit 1 before cascade delete");
  db.prepare("DELETE FROM circuits WHERE id = 1").run();
  const ciAfterCascade = (db.prepare("SELECT COUNT(*) c FROM circuit_items WHERE circuit_id = 1").get() as { c: number }).c;
  assert.equal(ciAfterCascade, 0, "deleting the parent circuits row cascades to circuit_items");

  console.log("dropExerciseIdFk.test.ts: Block A — other FKs (day_id/workout_id/circuit_id) still enforce + still cascade OK");

  // ── 4. Idempotency: running the migration path again is a safe no-op ──
  const stateBeforeRepeat: Record<string, unknown[]> = {};
  for (const table of ITEM_TABLES) stateBeforeRepeat[table] = allRows(db, table);

  assert.doesNotThrow(() => dropWorkoutExerciseIdForeignKeys(db), "calling the migration function again does not throw");
  assert.doesNotThrow(() => dropWorkoutExerciseIdForeignKeys(db), "calling it a third time also does not throw");

  assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "foreign_keys pragma still ON after idempotent re-calls (guard short-circuits before ever touching it)");
  for (const table of ITEM_TABLES) {
    assert.ok(!tableSql(db, table).includes("REFERENCES exercise_library"), `${table}: still no FK after repeat calls`);
    assert.deepEqual(allRows(db, table), stateBeforeRepeat[table], `${table}: data unchanged across idempotent re-calls`);
  }

  console.log("dropExerciseIdFk.test.ts: Block A — idempotency (repeat calls are safe no-ops) OK");

  db.close();
}

// ── Block B + C: the repo's real tenant-DB test approach (mirrors
// migrations/wiring.test.ts) ────────────────────────────────────────────────
// Wrapped in an async IIFE (not top-level await): no "type": "module" in
// package.json, so tsx/esbuild compiles to CJS, where top-level await is
// unsupported (same reasoning as wiring.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../control") as typeof import("../control");
  const { openTenantDb } = requireLocal("../tenant") as typeof import("../tenant");

  // ── Block B: an EXISTING tenant — its DB FILE is pre-seeded with the OLD
  // (FK'd) shape + real data BEFORE the first openTenantDb() call, simulating
  // a tenant created before this fix shipped. ensureTenantTables' `CREATE
  // TABLE IF NOT EXISTS` leaves the pre-existing (old-shape) table alone, so
  // it's genuinely TENANT_MIGRATIONS' "0003-drop-exercise-id-fk" fixing it —
  // proves the real call site preserves data end-to-end. ──
  {
    const slug = "gel-t4-existing-tenant-test";
    const dbFile = `tenants/${slug}/${slug}.db`;
    const fullPath = path.join(process.cwd(), "data", dbFile);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.rmSync(fullPath, { force: true });

    const seed = new Database(fullPath);
    seed.pragma("foreign_keys = ON");
    seed.exec(`
      CREATE TABLE workout_programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT 'New Program',
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        tags TEXT, summary TEXT, content TEXT, upload_filename TEXT, upload_original_name TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE TABLE workout_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT 'Day 1',
        position INTEGER NOT NULL DEFAULT 0,
        instructions TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX idx_workout_days_program ON workout_days(program_id);
      CREATE TABLE exercise_library (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, category TEXT, muscle_groups TEXT, equipment TEXT,
        video_url TEXT, image_url TEXT, instructions TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE TABLE workout_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
        section TEXT NOT NULL DEFAULT 'workout',
        exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        sets INTEGER NOT NULL DEFAULT 0,
        reps TEXT, rest_seconds INTEGER NOT NULL DEFAULT 0, notes TEXT, muscle_groups TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX idx_workout_exercises_day ON workout_exercises(day_id);
    `);
    seed
      .prepare("INSERT INTO workout_programs (id, title, type) VALUES (1, 'Existing Program', 'detailed')")
      .run();
    seed.prepare("INSERT INTO workout_days (id, program_id, name) VALUES (1, 1, 'Day 1')").run();
    seed
      .prepare(
        `INSERT INTO workout_exercises (id, day_id, section, exercise_id, name, position, sets, reps, rest_seconds, notes, muscle_groups, created_at)
         VALUES (1, 1, 'workout', NULL, 'Pre-existing Row', 0, 3, '10', 60, 'kept from before the fix', 'legs', 777)`,
      )
      .run();
    seed.close();

    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "GEL T4 Existing Tenant Test", dbFile) as { id: number };

    let sqlite: BetterSqlite3 | undefined;
    const cleanup = () => {
      try {
        sqlite?.close();
      } catch {
        // best effort
      }
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    };

    try {
      // The real call site: ensureTenantTables() (leaves the pre-existing
      // workout_exercises alone) -> runMigrations(sqlite, TENANT_MIGRATIONS)
      // (0003 detects + fixes it).
      const conn = openTenantDb(dbFile);
      sqlite = conn.sqlite;

      const sql = (
        sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='workout_exercises'").get() as {
          sql: string;
        }
      ).sql;
      assert.ok(
        !sql.includes("REFERENCES exercise_library"),
        "real openTenantDb() call site: existing tenant's workout_exercises FK is gone after migration",
      );

      const row = sqlite.prepare("SELECT * FROM workout_exercises WHERE id = 1").get();
      assert.deepEqual(
        row,
        {
          id: 1,
          day_id: 1,
          section: "workout",
          exercise_id: null,
          name: "Pre-existing Row",
          position: 0,
          sets: 3,
          reps: "10",
          rest_seconds: 60,
          notes: "kept from before the fix",
          muscle_groups: "legs",
          created_at: 777,
        },
        "the pre-existing row's data survived the real upgrade path byte-identical",
      );

      const inserted = sqlite
        .prepare(
          "INSERT INTO workout_exercises (day_id, exercise_id, name) VALUES (1, 424242, 'Global Exercise') RETURNING id",
        )
        .get() as { id: number };
      assert.ok(
        inserted.id,
        "a NEW insert with a control-plane-style exercise_id succeeds against the REAL openTenantDb() call site",
      );

      const applied = sqlite
        .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
        .get("0003-drop-exercise-id-fk");
      assert.ok(applied, "0003-drop-exercise-id-fk recorded as applied for this upgraded tenant");

      // Idempotency at the real call site: re-run the migration runner
      // directly on the same connection (openTenantDb() itself would just
      // return the cached conn without re-invoking anything, since
      // connCache is keyed by dbFile — this exercises runMigrations itself).
      const beforeRepeat = sqlite.prepare("SELECT * FROM workout_exercises ORDER BY id").all();
      assert.doesNotThrow(() => runMigrations(sqlite!, TENANT_MIGRATIONS));
      assert.doesNotThrow(() => runMigrations(sqlite!, TENANT_MIGRATIONS));
      const afterRepeat = sqlite.prepare("SELECT * FROM workout_exercises ORDER BY id").all();
      assert.deepEqual(afterRepeat, beforeRepeat, "re-running the migration runner twice more is a stable no-op");

      console.log("dropExerciseIdFk.test.ts: Block B — real existing-tenant upgrade path (openTenantDb) OK");
    } finally {
      cleanup();
    }
  }

  // ── Block C: a genuinely FRESH tenant — ensureTenantTables' updated DDL
  // alone (no migration involved) already has no exercise_id FK. ──
  {
    const slug = "gel-t4-fresh-tenant-test";
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "GEL T4 Fresh Tenant Test", dbFile) as { id: number };

    let sqlite: BetterSqlite3 | undefined;
    const cleanup = () => {
      try {
        sqlite?.close();
      } catch {
        // best effort
      }
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    };

    try {
      const conn = openTenantDb(dbFile);
      sqlite = conn.sqlite;

      for (const table of ITEM_TABLES) {
        const sql = (
          sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as {
            sql: string;
          }
        ).sql;
        assert.ok(
          !sql.includes("REFERENCES exercise_library"),
          `fresh tenant: ${table} has no exercise_library FK straight from ensureTenantTables (no migration needed)`,
        );
      }

      // A fresh program/day is needed to satisfy workout_exercises' day_id FK
      // (still enforced) before proving the exercise_id side accepts a
      // control-plane-style id with no local row backing it.
      sqlite.prepare("INSERT INTO workout_programs (id, title, type) VALUES (1, 'P', 'detailed')").run();
      sqlite.prepare("INSERT INTO workout_days (id, program_id, name) VALUES (1, 1, 'Day 1')").run();
      const inserted = sqlite
        .prepare(
          "INSERT INTO workout_exercises (day_id, exercise_id, name) VALUES (1, 424242, 'Global Exercise') RETURNING id",
        )
        .get() as { id: number };
      assert.ok(inserted.id, "fresh tenant: control-plane-style exercise_id insert succeeds immediately");

      // "0003-drop-exercise-id-fk" still gets recorded as applied (its guard
      // finds nothing pending and no-ops), so it doesn't re-attempt forever.
      const applied = sqlite
        .prepare("SELECT 1 FROM schema_migrations WHERE id = ?")
        .get("0003-drop-exercise-id-fk");
      assert.ok(applied, "0003-drop-exercise-id-fk recorded as applied (no-op) for a fresh tenant too");

      console.log("dropExerciseIdFk.test.ts: Block C — fresh tenant gets the corrected schema directly OK");
    } finally {
      cleanup();
    }
  }

  console.log("dropExerciseIdFk.test.ts: all assertions passed");
})();
