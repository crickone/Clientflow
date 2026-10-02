// Run: npm test -- src/lib/recorders/started.test.ts
//
// Recorder start stamps: set once per tenant on first boot after deploy and
// never moved, so a widget can say "Collecting since <date>". Pure parts only
// plus one real-SQLite check that the SQL is idempotent.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { RECORDER_KEYS, RECORDER_START_SQL, parseRecorderStart, recorderSettingKey } from "./started";

assert.deepEqual([...RECORDER_KEYS], ["stage_history", "page_views", "email_events", "status_dates"]);
assert.equal(recorderSettingKey("page_views"), "recorder_started:page_views");

assert.equal(parseRecorderStart(null), null);
assert.equal(parseRecorderStart("not json"), null);
assert.equal(parseRecorderStart('"nope"'), null);
assert.equal(parseRecorderStart('"2026-10-02T10:00:00.000Z"')?.toISOString(), "2026-10-02T10:00:00.000Z");

const sqlite = new Database(":memory:");
sqlite.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
sqlite.exec(RECORDER_START_SQL);
const first = sqlite.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
assert.equal(first.length, 4);
for (const r of first) assert.ok(parseRecorderStart(r.value), `${r.key} parses`);
sqlite.prepare("UPDATE settings SET value = ? WHERE key = ?").run('"2020-01-01T00:00:00.000Z"', "recorder_started:page_views");
sqlite.exec(RECORDER_START_SQL);
const again = sqlite.prepare("SELECT value FROM settings WHERE key = 'recorder_started:page_views'").get() as { value: string };
assert.equal(again.value, '"2020-01-01T00:00:00.000Z"', "a second run never moves the stamp");

console.log("started.test.ts: ok");
