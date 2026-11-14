// app/src/lib/programs/templates/rts.ts
import { day, ex, fixed, maxTest, range, rpe, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx, WeekRx } from "../types";

/** One week's effort scheme: the top set's reps and RPE, then back-off sets at a lower RPE. */
interface Scheme {
  label: string;
  reps: number;
  top: number;
  backSets: number;
  backReps: number;
  back: number;
}

const SCHEMES: Scheme[] = [
  { label: "Volume", reps: 8, top: 7, backSets: 3, backReps: 8, back: 6.5 },
  { label: "Volume", reps: 8, top: 7.5, backSets: 3, backReps: 8, back: 7 },
  { label: "Volume", reps: 8, top: 8, backSets: 3, backReps: 8, back: 7.5 },
  { label: "Strength", reps: 5, top: 8, backSets: 3, backReps: 5, back: 7 },
  { label: "Strength", reps: 5, top: 8.5, backSets: 3, backReps: 5, back: 7.5 },
  { label: "Strength", reps: 5, top: 9, backSets: 3, backReps: 5, back: 8 },
  { label: "Peak", reps: 3, top: 9, backSets: 2, backReps: 3, back: 8 },
  { label: "Taper", reps: 1, top: 8, backSets: 2, backReps: 2, back: 7 },
];

const TOP_NOTE = "Top set first, then the back-off sets. Go by the effort: change the weight if a set feels harder or easier than its RPE.";
const sets = (s: Scheme, fewer = 0): SetRx[] => [rpe(s.top, s.reps, 240), ...times(Math.max(1, s.backSets - fewer), rpe(s.back, s.backReps, 180))];
const main = (name: string, lift: LiftKey, s: Scheme, fewer = 0, notes = TOP_NOTE): ExerciseRx => ex(name, sets(s, fewer), { lift, notes });

function W(s: Scheme): WeekRx {
  return week(
    [
      day("Squat and bench", [main("Back squat", "squat", s), main("Bench press", "bench", s), ex("Barbell row", times(3, fixed(range(8, 10), 120)), { progress: false })]),
      day("Deadlift and bench", [
        main("Deadlift", "deadlift", s, 1),
        main("Pause bench press", "bench", s, 1, "Pause for a second on the chest. Expect it a little lighter than your bench press."),
        ex("Pull-up", times(3, fixed(range(6, 10), 120)), { bodyweight: true }),
      ]),
      day("Squat variation and bench", [
        main("Pause squat", "squat", s, 1, "Pause for two seconds at the bottom. Expect it lighter than your squat."),
        main("Close-grip bench press", "bench", s, 1),
        ex("Romanian deadlift", times(3, fixed(range(8, 10), 120)), { progress: false }),
      ]),
    ],
    s.label,
  );
}

export const rtsStyle: ProgramTemplate = {
  key: "rts-style-rpe-block",
  name: "RTS-style RPE block",
  author: "After Mike Tuchscherer's Reactive Training Systems",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 3,
  lengthWeeks: 9,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Experienced lifters who can judge how many reps they have left in a set.",
  description:
    "Nine weeks, three days a week. Every main set has a target effort (RPE) instead of a fixed percentage: RPE 8 means you could do two more reps. Each lift has a top set, then back-off sets at a lower RPE. Three weeks of eights, three weeks of fives, a week of triples, a lighter week of singles, then a test of all three lifts. The app suggests weights from your max; you change them to match the effort. The RPE targets are ours.",
  warning: "Ends in a max test on three lifts. Use a spotter or safety bars.",
  summary: "Nine weeks of top sets and back-off sets by effort (RPE), from eights down to singles, ending in a test of all three lifts.",
  phases: [
    { name: "Volume", fromWeek: 1, toWeek: 3, note: "A top set of eight at RPE 7, 7.5, then 8, and three back-off sets of eight half a point to a point lower." },
    { name: "Strength", fromWeek: 4, toWeek: 6, note: "A top set of five at RPE 8, 8.5, then 9, and back-off sets of five one RPE lower." },
    { name: "Peak", fromWeek: 7, toWeek: 7, note: "A top triple at RPE 9 and two back-off triples at RPE 8." },
    { name: "Taper", fromWeek: 8, toWeek: 8, note: "A single at RPE 8 and two easy doubles, so you go into the test fresh." },
    { name: "Test", fromWeek: 9, toWeek: 9, note: "A max test of squat and bench on one day, then deadlift on another." },
  ],
  whyItWorks:
    "The weight follows how you are on the day: a good day goes heavier, a tired day lighter, at the same effort. The reps come down and the effort goes up across the block. The RPE targets are ours, in the shape of Reactive Training Systems' blocks.",
  engine: { key: "fixed_block" },
  weeks: [
    ...SCHEMES.map(W),
    week(
      [day("Squat and bench test", [maxTest("Back squat", "squat"), maxTest("Bench press", "bench")], true), day("Deadlift test", [maxTest("Deadlift", "deadlift")], true)],
      "Test",
    ),
  ],
};
