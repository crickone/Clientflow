// Run: npm test -- src/lib/leadFlows/callPlan.test.ts
//
// Log a call outcomes, the call-back day picks, when a booked call's
// messages and staff alert go, and how the call is worded.
import assert from "node:assert/strict";

import {
  CALL_OUTCOMES,
  callbackDay,
  callbackDayError,
  callTimeError,
  formatCallDay,
  formatCallTime,
  isCallOutcome,
  isIsoDate,
  outcomeColumn,
  scheduleCallMessages,
  staffCallAlertAt,
} from "./callPlan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const H = 3_600_000;

assert.deepEqual(CALL_OUTCOMES.map((o) => o.label), ["No answer", "Call back later", "Spoke to them", "Thinking about it", "Booked a treatment"]);
n++;
ok(outcomeColumn("no_answer") === "key:no_answer" && outcomeColumn("spoke") === "role:engaged" && outcomeColumn("booked") === "role:booked", "each outcome has its column");
ok(isCallOutcome("thinking") && !isCallOutcome("maybe"), "isCallOutcome");

ok(callbackDay("tomorrow", "2026-11-30") === "2026-12-01", "Tomorrow");
ok(callbackDay("in_2_days", "2026-11-30") === "2026-12-02", "In 2 days");
ok(callbackDay("next_week", "2026-11-30") === "2026-12-07", "Next week is seven days on");
ok(callbackDayError("2026-11-29", "2026-11-30") === "Pick today or a later day.", "a past day refused");
ok(callbackDayError("2026-11-30", "2026-11-30") === null && callbackDayError("nope", "2026-11-30") === "Pick a day.", "today is fine, garbage is not");

ok(isIsoDate("2026-02-28") && isIsoDate("2028-02-29"), "real dates are accepted");
ok(!isIsoDate("2026-02-30") && !isIsoDate("2026-13-01") && !isIsoDate("2026-04-31") && !isIsoDate("nope"), "impossible dates are refused");
ok(callbackDayError("2026-02-30", "2026-02-01") === "Pick a day.", "an impossible call-back day is refused");

const now = Date.parse("2026-12-01T10:00:00Z");
const callAt = Date.parse("2026-12-02T10:30:00Z");
ok(callTimeError(callAt, now) === null && callTimeError(now - 1, now) === "Pick a time that has not passed yet.", "callTimeError");
const id = (t: number) => t;
assert.deepEqual(scheduleCallMessages({ now, callAt, delaysMs: [0, H], fit: id }), [now, callAt - H], "confirmation now, reminder an hour before");
n++;
const nineAm = Date.parse("2026-12-02T09:00:00Z");
const toNine = (t: number) => Math.max(t, nineAm);
assert.deepEqual(scheduleCallMessages({ now, callAt: nineAm, delaysMs: [0, H], fit: toNine }), [null, null], "a reminder pushed to the call time is dropped, and so is a confirmation that would land on it");
n++;
assert.deepEqual(scheduleCallMessages({ now: callAt - 30 * 60_000, callAt, delaysMs: [0, H], fit: id }), [callAt - 30 * 60_000, null], "booked 30 minutes ahead: no 1-hour reminder");
n++;
ok(staffCallAlertAt(now, callAt) === callAt - 10 * 60_000, "staff alert 10 minutes before");
ok(staffCallAlertAt(callAt - 5 * 60_000, callAt) === callAt - 5 * 60_000, "or straight away when that has passed");

ok(formatCallDay(callAt) === "Wednesday 2 December", "the day as people say it");
ok(formatCallTime(callAt) === "10:30", "24-hour time, Irish");
ok(formatCallTime(Date.parse("2026-07-01T08:05:00Z")) === "09:05", "summer time is respected");

console.log(`callPlan: ${n} checks passed.`);
