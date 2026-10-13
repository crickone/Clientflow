import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { trainingPlans } from "@/lib/db/schema";
import { assignedWorkoutPrograms } from "@/lib/clientApp";
import { getProgram } from "@/lib/workout";
import { listSessions, openSession } from "@/lib/workoutLog";
import { bestSet, setsDone, volumeKg, type SessionView } from "@/lib/workoutLogModel";
import {
  dateKey,
  liftChange,
  mondayOf,
  nextDayAfter,
  parseWeekdays,
  planWeek,
  strengthCurve,
  weeklyTotals,
  weekStreak,
  type PlanDay,
  type WeekTotal,
} from "@/lib/trainingProgress";

/**
 * Everything the member's Home, Workouts and Progress screens show about
 * their training, from one read of their log. Ambient tenant `db`; the
 * caller passes the signed-in member's id (or staff pass the profile's id).
 */

export interface LiftSummary {
  key: string;
  name: string;
  sessions: number;
  best: { weightKg: number; reps: number; e1rm: number; at: number };
  change: { first: number; best: number; kg: number; pct: number };
  points: { at: number; e1rm: number; weightKg: number; reps: number }[];
}

export interface NextWorkout {
  programId: number;
  programTitle: string;
  dayPosition: number;
  dayName: string;
}

export interface TrainingOverview {
  programs: { id: number; title: string; dayNames: string[] }[];
  plan: { programId: number; programTitle: string; weekdays: number[]; days: PlanDay[] } | null;
  next: NextWorkout | null;
  open: { id: number; dayName: string; done: number; total: number } | null;
  weeks: WeekTotal[];
  streak: number;
  workouts30: number;
  totalWorkouts: number;
  strength: { at: number; value: number }[];
  lifts: LiftSummary[];
  last: { id: number; dayName: string; finishedAt: number; sets: number; volume: number } | null;
  latestBest: { name: string; weightKg: number; reps: number; at: number } | null;
}

export function getTrainingPlanRow(clientId: number): { programId: number | null; weekdays: number[] } {
  const row = db.select().from(trainingPlans).where(eq(trainingPlans.clientId, clientId)).get();
  return { programId: row?.programId ?? null, weekdays: parseWeekdays(row?.weekdays) };
}

/** Save the member's training days for one of their programmes. The caller checks the programme is theirs. */
export function setTrainingPlan(clientId: number, programId: number, weekdays: number[]): void {
  const days = parseWeekdays(weekdays.join(","));
  const now = Date.now();
  const existing = db.select().from(trainingPlans).where(eq(trainingPlans.clientId, clientId)).get();
  if (existing) db.update(trainingPlans).set({ programId, weekdays: days.join(","), updatedAt: now }).where(eq(trainingPlans.clientId, clientId)).run();
  else db.insert(trainingPlans).values({ clientId, programId, weekdays: days.join(","), updatedAt: now }).run();
}

function liftSummaries(sessions: SessionView[]): { lifts: LiftSummary[]; latestBest: TrainingOverview["latestBest"] } {
  const by = new Map<string, LiftSummary>();
  let latestBest: TrainingOverview["latestBest"] = null;
  // Oldest first, so "beat the best so far" reads in order.
  for (const s of [...sessions].sort((a, b) => a.finishedAt! - b.finishedAt!)) {
    for (const ex of s.exercises) {
      const b = bestSet(ex.sets);
      if (!b) continue;
      const point = { at: s.finishedAt!, e1rm: b.e1rm, weightKg: b.weightKg, reps: b.reps };
      const cur = by.get(ex.exerciseKey);
      if (!cur) {
        by.set(ex.exerciseKey, { key: ex.exerciseKey, name: ex.name, sessions: 1, best: { ...b, at: point.at }, change: { first: b.e1rm, best: b.e1rm, kg: 0, pct: 0 }, points: [point] });
        continue;
      }
      cur.sessions++;
      cur.name = ex.name;
      cur.points.push(point);
      if (b.e1rm > cur.best.e1rm + 1e-9) {
        cur.best = { ...b, at: point.at };
        latestBest = { name: ex.name, weightKg: b.weightKg, reps: b.reps, at: point.at };
      }
    }
  }
  const lifts = [...by.values()].map((l) => ({ ...l, change: liftChange(l.points)! }));
  lifts.sort((a, b) => b.sessions - a.sessions || b.best.e1rm - a.best.e1rm);
  return { lifts, latestBest };
}

export function trainingOverview(clientId: number, now = Date.now()): TrainingOverview {
  const programs = assignedWorkoutPrograms(clientId)
    .filter((p) => p.type === "detailed")
    .map((p) => {
      const days = getProgram(p.id)?.days ?? [];
      return { id: p.id, title: p.title, dayNames: days.some((d) => d.exercises.length > 0) ? days.map((d, i) => d.name || `Day ${i + 1}`) : [] };
    })
    .filter((p) => p.dayNames.length > 0);

  const sessions = listSessions(clientId, 1000);
  const planRow = getTrainingPlanRow(clientId);
  const program = programs.find((p) => p.id === planRow.programId) ?? programs[0] ?? null;

  let next: NextWorkout | null = null;
  if (program) {
    const last = sessions.find((s) => s.programId === program.id);
    const pos = nextDayAfter(last ? last.dayPosition : null, program.dayNames.length);
    next = { programId: program.id, programTitle: program.title, dayPosition: pos, dayName: program.dayNames[pos] };
  }

  const thisMonday = mondayOf(dateKey(now));
  const plan =
    program && next
      ? {
          programId: program.id,
          programTitle: program.title,
          weekdays: program.id === planRow.programId ? planRow.weekdays : [],
          days: planWeek({
            now,
            weekdays: program.id === planRow.programId ? planRow.weekdays : [],
            dayNames: program.dayNames,
            nextDayPosition: next.dayPosition,
            logged: sessions.filter((s) => mondayOf(dateKey(s.finishedAt!)) === thisMonday).map((s) => ({ at: s.finishedAt!, title: s.dayName })),
          }),
        }
      : null;

  const stats = sessions.map((s) => {
    const c = setsDone(s.exercises);
    return { finishedAt: s.finishedAt!, sets: c.done, volume: volumeKg(s.exercises) };
  });
  const weeks = weeklyTotals(stats, 12, now);
  const { lifts, latestBest } = liftSummaries(sessions);
  const openRow = openSession(clientId);
  const openCount = openRow ? setsDone(openRow.exercises) : null;
  const lastSession = sessions[0];

  return {
    programs,
    plan,
    next,
    open: openRow && openCount ? { id: openRow.id, dayName: openRow.dayName, done: openCount.done, total: openCount.total } : null,
    weeks,
    streak: weekStreak(stats.map((s) => s.finishedAt), now),
    workouts30: stats.filter((s) => s.finishedAt >= now - 30 * 86400000).length,
    totalWorkouts: sessions.length,
    strength: strengthCurve(lifts.map((l) => l.points), weeklyTotals([], 26, now)),
    lifts,
    last: lastSession ? { id: lastSession.id, dayName: lastSession.dayName, finishedAt: lastSession.finishedAt!, sets: stats[0].sets, volume: stats[0].volume } : null,
    latestBest,
  };
}
