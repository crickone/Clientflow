// app/src/lib/programs/templates/gvt.ts
import { day, ex, fixed, rs, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const TEMPO = "Lower for four seconds, lift in two. Rest 90 seconds, then do the paired exercise.";
const tens = () => times(10, fixed(10, 90));

const chestBack = day("Chest and back", [
  ex("Bench press", tens(), { lift: "bench", notes: TEMPO }),
  ex("Chin-up", tens(), { bodyweight: true, joined: true }),
  ex("Incline dumbbell fly", rs(3, 10, 12, 60), { progress: false }),
  ex("Dumbbell row", rs(3, 10, 12, 60), { progress: false, joined: true }),
]);
const legs = day("Legs", [
  ex("Back squat", tens(), { lift: "squat", notes: TEMPO }),
  ex("Lying leg curl", tens(), { joined: true }),
  ex("Cable crunch", rs(3, 12, 15, 60), { progress: false }),
  ex("Seated calf raise", rs(3, 15, 20, 60), { progress: false, joined: true }),
]);
const armsShoulders = day("Arms and shoulders", [
  ex("Dip", tens(), { bodyweight: true, notes: TEMPO }),
  ex("Hammer curl", tens(), { joined: true }),
  ex("Rear delt fly", rs(3, 10, 12, 60), { progress: false }),
  ex("Lateral raise", rs(3, 10, 12, 60), { progress: false, joined: true }),
]);

export const germanVolumeTraining: ProgramTemplate = {
  key: "german-volume-training",
  name: "German Volume Training",
  author: "German Volume Training, popularised by Charles Poliquin",
  family: "size",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 6,
  lifts: ["bench", "squat"],
  tmPct: 1,
  who: "Lifters who want size and can set heavy strength work aside for six weeks.",
  description:
    "Ten sets of ten on one big lift per session, done back to back with a second exercise, at 60% of your max with 90 seconds of rest. Once you get all 100 reps, the weight goes up 2.5 kg next time. Three sessions a week: chest and back, legs, then arms and shoulders, each finished with two lighter exercises.",
  warning: "Very high volume. Expect to be sore for days after the first sessions.",
  engine: { key: "fixed_volume", increment: 2.5, startPct: 0.6 },
  weeks: [week([chestBack, legs, armsShoulders])],
};
