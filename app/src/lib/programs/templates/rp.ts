// app/src/lib/programs/templates/rp.ts
import { day, ex, rs, week } from "../dsl";
import type { DayRx, ExerciseRx, ProgramTemplate, WeekRx } from "../types";

/** An exercise in the block: compound or isolation, with its rep range and rest. */
type Slot = { name: string; kind: "compound" | "isolation"; min: number; max: number; rest: number };
const c = (name: string, min: number, max: number, rest = 150): Slot => ({ name, kind: "compound", min, max, rest });
const i = (name: string, min: number, max: number, rest = 75): Slot => ({ name, kind: "isolation", min, max, rest });

const DAYS: { name: string; slots: Slot[] }[] = [
  { name: "Push", slots: [c("Bench press", 8, 12), c("Incline dumbbell press", 8, 12), c("Seated dumbbell shoulder press", 8, 12), i("Lateral raise", 12, 15), i("Triceps pushdown", 10, 15)] },
  { name: "Pull", slots: [c("Chest-supported row", 8, 12), c("Lat pulldown", 8, 12), i("Rear delt fly", 12, 15), i("EZ-bar curl", 10, 12), i("Hammer curl", 10, 15)] },
  { name: "Legs", slots: [c("Back squat", 6, 10, 180), c("Romanian deadlift", 8, 10, 150), i("Leg extension", 12, 15), i("Seated leg curl", 10, 15), i("Standing calf raise", 10, 15)] },
  { name: "Upper", slots: [c("Incline bench press", 8, 12), c("Close-grip lat pulldown", 8, 12), i("Pec deck", 12, 15), i("Lateral raise", 12, 15), i("Overhead triceps extension", 10, 15), i("Incline dumbbell curl", 10, 12)] },
  { name: "Lower", slots: [c("Hack squat", 8, 12), c("Hip thrust", 8, 12), i("Lying leg curl", 10, 15), i("Walking lunge", 10, 12), i("Seated calf raise", 12, 15)] },
];

/** Sets per week for compounds and isolations, and the reps in reserve. Week 6 is the deload. */
const WEEKS: { label: string; compound: number; isolation: number; note: string }[] = [
  { label: "3 reps in reserve", compound: 3, isolation: 2, note: "Stop each set with about 3 reps left." },
  { label: "2 reps in reserve", compound: 3, isolation: 3, note: "Stop each set with about 2 reps left." },
  { label: "2 reps in reserve", compound: 4, isolation: 3, note: "Stop each set with about 2 reps left." },
  { label: "1 rep in reserve", compound: 4, isolation: 4, note: "Stop each set with about 1 rep left." },
  { label: "0 to 1 reps in reserve", compound: 5, isolation: 4, note: "Take the last set of each exercise to failure, with good form." },
];
const DELOAD_NOTE = "Deload: half the sets. Use the same weight or a little lighter, and stop well short of failure.";

const exercise = (s: Slot, sets: number, notes: string, deload = false): ExerciseRx =>
  ex(s.name, rs(sets, s.min, s.max, s.rest), { notes, ...(deload ? { progress: false } : {}) });

function W(w: (typeof WEEKS)[number]): WeekRx {
  return week(
    DAYS.map((d): DayRx => day(d.name, d.slots.map((s) => exercise(s, s.kind === "compound" ? w.compound : w.isolation, w.note)))),
    w.label,
  );
}

const deload = week(
  DAYS.map((d) => day(d.name, d.slots.map((s) => exercise(s, 2, DELOAD_NOTE, true)))),
  "Deload",
);

export const rpStyle: ProgramTemplate = {
  key: "rp-style-hypertrophy-block",
  name: "RP-style hypertrophy block",
  author: "After Renaissance Periodization's hypertrophy training",
  family: "size",
  level: "intermediate",
  daysPerWeek: 5,
  lengthWeeks: 6,
  lifts: [],
  tmPct: 1,
  who: "Intermediate lifters training for muscle who can judge how close a set is to failure.",
  description:
    "Six weeks, five days a week: push, pull, legs, upper and lower. Each week adds sets, and each set finishes closer to failure: about 3 reps left in week 1, down to the last set taken to failure in week 5. Week 6 is a deload with half the sets. Every exercise has a rep range; when every set reaches the top of it, the weight goes up by your smallest jump. Start the block again after the deload. The set counts and targets are ours.",
  summary: "Six weeks on five days a week. Sets go up and each set gets closer to failure, then a deload week.",
  phases: [
    { name: "Build", fromWeek: 1, toWeek: 5, note: "Three sets of each compound and two or three of each isolation to start, rising to five and four. Reps in reserve go from 3 down to 0 on the last set." },
    { name: "Deload", fromWeek: 6, toWeek: 6, note: "Two sets of everything, well short of failure, so fatigue drops before the next block." },
  ],
  whyItWorks:
    "Volume and effort both rise across the block, so each week asks a little more of the muscle than the last. The deload lets the fatigue that builds up drop before the next block starts. The set counts and targets are ours, in the shape of Renaissance Periodization's blocks.",
  engine: { key: "double_progression" },
  weeks: [...WEEKS.map(W), deload],
};
