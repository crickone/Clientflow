// app/src/components/clientapp/home/homeModel.test.ts
// Run: npx tsx src/components/clientapp/home/homeModel.test.ts
//
// What Home decides before it draws anything: the greeting, the hero's state and its set chips, and which tiles have real data.
import assert from "node:assert/strict";

import { initState } from "@/lib/programs/engines";
import { planSession } from "@/lib/programs/planner";
import { wendlerBbb } from "@/lib/programs/templates/wendler";
import { clockLabel, greeting, heroChips, homeTiles, pickHero, dublinHour } from "./homeModel";

// greeting by hour, and a plain one without a name
assert.equal(greeting(6, "Chris"), "Morning, Chris");
assert.equal(greeting(13, "Chris"), "Afternoon, Chris");
assert.equal(greeting(20, "Chris"), "Evening, Chris");
assert.equal(greeting(3, "Chris"), "Evening, Chris", "the small hours are not morning");
assert.equal(greeting(6, null), "Good morning");
assert.equal(greeting(13, ""), "Good afternoon");
assert.equal(greeting(22, "  "), "Good evening");

// Dublin time: 23:30 UTC in July is already 00:30 the next day there
assert.equal(dublinHour(Date.UTC(2026, 6, 1, 23, 30)), 0);
assert.equal(dublinHour(Date.UTC(2026, 0, 1, 23, 30)), 23);

// clock times as Irish clocks read them
assert.equal(clockLabel("18:30"), "6:30pm");
assert.equal(clockLabel("06:05"), "6:05am");
assert.equal(clockLabel("18:00"), "6pm");
assert.equal(clockLabel("12:00"), "12pm");
assert.equal(clockLabel("00:15"), "12:15am");
assert.equal(clockLabel("soon"), "soon");

// the main lift's top sets as chips, from a real 5/3/1 session: week 1, deadlift day
const kg = (n: number) => String(n);
const state = { ...initState(wendlerBbb, { bench: 100, deadlift: 150, press: 60, squat: 120 }, 2.5), day: 1 };
const session = planSession(wendlerBbb, state, { stepKg: 2.5 })!;
assert.equal(session.dayName, "Deadlift day");
const chips = heroChips(session.exercises, kg);
assert.equal(session.exercises[0].name, "Deadlift");
assert.equal(chips.length, 3);
assert.deepEqual(
  chips.map((c) => c.plus),
  [false, false, true],
  "the last set is the + set",
);
assert.deepEqual(
  chips.map((c) => c.reps),
  ["5", "5", "5+"],
);
assert.equal(chips[0].kg, kg(session.exercises[0].sets[0].kg!), "the first chip is the first working set");

// only the last three weighted sets, and sets with no weight are skipped
const ex = (name: string, lift: "squat" | null, kgs: (number | null)[]) => ({
  index: 0,
  name,
  lift,
  tier: null,
  stateKey: name,
  bodyweight: false,
  progresses: false,
  joined: false,
  notes: null,
  sets: kgs.map((k) => ({ kg: k, reps: 8, repsMax: 10 as number | null, amrap: false, rpe: null, pct: null, rest: 60, drives: false })),
});
assert.deepEqual(
  heroChips([ex("Squat", "squat", [60, 70, 80, 90, null])], kg).map((c) => c.kg),
  ["70", "80", "90"],
);
assert.equal(heroChips([ex("Squat", "squat", [60, 70, 80, 90])], kg)[0].reps, "8-10", "a range of reps reads as a range");
// no lift: the first exercise with weights leads
assert.deepEqual(
  heroChips([ex("Plank", null, [null]), ex("Row", null, [40, 45])], kg).map((c) => c.kg),
  ["40", "45"],
);
// a lift beats an earlier exercise with weights
assert.deepEqual(
  heroChips([ex("Curl", null, [10]), ex("Squat", "squat", [100])], kg).map((c) => c.kg),
  ["100"],
);
// a bodyweight-only session has no chips
assert.deepEqual(heroChips([ex("Push-up", null, [null, null]), ex("Plank", null, [null])], kg), []);
assert.deepEqual(heroChips([], kg), []);
// a drives set is a + set too
const drives = ex("Squat", "squat", [100]);
drives.sets[0].drives = true;
drives.sets[0].repsMax = null;
drives.sets[0].reps = 5;
assert.deepEqual(heroChips([drives], kg), [{ kg: "100", reps: "5+", plus: true }]);

