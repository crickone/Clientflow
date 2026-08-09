// Run: npm test -- src/instrumentation.test.ts
//
// Batch 1 fix wave (review finding #2): unit tests for the pure rate-limit
// decision helper behind the crash-guard alert email (see instrumentation.ts,
// alertOnSurvivedCrash). Deliberately NOT testing the process.on handlers,
// the dynamic import, or the email dispatch themselves — those are
// side-effecting/require a live mail provider; shouldSendAlert is the one
// pure, therefore testable, part of that logic (same philosophy as
// db/control.test.ts's shouldRunToday).
import assert from "node:assert/strict";
import { shouldSendAlert } from "./instrumentation";

const NOW = Date.parse("2026-08-09T14:00:00.000Z"); // any instant
const TEN_MIN = 10 * 60_000;

// Never alerted before (fresh boot / no crash yet) -> must allow.
assert.equal(shouldSendAlert(null, NOW, TEN_MIN), true, "no prior alert (null) -> send");
assert.equal(shouldSendAlert(undefined, NOW, TEN_MIN), true, "no prior alert (undefined) -> send");

// Well within the rate-limit window -> suppressed (this is the crash-loop guard).
assert.equal(shouldSendAlert(NOW - 1_000, NOW, TEN_MIN), false, "1s after the prior alert -> suppressed");
assert.equal(shouldSendAlert(NOW - (TEN_MIN - 1), NOW, TEN_MIN), false, "1ms inside the window -> suppressed");

// Exactly at the boundary -> allowed (inclusive, mirrors shouldRunToday's own
// inclusive boundary semantics).
assert.equal(shouldSendAlert(NOW - TEN_MIN, NOW, TEN_MIN), true, "exactly at the interval -> send");

// Past the window -> allowed.
assert.equal(shouldSendAlert(NOW - (TEN_MIN + 1), NOW, TEN_MIN), true, "1ms past the window -> send");
assert.equal(shouldSendAlert(NOW - 24 * 60 * 60_000, NOW, TEN_MIN), true, "a full day since the last alert -> send");

// A crash-loop burst: the caller updates lastAlertMs to `now` the instant it
// decides to send (see alertOnSurvivedCrash, which sets the timestamp BEFORE
// kicking off the async send) — verify re-checking immediately afterwards
// with that same `now` correctly suppresses a second send in the same burst.
assert.equal(shouldSendAlert(NOW, NOW, TEN_MIN), false, "re-checking at the same instant it just alerted -> suppressed");

// minIntervalMs of 0 is a degenerate but valid input: always allowed (no rate
// limiting at all).
assert.equal(shouldSendAlert(NOW, NOW, 0), true, "zero-length interval never suppresses");

console.log("instrumentation.test.ts: all assertions passed");
