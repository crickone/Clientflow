// app/src/lib/programs/panel.test.ts
// Run: npm test -- src/lib/programs/panel.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { PANEL_EVENT_LIMIT, panelFrom } from "./panel";
import { planSession } from "./planner";
import { platformProgram } from "./registry";

const sl = platformProgram("stronglifts-5x5")!;
const state = initState(sl, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5);
const at = Date.UTC(2026, 10, 12, 12);
const data = panelFrom({
  enrolment: { id: 9, status: "active", template: sl, state, unit: "kg", basedOnName: null },
  plan: planSession(sl, state, { stepKg: 2.5 }),
  events: [
    { id: 3, at, actor: "staff:4", actorName: "Ann Byrne", kind: "max", reason: "Ann Byrne set the squat max to 140 kg, training max 140 kg." },
    { id: 2, at, actor: "member", actorName: null, kind: "skip", reason: "Skipped Workout B, week 1 of 12." },
    { id: 1, at, actor: "engine", actorName: null, kind: "progress", reason: "Next back squat 52.5 kg. You did all 5 sets of 5.\nNext bench press 42.5 kg. You did all 5 sets of 5." },
  ],
  past: [{ name: "Starting Strength", endedAt: at }],
});
assert.ok(data.live);
const live = data.live!;
assert.equal(live.weekLine, "Week 1 of 12");
assert.equal(live.byline, "StrongLifts 5x5 by Mehdi Hadim");
assert.deepEqual(live.lifts[0], { lift: "squat", label: "Squat", max: "100 kg", tm: null, maxInUnit: 100 });
assert.deepEqual(live.next, { title: "Workout A, week 1 of 12", lines: ["Back squat 5 x 5 at 50 kg", "Bench press 5 x 5 at 40 kg", "Barbell row 5 x 5 at 35 kg"] });
assert.deepEqual(live.events.map((e) => e.who), ["Coach Ann Byrne", "Member", "Program"]);
assert.equal(live.events[2].lines.length, 2);
assert.deepEqual(live.skipped.map((s) => s.text), ["Skipped Workout B, week 1 of 12."]);
assert.deepEqual(live.weeks, [{ index: 0, number: 1, label: "Week 1" }, { index: 1, number: 2, label: "Week 2" }]);
assert.equal(data.past[0].name, "Starting Strength");
assert.equal(data.past[0].ended, "12 Nov 2026");

// a training max shows where the program uses one; pounds format in pounds
const bbb = platformProgram("531-bbb")!;
const b = panelFrom({ enrolment: { id: 1, status: "paused", template: bbb, state: initState(bbb, { press: 100, deadlift: 100, bench: 100, squat: 100 }, 2.5), unit: "lb", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(b.live!.status, "paused");
assert.equal(b.live!.lifts[0].max, "220.5 lb");
assert.equal(b.live!.lifts[0].tm, "198.4 lb");
assert.equal(b.live!.next, null);

// the coach's week options are weeks of the member's current round: a 5/3/1
// member in their second cycle (cycle 1) on its 3s week sees weeks 5 to 8,
// with week 6 the one selected
const bbbCycle1 = { ...initState(bbb, { press: 100, deadlift: 100, bench: 100, squat: 100 }, 2.5), cycle: 1, week: 1, day: 2 };
const c1 = panelFrom({ enrolment: { id: 3, status: "active", template: bbb, state: bbbCycle1, unit: "kg", basedOnName: null }, plan: planSession(bbb, bbbCycle1, { stepKg: 2.5 }), events: [], past: [] }).live!;
assert.deepEqual(
  c1.weeks.map((w) => w.label),
  ["Week 5: 5s week", "Week 6: 3s week", "Week 7: 5/3/1 week", "Week 8: Deload"],
);
assert.equal(c1.currentWeek, 1);
assert.equal(c1.weeks.find((w) => w.index === c1.currentWeek)!.label, "Week 6: 3s week", "the current week is the selected option");
assert.equal(c1.weekLine, "Week 6 of 12");
assert.equal(c1.next!.title, "Bench day, week 6 of 12");

// past its length the options restart with the round, as weekLabel does
const bbbRound2 = { ...bbbCycle1, cycle: 3, week: 0 };
const r2 = panelFrom({ enrolment: { id: 3, status: "active", template: bbb, state: bbbRound2, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] }).live!;
assert.equal(r2.weekLine, "Week 1 of 12, round 2");
assert.deepEqual(r2.weeks.map((w) => w.number), [1, 2, 3, 4]);

// a single repeating week has nowhere to move, so no options (the control is hidden)
for (const key of ["push-pull-legs", "arnold-style-split", "german-volume-training"]) {
  const tpl = platformProgram(key)!;
  assert.equal(tpl.weeks.length, 1, `${key} has one repeating week`);
  const p = panelFrom({ enrolment: { id: 8, status: "active", template: tpl, state: { ...initState(tpl, {}, 2.5), cycle: 2 }, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
  assert.deepEqual(p.live!.weeks, [], `${key} offers no week to move to`);
}

// past its length the week reads as a round
const again = panelFrom({ enrolment: { id: 2, status: "active", template: sl, state: { ...state, cycle: 6 }, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(again.live!.weekLine, "Week 1 of 12, round 2");

assert.equal(live.eventsCapped, false);
assert.equal(live.finished, false);

// a finished block: waiting for a new max, still live
const smolov = platformProgram("smolov-base")!;
const done = panelFrom({
  enrolment: { id: 4, status: "active", template: smolov, state: { ...initState(smolov, { squat: 150 }, 2.5), week: 3, day: 2, finished: true }, unit: "kg", basedOnName: null },
  plan: null,
  events: [{ id: 7, at, actor: "engine", actorName: null, kind: "progress", reason: "Block done. Your new squat max is 160 kg." }],
  past: [],
});
assert.equal(done.live!.finished, true);
assert.equal(done.live!.status, "active");
assert.equal(done.live!.weekLine, "Block finished. Waiting for a new max.");
assert.equal(done.live!.next, null);
assert.equal(done.live!.currentWeek, 3);

// no events: an empty log, no skips, nothing cut
const quiet = panelFrom({ enrolment: { id: 5, status: "active", template: sl, state, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
assert.deepEqual(quiet.live!.events, []);
assert.deepEqual(quiet.live!.skipped, []);
assert.equal(quiet.live!.eventsCapped, false);

// a full page of events says the log is cut there; skips come from that page only
const many = Array.from({ length: PANEL_EVENT_LIMIT }, (_, i) => ({ id: 100 - i, at, actor: "member", actorName: null, kind: i % 10 === 0 ? "skip" : "progress", reason: `Change ${i}.` }));
const full = panelFrom({ enrolment: { id: 6, status: "active", template: sl, state, unit: "kg", basedOnName: null }, plan: null, events: many, past: [] });
assert.equal(PANEL_EVENT_LIMIT, 40);
assert.equal(full.live!.eventsCapped, true);
assert.equal(full.live!.events.length, 40);
assert.equal(full.live!.skipped.length, 4);

// nothing live
assert.equal(panelFrom({ enrolment: null, plan: null, events: [], past: [] }).live, null);

console.log("programs/panel: ok");
