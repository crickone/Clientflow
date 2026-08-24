// Run: npm test -- src/lib/db/isWeeklyDue.test.ts
//
// Task 9 (Market Research P1) — unit tests for the pure weekly cron_state
// date-guard decision helper (see ./control, isWeeklyDue) that gates the
// weekly per-tenant competitor refresh in lib/automations/scheduler.ts.
// Mirrors control.test.ts's treatment of shouldRunToday: deliberately NOT
// testing the scheduler/cron_state persistence itself, just this pure
// function — same "TDD the guard, not the wiring" split as that file.
import assert from "node:assert/strict";

import { isWeeklyDue } from "./control";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  const NOW = "2026-08-16T12:00:00.000Z"; // any timestamp works; nothing here is calendar-relative
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** ISO timestamp `msAgo` milliseconds before NOW. */
  const iso = (msAgo: number) => new Date(Date.parse(NOW) - msAgo).toISOString();

  // Never run before (fresh tenant / no cron_state row yet) -> must run.
  check("no prior run recorded (null) -> due", isWeeklyDue(null, NOW) === true);

  // Brief's exact scenarios:
  check("6 days ago -> not due yet", isWeeklyDue(iso(6 * DAY_MS), NOW) === false);
  check("exactly 7 days ago -> due", isWeeklyDue(iso(7 * DAY_MS), NOW) === true);
  check("well over 7 days ago (30d) -> due", isWeeklyDue(iso(30 * DAY_MS), NOW) === true);

  // Precise millisecond boundary either side of the 7-day threshold — proves
  // the comparison is >= elapsed time, not a looser day-bucket check.
  check("7 days minus 1ms -> not due yet", isWeeklyDue(iso(7 * DAY_MS - 1), NOW) === false);
  check("7 days plus 1ms -> due", isWeeklyDue(iso(7 * DAY_MS + 1), NOW) === true);

  // A run that "just happened" (0ms ago, e.g. re-entrant call same tick) -> not due.
  check("just ran (0ms ago) -> not due", isWeeklyDue(NOW, NOW) === false);

  // Corrupt/unparsable marker fails OPEN (must run) rather than wedging the
  // job forever -- same philosophy as the rest of this guard family.
  check("unparsable lastRunIso fails open -> due", isWeeklyDue("not-a-real-date", NOW) === true);
  check("unparsable nowIso fails open -> due", isWeeklyDue(iso(DAY_MS), "also-not-a-date") === true);

  console.log(`isWeeklyDue: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
