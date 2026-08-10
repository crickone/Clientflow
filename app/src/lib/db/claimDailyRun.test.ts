// Run: npm test -- src/lib/db/claimDailyRun.test.ts
//
// Batch 6a (scale-hardening smalls, improvement-plan-2026-08.md Theme E4):
// unit tests for the atomic multi-instance scheduler-lock helpers
// (claimDailyRun / resetDailyClaim). Unlike control.test.ts's pure
// shouldRunToday tests, this DOES touch the real control.db cron_state table
// (same pattern as billing/engine.test.ts / db/agentsTable.test.ts) — there's
// no way to prove "only one caller wins an atomic UPDATE" without a real
// SQLite connection. Uses a scratch key that can't collide with any real
// scheduler's cron_state key ("last_daily_run"/"backup_last_run"/
// "lapse_last_run"/"billing_last_run"/"backup_last_alert"), and cleans up
// after itself.
import assert from "node:assert/strict";
import { claimDailyRun, controlSqlite, resetDailyClaim } from "./control";

const KEY = "test_batch6a_claim_daily_run";
const cleanup = () => {
  controlSqlite.prepare("DELETE FROM cron_state WHERE key = ?").run(KEY);
};

try {
  cleanup(); // in case a previous crashed run left this key behind

  // First call for a fresh key/today -> wins.
  assert.equal(claimDailyRun(KEY, "2026-08-09"), true, "first claim for a fresh key -> wins");

  // Second (and third) call, SAME key + SAME day -> loses. This is the whole
  // point: simulates a 2nd process/tick racing the first — only the winner
  // may run the job.
  assert.equal(claimDailyRun(KEY, "2026-08-09"), false, "second claim same day -> loses");
  assert.equal(claimDailyRun(KEY, "2026-08-09"), false, "a third claim same day still loses");

  // A NEW day (the next boot catch-up, or the next tick after midnight UTC)
  // -> wins again, mirroring shouldRunToday's date-string comparison (a
  // prior-day value never blocks today).
  assert.equal(claimDailyRun(KEY, "2026-08-10"), true, "a new day -> wins again");
  assert.equal(claimDailyRun(KEY, "2026-08-10"), false, "same new day again -> loses");

  // Retry-on-failure (the whole reason resetDailyClaim exists): releasing
  // TODAY's claim lets a SUBSEQUENT call for the SAME day win again — mirrors
  // what backup/lapse/daily-automations do when the job fails after winning
  // the claim, so a later tick/replica can retry today instead of being
  // wrongly skipped.
  resetDailyClaim(KEY);
  assert.equal(claimDailyRun(KEY, "2026-08-10"), true, "after resetDailyClaim, the same day wins again");
  assert.equal(claimDailyRun(KEY, "2026-08-10"), false, "...and is claimed once more after that");

  // Resetting a key with no row at all (never claimed, or already reset) is
  // a no-op, not an error.
  cleanup();
  resetDailyClaim(KEY); // must not throw
  assert.equal(claimDailyRun(KEY, "2026-08-11"), true, "claim after a no-op reset still wins cleanly");

  console.log("db/claimDailyRun.test.ts: all assertions passed");
} finally {
  cleanup();
}
