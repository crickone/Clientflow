// Run: npm test -- src/lib/db/migrations/index.test.ts
//
// Batch 6b (improvement-plan-2026-08.md Theme E1): unit tests for the
// versioned migration runner (runMigrations) — apply-once idempotency,
// in-order application, rollback-on-failure (leaving prior migrations
// applied and their DDL intact, but the failed one's DDL undone), and that a
// newly-added migration on an already-migrated DB applies just the new one.
//
// Uses a fresh in-memory better-sqlite3 DB per block — NOT the app's real
// control/tenant schema. The runner is generic over any better-sqlite3
// connection, independent of ensureTenantTables/ensureControlTables (which
// have their own coverage in tenant.test.ts / agentsTable.test.ts /
// control.test.ts). The wiring of runMigrations into openTenantDb/control's
// boot is covered separately in migrations/wiring.test.ts.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import type { Migration } from "./index";
import { runMigrations } from "./index";

// ── 1. Apply-once idempotency: up() runs exactly once across two calls ─────
{
  const db = new Database(":memory:");
  let upCalls = 0;
  const migrations: Migration[] = [
    {
      id: "0001-t1",
      description: "creates t1",
      up: (sqlite) => {
        upCalls++;
        sqlite.exec("CREATE TABLE t1 (id INTEGER)");
      },
    },
  ];

  runMigrations(db, migrations);
  assert.equal(upCalls, 1, "first call: up() ran once");

  const rows1 = db
    .prepare("SELECT id, applied_at FROM schema_migrations")
    .all() as Array<{ id: string; applied_at: number }>;
  assert.equal(rows1.length, 1, "one migration recorded");
  assert.equal(rows1[0].id, "0001-t1");
  assert.ok(rows1[0].applied_at > 0, "applied_at is a real timestamp");

  // Second call, SAME migrations array -> must be a no-op: up() not
  // re-invoked, schema_migrations unchanged.
  runMigrations(db, migrations);
  assert.equal(upCalls, 1, "second call: up() NOT re-invoked (already applied)");

  const rows2 = db.prepare("SELECT id FROM schema_migrations").all();
  assert.equal(rows2.length, 1, "still exactly one row after the no-op second call");

  db.close();
  console.log("migrations/index.test.ts: apply-once idempotency OK");
}

// ── 2. Ordering + rollback-on-failure ───────────────────────────────────────
{
  const db = new Database(":memory:");
  const invokedInOrder: string[] = [];
  const migrations: Migration[] = [
    {
      id: "0001-ok",
      description: "creates table_0001, always succeeds",
      up: (sqlite) => {
        invokedInOrder.push("0001");
        sqlite.exec("CREATE TABLE table_0001 (id INTEGER)");
      },
    },
    {
      id: "0002-fails",
      description: "creates table_0002 then throws — both must roll back",
      up: (sqlite) => {
        invokedInOrder.push("0002");
        sqlite.exec("CREATE TABLE table_0002 (id INTEGER)");
        throw new Error("boom: 0002 fails partway");
      },
    },
  ];

  assert.throws(() => runMigrations(db, migrations), /boom: 0002 fails partway/);
  assert.deepEqual(
    invokedInOrder,
    ["0001", "0002"],
    "ran in array order — 0002 was attempted right after 0001 committed",
  );

  const appliedIds = (
    db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>
  ).map((r) => r.id);
  assert.deepEqual(appliedIds, ["0001-ok"], "0001 recorded, 0002 NOT recorded");

  const t1 = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_0001'")
    .get();
  assert.ok(t1, "table_0001 (created by the successful 0001) exists");

  const t2 = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_0002'")
    .get();
  assert.equal(
    t2,
    undefined,
    "table_0002 does NOT exist — 0002's DDL was rolled back along with its failure",
  );

  // A later call (e.g. the next boot) retries the failed migration from
  // scratch rather than being permanently stuck.
  let secondAttemptRan = false;
  const fixed: Migration[] = [
    migrations[0],
    {
      id: "0002-fails",
      description: "same id, now succeeds",
      up: (sqlite) => {
        secondAttemptRan = true;
        sqlite.exec("CREATE TABLE table_0002 (id INTEGER)");
      },
    },
  ];
  runMigrations(db, fixed);
  assert.ok(secondAttemptRan, "the previously-failed id is retried on a later call");
  const t2Retried = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='table_0002'")
    .get();
  assert.ok(t2Retried, "table_0002 now exists after the retried migration succeeded");

  db.close();
  console.log("migrations/index.test.ts: ordering + rollback-on-failure OK");
}

// ── 3. A newly-added migration on an already-migrated DB applies just the
//      new one — earlier migrations' up() is not re-invoked ────────────────
{
  const db = new Database(":memory:");
  const calls = { "0001": 0, "0002": 0, "0003": 0 };
  const base: Migration[] = [
    {
      id: "0001-a",
      description: "a",
      up: (sqlite) => {
        calls["0001"]++;
        sqlite.exec("CREATE TABLE m1 (id INTEGER)");
      },
    },
    {
      id: "0002-b",
      description: "b",
      up: (sqlite) => {
        calls["0002"]++;
        sqlite.exec("CREATE TABLE m2 (id INTEGER)");
      },
    },
  ];
  runMigrations(db, base);
  assert.deepEqual(calls, { "0001": 1, "0002": 1, "0003": 0 }, "both base migrations ran once");

  const extended: Migration[] = [
    ...base,
    {
      id: "0003-c",
      description: "c",
      up: (sqlite) => {
        calls["0003"]++;
        sqlite.exec("CREATE TABLE m3 (id INTEGER)");
      },
    },
  ];
  runMigrations(db, extended);
  assert.deepEqual(
    calls,
    { "0001": 1, "0002": 1, "0003": 1 },
    "only the newly-added migration's up() ran — 0001/0002 were skipped",
  );

  const ids = (
    db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: string }>
  ).map((r) => r.id);
  assert.deepEqual(ids, ["0001-a", "0002-b", "0003-c"], "all three now recorded, in order");

  db.close();
  console.log("migrations/index.test.ts: new-migration-on-already-migrated-db OK");
}

console.log("migrations/index.test.ts: all assertions passed");
