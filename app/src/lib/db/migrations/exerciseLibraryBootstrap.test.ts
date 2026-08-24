// Run: npm test -- src/lib/db/migrations/exerciseLibraryBootstrap.test.ts
//
// Global Exercise Library, Task 1 (docs/superpowers/specs/
// 2026-08-24-global-exercise-library-design.md): covers the pure row mapper,
// the bootstrap's robustness (Inspire absent / missing db file / missing
// table — never throws), the Inspire->global + other-tenant->own-customs
// split, the inactive-tenant exclusion, and idempotency — both against a
// fully isolated in-memory connection (deterministic, no real app data) and
// against the REAL dev control.db + the real Inspire tenant fixture (mirrors
// migrations/wiring.test.ts's "prove it against the real call site" style).
// Neither this module nor ../control imports react's `cache` (only ../tenant
// does, for the request-scoped resolvers this bootstrap deliberately avoids
// — see exerciseLibraryBootstrap.ts's module comment), so no Module._load
// shim is needed here, unlike wiring.test.ts.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { controlSqlite } from "../control";
import {
  INSPIRE_TENANT_SLUG,
  mapExerciseForImport,
  runExerciseLibraryBootstrap,
} from "./exerciseLibraryBootstrap";

// ── 1. Pure row mapper: no DB/fs — plain object in, plain object out ───────
{
  const now = 1_700_000_000_000;
  const source = {
    name: "Barbell Bench Press",
    category: "Chest",
    muscle_groups: "chest,triceps,shoulders",
    equipment: "Barbell",
    video_url: "https://youtube.com/watch?v=abc",
    image_url: null,
    instructions: "Lie on the bench, unrack, lower to the chest, press.",
  };

  const global = mapExerciseForImport(source, null, now);
  assert.deepEqual(
    global,
    {
      tenant_id: null,
      name: "Barbell Bench Press",
      category: "Chest",
      muscle_groups: "chest,triceps,shoulders",
      equipment: "Barbell",
      video_url: "https://youtube.com/watch?v=abc",
      image_url: null,
      instructions: "Lie on the bench, unrack, lower to the chest, press.",
      created_at: now,
      updated_at: now,
    },
    "null targetTenantId maps to a global row, fields carried through verbatim",
  );

  const custom = mapExerciseForImport(source, 42, now);
  assert.equal(custom.tenant_id, 42, "a non-null targetTenantId maps to that tenant's custom");
  assert.equal(custom.created_at, now, "created_at is the caller-supplied import time");
  assert.equal(custom.updated_at, now, "updated_at is the caller-supplied import time");

  console.log("exerciseLibraryBootstrap.test.ts: pure mapper OK");
}

// ── Helpers for the isolated-connection scenarios below ────────────────────

