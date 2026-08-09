// Run: npm test -- src/lib/db/control.test.ts
//
// Batch 1 (production safety net): unit tests for the pure cron_state
// date-guard decision helper shared by the backup + lapse schedulers'
// boot-time catch-up (see lib/backup/scheduler.ts,
// lib/pipeline/lapseScheduler.ts). Deliberately NOT testing timers/schedulers
// themselves — just the pure function, per the batch1 brief.
import assert from "node:assert/strict";
import { shouldRunToday } from "./control";

const NOW = Date.parse("2026-08-09T14:00:00.000Z"); // any time on 2026-08-09 UTC

// Never run before (fresh install / no cron_state row yet) -> must run.
assert.equal(shouldRunToday(null, NOW), true, "no prior run recorded -> run now");

// Last run was yesterday (UTC) -> today hasn't happened yet -> must run.
assert.equal(shouldRunToday("2026-08-08", NOW), true, "yesterday's run -> run now");

// Last run was today (UTC), earlier in the day -> already done -> skip.
assert.equal(shouldRunToday("2026-08-09", NOW), false, "already ran today -> skip");

// Midnight-UTC boundary: `now` at 00:00:00 on the "today" date still counts as
// that date, and the day before it still counts as a new day needing a run.
const MIDNIGHT = Date.parse("2026-08-09T00:00:00.000Z");
assert.equal(shouldRunToday("2026-08-09", MIDNIGHT), false, "midnight boundary still counts as today");
assert.equal(shouldRunToday("2026-08-08", MIDNIGHT), true, "a fresh UTC day at midnight -> run now");
const JUST_BEFORE_MIDNIGHT = Date.parse("2026-08-08T23:59:59.999Z");
assert.equal(shouldRunToday("2026-08-08", JUST_BEFORE_MIDNIGHT), false, "one ms before midnight is still the prior day");

// A stale marker from last month/year is treated the same as yesterday -> run.
assert.equal(shouldRunToday("2025-01-01", NOW), true, "very old marker -> run now");

// This mirrors "at most once per UTC day regardless of boot + tick": calling
// it twice in a row with the SAME lastRun/now inputs (as a boot catch-up then
// the fixed tick would, before either has written a fresh cron_state) gives
// the same answer both times — the caller is responsible for writing
// cron_state between calls to actually prevent a double-run; this helper is
// only ever the read-side of that guard.
assert.equal(shouldRunToday("2026-08-08", NOW), shouldRunToday("2026-08-08", NOW));

console.log("db/control.test.ts: all assertions passed");
