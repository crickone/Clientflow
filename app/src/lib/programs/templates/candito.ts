// app/src/lib/programs/templates/candito.ts
import { day, ex, fixed, maxTest, pct, range, sxr, times, week } from "../dsl";
import type { ProgramTemplate, SetRx, WeekRx } from "../types";

const sq = (sets: SetRx[]) => ex("Back squat", sets, { lift: "squat" });
const dl = (sets: SetRx[]) => ex("Deadlift", sets, { lift: "deadlift" });
const bp = (sets: SetRx[]) => ex("Bench press", sets, { lift: "bench" });
const row = () => ex("Barbell row", times(4, fixed(range(6, 10), 120)), { progress: false });
const pull = () => ex("Pull-up", times(3, fixed(range(6, 10), 120)), { bodyweight: true });

function W(label: string, l1sq: SetRx[], l1dl: SetRx[], u1: SetRx[], l2sq: SetRx[], l2dl: SetRx[], u2: SetRx[]): WeekRx {
  return week(
    [day("Lower 1", [sq(l1sq), dl(l1dl)]), day("Upper 1", [bp(u1), row()]), day("Lower 2", [sq(l2sq), dl(l2dl)]), day("Upper 2", [bp(u2), pull()])],
    label,
  );
}

export const canditoStyle: ProgramTemplate = {
  key: "candito-style-6-week",
  name: "Candito-style 6-week",
  author: "After Jonnie Candito's 6 Week Strength Program",
  family: "peaking",
  level: "intermediate",
  daysPerWeek: 4,
  lengthWeeks: 6,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Intermediate lifters peaking the squat, bench and deadlift together.",
  description:
    "Six weeks that move from higher reps to singles, four days a week on an upper and lower split. Two weeks of sets of six to eight, a strength week of fours and fives, a heavy week of twos and threes, a peak week of doubles and singles, then a test of all three lifts. The percentages are ours, in the shape of Candito's program.",
  warning: "Ends in a max test on three lifts. Use a spotter or safety bars.",
  engine: { key: "fixed_block" },
  weeks: [
    W("Conditioning", sxr(4, 6, 0.7), sxr(2, 6, 0.65), sxr(4, 6, 0.7), sxr(3, 8, 0.65), sxr(2, 8, 0.6), sxr(3, 8, 0.65)),
    W("Conditioning", sxr(4, 6, 0.725), sxr(2, 6, 0.675), sxr(4, 6, 0.725), sxr(3, 8, 0.675), sxr(2, 8, 0.625), sxr(3, 8, 0.675)),
    W("Strength", sxr(4, 4, 0.8), sxr(3, 4, 0.775), sxr(4, 4, 0.8), sxr(3, 5, 0.775), sxr(2, 5, 0.75), sxr(3, 5, 0.775)),
    W("Heavy", sxr(3, 3, 0.85), sxr(2, 3, 0.825), sxr(3, 3, 0.85), sxr(3, 2, 0.875), sxr(2, 2, 0.85), sxr(3, 2, 0.875)),
    W("Peak", [...sxr(2, 2, 0.9), pct(0.95, 1, 240)], sxr(1, 2, 0.9), [...sxr(2, 2, 0.9), pct(0.95, 1, 240)], sxr(2, 1, 0.925), sxr(1, 1, 0.925), sxr(2, 1, 0.925)),
    week(
      [day("Squat and bench test", [maxTest("Back squat", "squat"), maxTest("Bench press", "bench")], true), day("Deadlift test", [maxTest("Deadlift", "deadlift")], true)],
      "Test",
    ),
  ],
};