/** A scratch "control-like" connection: just the two tables the bootstrap touches. */
function makeIsolatedControl(): BetterSqlite3 {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      db_file TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE exercise_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER,
      name TEXT NOT NULL,
      category TEXT,
      muscle_groups TEXT,
      equipment TEXT,
      video_url TEXT,
      image_url TEXT,
      instructions TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

/** A sentinel "stale" timestamp on source rows — proves the bootstrap stamps FRESH import-time timestamps rather than carrying these over. */
const STALE_TS = 12345;

/** A real scratch tenant SQLite file on disk, with a minimal exercise_library table + given rows. */
function makeScratchTenantDb(
  filePath: string,
  rows: Array<{ name: string; category?: string | null; equipment?: string | null }>,
): void {
  const db = new Database(filePath);
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO exercise_library
       (name, category, muscle_groups, equipment, video_url, image_url, instructions, created_at, updated_at)
     VALUES (@name, @category, @muscle_groups, @equipment, @video_url, @image_url, @instructions, @created_at, @updated_at)`,
  );
  for (const r of rows) {
    insert.run({
      name: r.name,
      category: r.category ?? null,
      muscle_groups: null,
      equipment: r.equipment ?? null,
      video_url: null,
      image_url: null,
      instructions: null,
      created_at: STALE_TS,
      updated_at: STALE_TS,
    });
  }
  db.close();
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exlib-bootstrap-test-"));
try {
  // ── 2. Robustness: no tenants registered at all -> nothing imported, no throw ──
  {
    const control = makeIsolatedControl();
    assert.doesNotThrow(() => runExerciseLibraryBootstrap(control));
    const rows = control.prepare("SELECT * FROM exercise_library").all();
    assert.equal(rows.length, 0, "no tenants registered -> nothing imported, no throw");
    control.close();
  }

  // ── 3. Robustness: Inspire registered but its db_file doesn't exist on disk ──
  {
    const control = makeIsolatedControl();
    control
      .prepare("INSERT INTO tenants (slug, db_file, is_active) VALUES (?, ?, 1)")
      .run(INSPIRE_TENANT_SLUG, path.join(tmpDir, "does-not-exist.db"));
    assert.doesNotThrow(() => runExerciseLibraryBootstrap(control));
    const rows = control.prepare("SELECT * FROM exercise_library").all();
    assert.equal(rows.length, 0, "inspire's db file is missing -> nothing imported, no throw");
    control.close();
  }

  // ── 4. Robustness: Inspire's db file exists but predates exercise_library ──
  {
    const control = makeIsolatedControl();
    const emptySchemaPath = path.join(tmpDir, "empty-schema.db");
    const emptyDb = new Database(emptySchemaPath);
    emptyDb.exec("CREATE TABLE unrelated (id INTEGER)");
    emptyDb.close();
    control
      .prepare("INSERT INTO tenants (slug, db_file, is_active) VALUES (?, ?, 1)")
      .run(INSPIRE_TENANT_SLUG, emptySchemaPath);
    assert.doesNotThrow(() => runExerciseLibraryBootstrap(control));
    const rows = control.prepare("SELECT * FROM exercise_library").all();
    assert.equal(
      rows.length,
      0,
      "inspire's db file predates exercise_library (no such table) -> nothing imported, no throw",
    );
    control.close();
  }

  // ── 5. Happy path (Inspire -> global, other active -> own customs,
  //      inactive -> excluded) + idempotency, all on one connection so
  //      idempotency is proven against the exact same populated state ──
  {
    const control = makeIsolatedControl();

    const inspirePath = path.join(tmpDir, "inspire.db");
    makeScratchTenantDb(inspirePath, [
      { name: "Barbell Back Squat", category: "Legs" },
      { name: "Barbell Bench Press", category: "Chest" },
    ]);
    const otherPath = path.join(tmpDir, "other-active.db");
    makeScratchTenantDb(otherPath, [
      { name: "Custom Lunge Variant", category: "Legs", equipment: "Dumbbell" },
    ]);
    const inactivePath = path.join(tmpDir, "other-inactive.db");
    makeScratchTenantDb(inactivePath, [{ name: "Should Never Import", category: "Legs" }]);

    control
      .prepare("INSERT INTO tenants (id, slug, db_file, is_active) VALUES (1, ?, ?, 1)")
      .run(INSPIRE_TENANT_SLUG, inspirePath);
    control
      .prepare("INSERT INTO tenants (id, slug, db_file, is_active) VALUES (2, 'other-active', ?, 1)")
      .run(otherPath);
    control
      .prepare("INSERT INTO tenants (id, slug, db_file, is_active) VALUES (3, 'other-inactive', ?, 0)")
      .run(inactivePath);

    const before = Date.now();
    runExerciseLibraryBootstrap(control);
    const after = Date.now();

    const globals = control
      .prepare("SELECT * FROM exercise_library WHERE tenant_id IS NULL ORDER BY name")
      .all() as Array<{ name: string; created_at: number; updated_at: number }>;
    assert.equal(globals.length, 2, "both of Inspire's rows imported as GLOBAL (tenant_id NULL)");
    assert.deepEqual(
      globals.map((r) => r.name),
      ["Barbell Back Squat", "Barbell Bench Press"],
    );
    for (const g of globals) {
      assert.ok(
        g.created_at >= before && g.created_at <= after && g.created_at !== STALE_TS,
        "created_at is a FRESH import-time timestamp, not the source row's stale sentinel",
      );
      assert.ok(g.updated_at >= before && g.updated_at <= after, "updated_at is fresh too");
    }

    const customs = control
      .prepare("SELECT * FROM exercise_library WHERE tenant_id = 2")
      .all() as Array<{ name: string; category: string | null; equipment: string | null }>;
    assert.equal(customs.length, 1, "the OTHER ACTIVE tenant's row imported as ITS OWN custom (tenant_id = 2)");
    assert.equal(customs[0].name, "Custom Lunge Variant");
    assert.equal(customs[0].category, "Legs", "non-name fields (category) carry through correctly");
    assert.equal(customs[0].equipment, "Dumbbell", "non-name fields (equipment) carry through correctly");

    const inactiveCustoms = control.prepare("SELECT * FROM exercise_library WHERE tenant_id = 3").all();
    assert.equal(inactiveCustoms.length, 0, "the INACTIVE tenant's rows are NOT imported");

    const totalAfterFirst = (
      control.prepare("SELECT COUNT(*) AS c FROM exercise_library").get() as { c: number }
    ).c;
    assert.equal(totalAfterFirst, 3, "3 total rows after the first run (2 global + 1 custom)");

    // ── idempotency: calling it again (twice more) on the SAME connection
    // must not duplicate anything — this is the internal row-count guard,
    // independent of CONTROL_MIGRATIONS' own schema_migrations tracking. ──
    runExerciseLibraryBootstrap(control);
    runExerciseLibraryBootstrap(control);
    const totalAfterRepeat = (
      control.prepare("SELECT COUNT(*) AS c FROM exercise_library").get() as { c: number }
    ).c;
    assert.equal(
      totalAfterRepeat,
      totalAfterFirst,
      "calling runExerciseLibraryBootstrap again (twice more) does NOT duplicate rows",
    );

    control.close();
  }

  console.log("exerciseLibraryBootstrap.test.ts: isolated-connection scenarios OK");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── 6. Real dev control.db + the real Inspire tenant fixture ───────────────
// Mirrors migrations/wiring.test.ts's "prove the real call site" approach.
// data/ is entirely gitignored (app/.gitignore), so a fresh CI checkout has
// NO 'inspire' tenant registered yet — this block SKIPS gracefully in that
// case, which doubles as a live proof of the "Inspire absent" robustness
// path against the REAL control.db (not just the synthetic block 3 above).
// Locally, the dev control.db already has a real 'inspire' tenant (its
// per-tenant exercise_library currently has a handful of curated rows; prod
// has ~600 — see the design doc) — there this block proves the bootstrap's
// global rows match Inspire's CURRENT rows exactly, and that re-running does
// not change that count. It does NOT assume "fresh" state (this same
// control.db is shared by every test file in the suite, and by whatever
// `next build`/`next dev` has already touched it) — only that the two
// invariants (exact match to source, stability across repeat calls) hold
// regardless of how many times the bootstrap has already fired.
{
  const inspireRow = controlSqlite
    .prepare("SELECT db_file FROM tenants WHERE slug = ?")
    .get(INSPIRE_TENANT_SLUG) as { db_file: string } | undefined;

  if (!inspireRow) {
    console.log(
      "exerciseLibraryBootstrap.test.ts: real-Inspire block SKIPPED (no 'inspire' tenant in this control.db — expected on a fresh CI checkout)",
    );
  } else {
    const inspireFullPath = path.isAbsolute(inspireRow.db_file)
      ? inspireRow.db_file
      : path.join(process.cwd(), "data", inspireRow.db_file);
    assert.ok(fs.existsSync(inspireFullPath), `real inspire.db should exist at ${inspireFullPath}`);

    const inspireDb = new Database(inspireFullPath, { readonly: true });
    let sourceNames: string[];
    try {
      sourceNames = (
        inspireDb.prepare("SELECT name FROM exercise_library").all() as Array<{ name: string }>
      )
        .map((r) => r.name)
        .sort();
    } finally {
      inspireDb.close();
    }

    // Triggers controlSqlite's lazy open (ensureControlTables + CONTROL_MIGRATIONS)
    // if nothing in this process has touched it yet.
    runExerciseLibraryBootstrap(controlSqlite);
    const countAfterFirst = (
      controlSqlite
        .prepare("SELECT COUNT(*) AS c FROM exercise_library WHERE tenant_id IS NULL")
        .get() as { c: number }
    ).c;
    const globalNamesAfterFirst = (
      controlSqlite
        .prepare("SELECT name FROM exercise_library WHERE tenant_id IS NULL")
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .sort();

    assert.equal(
      countAfterFirst,
      sourceNames.length,
      `control global row count (${countAfterFirst}) matches inspire.db's CURRENT exercise_library row count (${sourceNames.length})`,
    );
    assert.deepEqual(
      globalNamesAfterFirst,
      sourceNames,
      "the control's global exercise names match inspire.db's exercise names exactly (as a multiset)",
    );

    // ── idempotency against the REAL control.db: two more direct calls ──
    runExerciseLibraryBootstrap(controlSqlite);
    runExerciseLibraryBootstrap(controlSqlite);
    const countAfterRepeat = (
      controlSqlite
        .prepare("SELECT COUNT(*) AS c FROM exercise_library WHERE tenant_id IS NULL")
        .get() as { c: number }
    ).c;
    assert.equal(
      countAfterRepeat,
      countAfterFirst,
      "re-running against the REAL dev control.db (2 more direct calls) does not change the global row count",
    );

    console.log(
      `exerciseLibraryBootstrap.test.ts: real-Inspire block OK (${countAfterFirst} global row(s), stable across repeat calls)`,
    );
  }
}

console.log("exerciseLibraryBootstrap.test.ts: all assertions passed");
