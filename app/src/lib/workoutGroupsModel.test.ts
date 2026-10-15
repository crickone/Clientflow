// Run: npm test -- src/lib/workoutGroupsModel.test.ts
import assert from "node:assert/strict";

import { groupLabels, groupName, groupSize, nextWeight, repRange, restsAfter, searchExercises, searchWords } from "./workoutGroupsModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// ── groups ──
const rows = [{}, { joined: true }, {}, {}, { joined: true }, { joined: true }];
check("labels: superset, single, circuit", groupLabels(rows).join() === "A1,A2,B,C1,C2,C3");
check("no joins: plain letters", groupLabels([{}, {}, {}]).join() === "A,B,C");
check("a joined first row is just a group of one", groupLabels([{ joined: true }, {}]).join() === "A,B");
check("group size", groupSize(rows, 0) === 2 && groupSize(rows, 2) === 1 && groupSize(rows, 4) === 3);
check("rest only after the last in a group", !restsAfter(rows, 0) && restsAfter(rows, 1) && restsAfter(rows, 2) && !restsAfter(rows, 3) && restsAfter(rows, 5));
check("names", groupName(2) === "Superset" && groupName(3) === "Circuit" && groupName(1) === null);

// ── next weight ──
check("rep ranges", repRange("8-12")?.max === 12 && repRange("10")?.min === 10 && repRange("8 to 10")?.max === 10 && repRange("AMRAP") === null && repRange("40 seconds") === null);
const hit = [
  { weightKg: 60, reps: 12, done: true },
  { weightKg: 60, reps: 12, done: true },
  { weightKg: 60, reps: 12, done: true },
];
check("every set at the top of the range: up 2.5 kg", nextWeight(hit, "8-12")?.weightKg === 62.5 && nextWeight(hit, "8-12")?.change === "up");
check("light weights go up 1 kg", nextWeight([{ weightKg: 12, reps: 12, done: true }], "12")?.weightKg === 13);
const missed = [
  { weightKg: 60, reps: 12, done: true },
  { weightKg: 60, reps: 9, done: true },
];
check("a set short of the top: same weight, aim for the reps", nextWeight(missed, "8-12")?.weightKg === 60 && nextWeight(missed, "8-12")?.change === "same");
check("nothing done or no weights: no suggestion", nextWeight([{ weightKg: null, reps: 10, done: true }], "10") === null && nextWeight(hit, "AMRAP") === null);
check("undone sets are ignored", nextWeight([...hit, { weightKg: 60, reps: 3, done: false }], "12")?.change === "up");

// ── search ──
const lib = [
  { name: "Dumbbell Bench Press", equipment: "Dumbbell", muscleGroups: ["Chest"] },
  { name: "Barbell Bench Press", equipment: "Barbell", muscleGroups: ["Chest"] },
  { name: "Romanian Deadlift", equipment: "Barbell", muscleGroups: ["Hamstrings"] },
  { name: "Pull-Up", equipment: "Bodyweight", muscleGroups: ["Lats"] },
  { name: "Lat Pulldown", equipment: "Cable", muscleGroups: ["Lats"] },
  { name: "Overhead Press", equipment: "Barbell", muscleGroups: ["Shoulders"] },
];
check("shorthand expands", searchWords("DB rdls").join(" ") === "dumbbell romanian deadlift");
check("'db bench' finds the dumbbell bench", searchExercises(lib, "db bench")[0].name === "Dumbbell Bench Press");
check("'rdl' finds the Romanian deadlift", searchExercises(lib, "rdl")[0].name === "Romanian Deadlift");
check("'pullup' and 'pull ups' find the pull-up", searchExercises(lib, "pullup")[0].name === "Pull-Up" && searchExercises(lib, "pull ups")[0].name === "Pull-Up");
check("'ohp' finds the overhead press", searchExercises(lib, "ohp")[0].name === "Overhead Press");
check("a muscle finds its exercises", searchExercises(lib, "lats").length === 2);
check("'pulldown' finds lat pulldown", searchExercises(lib, "pulldown")[0].name === "Lat Pulldown");
check("nothing typed, nothing found", searchExercises(lib, "  ").length === 0);

console.log(`workoutGroupsModel: ${passed} checks passed`);