// the hero state for each member case
const planDay = { dayName: "Press day", weekLabel: "Week 1 of 12", chips, today: true };
const none = { open: null, program: null, next: null, programsVisible: true };
const cases = [
  { name: "program, a training day", in: { ...none, program: { plan: planDay, inProgress: false } }, want: { kind: "program", eyebrow: "Today · Week 1 of 12", title: "Press day", action: "start" } },
  { name: "program, a rest day", in: { ...none, program: { plan: { ...planDay, today: false }, inProgress: false } }, want: { kind: "program", eyebrow: "Next up · Week 1 of 12", title: "Press day", action: "start" } },
  { name: "program session open", in: { ...none, program: { plan: planDay, inProgress: true } }, want: { kind: "program", eyebrow: "Today · Week 1 of 12", title: "Press day", action: "continue" } },
  { name: "block done", in: { ...none, program: { plan: null, inProgress: false } }, want: { kind: "block_done", title: "Block done" } },
  { name: "coach plan", in: { ...none, next: { programId: 4, dayPosition: 2, dayName: "Legs" } }, want: { kind: "plan", title: "Legs", programId: 4, dayPosition: 2 } },
  { name: "open workout", in: { ...none, open: { id: 9, dayName: "Legs" } }, want: { kind: "open", title: "Legs", sessionId: 9 } },
  { name: "open workout beats a program start", in: { ...none, open: { id: 9, dayName: "Legs" }, program: { plan: planDay, inProgress: false } }, want: { kind: "open", title: "Legs", sessionId: 9 } },
  { name: "program beats a coach plan", in: { ...none, program: { plan: planDay, inProgress: false }, next: { programId: 4, dayPosition: 2, dayName: "Legs" } }, want: { kind: "program" } },
  { name: "nothing, programs on", in: none, want: { kind: "empty", programsVisible: true } },
  { name: "paused program, nothing else: no hero", in: { ...none, paused: true }, want: null },
  { name: "paused program with a coach plan still shows the plan", in: { ...none, paused: true, next: { programId: 4, dayPosition: 2, dayName: "Legs" } }, want: { kind: "plan" } },
  { name: "nothing, programs off", in: { ...none, programsVisible: false }, want: { kind: "empty", programsVisible: false } },
] as const;
for (const c of cases) {
  const got = pickHero(c.in);
  if (c.want === null) {
    assert.equal(got, null, c.name);
    continue;
  }
  assert.ok(got, c.name);
  assert.equal(got.kind, c.want.kind, c.name);
  for (const [k, v] of Object.entries(c.want)) assert.deepEqual((got as unknown as Record<string, unknown>)[k], v, `${c.name}: ${k}`);
}
const programHero = pickHero({ ...none, program: { plan: planDay, inProgress: false } });
assert.ok(programHero && programHero.kind === "program" && programHero.chips.length === 3, "the program hero carries its chips");

// tiles: only real data, in order, never a zero
const all = { protein: { got: 92, target: 160 }, habits: { done: 2, total: 3 }, week: { done: 1, planned: 4 }, streak: 3, nextClass: "Wed 6:30pm" };
const tiles = homeTiles(all);
assert.deepEqual(
  tiles.map((t) => t.key),
  ["protein", "habits", "week", "streak", "class"],
);
assert.equal(tiles[0].value, "92 / 160 g");
assert.equal(tiles[0].pct, 92 / 160);
assert.equal(tiles[1].value, "2 of 3");
assert.equal(tiles[1].pct, 2 / 3);
assert.equal(tiles[2].value, "1 of 4");
assert.equal(tiles[2].pct, 0.25);
assert.equal(tiles[3].value, "3 weeks");
assert.equal(tiles[3].pct, null);
assert.equal(tiles[4].value, "Wed 6:30pm");
assert.equal(tiles[4].pct, null);
assert.equal(homeTiles({ ...all, streak: 1 }).find((t) => t.key === "streak")?.value, "1 week");
assert.equal(homeTiles({ ...all, protein: { got: 200, target: 160 } })[0].pct, 1, "the bar stops at full");
assert.ok(!homeTiles({ ...all, protein: { got: 0, target: 160 } }).some((t) => t.key === "protein"), "nothing logged today, no protein tile");
assert.ok(!homeTiles({ ...all, streak: 0 }).some((t) => t.key === "streak"), "no zero streak");
assert.ok(!homeTiles({ ...all, protein: { got: 50, target: 0 } }).some((t) => t.key === "protein"), "no target, no protein tile");
assert.ok(!homeTiles({ ...all, protein: { got: 50, target: null } }).some((t) => t.key === "protein"));
assert.ok(!homeTiles({ ...all, week: { done: 0, planned: 0 } }).some((t) => t.key === "week"), "nothing planned, no week tile");
assert.ok(!homeTiles({ ...all, week: { done: 0, planned: 4 } }).some((t) => t.key === "week"), "nothing done yet, no week tile");
assert.ok(!homeTiles({ ...all, habits: { done: 0, total: 0 } }).some((t) => t.key === "habits"));
assert.ok(homeTiles({ ...all, habits: { done: 0, total: 3 } }).some((t) => t.key === "habits"), "0 of 3 is a count of habits to do");
assert.ok(!homeTiles({ ...all, nextClass: null }).some((t) => t.key === "class"));
assert.deepEqual(homeTiles({ protein: null, habits: null, week: null, streak: 0, nextClass: null }), []);

console.log("home model: ok");
