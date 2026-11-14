// app/src/lib/programs/templates/conjugate.ts
import { day, ex, fixed, pct, range, rpe, times, week } from "../dsl";
import type { ProgramTemplate, SetRx, WeekRx } from "../types";

/** The max-effort lift for each week, lower and upper. It changes every week. */
const LOWER_ME = ["Box squat", "Rack pull", "Good morning", "Front squat", "Deficit deadlift", "Pause squat", "Sumo deadlift", "Box squat", "Rack pull"];
const UPPER_ME = ["Floor press", "Pin press", "Close-grip bench press", "Incline bench press", "Floor press", "Pin press", "Close-grip bench press", "Incline bench press", "Pause bench press"];
/** Speed work, as a fraction of your max, in three-week waves. */
const SPEED = [0.5, 0.55, 0.6];

const ME_NOTE = "Max effort: work up in sets of three, then singles, to a heavy single you could just about do once more. Log the heaviest single. The lift changes each week.";
const SPEED_NOTE = "Move the bar as fast as you can. Westside adds bands or chains; the app logs the bar weight only.";
const rr = (n: number, min: number, max: number, rest = 90): SetRx[] => times(n, fixed(range(min, max), rest));

function W(i: number): WeekRx {
  const s = SPEED[i % 3];
  return week(
    [
      day("Max effort lower", [
        ex(LOWER_ME[i], [rpe(9, 1, 300)], { notes: ME_NOTE }),
        ex("Romanian deadlift", rr(3, 8, 10, 120)),
        ex("Back extension", rr(3, 10, 15, 60), { bodyweight: true }),
        ex("Hanging leg raise", rr(3, 10, 15, 60), { bodyweight: true }),
      ]),
      day("Max effort upper", [
        ex(UPPER_ME[i], [rpe(9, 1, 300)], { notes: ME_NOTE }),
        ex("Skull crusher", rr(4, 8, 12)),
        ex("Dumbbell row", rr(4, 8, 12)),
        ex("Face pull", rr(3, 12, 15, 60)),
      ]),
      day("Speed lower", [
        ex("Box squat", times(i % 3 === 2 ? 8 : 10, pct(s, 2, 60)), { lift: "squat", notes: SPEED_NOTE }),
        ex("Deadlift", times(6, pct(Math.round((s + 0.1) * 100) / 100, 1, 60)), { lift: "deadlift", notes: SPEED_NOTE }),
        ex("Walking lunge", rr(3, 10, 12)),
        ex("Lying leg curl", rr(3, 10, 15, 60)),
        ex("Cable crunch", rr(3, 12, 15, 60)),
      ]),
      day("Speed upper", [
        ex("Bench press", times(9, pct(s, 3, 60)), { lift: "bench", notes: SPEED_NOTE }),
        ex("Dumbbell bench press", rr(3, 10, 12)),
        ex("Lat pulldown", rr(4, 10, 12)),
        ex("Triceps pushdown", rr(3, 12, 15, 60)),
      ]),
    ],
    `Wave ${Math.floor(i / 3) + 1}, speed at ${Math.round(s * 100)}%`,
  );
}

export const conjugateStyle: ProgramTemplate = {
  key: "westside-style-conjugate",
  name: "Westside-style conjugate",
  author: "After Louie Simmons's Westside Barbell conjugate method",
  family: "strength",
  level: "advanced",
  daysPerWeek: 4,
  lengthWeeks: 9,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Experienced lifters who want to train heavy every week without peaking.",
  description:
    "Four days a week: a max-effort day and a speed day for the lower body, and the same for the upper body. On max-effort days you work up to a heavy single on a different lift each week, such as a box squat, rack pull or floor press. On speed days you lift a light weight as fast as you can: box squats, deadlift singles and bench triples at 50% to 70% of your max, rising over three-week waves. Each day finishes with accessory work for the muscles that move the main lifts. The lifts, percentages and RPE are ours.",
  warning: "Max-effort days are heavy every week. Use a spotter or safety bars.",
  summary: "A heavy single on a new lift each week, plus speed days at light weights, for the squat, bench and deadlift.",
  phases: [
    { name: "Wave 1", fromWeek: 1, toWeek: 3, note: "Speed work at 50%, 55%, then 60% of your max. Max effort: box squat, rack pull and good morning, with floor press, pin press and close-grip bench." },
    { name: "Wave 2", fromWeek: 4, toWeek: 6, note: "Speed work starts again at 50%. Max effort: front squat, deficit deadlift and pause squat, with incline bench, floor press and pin press." },
    { name: "Wave 3", fromWeek: 7, toWeek: 9, note: "Speed work from 50% again. Max effort: sumo deadlift, box squat and rack pull, with close-grip, incline and pause bench." },
  ],
  whyItWorks:
    "Changing the heavy lift every week lets you train close to your max without doing the same lift heavy over and over. The speed days add practice at the main lifts at weights that are easy to recover from. Accessory work covers the muscles the lifts depend on. The lifts, percentages and RPE are ours.",
  engine: { key: "double_progression" },
  weeks: LOWER_ME.map((_, i) => W(i)),
};
