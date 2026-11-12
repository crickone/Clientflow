// app/src/lib/programs/templates/smolov.ts
import { day, ex, maxTest, sxr, week } from "../dsl";
import type { LiftKey, ProgramTemplate, WeekRx } from "../types";

function baseWeek(addKg: number, label: string): WeekRx {
  const sq = (n: number, reps: number, p: number) => ex("Back squat", sxr(n, reps, p, 180, addKg), { lift: "squat" });
  return week([day("Day 1", [sq(4, 9, 0.7)]), day("Day 2", [sq(5, 7, 0.75)]), day("Day 3", [sq(7, 5, 0.8)]), day("Day 4", [sq(10, 3, 0.85)])], label);
}

export const smolovBase: ProgramTemplate = {
  key: "smolov-base",
  name: "Smolov base mesocycle",
  author: "Smolov by Sergey Smolov",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 4,
  lengthWeeks: 4,
  lifts: ["squat"],
  tmPct: 1,
  who: "Experienced squatters who want a big jump in their squat max.",
  description:
    "The base block of Smolov's squat program. Four squat sessions a week for three weeks: 4 x 9 at 70%, 5 x 7 at 75%, 7 x 5 at 80% and 10 x 3 at 85% of your max. Week two adds 10 kg over week one and week three adds 15 kg over week one. Week four is a test of your new max.",
  warning: "Squats four days a week at high volume. Only for lifters with a year or more of steady squatting.",
  summary: "Four squat sessions a week for three weeks, each week heavier than the last, then a test of your new max.",
  phases: [
    { name: "Base", fromWeek: 1, toWeek: 1, note: "4 x 9, 5 x 7, 7 x 5 and 10 x 3 at 70% to 85% of your max. Hard, with a lot of reps." },
    { name: "Plus 10 kg", fromWeek: 2, toWeek: 2, note: "The same four sessions with 10 kg more on every set. Sleep and eat well." },
    { name: "Plus 15 kg", fromWeek: 3, toWeek: 3, note: "The same sessions with 15 kg more than week 1. The hardest week." },
    { name: "Test", fromWeek: 4, toWeek: 4, note: "One session: work up to a new 1-rep max with a spotter or safety bars." },
  ],
  whyItWorks:
    "The same four sessions repeat for three weeks while the weight climbs, so you squat a lot of reps at 70% to 85% of your max. Fixed jumps of 10 kg and 15 kg make each week harder than the last. The test week reads your new max from your best set.",
  engine: { key: "fixed_block" },
  weeks: [baseWeek(0, "Base"), baseWeek(10, "Base, plus 10 kg"), baseWeek(15, "Base, plus 15 kg"), week([day("Test day", [maxTest("Back squat", "squat")], true)], "Test")],
};

function jrWeek(name: string, lift: LiftKey, addKg: number, label: string): WeekRx {
  const e = (n: number, reps: number, p: number) => ex(name, sxr(n, reps, p, 180, addKg), { lift });
  return week([day("Day 1", [e(6, 6, 0.7)]), day("Day 2", [e(7, 5, 0.75)]), day("Day 3", [e(8, 4, 0.8)]), day("Day 4", [e(10, 3, 0.85)])], label);
}

function smolovJr(lift: LiftKey, name: string, key: string, title: string, adds: [number, number]): ProgramTemplate {
  return {
    key,
    name: title,
    author: "Smolov Jr, adapted from Sergey Smolov's program",
    family: "peaking",
    level: "intermediate",
    daysPerWeek: 4,
    lengthWeeks: 4,
    lifts: [lift],
    tmPct: 1,
    who: `Lifters who want a quick jump in their ${name.toLowerCase()} max.`,
    description: `A three-week block on one lift, four sessions a week: 6 x 6 at 70%, 7 x 5 at 75%, 8 x 4 at 80% and 10 x 3 at 85% of your max. Week two adds ${adds[0]} kg over week one and week three adds ${adds[1]} kg over week one. A fourth week tests your new max.`,
    warning: "Four heavy sessions a week on one lift. For lifters with at least a year of steady training.",
    summary: `Four ${name.toLowerCase()} sessions a week for three weeks, heavier each week, then a test of your new max.`,
    phases: [
      { name: "Week 1", fromWeek: 1, toWeek: 1, note: "6 x 6, 7 x 5, 8 x 4 and 10 x 3 at 70% to 85% of your max." },
      { name: `Plus ${adds[0]} kg`, fromWeek: 2, toWeek: 2, note: `The same four sessions with ${adds[0]} kg more on every set.` },
      { name: `Plus ${adds[1]} kg`, fromWeek: 3, toWeek: 3, note: `The same sessions with ${adds[1]} kg more than week 1. The hardest week.` },
      { name: "Test", fromWeek: 4, toWeek: 4, note: "One session: work up to a new 1-rep max with a spotter or safety bars." },
    ],
    whyItWorks:
      "A short block on one lift: the same four sessions each week, with a fixed jump in weight. The sets get shorter as the percentage rises, so each day has a similar number of reps. The test week reads your new max from your best set.",
    engine: { key: "fixed_block" },
    weeks: [
      jrWeek(name, lift, 0, "Week 1"),
      jrWeek(name, lift, adds[0], `Plus ${adds[0]} kg`),
      jrWeek(name, lift, adds[1], `Plus ${adds[1]} kg`),
      week([day("Test day", [maxTest(name, lift)], true)], "Test"),
    ],
  };
}

export const smolovJrSquat = smolovJr("squat", "Back squat", "smolov-jr-squat", "Smolov Jr (squat)", [5, 10]);
export const smolovJrBench = smolovJr("bench", "Bench press", "smolov-jr-bench", "Smolov Jr (bench)", [2.5, 5]);
