// app/src/lib/programs/templates/rsr.ts
import { MAX_TEST_NOTE, day, ex, pct, sxr, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const sq = (n: number, reps: number, p: number) => ex("Back squat", sxr(n, reps, p), { lift: "squat" });
const three = (a: ReturnType<typeof sq>, b: ReturnType<typeof sq>, c: ReturnType<typeof sq>) => [day("Day 1", [a]), day("Day 2", [b]), day("Day 3", [c])];

export const russianSquatRoutine: ProgramTemplate = {
  key: "russian-squat-routine",
  name: "Russian Squat Routine",
  author: "Russian Squat Routine, a Soviet-era squat cycle",
  family: "peaking",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 6,
  lifts: ["squat"],
  tmPct: 1,
  who: "Lifters who want to raise their squat over six weeks without daily heavy singles.",
  description:
    "Six weeks of squats three times a week, almost all at 80% of your max. For three weeks the sets stay at six while the reps climb from two to six on alternate days. Then the weight climbs to 85%, 90%, 95% and 100% while the sets drop. The last session is a single at 105%, your new max.",
  warning: "Squats three times a week for six weeks with no easy weeks. Keep other leg work light.",
  engine: { key: "fixed_block" },
  weeks: [
    week(three(sq(6, 2, 0.8), sq(6, 3, 0.8), sq(6, 2, 0.8))),
    week(three(sq(6, 4, 0.8), sq(6, 2, 0.8), sq(6, 5, 0.8))),
    week(three(sq(6, 2, 0.8), sq(6, 6, 0.8), sq(6, 2, 0.8))),
    week(three(sq(5, 5, 0.85), sq(6, 2, 0.8), sq(4, 4, 0.9))),
    week(three(sq(6, 2, 0.8), sq(3, 3, 0.95), sq(6, 2, 0.8))),
    week(
      [
        day("Day 1", [sq(2, 2, 1.0)]),
        day("Day 2", [sq(6, 2, 0.8)]),
        day("Day 3: new max", [ex("Back squat", [pct(0.5, 5, 120), pct(0.7, 3, 150), pct(0.85, 1, 180), pct(0.95, 1, 240), pct(1.05, 1, 300)], { lift: "squat", notes: MAX_TEST_NOTE })], true),
      ],
      "Test",
    ),
  ],
};
