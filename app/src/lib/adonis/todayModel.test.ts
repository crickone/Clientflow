// Run: npm test -- src/lib/adonis/todayModel.test.ts
//
// The opening screen's "Needs you today": the week starts Monday 00:00 Irish
// time; leads waiting are lead conversations whose last message came in;
// drafts to approve are the inbox's unresolved AI drafts.
import assert from "node:assert/strict";

import { countInbox, formatEuros, weekStartDublin } from "./todayModel";

assert.equal(weekStartDublin(Date.UTC(2026, 10, 24, 15, 0)), Date.UTC(2026, 10, 23, 0, 0), "Tuesday: back to Monday (Irish winter time is UTC)");
assert.equal(weekStartDublin(Date.UTC(2026, 10, 29, 22, 0)), Date.UTC(2026, 10, 23, 0, 0), "Sunday belongs to the week that started Monday");
assert.equal(weekStartDublin(Date.UTC(2026, 10, 23, 0, 30)), Date.UTC(2026, 10, 23, 0, 0), "Monday just after midnight");
assert.equal(weekStartDublin(Date.UTC(2026, 6, 1, 10, 0)), Date.UTC(2026, 5, 28, 23, 0), "summer: Monday 00:00 in Dublin is 23:00 UTC on Sunday");
assert.equal(weekStartDublin(Date.UTC(2026, 5, 28, 23, 30)), Date.UTC(2026, 5, 28, 23, 0), "00:30 Monday in Dublin is already the new week");

assert.deepEqual(
  countInbox([
    { kind: "lead", lastDirection: "inbound", needsAttention: true },
    { kind: "lead", lastDirection: "outbound", needsAttention: false },
    { kind: "client", lastDirection: "inbound", needsAttention: true },
    { kind: "lead", lastDirection: "inbound", needsAttention: false },
    { kind: "lead", lastDirection: "note", needsAttention: false },
  ]),
  { leadsWaiting: 2, draftsToApprove: 2 },
);
assert.deepEqual(countInbox([]), { leadsWaiting: 0, draftsToApprove: 0 });

assert.equal(formatEuros(78400), "€784");
assert.equal(formatEuros(1250), "€12.50");
assert.equal(formatEuros(0), "€0");

console.log("todayModel: all checks passed");
