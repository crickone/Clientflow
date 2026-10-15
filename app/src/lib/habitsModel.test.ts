// Run: npm test -- src/lib/habitsModel.test.ts
import assert from "node:assert/strict";

import { completionByDay, completionRate, lastDays, perHabit, streak } from "./habitsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const habits = [
  { id: 1, label: "Drink 2L water" },
  { id: 2, label: "Walk 10,000 steps" },
];
const ticks = [
  { habitId: 1, day: "2026-10-13" },
  { habitId: 2, day: "2026-10-13" },
  { habitId: 1, day: "2026-10-14" },
  { habitId: 2, day: "2026-10-14" },
  { habitId: 1, day: "2026-10-15" },
  { habitId: 9, day: "2026-10-15" }, // a habit that was since removed from the form
];

check("completion per day counts only current habits", completionByDay(habits, ticks, ["2026-10-14", "2026-10-15"]).map((r) => r.done).join() === "2,1");
check("today half done: the streak counts back from yesterday", streak(habits, ticks, "2026-10-15") === 2);
check("today all done: today counts", streak(habits, [...ticks, { habitId: 2, day: "2026-10-15" }], "2026-10-15") === 3);
check("a missed day breaks it", streak(habits, ticks.filter((t) => t.day !== "2026-10-14"), "2026-10-15") === 0);
check("no habits, no streak", streak([], ticks, "2026-10-15") === 0);
check("a duplicate tick doesn't count twice", streak(habits, [...ticks, { habitId: 1, day: "2026-10-15" }], "2026-10-15") === 2);
check("last days end today, oldest first", lastDays("2026-10-15", 3).join() === "2026-10-13,2026-10-14,2026-10-15");
check("completion rate over a period", completionRate(habits, ticks, ["2026-10-13", "2026-10-14", "2026-10-15"]) === 83);
check("no days is 0%", completionRate(habits, ticks, []) === 0);
const ph = perHabit(habits, ticks, ["2026-10-13", "2026-10-14", "2026-10-15"]);
check("per habit, best first", ph[0].habit.id === 1 && ph[0].days === 3 && ph[1].days === 2 && ph[1].of === 3);

console.log(`habitsModel: ${passed} checks passed`);
