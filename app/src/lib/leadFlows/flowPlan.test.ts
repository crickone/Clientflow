// Run: npm test -- src/lib/leadFlows/flowPlan.test.ts
//
// The decisions the engine makes: what entering a column does, which
// treatment version a lead gets, when each step goes, when the finish move
// happens, and which replies count as wanting to book or talk.
import assert from "node:assert/strict";

import { cascadeDueTimes, columnEntryEffect, finishDueAt, interestMatches, isPositiveReply, pickForInterest } from "./flowPlan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const DAY = 86_400_000;

// Column entry.
assert.deepEqual(columnEntryEffect({ actor: "user", role: null, flowKey: "lead_no_answer", startFlow: true }), { stop: "all", start: "lead_no_answer", cancelCallRows: true });
n++;
assert.deepEqual(columnEntryEffect({ actor: "user", role: null, flowKey: null, startFlow: true }), { stop: "all", start: null, cancelCallRows: true }, "a person moving a lead stops everything, even into a column with no flow");
n++;
assert.deepEqual(columnEntryEffect({ actor: "agent", role: "booked", flowKey: "lead_booked", startFlow: false }), { stop: "all", start: null, cancelCallRows: true }, "startFlow false: stops but starts nothing");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: null, flowKey: "lead_nurture", startFlow: true }), { stop: "all", start: "lead_nurture", cancelCallRows: false }, "an automatic move into a flow column starts it");
n++;
const booked = columnEntryEffect({ actor: "automation", role: "booked", flowKey: null, startFlow: true });
ok(typeof booked.stop === "object" && "except" in booked.stop && booked.stop.except.includes("lead_call_booked") && booked.start === null, "a booking with its flow off still stops the nudges");
const noShow = columnEntryEffect({ actor: "automation", role: "no_show", flowKey: null, startFlow: true });
ok(typeof noShow.stop === "object" && "only" in noShow.stop && noShow.stop.only.includes("lead_booked") && noShow.cancelCallRows, "a no-show stops the booking messages");
assert.deepEqual(columnEntryEffect({ actor: "system", role: "won", flowKey: "lead_x", startFlow: true }), { stop: "all", start: null, cancelCallRows: true }, "a sale stops everything and starts nothing");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: null, flowKey: null, startFlow: true }), { stop: "none", start: null, cancelCallRows: false }, "an automatic move into Message undelivered leaves the flow running");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: "engaged", flowKey: null, startFlow: true }), { stop: "none", start: null, cancelCallRows: false }, "the reply path stops flows itself");
n++;

// Treatment versions.
ok(interestMatches("hbot, hyperbaric, oxygen", "Hyperbaric oxygen"), "keywords match the interest text, any case");
ok(!interestMatches("hbot, hyperbaric", "Massage and bodywork") && !interestMatches("hbot", null) && !interestMatches(" , ", "hbot"), "and only then");
const msgs = [
  { id: "w1", delayMs: 0, matchInterest: null },
  { id: "w2-hbot", delayMs: 7 * DAY, matchInterest: "hbot, hyperbaric" },
  { id: "w2-massage", delayMs: 7 * DAY, matchInterest: "massage" },
  { id: "w2-general", delayMs: 7 * DAY, matchInterest: "other" },
  { id: "w6", delayMs: 35 * DAY, matchInterest: null },
];
assert.deepEqual(pickForInterest(msgs, "HBOT").map((m) => m.id), ["w1", "w2-hbot", "w6"]);
n++;
assert.deepEqual(pickForInterest(msgs, "Not sure yet").map((m) => m.id), ["w1", "w2-general", "w6"], "no match: the general version");
n++;
assert.deepEqual(pickForInterest(msgs, null).map((m) => m.id), ["w1", "w2-general", "w6"], "no interest at all: the general version");
n++;
assert.deepEqual(pickForInterest(msgs, "hyperbaric and massage").map((m) => m.id), ["w1", "w2-hbot", "w6"], "two matches: the first version only");
n++;

// Step times: each step from the previous step's real time.
const id = (t: number) => t;
assert.deepEqual(cascadeDueTimes(1000, [0, 0, 2 * DAY, 4 * DAY], id), [1000, 1000, 1000 + 2 * DAY, 1000 + 4 * DAY]);
n++;
const heldOvernight = (t: number, i: number) => (i === 0 ? t + 10 * 3_600_000 : t);
assert.deepEqual(cascadeDueTimes(0, [0, 2 * DAY], heldOvernight), [10 * 3_600_000, 10 * 3_600_000 + 2 * DAY], "a held first step pushes the next one back");
n++;
assert.deepEqual(cascadeDueTimes(0, [2 * DAY, 4 * DAY], id, 5 * DAY), [5 * DAY, 7 * DAY], "a fixed first time (the morning after a picked day) replaces the first delay");
n++;
assert.deepEqual(cascadeDueTimes(0, [5 * DAY, 2 * DAY], id), [5 * DAY, 5 * DAY], "a delay shorter than the one before never goes backwards");
n++;

// Finish move.
ok(finishDueAt(0, [0, 2 * DAY + 3_600_000], [0, 2 * DAY], 4 * DAY) === 4 * DAY + 3_600_000, "counted on from the last step's real time");
ok(finishDueAt(500, [], [], 4 * DAY) === 500 + 4 * DAY, "no messages: from the start");
ok(finishDueAt(0, [0, null], [0, 2 * DAY], 4 * DAY) === 4 * DAY, "a dropped last step: from the one before");

// Replies.
ok(isPositiveReply({ category: "booking", priority: "normal" }), "wants to book");
ok(isPositiveReply({ category: "new_lead", priority: "high" }), "a hot, urgent message");
ok(!isPositiveReply({ category: "faq", priority: "normal" }), "a question is not a yes");
ok(!isPositiveReply({ category: "sensitive", priority: "high" }), "sensitive is never a yes");
ok(!isPositiveReply({ category: "spam", priority: "high" }), "nor spam");

console.log(`flowPlan: ${n} checks passed.`);
