// app/src/lib/programs/panel.test.ts
// Run: npm test -- src/lib/programs/panel.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { panelFrom } from "./panel";
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
    { id: 2, at, actor: "member", actorName: null, kind: "skip", reason: "Skipped Workout B, week 1." },
    { id: 1, at, actor: "engine", actorName: null, kind: "progress", reason: "Next back squat 52.5 kg. You did all 5 sets of 5.\nNext bench press 42.5 kg. You did all 5 sets of 5." },
  ],
  past: [{ name: "Starting Strength", endedAt: at }],
});
assert.ok(data.live);
const live = data.live!;
assert.equal(live.weekLine, "Week 1 of 12");
assert.equal(live.byline, "StrongLifts 5x5 by Mehdi Hadim");
assert.deepEqual(live.lifts[0], { lift: "squat", label: "Squat", max: "100 kg", tm: null, maxInUnit: 100 });
assert.deepEqual(live.next, { title: "Workout A, week 1", lines: ["Back squat 5 x 5 at 50 kg", "Bench press 5 x 5 at 40 kg", "Barbell row 5 x 5 at 35 kg"] });
assert.deepEqual(live.events.map((e) => e.who), ["Coach Ann Byrne", "Member", "Program"]);
assert.equal(live.events[2].lines.length, 2);
assert.deepEqual(live.skipped.map((s) => s.text), ["Skipped Workout B, week 1."]);
assert.deepEqual(live.weeks, [{ index: 0, label: "Week 1" }, { index: 1, label: "Week 2" }]);
assert.equal(data.past[0].name, "Starting Strength");
assert.equal(data.past[0].ended, "12 Nov 2026");

// a training max shows where the program uses one; pounds format in pounds
const bbb = platformProgram("531-bbb")!;
const b = panelFrom({ enrolment: { id: 1, status: "paused", template: bbb, state: initState(bbb, { press: 100, deadlift: 100, bench: 100, squat: 100 }, 2.5), unit: "lb", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(b.live!.status, "paused");
assert.equal(b.live!.lifts[0].max, "220.5 lb");
assert.equal(b.live!.lifts[0].tm, "198.4 lb");
assert.equal(b.live!.next, null);

// past its length the week reads as a round
const again = panelFrom({ enrolment: { id: 2, status: "active", template: sl, state: { ...state, cycle: 6 }, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(again.live!.weekLine, "Week 1 of 12, round 2");

// nothing live
assert.equal(panelFrom({ enrolment: null, plan: null, events: [], past: [] }).live, null);

console.log("programs/panel: ok");
