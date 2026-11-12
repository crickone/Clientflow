// app/src/lib/programs/templates/texas.ts
import { day, ex, fixed, pct, range, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate } from "../types";

/** n x reps at a percentage of the 5-rep max; `drives` marks a top set that raises it. */
const T = (name: string, lift: LiftKey, n: number, reps: number, p: number, drives = false, rest = 180): ExerciseRx =>
  ex(name, times(n, pct(p, reps, rest, drives ? { drives: true } : {})), { lift });
const chins = () => ex("Chin-up", times(3, fixed(range(5, 10), 120)), { bodyweight: true });
const backExt = () => ex("Back extension", times(3, fixed(10, 90)), { bodyweight: true });

export const texasMethod: ProgramTemplate = {
  key: "texas-method",
  name: "Texas Method",
  author: "Texas Method, from Glenn Pendlay, as written up by Mark Rippetoe",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["squat", "bench", "press", "deadlift"],
  // The training max is your 5-rep max, estimated from your max with Epley: max / (1 + 5/30).
  tmPct: 6 / 7,
  who: "Lifters who have outgrown a beginner program and now progress week to week.",
  description:
    "Three days a week. Monday is volume: 5 sets of 5 at 90% of your 5-rep max. Wednesday is light: 2 sets of 5 squats at 80% of Monday's weight. Friday is intensity: a new 5-rep max. Bench and press swap each week. When you get all five reps on a top set, that lift goes up 2.5 kg, or 5 kg on the deadlift.",
  warning: "A new 5-rep max every week. Expect to stall and change the plan within a few months.",
  summary: "Three days a week: a volume day, a light day, and an intensity day with a top set of five.",
  phases: [
    { name: "Bench week", fromWeek: 1, toWeek: 1, note: "Squat and bench on the volume and intensity days, press on the light day. Deadlift on the volume day." },
    { name: "Press week", fromWeek: 2, toWeek: 2, note: "Squat and press on the volume and intensity days, bench on the light day. Deadlift on the volume day." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "The volume day does the hard work, the light day keeps you moving while you recover, and the intensity day shows where you are. The volume sets are 90% of your 5-rep max. Each top set of five you finish raises that lift for the next week.",
  engine: { key: "tm_cycle", rule: "drive_set", increment: 2.5, increments: { deadlift: 5 } },
  weeks: [
    week(
      [
        day("Volume day", [T("Back squat", "squat", 5, 5, 0.9), T("Bench press", "bench", 5, 5, 0.9), T("Deadlift", "deadlift", 1, 5, 1, true, 300)]),
        day("Recovery day", [T("Back squat", "squat", 2, 5, 0.72), T("Overhead press", "press", 3, 5, 0.8), chins(), backExt()]),
        day("Intensity day", [T("Back squat", "squat", 1, 5, 1, true, 300), T("Bench press", "bench", 1, 5, 1, true, 300), chins()]),
      ],
      "Bench week",
    ),
    week(
      [
        day("Volume day", [T("Back squat", "squat", 5, 5, 0.9), T("Overhead press", "press", 5, 5, 0.9), T("Deadlift", "deadlift", 1, 5, 1, true, 300)]),
        day("Recovery day", [T("Back squat", "squat", 2, 5, 0.72), T("Bench press", "bench", 3, 5, 0.8), chins(), backExt()]),
        day("Intensity day", [T("Back squat", "squat", 1, 5, 1, true, 300), T("Overhead press", "press", 1, 5, 1, true, 300), chins()]),
      ],
      "Press week",
    ),
  ],
};
