// app/src/lib/programs/simulate.ts
/**
 * Run a program end to end with a simulated member, for tests: a perfect
 * member who hits every rep, or one with scripted misses. Pure.
 */
import { initState, progress } from "./engines";
import { planSession, sessionCount, summarisePlanned } from "./planner";
import type { DoneSet, EngineState, LiftKey, PlannedExercise, PlannedSession, PlannedSet, ProgramTemplate, WeightUnit } from "./types";

export type Performer = (c: { n: number; session: PlannedSession; exercise: PlannedExercise; set: PlannedSet; setIndex: number }) => DoneSet;

/** Does every set as planned: the top of a rep range, two over the minimum on a + set, 20 kg where no weight is planned. */
export const perfect: Performer = ({ exercise, set }) => ({
  kg: exercise.bodyweight ? null : set.kg ?? 20,
  reps: set.amrap ? set.reps + 2 : set.repsMax ?? set.reps,
  done: true,
});

/** Perfect, except every `every`th session the last set of each exercise falls one rep short. */
export function scriptedMisses(every = 3): Performer {
  return (c) => {
    const p = perfect(c);
    const last = c.setIndex === c.exercise.sets.length - 1;
    return c.n % every === every - 1 && last ? { ...p, reps: Math.max(0, c.set.reps - 1) } : p;
  };
}

/** A block runs once; a repeating program runs for its card length. */
export function plannedSessionCount(t: ProgramTemplate): number {
  return t.engine.key === "fixed_block" ? sessionCount(t) : Math.ceil(t.lengthWeeks / t.weeks.length) * sessionCount(t);
}

export interface SimRun {
  sessions: PlannedSession[];
  reasons: string[][];
  states: EngineState[];
  final: EngineState;
}

export function simulate(
  t: ProgramTemplate,
  opts: { maxes: Partial<Record<LiftKey, number>>; stepKg?: number; unit?: WeightUnit; sessions?: number; performer?: Performer },
): SimRun {
  const stepKg = opts.stepKg ?? 2.5;
  const unit = opts.unit ?? "kg";
  const performer = opts.performer ?? perfect;
  const n = opts.sessions ?? plannedSessionCount(t);
  let state = initState(t, opts.maxes, stepKg);
  const run: SimRun = { sessions: [], reasons: [], states: [], final: state };
  for (let i = 0; i < n && !state.finished; i++) {
    const session = planSession(t, state, { stepKg });
    if (!session) break;
    const result = {
      exercises: session.exercises.map((exercise) => ({
        planned: exercise,
        sets: exercise.sets.map((set, setIndex) => performer({ n: i, session, exercise, set, setIndex })),
      })),
    };
    const out = progress({ template: t, state, result, stepKg, unit });
    run.sessions.push(session);
    run.reasons.push(out.reasons);
    state = out.state;
    run.states.push(state);
  }
  run.final = state;
  return run;
}

/** The planned session at a position, straight from the starting maxes. */
export function planAt(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, week: number, day: number, stepKg = 2.5): PlannedSession {
  const p = planSession(t, { ...initState(t, maxes, stepKg), week, day }, { stepKg });
  if (!p) throw new Error(`${t.key}: no session at week ${week + 1}, day ${day + 1}`);
  return p;
}

/** Anything a member should never see: a missing or silly weight, a broken reason. */
export function runProblems(run: SimRun): string[] {
  const out: string[] = [];
  run.sessions.forEach((s, n) => {
    if (s.exercises.length === 0) out.push(`session ${n + 1} has no exercises`);
    for (const e of s.exercises)
      for (const set of e.sets) {
        if (set.kg !== null && !(Number.isFinite(set.kg) && set.kg > 0 && set.kg < 1000)) out.push(`session ${n + 1} ${e.name}: weight ${set.kg}`);
        if (!(set.reps >= 1)) out.push(`session ${n + 1} ${e.name}: reps ${set.reps}`);
      }
  });
  for (const r of run.reasons.flat()) if (!r.trim() || /NaN|undefined|null/.test(r)) out.push(`reason: ${r}`);
  return out;
}

/** "Back squat 4 x 9 at 70 kg", for test pins. */
export function line(e: PlannedExercise, unit: WeightUnit = "kg"): string {
  return `${e.name} ${summarisePlanned(e.sets, unit)}`;
}
