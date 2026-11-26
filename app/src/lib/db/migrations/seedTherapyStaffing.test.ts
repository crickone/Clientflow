// Run: npm test -- src/lib/db/migrations/seedTherapyStaffing.test.ts
//
// 0012 sets "setup" for therapies mapped to a machine-like resource (HBOT,
// infrared, HIFEM, red light, PEMF, sauna) and leaves the rest "whole".
// In-memory better-sqlite3 with only the tables it touches, as
// seedTherapyResources.test.ts does.
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { TENANT_MIGRATIONS } from "./index";

const migration = TENANT_MIGRATIONS.find((m) => m.id === "0012-seed-therapy-staffing");
assert.ok(migration, "0012-seed-therapy-staffing is in TENANT_MIGRATIONS");

function freshDb(withColumn: boolean) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE therapies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL ${withColumn ? ", staffing TEXT NOT NULL DEFAULT 'whole'" : ""});
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE therapy_resources (therapy_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, units INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (therapy_id, resource_id));
  `);
  return db;
}

function seed(db: Database.Database) {
  const res = ["HBOT", "Infrared Therapy", "HIFEM Therapy", "Massage room", "Red Light Bed", "pemf mat", "Sauna"];
  for (const r of res) db.prepare("INSERT INTO resources (name) VALUES (?)").run(r);
  const th = [
    ["HBOT session", 1],
    ["Infrared session", 2],
    ["HIFEM session", 3],
    ["Deep tissue massage", 4],
    ["Facial", 4],
    ["Red light", 5],
    ["PEMF", 6],
    ["Sauna session", 7],
  ] as const;
  for (const [name, rid] of th) {
    const id = Number(db.prepare("INSERT INTO therapies (name) VALUES (?)").run(name).lastInsertRowid);
    db.prepare("INSERT INTO therapy_resources (therapy_id, resource_id) VALUES (?, ?)").run(id, rid);
  }
  // A therapy with no resource stays whole, even with a machine-like name.
  db.prepare("INSERT INTO therapies (name) VALUES ('HBOT unmapped')").run();
}

for (const withColumn of [true, false]) {
  const db = freshDb(withColumn);
  seed(db);
  migration!.up(db);
  const rows = db.prepare("SELECT name, staffing FROM therapies ORDER BY id").all() as { name: string; staffing: string }[];
  assert.deepEqual(rows, [
    { name: "HBOT session", staffing: "setup" },
    { name: "Infrared session", staffing: "setup" },
    { name: "HIFEM session", staffing: "setup" },
    { name: "Deep tissue massage", staffing: "whole" },
    { name: "Facial", staffing: "whole" },
    { name: "Red light", staffing: "setup" },
    { name: "PEMF", staffing: "setup" },
    { name: "Sauna session", staffing: "setup" },
    { name: "HBOT unmapped", staffing: "whole" },
  ], `staffing seeded (column ${withColumn ? "present" : "added by the migration"})`);

  // Re-running changes nothing.
  migration!.up(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM therapies WHERE staffing = 'setup'").get() as { n: number }).n, 6);
}

console.log("seedTherapyStaffing: all checks passed.");
