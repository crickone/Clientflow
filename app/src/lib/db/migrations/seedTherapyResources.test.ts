// Run: npm test -- src/lib/db/migrations/seedTherapyResources.test.ts
//
// The 0007 migration makes one claim that matters: seeding a resource per
// therapy at concurrency 1 reproduces the OLD conflict rule exactly, so no
// tenant's diary behaves differently the morning after it runs. A commit
// message asserting that is worth nothing; this proves it.
//
// In-memory better-sqlite3 with just the tables the migration touches — the
// same approach index.test.ts takes with the runner itself.
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { TENANT_MIGRATIONS } from "./index";
import { firstConflict, demandFrom, type ResourceLimit } from "@/lib/scheduling/resourceDemand";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const migration = TENANT_MIGRATIONS.find((m) => m.id === "0007-seed-therapy-resources");
assert.ok(migration, "0007-seed-therapy-resources is in TENANT_MIGRATIONS");

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE therapies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'equipment',
      concurrency INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE therapy_resources (
      therapy_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, units INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (therapy_id, resource_id)
    );
  `);
  return db;
}

// Optimal Health's real shape.
const THERAPIES = ["HBOT", "Infrared", "PEMF", "Massage"];

// ── 1. One resource per therapy, mapped, at concurrency 1 ──────────────────
{
  const db = freshDb();
  for (const n of THERAPIES) db.prepare("INSERT INTO therapies (name) VALUES (?)").run(n);
  migration!.up(db);

  const res = db.prepare("SELECT id, name, concurrency FROM resources ORDER BY id").all() as
    { id: number; name: string; concurrency: number }[];
  check("one resource per therapy", res.map((r) => r.name), THERAPIES);
  check("each at concurrency 1", res.every((r) => r.concurrency === 1), true);

  const links = db.prepare("SELECT therapy_id, resource_id, units FROM therapy_resources ORDER BY therapy_id").all() as
    { therapy_id: number; resource_id: number; units: number }[];
  check("every therapy is mapped", links.length, THERAPIES.length);
  check("each maps to its own resource, one unit", links.every((l) => l.units === 1), true);
  check("no two therapies share a resource", new Set(links.map((l) => l.resource_id)).size, THERAPIES.length);
}

// ── 2. The behaviour claim: identical to "conflict iff same therapy" ───────
{
  const db = freshDb();
  for (const n of THERAPIES) db.prepare("INSERT INTO therapies (name) VALUES (?)").run(n);
  migration!.up(db);

  const limits = new Map<number, ResourceLimit>(
    (db.prepare("SELECT id, name, concurrency FROM resources").all() as ResourceLimit[]).map((r) => [r.id, r]),
  );
  const demandFor = (therapyId: number) =>
    demandFrom(
      db.prepare("SELECT resource_id AS resourceId, units FROM therapy_resources WHERE therapy_id = ?")
        .all(therapyId) as { resourceId: number; units: number }[],
    );

  const [hbot, infrared, , massage] = (db.prepare("SELECT id FROM therapies ORDER BY id").all() as { id: number }[])
    .map((t) => t.id);

  const at10 = { startMin: 600, endMin: 660, bufferMinutes: 0, limits };
  const booked = (therapyId: number) => [{ startMin: 600, endMin: 660, demand: demandFor(therapyId) }];

  // OLD rule: same therapy -> clash.
  check(
    "a second HBOT at the same time still clashes",
    firstConflict({ ...at10, demand: demandFor(hbot), booked: booked(hbot) })?.resourceName,
    "HBOT",
  );
  // OLD rule: different therapy -> allowed.
  check(
    "HBOT alongside Infrared is still allowed",
    firstConflict({ ...at10, demand: demandFor(hbot), booked: booked(infrared) }),
    null,
  );
  check(
    "Massage alongside HBOT is still allowed",
    firstConflict({ ...at10, demand: demandFor(massage), booked: booked(hbot) }),
    null,
  );
  // And the new expressiveness the old rule could not reach: raise one
  // resource's concurrency and a second booking of that therapy fits.
  db.prepare("UPDATE resources SET concurrency = 3 WHERE name = 'Massage'").run();
  const wider = new Map<number, ResourceLimit>(
    (db.prepare("SELECT id, name, concurrency FROM resources").all() as ResourceLimit[]).map((r) => [r.id, r]),
  );
  check(
    "three massage rooms means a second massage fits",
    firstConflict({ ...at10, limits: wider, demand: demandFor(massage), booked: booked(massage) }),
    null,
  );
}

// ── 3. Create-only: re-running changes nothing, and never double-maps ──────
{
  const db = freshDb();
  for (const n of THERAPIES) db.prepare("INSERT INTO therapies (name) VALUES (?)").run(n);
  migration!.up(db);
  migration!.up(db);
  check("re-running adds no resources", (db.prepare("SELECT count(*) AS n FROM resources").get() as { n: number }).n, 4);
  check("re-running adds no links", (db.prepare("SELECT count(*) AS n FROM therapy_resources").get() as { n: number }).n, 4);
}

// ── 4. A tenant who already configured resources is left alone ─────────────
{
  const db = freshDb();
  for (const n of THERAPIES) db.prepare("INSERT INTO therapies (name) VALUES (?)").run(n);
  db.prepare("INSERT INTO resources (name, concurrency) VALUES ('Treatment rooms', 3)").run();
  // Every therapy already points at the shared room pool.
  for (let id = 1; id <= 4; id++) {
    db.prepare("INSERT INTO therapy_resources (therapy_id, resource_id, units) VALUES (?, 1, 1)").run(id);
  }
  migration!.up(db);
  check("no new resources invented", (db.prepare("SELECT count(*) AS n FROM resources").get() as { n: number }).n, 1);
  check("their mapping survives", (db.prepare("SELECT count(*) AS n FROM therapy_resources").get() as { n: number }).n, 4);
}

// ── 5. No therapies at all (a brand new tenant) ────────────────────────────
{
  const db = freshDb();
  migration!.up(db);
  check("nothing seeded for a tenant with no therapies", (db.prepare("SELECT count(*) AS n FROM resources").get() as { n: number }).n, 0);
}

console.log(`seedTherapyResources: ${passed} checks passed.`);
