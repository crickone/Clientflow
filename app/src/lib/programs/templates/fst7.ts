// app/src/lib/programs/templates/fst7.ts
import { day, ex, rs, week } from "../dsl";
import type { ExerciseRx, ProgramTemplate } from "../types";

const FST_NOTE = "FST-7: seven sets with 30 to 45 seconds rest. Keep the weight; drop it if you can't reach 8 reps.";
/** The finisher: 7 sets of 8-12 on short rest. */
const fst = (name: string): ExerciseRx => ex(name, rs(7, 8, 12, 40), { notes: FST_NOTE });
const heavy = (name: string, sets = 4, min = 6, max = 10): ExerciseRx => ex(name, rs(sets, min, max, 150));
const mid = (name: string, sets = 3): ExerciseRx => ex(name, rs(sets, 8, 12, 90));

export const fst7Style: ProgramTemplate = {
  key: "fst-7-style",
  name: "FST-7-style",
  author: "After Hany Rambod's FST-7",
  family: "size",
  level: "intermediate",
  daysPerWeek: 5,
  lengthWeeks: 8,
  lifts: [],
  tmPct: 1,
  who: "Intermediate lifters training for muscle who like a hard finish to each session.",
  description:
    "Five days a week, one or two body parts a day: legs, chest, back and calves, shoulders, arms. Each body part gets three or four exercises of normal sets, then a finisher of seven sets of eight to twelve with only 30 to 45 seconds of rest. When every set of an exercise reaches the top of its range, the weight goes up by your smallest jump. The exercises and set counts are ours.",
  summary: "Five days a week, one or two body parts a day, each finishing with seven short-rest sets of one exercise.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick weights that let you reach the bottom of each range. On the seven-set finisher, pick a weight you can hold for all seven sets." },
    { name: "Build", fromWeek: 2, toWeek: 8, note: "Add reps each session. When every set reaches the top of its range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "The heavy sets come first, while you are fresh. The seven-set finisher packs a lot of work into a few minutes on one muscle. Each body part is trained once a week with plenty of sets. The exercises and set counts are ours, in the shape of FST-7.",
  engine: { key: "double_progression" },
  weeks: [
    week([
      day("Legs", [heavy("Back squat"), heavy("Romanian deadlift", 3, 8, 10), mid("Walking lunge"), mid("Lying leg curl"), fst("Leg extension")]),
      day("Chest", [heavy("Incline bench press"), heavy("Dumbbell bench press", 3, 8, 10), mid("Incline dumbbell fly"), fst("Pec deck")]),
      day("Back and calves", [heavy("Barbell row"), mid("Lat pulldown", 4), mid("Seated cable row"), fst("Close-grip lat pulldown"), fst("Leg press calf raise")]),
      day("Shoulders", [heavy("Seated dumbbell shoulder press"), mid("Upright row"), mid("Rear delt fly"), fst("Lateral raise")]),
      day("Arms", [heavy("Close-grip bench press", 3), mid("EZ-bar curl"), mid("Skull crusher"), mid("Hammer curl"), fst("Preacher curl"), fst("Triceps pushdown")]),
    ]),
  ],
};
