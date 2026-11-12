# DIY Training and the Program Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member switched to DIY pick a well-known program (Smolov, 5/3/1, StrongLifts and the rest) from a platform library, with every working weight worked out from their maxes and progression applied automatically after each finished session, while coaches see and correct it and gyms can hide programs or make their own versions.

**Architecture:** Programs are typed data (one TypeScript file per program) read from a code registry. A pure planner turns a template plus the member's engine state into a session with weights; five pure progression engines turn (state, template, session results) into (new state, reasons). The tenant DB stores gym copies, hidden keys, enrolments (with a template snapshot) and a change log; the existing workout logger records the sessions, gaining a planned weight and an RPE per set.

**Tech Stack:** Next.js 15 App Router, TypeScript, drizzle-orm over better-sqlite3 (tenant DB per business), zod 4, lucide-react, plain `node:assert/strict` test scripts run with tsx.

Spec (source of truth): `docs/superpowers/specs/2026-11-12-diy-program-library-design.md`.

## Global Constraints

- NO EMOJIS anywhere: UI, code, comments, log lines, commit messages, docs. Where a glyph is needed, use a `lucide-react` icon.
- Copy is plain sentence case and short factual sentences. No "X rather than Y", no "not just X", no filler. Program descriptions are our own words; nothing copied from the books.
- Every program names its author in one line (e.g. "5/3/1 by Jim Wendler"). Demanding programs carry a warning line.
- Every member has a training mode: `coach` (default) or `diy`. Switching never deletes anything; switching to coach pauses an active DIY program, it does not end it.
- Programs live in code (`app/src/lib/programs/templates/*.ts`, read from `app/src/lib/programs/registry.ts`). They are never copied into a database. Gym copies and hide switches live in the tenant DB.
- An enrolment stores a snapshot of the template it started from.
- Everything is stored in kg. The member chooses kg or lb for display. 5 lb is stored as 2.26796 kg.
- Weights round to the member's smallest jump: 2.5 kg by default, 1.25 kg for small plates, 5 lb (2.26796 kg) for pounds.
- A max can come from a 1-rep max, a recent set (Epley, only sets of 1 to 10 reps), or the best logged set of that lift in the last 90 days.
- The program advances when a session is finished, never by the calendar. Skips are recorded.
- One live (active or paused) DIY program per member. Ending one keeps its history.
- Every engine change returns a reason sentence, shown to the member and stored in the enrolment's change log.
- Template check: every exercise name is in the canonical list, every percentage is between 30% and 110%, every lift an exercise takes a max from is one the program asks a max for.
- New module `programs` ("Programs"), included for every gym (no add-on). Its rollout defaults to Nobody until switched on from the console Feature flags page.
- Tenant DB changes are ADDITIVE and go in `ensureTenantTables` in `app/src/lib/db/tenant.ts` (`CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info` guarded `ALTER TABLE ... ADD COLUMN`). Do NOT add them to `TENANT_MIGRATIONS` in `app/src/lib/db/migrations/index.ts`; that runner is only for non-additive changes, and putting the same change in both is the two-migration-arrays trap.
- Never diagnose tenant state from the local `app/data/` files; they are stale dev copies.
- Tests are plain `node:assert/strict` scripts with no framework. Run one with `cd app && npm test -- src/path/file.test.ts`. DB tests make a scratch tenant (control row plus a real tenant DB file) and clean it up.
- Staff `<select>` elements use the global select style in `app/src/app/globals.css` (36px right padding, chevron 12px in). Never set a smaller right padding on a select. Buttons and toggles are never cramped: use the shared `Button` component where you can, and give any hand-made control at least 32px of height and 12px of side padding.
- The member app (`/app`) uses the tenant's brand CSS variables (`--accent`, `--accent-soft`, `--accent-ink`, `--text-*`, `--hairline`, `--surface-*`). Staff pages use the admin theme tokens in `globals.css`.
- Commit after every task with `git add <exact paths>` (never `git add -A` or `git add .`; unrelated untracked files exist). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Full checks before deploy: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`. Deploy is `cd app && railway up --detach`, from `main`.

---

## Notes for the user: program accuracy

The engines and data shapes are exact. The program numbers are not all equally certain, so the plan is explicit about which are which.

**Encoded from the published programs, with tests pinning the numbers:** StrongLifts 5x5, Starting Strength (novice phase 1), the Smolov base mesocycle and Smolov Jr percentages, the Russian Squat Routine (all 18 sessions), 5/3/1 waves (65/75/85, 70/80/90, 75/85/95, deload 40/50/60, training max 90%), Boring But Big (5 x 10 at 50%), First Set Last, German Volume Training (10 x 10 at 60%), the GZCLP rep schemes (5x3+, 6x2+, 10x1+; 3x10, 3x8, 3x6; 3x15+), the Texas Method core (volume 5 x 5 at 90% of the 5-rep max, recovery 2 x 5 at 80% of that, intensity day a new 5-rep max), and the PHUL and PHAT exercise lists and rep ranges.

**Labelled "-style" because we are not certain of the exact published numbers:**
- **Candito-style 6-week**: the phase shape (conditioning, strength, heavy, peak, test) follows Jonnie Candito's program; the percentages are ours.
- **Sheiko-style**: pyramids and submaximal doubles and triples in Boris Sheiko's manner; the numbers are ours, not any numbered Sheiko program.
- **nSuns-style 5-day**: the T1 rows are as commonly published; the T2 rows and the kg progression table (0-1 reps +0, 2-3 +2.5 kg, 4-5 +5 kg, 6+ +7.5 kg) should be checked against the source spreadsheet before switching it on.
- **Arnold-style split**: his chest and back / shoulders and arms / legs split, each twice a week; exercise choice and set counts are ours.
- **HIT-style full body**: one work set to failure after Arthur Jones and Mike Mentzer; the two workouts are ours.

**Choices that are ours, written into the code as settings so they can be changed in one place:**
- Starting weights for linear programs: 50% of the entered max (StrongLifts, Starting Strength, Greyskull), floored at a 20 kg bar.
- GZCLP starting weights: T1 at 73% of the max (about 85% of a 5-rep max), T2 at 55%; after 10x1+ fails, T1 restarts 5x3+ at 85% of the stalled weight (the program says re-test a 5-rep max); after 3x6 fails, T2 restarts 3x10 at 5 kg over its last 3x10 start.
- 5/3/1: the training max holds for a lift whose + set fell short of the minimum reps in that cycle.
- Smolov base: week 2 is +10 kg over week 1 and week 3 is +15 kg over week 1. Sources differ on week 3 (between +5 and +7.5 kg over week 2).
- Greyskull LP: the day pairing (A: bench, row, squat; B: press, chin-up, deadlift) is as commonly shared; the set scheme (2 x 5, 1 x 5+), the 10% reset on a miss and the double jump at 10+ reps are the method's core.

**Where the plan departs from the spec, and why:**
- **Smolov ships as the base mesocycle (4 weeks with a test), not the full 13 weeks.** We can stand behind the base mesocycle's numbers. We cannot for the intro microcycle, switching phase and intense mesocycle. The spec's example card text ("13 weeks") becomes "4 days a week for 4 weeks".
- **Smolov Jr ships twice** (squat and bench), because lifters run it for either.
- **Training weekdays live on the enrolment** (`program_enrolments.weekdays`) and reuse the planner UI pattern and `planWeek()`. The existing `training_plans` table holds one row per member tied to a coach program id (foreign key to `workout_programs`), so a DIY member who also has a coach program would lose one or the other.
- **One extra column, `workout_session_exercises.rx_json`**, holds the planned sets for each exercise (index, reps per set, AMRAP, RPE target, weight). The spec's `target_weight_kg` and `rpe` on set logs are added as written; per-set reps and the link back to the template exercise need somewhere to live too.

**Checked before handing over:** on 2026-11-12 every code block and edit in this plan was applied to a scratch copy of `main` (at `ffd969c`). `npx tsc --noEmit -p .` was clean, all 359 test files passed (including the 16 new ones), and `npx next build` succeeded with all seven new routes. The scratch copy was then thrown away. If `main` has moved on, an edit's "replace this" text may need finding again, but the code itself is consistent.

---

## File structure

Pure modules (no server imports; shared by server, member app and staff UI):

| File | Responsibility |
|---|---|
| `app/src/lib/programs/types.ts` | All program types, lift keys and labels, `emptyState()` |
| `app/src/lib/programs/units.ts` | kg/lb, rounding to the smallest jump, maxes (Epley capped at 10), training max, RPE weight |
| `app/src/lib/programs/exercises.ts` | Canonical exercise list with aliases, gym library matching |
| `app/src/lib/programs/dsl.ts` | Small builders the template files use (`pct`, `amrap`, `fixed`, `sxr`, `maxTest`...) |
| `app/src/lib/programs/planner.ts` | Template + state to a planned session with weights; position helpers; summaries |
| `app/src/lib/programs/engines.ts` | `initState`, the five engines, `progress()` |
| `app/src/lib/programs/validate.ts` | `validateTemplate`, `copyErrors` |
| `app/src/lib/programs/simulate.ts` | Simulation harness for tests (perfect member, scripted misses) |
| `app/src/lib/programs/registry.ts` | `PLATFORM_PROGRAMS`, `platformProgram(key)` |
| `app/src/lib/programs/templates/*.ts` | One file per program (or per family of closely related programs) |
| `app/src/lib/programs/cards.ts` | Library card data and filters |
| `app/src/lib/programs/preview.ts` | Week-by-week preview for a 100 kg lifter |

Server modules (ambient tenant `db`):

| File | Responsibility |
|---|---|
| `app/src/lib/programs/library.ts` | Hidden keys, gym copies CRUD, `programByKey`, `memberPrograms` |
| `app/src/lib/programs/enrolments.ts` | Enrol, plan, start/finish/skip sessions, pause/resume via mode, end, restart, coach changes, best logged set |
| `app/src/lib/programs/access.ts` | `programsOn`, `memberSeesPrograms`, `requireProgramsPage` |
| `app/src/lib/programs/staffView.ts` | Data for the staff DIY program panel |

UI and actions: member pages under `app/src/app/app/programs/`, member components in `app/src/components/clientapp/`, staff library under `app/src/app/workout/library/`, staff components in `app/src/components/workout/` and `app/src/components/clients/`.

---

### Task 1: Pure program model: types, units, canonical exercises, template builders, planner

**Files:**
- Create: `app/src/lib/programs/types.ts`
- Create: `app/src/lib/programs/units.ts`
- Create: `app/src/lib/programs/exercises.ts`
- Create: `app/src/lib/programs/dsl.ts`
- Create: `app/src/lib/programs/planner.ts`
- Test: `app/src/lib/programs/units.test.ts`
- Test: `app/src/lib/programs/planner.test.ts`

**Interfaces:**
- Consumes: `estimatedMax(weightKg, reps)` and `parseWeight(raw)` from `app/src/lib/workoutLogModel.ts` (already exist).
- Produces (all later tasks rely on these exact names):
  - `types.ts`: `WeightUnit = "kg" | "lb"`; `LiftKey = "squat" | "bench" | "deadlift" | "press" | "row"`; `LIFT_KEYS`, `LIFT_LABEL`, `LIFT_EXERCISE`; `Family`, `FAMILY_LABEL`, `Level`, `LEVEL_LABEL`; `EngineKey`, `ENGINE_LABEL`; `Reps`; `SetRx` (kinds `pct | amrap | rpe | fixed | same_as_last`); `ExerciseRx`; `DayRx`; `WeekRx`; `LinearSettings`, `TmCycleSettings`, `FixedBlockSettings`, `DoubleProgressionSettings`, `FixedVolumeSettings`, `EngineSettings`; `ProgramTemplate`; `EngineState`; `emptyState(): EngineState`; `PlannedSet`, `PlannedExercise`, `PlannedSession`; `DoneSet`, `ExerciseResult`, `SessionResult`.
  - `units.ts`: `LB_TO_KG`, `STEP_5LB_KG = 2.26796`, `StepKey = "2.5kg" | "1.25kg" | "5lb"`, `STEP_OPTIONS`, `stepFromKey(key): number`, `keyFromStep(kg): StepKey`, `roundToStep(kg, stepKg): number`, `kgToUnit(kg, unit): number`, `unitToKg(value, unit): number`, `formatWeight(kg, unit): string`, `parseWeightIn(raw, unit): number | null`, `parseRpe(raw): number | null`, `formatSetIn(set, unit): string`, `MAX_SET_REPS = 10`, `maxFromSet(kg, reps): number | null`, `MaxInput`, `resolveMax(input): number | null`, `trainingMax(max, tmPct): number`, `weightForRpe(e1rm, reps, rpe): number`.
  - `exercises.ts`: `CanonicalExercise`, `CANONICAL_EXERCISES`, `isCanonical(name)`, `canonicalFor(name)`, `namesFor(name): string[]`, `matchLibraryId(name, library: {id:number; name:string}[]): number | null`.
  - `dsl.ts`: `pct(p, reps, rest?, opts?)`, `amrap(p, reps, rest?, opts?)`, `rpe(r, reps, rest?)`, `fixed(reps, rest?, isAmrap?)`, `range(min, max)`, `times(n, set)`, `sxr(n, reps, p, rest?, addKg?)`, `ex(name, sets, opts?)`, `day(name, exercises, test?)`, `week(days, label?)`, `MAX_TEST_NOTE`, `maxTest(name, lift)`.
  - `planner.ts`: `stateKey(ex)`, `setsFor(ex, stages)`, `progresses(ex)`, `sessionCount(t)`, `positionOf(t, week, day)`, `dayAt(t, week, day)`, `isLastSession(t, week, day)`, `advance(t, pos)`, `weekNumber(t, state)`, `PlanContext`, `planExercise(ex, index, state, ctx)`, `planSession(t, state, ctx): PlannedSession | null`, `repsLabel(set)`, `summarisePlanned(sets, unit)`, `summariseRx(sets)`, `schemeLabel(sets)`.

- [ ] **Step 1: Write `types.ts`**

```ts
// app/src/lib/programs/types.ts
/**
 * The program library's shapes (docs/superpowers/specs/2026-11-12-diy-program-library-design.md).
 * Pure: no server imports. Templates, the planner, the engines, the member app
 * and the staff screens all share these.
 */

export type WeightUnit = "kg" | "lb";

export type LiftKey = "squat" | "bench" | "deadlift" | "press" | "row";
export const LIFT_KEYS: readonly LiftKey[] = ["squat", "bench", "deadlift", "press", "row"];
export const LIFT_LABEL: Record<LiftKey, string> = {
  squat: "Squat",
  bench: "Bench press",
  deadlift: "Deadlift",
  press: "Overhead press",
  row: "Barbell row",
};
/** The canonical exercise whose logs count as this lift's history (best logged set). */
export const LIFT_EXERCISE: Record<LiftKey, string> = {
  squat: "Back squat",
  bench: "Bench press",
  deadlift: "Deadlift",
  press: "Overhead press",
  row: "Barbell row",
};

export type Family = "strength" | "peaking" | "beginner" | "size";
export const FAMILY_LABEL: Record<Family, string> = {
  strength: "Strength",
  peaking: "Powerlifting peak",
  beginner: "Beginner",
  size: "Size",
};

export type Level = "beginner" | "intermediate" | "advanced";
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export type EngineKey = "linear" | "tm_cycle" | "fixed_block" | "double_progression" | "fixed_volume";
export const ENGINE_LABEL: Record<EngineKey, string> = {
  linear: "Linear, with deloads",
  tm_cycle: "Training-max cycles",
  fixed_block: "Fixed block with a re-test",
  double_progression: "Double progression",
  fixed_volume: "Fixed volume",
};

/** A rep count, or a range for rep-range programs. */
export type Reps = number | { min: number; max: number };

/**
 * One prescribed set.
 * - pct: a fraction of the lift's training max (0.7 = 70%), plus an optional fixed kg on top.
 * - amrap: the same, and the member does as many reps as they can (reps = the minimum).
 * - rpe: a target effort; the weight is suggested from the member's best estimated max.
 * - fixed: the weight comes from the engine's state for this exercise.
 * - same_as_last: the previous set's weight.
 * `drives` marks the set whose result moves the training max (nSuns 1+ set, Texas top set).
 */
export type SetRx =
  | { kind: "pct"; pct: number; reps: number; rest: number; addKg?: number; drives?: boolean }
  | { kind: "amrap"; pct: number; reps: number; rest: number; addKg?: number; drives?: boolean }
  | { kind: "rpe"; rpe: number; reps: number; rest: number }
  | { kind: "fixed"; reps: Reps; rest: number; amrap?: boolean }
  | { kind: "same_as_last"; reps: Reps; rest: number };

export interface ExerciseRx {
  /** A name from the canonical list (exercises.ts). */
  name: string;
  /** The max this exercise's percentages and starting weight come from. */
  lift?: LiftKey;
  /** GZCLP tier. Also part of the state key, so T1 squat and T2 squat keep separate weights. */
  tier?: "t1" | "t2" | "t3";
  sets: SetRx[];
  /** GZCLP: the rep schemes the exercise moves through when it fails. sets === stages[0]. */
  stages?: SetRx[][];
  bodyweight?: boolean;
  /** false: the engine never changes this exercise's weight (speed sets, light accessories). */
  progress?: boolean;
  /** Starting weight as a fraction of the lift's max, overriding the engine's startPct. */
  startPct?: number;
  /** Done back to back with the exercise above (superset). */
  joined?: boolean;
  notes?: string;
}

export interface DayRx {
  name: string;
  exercises: ExerciseRx[];
  /** A test day: the engine reads the member's new max from it. */
  test?: boolean;
}

export interface WeekRx {
  label?: string;
  days: DayRx[];
}

export interface LinearSettings {
  key: "linear";
  increment: number;
  increments?: Partial<Record<LiftKey, number>>;
  /** Misses in a row on a lift before it drops. */
  deloadAfter: number;
  /** 0.1 = 10% lighter. */
  deloadPct: number;
  /** Starting weight as a fraction of the entered max. */
  startPct: number;
  /** AMRAP reps at or above this double the jump (Greyskull). */
  doubleAt?: number;
}

export interface TmCycleSettings {
  key: "tm_cycle";
  /**
   * cycle: training max rises at the end of each cycle (5/3/1).
   * amrap_table: training max moves by the reps on the driving AMRAP set (nSuns).
   * drive_set: training max rises when the driving set is completed (Texas Method).
   * gzclp: per-exercise weights move through rep schemes (GZCLP).
   */
  rule: "cycle" | "amrap_table" | "drive_set" | "gzclp";
  increment: number;
  increments?: Partial<Record<LiftKey, number>>;
  amrapTable?: { minReps: number; kg: number }[];
  t2ResetKg?: number;
  t3AmrapTarget?: number;
  startPct?: number;
}

export interface FixedBlockSettings {
  key: "fixed_block";
}

export interface DoubleProgressionSettings {
  key: "double_progression";
}

export interface FixedVolumeSettings {
  key: "fixed_volume";
  increment: number;
  startPct: number;
}

export type EngineSettings = LinearSettings | TmCycleSettings | FixedBlockSettings | DoubleProgressionSettings | FixedVolumeSettings;

export interface ProgramTemplate {
  key: string;
  name: string;
  /** One line, e.g. "5/3/1 by Jim Wendler". */
  author: string;
  family: Family;
  level: Level;
  daysPerWeek: number;
  /** The length shown on the card. Repeating programs loop their weeks until then and beyond. */
  lengthWeeks: number;
  /** The lifts the member gives a max for. */
  lifts: LiftKey[];
  /** Training max as a fraction of the max (5/3/1 uses 0.9). */
  tmPct: number;
  /** Who it is for, one line. */
  who: string;
  /** Our own words. */
  description: string;
  /** For demanding programs. */
  warning?: string;
  engine: EngineSettings;
  weeks: WeekRx[];
}

/** Everything an engine carries between sessions. Position is week/day within the template. */
export interface EngineState {
  week: number;
  day: number;
  /** Completed passes through the template. */
  cycle: number;
  maxes: Partial<Record<LiftKey, number>>;
  tms: Partial<Record<LiftKey, number>>;
  /** Working weight per state key (fixed-weight programs). */
  weights: Record<string, number>;
  misses: Record<string, number>;
  stages: Record<string, number>;
  /** 5/3/1: a + set fell short of its minimum this cycle. */
  short: Partial<Record<LiftKey, boolean>>;
  /** GZCLP: the weight T2 last started its 3 x 10 at. */
  t2Base: Record<string, number>;
  /** Fixed block: the new maxes read from the test day. */
  testMaxes: Partial<Record<LiftKey, number>>;
  /** Fixed block: the last session is done. */
  finished: boolean;
}

export function emptyState(): EngineState {
  return { week: 0, day: 0, cycle: 0, maxes: {}, tms: {}, weights: {}, misses: {}, stages: {}, short: {}, t2Base: {}, testMaxes: {}, finished: false };
}

export interface PlannedSet {
  kg: number | null;
  reps: number;
  repsMax: number | null;
  amrap: boolean;
  rpe: number | null;
  pct: number | null;
  rest: number;
  drives: boolean;
}

export interface PlannedExercise {
  /** Index of the exercise in the template day. */
  index: number;
  name: string;
  lift: LiftKey | null;
  tier: "t1" | "t2" | "t3" | null;
  stateKey: string;
  bodyweight: boolean;
  /** The engine can change this exercise's weight. */
  progresses: boolean;
  joined: boolean;
  notes: string | null;
  sets: PlannedSet[];
}

export interface PlannedSession {
  week: number;
  day: number;
  /** Sessions before this one in the template: the logger's day_position. */
  position: number;
  dayName: string;
  weekLabel: string | null;
  test: boolean;
  exercises: PlannedExercise[];
}

export interface DoneSet {
  kg: number | null;
  reps: number | null;
  done: boolean;
}

export interface ExerciseResult {
  planned: PlannedExercise;
  sets: DoneSet[];
}

export interface SessionResult {
  exercises: ExerciseResult[];
}
```

- [ ] **Step 2: Write the failing units test**

```ts
// app/src/lib/programs/units.test.ts
// Run: npm test -- src/lib/programs/units.test.ts
import assert from "node:assert/strict";

import {
  STEP_5LB_KG,
  formatSetIn,
  formatWeight,
  keyFromStep,
  kgToUnit,
  maxFromSet,
  parseRpe,
  parseWeightIn,
  resolveMax,
  roundToStep,
  stepFromKey,
  trainingMax,
  unitToKg,
  weightForRpe,
} from "./units";

// Rounding to the smallest jump (nearest, half up).
assert.equal(roundToStep(101.3, 2.5), 102.5);
assert.equal(roundToStep(101.2, 2.5), 100);
assert.equal(roundToStep(101.25, 2.5), 102.5);
assert.equal(roundToStep(101.3, 1.25), 101.25);
assert.equal(roundToStep(102, STEP_5LB_KG), 102.058);
assert.equal(roundToStep(57.5, 0), 57.5);

// Units: everything is stored in kg.
assert.equal(STEP_5LB_KG, 2.26796);
assert.equal(formatWeight(102.5, "kg"), "102.5 kg");
assert.equal(formatWeight(102.058, "lb"), "225 lb");
assert.equal(kgToUnit(100, "lb"), 220.5);
assert.equal(unitToKg(225, "lb"), 102.058);
assert.equal(unitToKg(62.5, "kg"), 62.5);
assert.equal(parseWeightIn("225", "lb"), 102.058);
assert.equal(parseWeightIn("62,5", "kg"), 62.5);
assert.equal(parseWeightIn("", "lb"), null);
assert.equal(parseWeightIn("abc", "kg"), null);
assert.equal(formatSetIn({ weightKg: 102.058, reps: 5 }, "lb"), "225 lb x 5");
assert.equal(formatSetIn({ weightKg: null, reps: 8 }, "kg"), "8 reps");
assert.equal(stepFromKey("1.25kg"), 1.25);
assert.equal(stepFromKey("5lb"), STEP_5LB_KG);
assert.equal(keyFromStep(2.26796), "5lb");
assert.equal(keyFromStep(2.5), "2.5kg");

// RPE input.
assert.equal(parseRpe("8"), 8);
assert.equal(parseRpe("7,5"), 7.5);
assert.equal(parseRpe("8.3"), 8.5);
assert.equal(parseRpe("11"), null);
assert.equal(parseRpe(""), null);

// Maxes: Epley, only sets of 1 to 10 reps.
assert.equal(maxFromSet(100, 1), 100);
assert.equal(maxFromSet(100, 5), 116.67);
assert.equal(maxFromSet(100, 10), 133.33);
assert.equal(maxFromSet(100, 11), null);
assert.equal(maxFromSet(0, 5), null);
assert.equal(maxFromSet(100, 0), null);
assert.equal(resolveMax({ kind: "one_rm", kg: 140 }), 140);
assert.equal(resolveMax({ kind: "set", kg: 100, reps: 5 }), 116.67);
assert.equal(resolveMax({ kind: "set", kg: 100, reps: 12 }), null);
assert.equal(resolveMax({ kind: "one_rm", kg: -1 }), null);

// Training max.
assert.equal(trainingMax(200, 0.9), 180);
assert.equal(trainingMax(111.11, 0.9), 100);
assert.equal(trainingMax(116.67, 6 / 7), 100);

// RPE weight: the Epley estimate run backwards with reps in reserve.
assert.equal(weightForRpe(100, 1, 10), 100);
assert.equal(Math.round(weightForRpe(100, 3, 8) * 1000) / 1000, 85.714);

console.log("programs/units: ok");
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/units.test.ts`
Expected: FAIL with `Cannot find module './units'`.

- [ ] **Step 4: Write `units.ts`**

```ts
// app/src/lib/programs/units.ts
/**
 * Weights for the program library. Pure. Everything is stored in kg; the
 * member chooses kg or lb for display, and every working weight rounds to
 * their smallest jump.
 */
import { estimatedMax, parseWeight } from "@/lib/workoutLogModel";
import type { WeightUnit } from "./types";

export const LB_TO_KG = 0.45359237;
/** 5 lb, the smallest jump for a member who lifts in pounds, kept in kg. */
export const STEP_5LB_KG = 2.26796;

export type StepKey = "2.5kg" | "1.25kg" | "5lb";
export const STEP_OPTIONS: { key: StepKey; label: string; kg: number; unit: WeightUnit }[] = [
  { key: "2.5kg", label: "2.5 kg", kg: 2.5, unit: "kg" },
  { key: "1.25kg", label: "1.25 kg (small plates)", kg: 1.25, unit: "kg" },
  { key: "5lb", label: "5 lb", kg: STEP_5LB_KG, unit: "lb" },
];

export function stepFromKey(key: StepKey): number {
  return STEP_OPTIONS.find((s) => s.key === key)?.kg ?? 2.5;
}

export function keyFromStep(kg: number): StepKey {
  return STEP_OPTIONS.find((s) => Math.abs(s.kg - kg) < 1e-3)?.key ?? "2.5kg";
}

/** The nearest multiple of the smallest jump (half rounds up). */
export function roundToStep(kg: number, stepKg: number): number {
  if (!Number.isFinite(kg)) return 0;
  if (!(stepKg > 0)) return Math.round(kg * 100) / 100;
  return Number((Math.round(kg / stepKg + 1e-9) * stepKg).toFixed(3));
}

export function kgToUnit(kg: number, unit: WeightUnit): number {
  return unit === "lb" ? Math.round((kg / LB_TO_KG) * 10) / 10 : Math.round(kg * 100) / 100;
}

export function unitToKg(value: number, unit: WeightUnit): number {
  return Math.round((unit === "lb" ? value * LB_TO_KG : value) * 1000) / 1000;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${kgToUnit(kg, unit)} ${unit}`;
}

/** A typed weight in the member's unit, to kg. Blank or nonsense is null. */
export function parseWeightIn(raw: string, unit: WeightUnit): number | null {
  if (unit === "kg") return parseWeight(raw);
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 2200) return null;
  return unitToKg(Math.round(n * 10) / 10, "lb");
}

/** RPE 1 to 10, to the nearest half. Blank or out of range is null. */
export function parseRpe(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return Math.round(n * 2) / 2;
}

export function formatSetIn(s: { weightKg: number | null; reps: number | null }, unit: WeightUnit): string {
  if (s.weightKg !== null && s.weightKg > 0 && s.reps !== null) return `${formatWeight(s.weightKg, unit)} x ${s.reps}`;
  if (s.reps !== null) return `${s.reps} reps`;
  if (s.weightKg !== null && s.weightKg > 0) return formatWeight(s.weightKg, unit);
  return "Done";
}

/** Sets above this many reps do not estimate a max. */
export const MAX_SET_REPS = 10;

/** Estimated 1-rep max from a set (Epley), only for sets of 1 to 10 reps. */
export function maxFromSet(kg: number, reps: number): number | null {
  if (!Number.isFinite(kg) || kg <= 0 || !Number.isInteger(reps) || reps < 1 || reps > MAX_SET_REPS) return null;
  return Math.round(estimatedMax(kg, reps) * 100) / 100;
}

export type MaxInput = { kind: "one_rm"; kg: number } | { kind: "set"; kg: number; reps: number };

export function resolveMax(input: MaxInput): number | null {
  if (input.kind === "one_rm") return Number.isFinite(input.kg) && input.kg > 0 ? Math.round(input.kg * 100) / 100 : null;
  return maxFromSet(input.kg, input.reps);
}

export function trainingMax(max: number, tmPct: number): number {
  return Math.round(max * tmPct * 100) / 100;
}

/** The weight for `reps` at a target RPE: Epley backwards, counting reps in reserve as reps. */
export function weightForRpe(e1rm: number, reps: number, rpe: number): number {
  const eff = reps + Math.max(0, 10 - rpe);
  return eff <= 1 ? e1rm : e1rm / (1 + eff / 30);
}
```

- [ ] **Step 5: Run the units test**

Run: `cd app && npm test -- src/lib/programs/units.test.ts`
Expected: PASS, prints `programs/units: ok`.

- [ ] **Step 6: Write `exercises.ts`**

```ts
// app/src/lib/programs/exercises.ts
/**
 * The platform's canonical exercise names. Templates use these exactly; a
 * session matches them (and their aliases) to the gym's own exercise library
 * so the video and instructions show up. Pure.
 */
export interface CanonicalExercise {
  name: string;
  aliases: string[];
}

export const CANONICAL_EXERCISES: CanonicalExercise[] = [
  { name: "Back squat", aliases: ["Squat", "Barbell squat", "Barbell back squat"] },
  { name: "Front squat", aliases: ["Barbell front squat"] },
  { name: "Bench press", aliases: ["Barbell bench press", "Flat bench press"] },
  { name: "Close-grip bench press", aliases: ["Close grip bench press"] },
  { name: "Incline bench press", aliases: ["Incline barbell bench press"] },
  { name: "Overhead press", aliases: ["Military press", "Barbell overhead press", "Standing press"] },
  { name: "Deadlift", aliases: ["Barbell deadlift", "Conventional deadlift"] },
  { name: "Sumo deadlift", aliases: [] },
  { name: "Romanian deadlift", aliases: ["RDL"] },
  { name: "Stiff-legged deadlift", aliases: ["Stiff leg deadlift"] },
  { name: "Barbell row", aliases: ["Bent-over row", "Bent over row", "Barbell bent-over row"] },
  { name: "Pendlay row", aliases: [] },
  { name: "Chin-up", aliases: ["Chin up", "Chinup"] },
  { name: "Pull-up", aliases: ["Pull up", "Pullup"] },
  { name: "Lat pulldown", aliases: ["Lat pull-down", "Wide-grip lat pulldown"] },
  { name: "Close-grip lat pulldown", aliases: [] },
  { name: "Seated cable row", aliases: ["Cable row"] },
  { name: "Dumbbell row", aliases: ["One-arm dumbbell row", "Single-arm dumbbell row"] },
  { name: "Dip", aliases: ["Dips", "Parallel bar dip"] },
  { name: "Barbell curl", aliases: ["Standing barbell curl"] },
  { name: "EZ-bar curl", aliases: ["EZ bar curl"] },
  { name: "Incline dumbbell curl", aliases: [] },
  { name: "Hammer curl", aliases: ["Dumbbell hammer curl"] },
  { name: "Preacher curl", aliases: [] },
  { name: "Concentration curl", aliases: [] },
  { name: "Spider curl", aliases: [] },
  { name: "Skull crusher", aliases: ["Lying triceps extension"] },
  { name: "Triceps pushdown", aliases: ["Tricep pushdown", "Cable pushdown"] },
  { name: "Overhead triceps extension", aliases: ["Seated triceps extension"] },
  { name: "Cable triceps kickback", aliases: ["Triceps kickback"] },
  { name: "Dumbbell bench press", aliases: ["Flat dumbbell press"] },
  { name: "Incline dumbbell press", aliases: ["Incline dumbbell bench press"] },
  { name: "Dumbbell fly", aliases: ["Flat dumbbell fly"] },
  { name: "Incline dumbbell fly", aliases: [] },
  { name: "Incline cable fly", aliases: [] },
  { name: "Machine chest press", aliases: ["Chest press"] },
  { name: "Seated dumbbell shoulder press", aliases: ["Dumbbell shoulder press"] },
  { name: "Upright row", aliases: [] },
  { name: "Lateral raise", aliases: ["Dumbbell lateral raise", "Side lateral raise"] },
  { name: "Rear delt fly", aliases: ["Reverse fly", "Bent-over lateral raise"] },
  { name: "Face pull", aliases: [] },
  { name: "Dumbbell shrug", aliases: [] },
  { name: "Barbell shrug", aliases: [] },
  { name: "Leg press", aliases: [] },
  { name: "Hack squat", aliases: [] },
  { name: "Walking lunge", aliases: ["Barbell lunge", "Lunge"] },
  { name: "Bulgarian split squat", aliases: [] },
  { name: "Leg extension", aliases: [] },
  { name: "Lying leg curl", aliases: ["Leg curl"] },
  { name: "Seated leg curl", aliases: [] },
  { name: "Standing calf raise", aliases: ["Calf raise"] },
  { name: "Seated calf raise", aliases: [] },
  { name: "Leg press calf raise", aliases: ["Calf press"] },
  { name: "Donkey calf raise", aliases: [] },
  { name: "Back extension", aliases: ["Hyperextension"] },
  { name: "Good morning", aliases: [] },
  { name: "Hanging leg raise", aliases: [] },
  { name: "Cable crunch", aliases: [] },
  { name: "Plank", aliases: [] },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const BY_NAME = new Map<string, CanonicalExercise>();
for (const c of CANONICAL_EXERCISES) {
  BY_NAME.set(norm(c.name), c);
  for (const a of c.aliases) BY_NAME.set(norm(a), c);
}

/** Exactly a canonical name (templates must use these spellings). */
export function isCanonical(name: string): boolean {
  return CANONICAL_EXERCISES.some((c) => c.name === name);
}

/** The canonical exercise for a name or alias, any case. */
export function canonicalFor(name: string): CanonicalExercise | null {
  return BY_NAME.get(norm(name)) ?? null;
}

export function namesFor(name: string): string[] {
  const c = canonicalFor(name);
  return c ? [c.name, ...c.aliases] : [name];
}

/** The gym library exercise with this name or one of its aliases, if the gym has it. */
export function matchLibraryId(name: string, library: { id: number; name: string }[]): number | null {
  const wanted = new Set(namesFor(name).map(norm));
  return library.find((e) => wanted.has(norm(e.name)))?.id ?? null;
}
```

- [ ] **Step 7: Write `dsl.ts`**

```ts
// app/src/lib/programs/dsl.ts
/** Small builders the template files use, so a program reads like its spreadsheet. Pure. */
import type { DayRx, ExerciseRx, LiftKey, Reps, SetRx, WeekRx } from "./types";

export function pct(p: number, reps: number, rest = 180, opts: { addKg?: number; drives?: boolean } = {}): SetRx {
  return { kind: "pct", pct: p, reps, rest, ...(opts.addKg ? { addKg: opts.addKg } : {}), ...(opts.drives ? { drives: true } : {}) };
}

export function amrap(p: number, reps: number, rest = 180, opts: { addKg?: number; drives?: boolean } = {}): SetRx {
  return { kind: "amrap", pct: p, reps, rest, ...(opts.addKg ? { addKg: opts.addKg } : {}), ...(opts.drives ? { drives: true } : {}) };
}

export function rpe(r: number, reps: number, rest = 180): SetRx {
  return { kind: "rpe", rpe: r, reps, rest };
}

export function fixed(reps: Reps, rest = 120, isAmrap = false): SetRx {
  return isAmrap ? { kind: "fixed", reps, rest, amrap: true } : { kind: "fixed", reps, rest };
}

export function range(min: number, max: number): Reps {
  return { min, max };
}

export function times(n: number, s: SetRx): SetRx[] {
  return Array.from({ length: n }, () => ({ ...s }));
}

/** n sets of reps at one percentage: sxr(4, 9, 0.7) is 4 x 9 at 70%. */
export function sxr(n: number, reps: number, p: number, rest = 180, addKg = 0): SetRx[] {
  return times(n, pct(p, reps, rest, { addKg }));
}

export function ex(name: string, sets: SetRx[], opts: Omit<ExerciseRx, "name" | "sets"> = {}): ExerciseRx {
  return { name, sets, ...opts };
}

export function day(name: string, exercises: ExerciseRx[], test = false): DayRx {
  return test ? { name, exercises, test: true } : { name, exercises };
}

export function week(days: DayRx[], label?: string): WeekRx {
  return label ? { label, days } : { days };
}

export const MAX_TEST_NOTE = "Work up to a new 1-rep max. Use safety bars or a spotter. Stop when the bar slows down a lot.";

/** A test-day exercise: warm-ups by percentage, then a max attempt the engine reads. */
export function maxTest(name: string, lift: LiftKey): ExerciseRx {
  return ex(name, [pct(0.5, 5, 120), pct(0.7, 3, 150), pct(0.85, 1, 180), pct(0.95, 1, 240), rpe(10, 1, 300)], { lift, notes: MAX_TEST_NOTE });
}
```

- [ ] **Step 8: Write the failing planner test**

```ts
// app/src/lib/programs/planner.test.ts
// Run: npm test -- src/lib/programs/planner.test.ts
import assert from "node:assert/strict";

import { amrap, day, ex, fixed, maxTest, range, sxr, week } from "./dsl";
import {
  advance,
  isLastSession,
  planSession,
  positionOf,
  progresses,
  schemeLabel,
  sessionCount,
  stateKey,
  summarisePlanned,
  summariseRx,
  weekNumber,
} from "./planner";
import { emptyState, type EngineState, type ProgramTemplate } from "./types";
import { STEP_5LB_KG } from "./units";

const t: ProgramTemplate = {
  key: "test",
  name: "Test",
  author: "Test",
  family: "strength",
  level: "beginner",
  daysPerWeek: 2,
  lengthWeeks: 2,
  lifts: ["squat", "bench"],
  tmPct: 0.9,
  who: "Testers.",
  description: "Test.",
  engine: { key: "fixed_block" },
  weeks: [
    week([
      day("Day 1", [ex("Back squat", sxr(4, 9, 0.7), { lift: "squat" }), ex("Bench press", [amrap(0.85, 5)], { lift: "bench" })]),
      day("Day 2", [
        ex("Back squat", sxr(2, 3, 0.8, 180, 10), { lift: "squat" }),
        ex("Barbell row", [fixed(range(8, 12)), { kind: "same_as_last", reps: 8, rest: 90 }]),
        ex("Chin-up", [fixed(10)], { bodyweight: true }),
      ]),
    ]),
    week([day("Test day", [maxTest("Back squat", "squat")], true)], "Test"),
  ],
};

const state: EngineState = { ...emptyState(), maxes: { squat: 166.67, bench: 100 }, tms: { squat: 150, bench: 90 }, weights: { "barbell row@8-12": 60 } };

// State keys: name, tier and rep range.
assert.equal(stateKey(ex("Barbell row", [fixed(range(8, 12))])), "barbell row@8-12");
assert.equal(stateKey(ex("Back squat", [fixed(3)], { tier: "t1" })), "t1:back squat");
assert.equal(stateKey(ex("Bench press", sxr(3, 5, 0.8))), "bench press");
assert.equal(progresses(ex("Barbell row", [fixed(5)])), true);
assert.equal(progresses(ex("Chin-up", [fixed(5)], { bodyweight: true })), false);
assert.equal(progresses(ex("Back squat", sxr(3, 5, 0.8), { lift: "squat" })), false);

// Day 1: percentages of the training max, rounded to 2.5 kg.
const d1 = planSession(t, state, { stepKg: 2.5 })!;
assert.equal(d1.dayName, "Day 1");
assert.equal(d1.position, 0);
assert.equal(summarisePlanned(d1.exercises[0].sets, "kg"), "4 x 9 at 105 kg");
assert.equal(summarisePlanned(d1.exercises[1].sets, "kg"), "1 x 5+ at 77.5 kg");
assert.equal(d1.exercises[1].sets[0].amrap, true);

// Day 2: a fixed kg on top, engine weights, same as last, bodyweight.
const d2 = planSession(t, { ...state, day: 1 }, { stepKg: 2.5 })!;
assert.equal(d2.position, 1);
assert.equal(summarisePlanned(d2.exercises[0].sets, "kg"), "2 x 3 at 130 kg");
assert.deepEqual(d2.exercises[1].sets.map((s) => [s.kg, s.reps, s.repsMax]), [[60, 8, 12], [60, 8, null]]);
assert.equal(d2.exercises[2].sets[0].kg, null);
assert.equal(d2.exercises[2].bodyweight, true);

// Test day: warm-ups from the training max, the attempt from the max.
const td = planSession(t, { ...state, week: 1, day: 0 }, { stepKg: 2.5 })!;
assert.equal(td.test, true);
assert.equal(td.weekLabel, "Test");
assert.deepEqual(td.exercises[0].sets.map((s) => s.kg), [75, 105, 127.5, 142.5, 167.5]);
const td2 = planSession(t, { ...state, week: 1, day: 0 }, { stepKg: 2.5, e1rm: { "back squat": 200 } })!;
assert.equal(td2.exercises[0].sets[4].kg, 200);

// Pounds: the smallest jump is 5 lb.
const lb = planSession(t, state, { stepKg: STEP_5LB_KG })!;
assert.equal(summarisePlanned(lb.exercises[0].sets, "lb"), "4 x 9 at 230 lb");

// A finished block has no next session.
assert.equal(planSession(t, { ...state, finished: true }, { stepKg: 2.5 }), null);

// Positions.
assert.equal(sessionCount(t), 3);
assert.equal(positionOf(t, 1, 0), 2);
assert.equal(isLastSession(t, 1, 0), true);
assert.equal(isLastSession(t, 0, 1), false);
assert.deepEqual(advance(t, { week: 0, day: 0, cycle: 0 }), { week: 0, day: 1, cycle: 0, wrapped: false });
assert.deepEqual(advance(t, { week: 0, day: 1, cycle: 0 }), { week: 1, day: 0, cycle: 0, wrapped: false });
assert.deepEqual(advance(t, { week: 1, day: 0, cycle: 0 }), { week: 0, day: 0, cycle: 1, wrapped: true });
assert.equal(weekNumber(t, { week: 1, cycle: 2 }), 6);

// Summaries for the staff preview.
assert.equal(summariseRx(sxr(4, 9, 0.7)), "4 x 9 at 70%");
assert.equal(summariseRx(sxr(2, 3, 0.8, 180, 10)), "2 x 3 at 80% + 10 kg");
assert.equal(summariseRx(sxr(3, 2, 0.725)), "3 x 2 at 72.5%");
assert.equal(summariseRx([fixed(range(8, 12)), fixed(range(8, 12))]), "2 x 8-12");
assert.equal(
  summariseRx(maxTest("Back squat", "squat").sets),
  "1 x 5 at 50%, then 1 x 3 at 70%, then 1 x 1 at 85%, then 1 x 1 at 95%, then 1 x 1 at RPE 10",
);
assert.equal(schemeLabel([fixed(3), fixed(3), fixed(3), fixed(3), fixed(3, 180, true)]), "5 x 3+");
assert.equal(schemeLabel([fixed(10), fixed(10), fixed(10)]), "3 x 10");

console.log("programs/planner: ok");
```

- [ ] **Step 9: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/planner.test.ts`
Expected: FAIL with `Cannot find module './planner'`.

- [ ] **Step 10: Write `planner.ts`**

```ts
// app/src/lib/programs/planner.ts
/**
 * Template + engine state -> the session a member does next, with every
 * weight worked out. Also position helpers and the text summaries the cards,
 * previews and the logger show. Pure.
 */
import type { DayRx, EngineState, ExerciseRx, PlannedExercise, PlannedSession, PlannedSet, ProgramTemplate, Reps, SetRx, WeightUnit } from "./types";
import { formatWeight, roundToStep, weightForRpe } from "./units";

/**
 * The key an exercise's working weight is kept under: its name, its GZCLP
 * tier, and its rep range, so the same lift done in two rep ranges (PHAT)
 * keeps two weights.
 */
export function stateKey(ex: Pick<ExerciseRx, "name" | "tier" | "sets">): string {
  const base = ex.name.trim().toLowerCase().replace(/\s+/g, " ");
  const first = ex.sets[0];
  const rangeTag = first && first.kind === "fixed" && typeof first.reps !== "number" ? `@${first.reps.min}-${first.reps.max}` : "";
  return `${ex.tier ? `${ex.tier}:` : ""}${base}${rangeTag}`;
}

/** The sets an exercise uses now: its current GZCLP stage, or its sets. */
export function setsFor(ex: ExerciseRx, stages: Record<string, number>): SetRx[] {
  if (!ex.stages || ex.stages.length === 0) return ex.sets;
  const i = Math.min(Math.max(0, stages[stateKey(ex)] ?? 0), ex.stages.length - 1);
  return ex.stages[i];
}

/** The engine can move this exercise's weight: fixed-weight sets, not bodyweight, not switched off. */
export function progresses(ex: ExerciseRx): boolean {
  if (ex.bodyweight || ex.progress === false) return false;
  return [...ex.sets, ...(ex.stages ?? []).flat()].some((s) => s.kind === "fixed");
}

export function sessionCount(t: Pick<ProgramTemplate, "weeks">): number {
  return t.weeks.reduce((n, w) => n + w.days.length, 0);
}

export function positionOf(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): number {
  let n = 0;
  for (let w = 0; w < week && w < t.weeks.length; w++) n += t.weeks[w].days.length;
  return n + day;
}

export function dayAt(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): DayRx | null {
  return t.weeks[week]?.days[day] ?? null;
}

export function isLastSession(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): boolean {
  const last = t.weeks.length - 1;
  return week === last && day === t.weeks[last].days.length - 1;
}

/** The position after this one; after the last session it wraps to the start of the next cycle. */
export function advance(
  t: Pick<ProgramTemplate, "weeks">,
  pos: { week: number; day: number; cycle: number },
): { week: number; day: number; cycle: number; wrapped: boolean } {
  const w = t.weeks[pos.week];
  if (w && pos.day + 1 < w.days.length) return { week: pos.week, day: pos.day + 1, cycle: pos.cycle, wrapped: false };
  if (pos.week + 1 < t.weeks.length) return { week: pos.week + 1, day: 0, cycle: pos.cycle, wrapped: false };
  return { week: 0, day: 0, cycle: pos.cycle + 1, wrapped: true };
}

/** "Week 3": weeks run on across repeats of a short cycle. */
export function weekNumber(t: Pick<ProgramTemplate, "weeks">, s: Pick<EngineState, "week" | "cycle">): number {
  return s.cycle * t.weeks.length + s.week + 1;
}

export interface PlanContext {
  stepKg: number;
  /** Best estimated max per state key, from the member's logs, for RPE sets. */
  e1rm?: Record<string, number>;
}

function repsOf(r: Reps): { reps: number; repsMax: number | null } {
  return typeof r === "number" ? { reps: r, repsMax: null } : { reps: r.min, repsMax: r.max };
}

function planSet(s: SetRx, ex: ExerciseRx, key: string, state: EngineState, ctx: PlanContext, prev: PlannedSet | undefined): PlannedSet {
  switch (s.kind) {
    case "pct":
    case "amrap": {
      const tm = ex.lift ? state.tms[ex.lift] : undefined;
      return {
        kg: tm ? roundToStep(tm * s.pct + (s.addKg ?? 0), ctx.stepKg) : null,
        reps: s.reps,
        repsMax: null,
        amrap: s.kind === "amrap",
        rpe: null,
        pct: s.pct,
        rest: s.rest,
        drives: s.drives === true,
      };
    }
    case "rpe": {
      const e1 = ctx.e1rm?.[key] ?? (ex.lift ? state.maxes[ex.lift] : undefined);
      return { kg: e1 ? roundToStep(weightForRpe(e1, s.reps, s.rpe), ctx.stepKg) : null, reps: s.reps, repsMax: null, amrap: false, rpe: s.rpe, pct: null, rest: s.rest, drives: false };
    }
    case "fixed":
      return { kg: state.weights[key] ?? null, ...repsOf(s.reps), amrap: s.amrap === true, rpe: null, pct: null, rest: s.rest, drives: false };
    case "same_as_last":
      return { kg: prev ? prev.kg : null, ...repsOf(s.reps), amrap: false, rpe: null, pct: null, rest: s.rest, drives: false };
    default: {
      const never: never = s;
      return never;
    }
  }
}

export function planExercise(ex: ExerciseRx, index: number, state: EngineState, ctx: PlanContext): PlannedExercise {
  const key = stateKey(ex);
  const sets: PlannedSet[] = [];
  for (const s of setsFor(ex, state.stages)) {
    const p = planSet(s, ex, key, state, ctx, sets[sets.length - 1]);
    sets.push(ex.bodyweight ? { ...p, kg: null } : p);
  }
  return {
    index,
    name: ex.name,
    lift: ex.lift ?? null,
    tier: ex.tier ?? null,
    stateKey: key,
    bodyweight: ex.bodyweight === true,
    progresses: progresses(ex),
    joined: ex.joined === true,
    notes: ex.notes ?? null,
    sets,
  };
}

/** The session at the state's position, or null when the program is finished. */
export function planSession(t: ProgramTemplate, state: EngineState, ctx: PlanContext): PlannedSession | null {
  if (state.finished) return null;
  const d = dayAt(t, state.week, state.day);
  if (!d) return null;
  return {
    week: state.week,
    day: state.day,
    position: positionOf(t, state.week, state.day),
    dayName: d.name,
    weekLabel: t.weeks[state.week].label ?? null,
    test: d.test === true,
    exercises: d.exercises.map((ex, i) => planExercise(ex, i, state, ctx)),
  };
}

/** "5", "8-12", "5+". */
export function repsLabel(s: Pick<PlannedSet, "reps" | "repsMax" | "amrap">): string {
  return `${s.reps}${s.repsMax !== null && s.repsMax !== s.reps ? `-${s.repsMax}` : ""}${s.amrap ? "+" : ""}`;
}

function groupPieces(pieces: string[]): string {
  const groups: { n: number; piece: string }[] = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.piece === piece) last.n++;
    else groups.push({ n: 1, piece });
  }
  return groups.map((g) => `${g.n} x ${g.piece}`).join(", then ");
}

/** "4 x 9 at 102.5 kg", "2 x 5 at 40 kg, then 1 x 5+ at 40 kg", "1 x 3 at RPE 8, about 140 kg". */
export function summarisePlanned(sets: PlannedSet[], unit: WeightUnit): string {
  return groupPieces(
    sets.map((s) => {
      const load =
        s.rpe !== null ? ` at RPE ${s.rpe}${s.kg !== null ? `, about ${formatWeight(s.kg, unit)}` : ""}` : s.kg !== null ? ` at ${formatWeight(s.kg, unit)}` : "";
      return `${repsLabel(s)}${load}`;
    }),
  );
}

function repsText(r: Reps): string {
  return typeof r === "number" ? String(r) : `${r.min}-${r.max}`;
}

function pctText(p: number): string {
  return `${Math.round(p * 1000) / 10}%`;
}

/** "4 x 9 at 70%", "2 x 3 at 80% + 10 kg", "3 x 8-12". */
export function summariseRx(sets: SetRx[]): string {
  return groupPieces(
    sets.map((s) => {
      switch (s.kind) {
        case "pct":
        case "amrap":
          return `${s.reps}${s.kind === "amrap" ? "+" : ""} at ${pctText(s.pct)}${s.addKg ? ` + ${s.addKg} kg` : ""}`;
        case "rpe":
          return `${s.reps} at RPE ${s.rpe}`;
        case "fixed":
          return `${repsText(s.reps)}${s.amrap ? "+" : ""}`;
        case "same_as_last":
          return `${repsText(s.reps)} at the same weight`;
        default: {
          const never: never = s;
          return never;
        }
      }
    }),
  );
}

/** A GZCLP rep scheme as lifters write it: "5 x 3+", "3 x 10". */
export function schemeLabel(sets: SetRx[]): string {
  const first = sets[0];
  const last = sets[sets.length - 1];
  const plus = !!last && (last.kind === "amrap" || (last.kind === "fixed" && last.amrap === true));
  return `${sets.length} x ${first ? repsText(first.reps) : "0"}${plus ? "+" : ""}`;
}
```

- [ ] **Step 11: Run the planner test**

Run: `cd app && npm test -- src/lib/programs/planner.test.ts`
Expected: PASS, prints `programs/planner: ok`.

- [ ] **Step 12: Typecheck the new files**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add app/src/lib/programs/types.ts app/src/lib/programs/units.ts app/src/lib/programs/exercises.ts app/src/lib/programs/dsl.ts app/src/lib/programs/planner.ts app/src/lib/programs/units.test.ts app/src/lib/programs/planner.test.ts
git commit -m "feat(programs): pure program model, units and planner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The five progression engines

**Files:**
- Create: `app/src/lib/programs/engines.ts`
- Test: `app/src/lib/programs/engines.test.ts`

**Interfaces:**
- Consumes (Task 1): `types.ts` (all types, `LIFT_LABEL`, `emptyState`), `units.ts` (`roundToStep`, `formatWeight`, `maxFromSet`, `trainingMax`), `planner.ts` (`advance`, `isLastSession`, `progresses`, `stateKey`, `schemeLabel`, `planSession`), `dsl.ts` (tests only).
- Produces:
  - `initState(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, stepKg: number): EngineState` sets maxes, training maxes (`trainingMax(max, t.tmPct)`), starting weights for fixed-weight exercises with a lift (`max x (ex.startPct ?? engine startPct)`, rounded, never below a 20 kg bar), and GZCLP `t2Base`.
  - `interface ProgressInput { template: ProgramTemplate; state: EngineState; result: SessionResult; stepKg: number; unit: WeightUnit }`
  - `interface ProgressOutput { state: EngineState; reasons: string[] }`
  - `progress(input: ProgressInput): ProgressOutput` runs the template's engine on the session just finished (at `state.week/day`), then advances the position. A fixed block's last session sets `finished = true` and does not advance.
  - `skipState(t: ProgramTemplate, state: EngineState): EngineState` advances without running the engine (a skipped last block session finishes the block).
  - `hitAll(r: ExerciseResult): boolean`, `workingKg(r: ExerciseResult): number | null`.

- [ ] **Step 1: Write the failing engines test**

```ts
// app/src/lib/programs/engines.test.ts
// Run: npm test -- src/lib/programs/engines.test.ts
//
// Each engine is a pure function (state, template, session results) -> (new
// state, reasons). Covers: all reps hit, a missed set, three misses in a row,
// AMRAP scoring, the end of a cycle, and test day, for all five engines.
import assert from "node:assert/strict";

import { amrap, day, ex, fixed, maxTest, pct, range, sxr, times, week } from "./dsl";
import { initState, progress, skipState } from "./engines";
import { planSession } from "./planner";
import type { DoneSet, EngineState, PlannedSet, ProgramTemplate, SessionResult } from "./types";

type Perform = (name: string, i: number, p: PlannedSet) => DoneSet;

const base = {
  author: "Test",
  family: "strength" as const,
  level: "beginner" as const,
  daysPerWeek: 1,
  lengthWeeks: 1,
  tmPct: 1,
  who: "Testers.",
  description: "Test.",
};

function run(t: ProgramTemplate, state: EngineState, perform: Perform) {
  const session = planSession(t, state, { stepKg: 2.5 });
  assert.ok(session, "there is a session to run");
  const result: SessionResult = { exercises: session.exercises.map((e) => ({ planned: e, sets: e.sets.map((s, i) => perform(e.name, i, s)) })) };
  return progress({ template: t, state, result, stepKg: 2.5, unit: "kg" });
}

const asPlanned: Perform = (_n, _i, s) => ({ kg: s.kg, reps: s.amrap ? s.reps + 2 : s.repsMax ?? s.reps, done: true });

// ── 1. Linear with deloads ────────────────────────────────────────────────
const lin: ProgramTemplate = {
  ...base,
  key: "lin",
  name: "Lin",
  lifts: ["squat", "deadlift"],
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([day("A", [ex("Back squat", times(5, fixed(5)), { lift: "squat" }), ex("Deadlift", [fixed(5)], { lift: "deadlift" })])])],
};
const l0 = initState(lin, { squat: 200, deadlift: 200 }, 2.5);
assert.equal(l0.weights["back squat"], 100);
assert.equal(l0.weights["deadlift"], 100);
assert.equal(l0.tms.squat, 200);

// all reps hit: +2.5 kg, +5 kg on the deadlift
const l1 = run(lin, l0, asPlanned);
assert.equal(l1.state.weights["back squat"], 102.5);
assert.equal(l1.state.weights["deadlift"], 105);
assert.ok(l1.reasons.includes("Next back squat 102.5 kg. You did all 5 sets of 5."));
assert.ok(l1.reasons.includes("Next deadlift 105 kg. You did your set of 5."));
assert.equal(l1.state.cycle, 1, "a one-day template wraps to the next cycle");

// a missed set: the weight stays
const missSet4: Perform = (n, i, p) => (n === "Back squat" && i === 3 ? { kg: p.kg, reps: 3, done: true } : asPlanned(n, i, p));
const m1 = run(lin, l1.state, missSet4);
assert.equal(m1.state.weights["back squat"], 102.5);
assert.equal(m1.state.misses["back squat"], 1);
assert.ok(m1.reasons.includes("Back squat stays at 102.5 kg. You got 3 of 5 on set 4. Try it again next time."));

// three misses in a row: 10% lighter
const m2 = run(lin, m1.state, missSet4);
const m3 = run(lin, m2.state, missSet4);
assert.equal(m3.state.weights["back squat"], 92.5);
assert.equal(m3.state.misses["back squat"], 0);
assert.ok(m3.reasons.includes("Next back squat 92.5 kg, 10% lighter. You missed reps three sessions in a row."));

// an unticked set is a miss too
const unticked = run(lin, l1.state, (n, i, p) => (n === "Deadlift" ? { kg: p.kg, reps: null, done: false } : asPlanned(n, i, p)));
assert.ok(unticked.reasons.includes("Deadlift stays at 105 kg. Set 1 wasn't ticked. Try it again next time."));

// the weight actually lifted counts
const heavier = run(lin, l1.state, (n, _i, p) => ({ kg: n === "Back squat" ? 110 : p.kg, reps: p.reps, done: true }));
assert.equal(heavier.state.weights["back squat"], 112.5);

// AMRAP scoring (Greyskull): 10+ reps doubles the jump; any miss resets 10%
const gs: ProgramTemplate = {
  ...base,
  key: "gs",
  name: "Gs",
  lifts: ["squat"],
  engine: { key: "linear", increment: 1.25, increments: { squat: 2.5 }, deloadAfter: 1, deloadPct: 0.1, startPct: 0.5, doubleAt: 10 },
  weeks: [week([day("A", [ex("Back squat", [fixed(5), fixed(5), fixed(5, 180, true)], { lift: "squat" })])])],
};
const g0 = initState(gs, { squat: 200 }, 2.5);
const big = run(gs, g0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 12 : 5, done: true }));
assert.equal(big.state.weights["back squat"], 105);
assert.ok(big.reasons.includes("Next back squat 105 kg. You got 12 on the last set, so it goes up twice as much."));
const small = run(gs, g0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 4 : 5, done: true }));
assert.equal(small.state.weights["back squat"], 90);
assert.ok(small.reasons.includes("Next back squat 90 kg, 10% lighter. You got 4 of 5 on set 3."));

// ── 2. Training-max cycles ────────────────────────────────────────────────
// 2a. cycle rule (5/3/1): + sets are scored; the training max rises at the end of the cycle
const wave = (a: number, b: number, c: number, reps: number, plus = true) =>
  ex("Bench press", [pct(a, reps), pct(b, reps), plus ? amrap(c, reps) : pct(c, reps)], { lift: "bench" });
const cyc: ProgramTemplate = {
  ...base,
  key: "cyc",
  name: "Cyc",
  lifts: ["bench"],
  tmPct: 0.9,
  engine: { key: "tm_cycle", rule: "cycle", increment: 2.5, increments: { squat: 5 } },
  weeks: [week([day("Bench", [wave(0.65, 0.75, 0.85, 5)])]), week([day("Deload", [wave(0.4, 0.5, 0.6, 5, false)])])],
};
const c0 = initState(cyc, { bench: 111.11 }, 2.5);
assert.equal(c0.tms.bench, 100);
const c1 = run(cyc, c0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 7 : 5, done: true }));
assert.deepEqual(c1.reasons, ["Bench press: 7 reps on the 5+ set."]);
assert.equal(c1.state.tms.bench, 100, "no change inside the cycle");
assert.equal(c1.state.week, 1);
const c2 = run(cyc, c1.state, asPlanned);
assert.equal(c2.state.tms.bench, 102.5);
assert.ok(c2.reasons.includes("Bench press training max goes up to 102.5 kg for the next cycle."));
assert.equal(c2.state.cycle, 1);
assert.equal(c2.state.week, 0);
// short on a + set: the training max holds at the end of the cycle
const s1 = run(cyc, c0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 3 : 5, done: true }));
assert.equal(s1.state.short.bench, true);
const s2 = run(cyc, s1.state, asPlanned);
assert.equal(s2.state.tms.bench, 100);
assert.ok(s2.reasons.includes("Bench press training max stays at 100 kg. You fell short on a + set this cycle."));
assert.deepEqual(s2.state.short, {});

// 2b. amrap_table rule (nSuns): the driving 1+ set moves the training max by the table
const tab: ProgramTemplate = {
  ...base,
  key: "tab",
  name: "Tab",
  lifts: ["squat"],
  tmPct: 0.9,
  engine: {
    key: "tm_cycle",
    rule: "amrap_table",
    increment: 0,
    amrapTable: [
      { minReps: 0, kg: 0 },
      { minReps: 2, kg: 2.5 },
      { minReps: 4, kg: 5 },
      { minReps: 6, kg: 7.5 },
    ],
  },
  weeks: [week([day("Squat", [ex("Back squat", [pct(0.75, 5), amrap(0.95, 1, 180, { drives: true }), amrap(0.65, 5)], { lift: "squat" })])])],
};
const t0 = initState(tab, { squat: 111.11 }, 2.5);
const t3reps = run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 3 : p.reps, done: true }));
assert.equal(t3reps.state.tms.squat, 102.5);
assert.ok(t3reps.reasons.includes("Squat training max goes up to 102.5 kg. You got 3 on the 1+ set."));
const t1rep = run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 1 : p.reps, done: true }));
assert.equal(t1rep.state.tms.squat, 100);
assert.ok(t1rep.reasons.includes("Squat training max stays at 100 kg. You got 1 on the 1+ set."));
assert.equal(run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 6 : p.reps, done: true })).state.tms.squat, 107.5);

// 2c. drive_set rule (Texas Method): the top set completed raises the training max
const tex: ProgramTemplate = {
  ...base,
  key: "tex",
  name: "Tex",
  lifts: ["squat"],
  tmPct: 6 / 7,
  engine: { key: "tm_cycle", rule: "drive_set", increment: 2.5 },
  weeks: [week([day("Intensity", [ex("Back squat", [pct(1, 5, 300, { drives: true })], { lift: "squat" })])])],
};
const x0 = initState(tex, { squat: 116.67 }, 2.5);
assert.equal(x0.tms.squat, 100);
const x1 = run(tex, x0, asPlanned);
assert.equal(x1.state.tms.squat, 102.5);
assert.ok(x1.reasons.includes("Squat training max goes up to 102.5 kg. You got all 5 reps on your top set."));
const x2 = run(tex, x0, (_n, _i, p) => ({ kg: p.kg, reps: 4, done: true }));
assert.equal(x2.state.tms.squat, 100);
assert.ok(x2.reasons.includes("Squat training max stays at 100 kg. You got 4 of 5 on your top set."));

// 2d. gzclp rule: a failed lift moves to its next rep scheme
const T1 = [
  [...times(4, fixed(3, 180)), fixed(3, 180, true)],
  [...times(5, fixed(2, 180)), fixed(2, 180, true)],
  [...times(9, fixed(1, 180)), fixed(1, 180, true)],
];
const T2 = [times(3, fixed(10, 120)), times(3, fixed(8, 120)), times(3, fixed(6, 120))];
const gz: ProgramTemplate = {
  ...base,
  key: "gz",
  name: "Gz",
  lifts: ["squat", "bench"],
  engine: { key: "tm_cycle", rule: "gzclp", increment: 2.5, increments: { squat: 5 }, t2ResetKg: 5, t3AmrapTarget: 25 },
  weeks: [
    week([
      day("A1", [
        ex("Back squat", T1[0], { lift: "squat", tier: "t1", stages: T1, startPct: 0.73 }),
        ex("Bench press", T2[0], { lift: "bench", tier: "t2", stages: T2, startPct: 0.55 }),
        ex("Lat pulldown", [fixed(15, 60), fixed(15, 60), fixed(15, 60, true)], { tier: "t3" }),
      ]),
    ]),
  ],
};
const z0 = initState(gz, { squat: 100, bench: 100 }, 2.5);
assert.equal(z0.weights["t1:back squat"], 72.5);
assert.equal(z0.weights["t2:bench press"], 55);
assert.equal(z0.t2Base["t2:bench press"], 55);
const gzPerfect: Perform = (_n, _i, p) => ({ kg: p.kg ?? 30, reps: p.amrap ? p.reps + 2 : p.reps, done: true });
const z1 = run(gz, z0, gzPerfect);
assert.equal(z1.state.weights["t1:back squat"], 77.5);
assert.ok(z1.reasons.includes("Next back squat 77.5 kg. You did every set."));
assert.equal(z1.state.weights["t3:lat pulldown"], 30, "a T3 weight is kept from the first log");
const failT1: Perform = (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Back squat" && i === 0 ? p.reps - 1 : p.reps, done: true });
const f1 = run(gz, z0, failT1);
assert.equal(f1.state.stages["t1:back squat"], 1);
assert.equal(f1.state.weights["t1:back squat"], 72.5);
assert.ok(f1.reasons.includes("Back squat moves to 6 x 2+ at 72.5 kg. You got 2 of 3 on set 1."));
const f2 = run(gz, f1.state, failT1);
assert.equal(f2.state.stages["t1:back squat"], 2);
const f3 = run(gz, f2.state, failT1);
assert.equal(f3.state.stages["t1:back squat"], 0);
assert.equal(f3.state.weights["t1:back squat"], 62.5);
assert.ok(f3.reasons.includes("Back squat goes back to 5 x 3+ at 62.5 kg, 85% of where it stalled."));
const failT2: Perform = (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Bench press" && i === 2 ? p.reps - 2 : p.reps, done: true });
const b1 = run(gz, z0, failT2);
assert.equal(b1.state.stages["t2:bench press"], 1);
const b3 = run(gz, run(gz, b1.state, failT2).state, failT2);
assert.equal(b3.state.stages["t2:bench press"], 0);
assert.equal(b3.state.weights["t2:bench press"], 60);
assert.ok(b3.reasons.includes("Bench press goes back to 3 x 10 at 60 kg."));
const t3up = run(gz, z1.state, (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Lat pulldown" && i === 2 ? 26 : p.reps, done: true }));
assert.equal(t3up.state.weights["t3:lat pulldown"], 32.5);
assert.ok(t3up.reasons.includes("Next lat pulldown 32.5 kg. You got 26 on the last set."));

// ── 3. Fixed block with re-test ───────────────────────────────────────────
const blk: ProgramTemplate = {
  ...base,
  key: "blk",
  name: "Blk",
  lifts: ["squat"],
  engine: { key: "fixed_block" },
  weeks: [week([day("Day 1", [ex("Back squat", sxr(4, 9, 0.7), { lift: "squat" })])]), week([day("Test day", [maxTest("Back squat", "squat")], true)])],
};
const k0 = initState(blk, { squat: 150 }, 2.5);
const k1 = run(blk, k0, asPlanned);
assert.deepEqual(k1.reasons, [], "no changes inside the block");
assert.deepEqual(k1.state.tms, k0.tms);
assert.equal(k1.state.week, 1);
const k2 = run(blk, k1.state, (_n, i, p) => ({ kg: i === 4 ? 160 : p.kg, reps: i === 4 ? 2 : p.reps, done: true }));
assert.equal(k2.state.testMaxes.squat, 170.67);
assert.equal(k2.state.finished, true);
assert.equal(k2.state.week, 1, "a finished block does not wrap");
assert.ok(k2.reasons.includes("Your new squat max is about 170 kg, from 160 kg x 2."));
assert.ok(k2.reasons.includes("Block done. Start it again from your new max when you're ready."));
assert.equal(planSession(blk, k2.state, { stepKg: 2.5 }), null);
const kNo = run(blk, k1.state, (_n, _i, p) => ({ kg: p.kg, reps: null, done: false }));
assert.ok(kNo.reasons.includes("No squat max from today. Enter one when you start again."));

// ── 4. Double progression ─────────────────────────────────────────────────
const dp: ProgramTemplate = {
  ...base,
  key: "dp",
  name: "Dp",
  lifts: [],
  engine: { key: "double_progression" },
  weeks: [
    week([
      day("Upper", [
        ex("Incline dumbbell press", times(3, fixed(range(8, 12), 90))),
        ex("Lateral raise", times(3, fixed(range(12, 15), 60)), { progress: false }),
      ]),
    ]),
  ],
};
const d0 = initState(dp, {}, 2.5);
const d1 = run(dp, d0, () => ({ kg: 30, reps: 10, done: true }));
assert.equal(d1.state.weights["incline dumbbell press@8-12"], 30);
assert.equal(d1.state.weights["lateral raise@12-15"], undefined);
assert.deepEqual(d1.reasons, ["Weights saved from today. Each one goes up when you reach the top of its rep range on every set."]);
const d2 = run(dp, d1.state, (_n, _i, p) => ({ kg: p.kg ?? 10, reps: p.repsMax ?? p.reps, done: true }));
assert.equal(d2.state.weights["incline dumbbell press@8-12"], 32.5);
assert.deepEqual(d2.reasons, ["Next incline dumbbell press 32.5 kg, back to 8 reps. You hit 12 on every set."]);
const d3 = run(dp, d2.state, (_n, i, p) => ({ kg: p.kg ?? 10, reps: i === 2 ? 11 : 12, done: true }));
assert.equal(d3.state.weights["incline dumbbell press@8-12"], 32.5);
assert.deepEqual(d3.reasons, []);

// ── 5. Fixed volume ───────────────────────────────────────────────────────
const gv: ProgramTemplate = {
  ...base,
  key: "gv",
  name: "Gv",
  lifts: ["bench"],
  engine: { key: "fixed_volume", increment: 2.5, startPct: 0.6 },
  weeks: [week([day("Chest", [ex("Bench press", times(10, fixed(10, 90)), { lift: "bench" })])])],
};
const v0 = initState(gv, { bench: 100 }, 2.5);
assert.equal(v0.weights["bench press"], 60);
const v1 = run(gv, v0, asPlanned);
assert.equal(v1.state.weights["bench press"], 62.5);
assert.ok(v1.reasons.includes("Next bench press 62.5 kg. You did all 100 reps."));
const v2 = run(gv, v0, (_n, i, p) => ({ kg: p.kg, reps: i >= 7 ? 6 : 10, done: true }));
assert.equal(v2.state.weights["bench press"], 60);
assert.ok(v2.reasons.includes("Bench press stays at 60 kg. You did 88 of 100 reps."));

// ── skipping ──────────────────────────────────────────────────────────────
assert.equal(skipState(blk, k1.state).finished, true, "skipping the last block session finishes it");
const skipped = skipState(cyc, c0);
assert.equal(skipped.week, 1);
assert.equal(skipped.tms.bench, 100, "a skip runs no engine");

// ── a lighter bar never goes below 20 kg ─────────────────────────────────
assert.equal(initState(lin, { squat: 30, deadlift: 30 }, 2.5).weights["back squat"], 20);

console.log("programs/engines: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/engines.test.ts`
Expected: FAIL with `Cannot find module './engines'`.

- [ ] **Step 3: Write `engines.ts`**

```ts
// app/src/lib/programs/engines.ts
/**
 * The five progression engines. Each takes the session just finished (at
 * state.week/day), what the member actually lifted, and returns the new state
 * with a reason for every change. progress() then moves the position on.
 * Pure: no server imports.
 */
import { advance, isLastSession, progresses, schemeLabel, stateKey } from "./planner";
import {
  LIFT_LABEL,
  emptyState,
  type EngineState,
  type ExerciseResult,
  type FixedVolumeSettings,
  type LiftKey,
  type LinearSettings,
  type ProgramTemplate,
  type SessionResult,
  type TmCycleSettings,
  type WeightUnit,
} from "./types";
import { formatWeight, maxFromSet, roundToStep, trainingMax } from "./units";

export interface ProgressInput {
  template: ProgramTemplate;
  state: EngineState;
  result: SessionResult;
  stepKg: number;
  unit: WeightUnit;
}

export interface ProgressOutput {
  state: EngineState;
  reasons: string[];
}

interface Ctx extends ProgressInput {
  atCycleEnd: boolean;
  reasons: string[];
  fmt: (kg: number) => string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => WORDS[n] ?? String(n);
const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;

function engineStartPct(t: ProgramTemplate): number | undefined {
  const e = t.engine;
  if (e.key === "linear" || e.key === "fixed_volume") return e.startPct;
  if (e.key === "tm_cycle") return e.startPct;
  return undefined;
}

/** The state a member starts a program with, from their maxes. */
export function initState(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, stepKg: number): EngineState {
  const s = emptyState();
  for (const lift of t.lifts) {
    const m = maxes[lift];
    if (m && m > 0) {
      s.maxes[lift] = round2(m);
      s.tms[lift] = trainingMax(m, t.tmPct);
    }
  }
  const fallback = engineStartPct(t);
  const bar = roundToStep(20, stepKg);
  for (const w of t.weeks)
    for (const d of w.days)
      for (const ex of d.exercises) {
        const key = stateKey(ex);
        if (key in s.weights || !progresses(ex) || !ex.lift) continue;
        const startPct = ex.startPct ?? fallback;
        const max = s.maxes[ex.lift];
        if (!startPct || !max) continue;
        s.weights[key] = Math.max(bar, roundToStep(max * startPct, stepKg));
        if (ex.tier === "t2") s.t2Base[key] = s.weights[key];
      }
  return s;
}

/** Every planned set has a ticked set at or above its reps (a + set counts its minimum). */
export function hitAll(r: ExerciseResult): boolean {
  return r.planned.sets.every((p, i) => {
    const d = r.sets[i];
    return !!d && d.done && d.reps !== null && d.reps >= p.reps;
  });
}

function hitTop(r: ExerciseResult): boolean {
  return r.planned.sets.every((p, i) => {
    const d = r.sets[i];
    return !!d && d.done && d.reps !== null && d.reps >= (p.repsMax ?? p.reps);
  });
}

/** The lightest weight the member actually used on a ticked set. */
export function workingKg(r: ExerciseResult): number | null {
  const ks = r.sets.filter((s) => s.done && s.kg !== null && s.kg > 0).map((s) => s.kg as number);
  return ks.length ? Math.min(...ks) : null;
}

function missText(r: ExerciseResult): string {
  const i = r.planned.sets.findIndex((p, k) => {
    const d = r.sets[k];
    return !d || !d.done || d.reps === null || d.reps < p.reps;
  });
  if (i === -1) return "";
  const d = r.sets[i];
  return d && d.done && d.reps !== null ? `You got ${d.reps} of ${r.planned.sets[i].reps} on set ${i + 1}.` : `Set ${i + 1} wasn't ticked.`;
}

function lastAmrap(r: ExerciseResult): { want: number; got: number | null } | null {
  for (let i = r.planned.sets.length - 1; i >= 0; i--) {
    if (!r.planned.sets[i].amrap) continue;
    const d = r.sets[i];
    return { want: r.planned.sets[i].reps, got: d && d.done ? d.reps : null };
  }
  return null;
}

function setCountText(r: ExerciseResult): string {
  const sets = r.planned.sets;
  const reps = sets[0]?.reps;
  if (sets.length && sets.every((s) => s.reps === reps && !s.amrap && s.repsMax === null)) {
    return sets.length === 1 ? `your set of ${reps}` : `all ${sets.length} sets of ${reps}`;
  }
  return "every set";
}

function linear(c: Ctx, s: LinearSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
    const inc = (p.lift ? s.increments?.[p.lift] : undefined) ?? s.increment;
    const name = p.name.toLowerCase();
    if (hitAll(r)) {
      const a = lastAmrap(r);
      const double = s.doubleAt !== undefined && a !== null && a.got !== null && a.got >= s.doubleAt;
      const next = roundToStep(used + (double ? inc * 2 : inc), c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.state.misses[p.stateKey] = 0;
      c.reasons.push(
        double ? `Next ${name} ${c.fmt(next)}. You got ${a!.got} on the last set, so it goes up twice as much.` : `Next ${name} ${c.fmt(next)}. You did ${setCountText(r)}.`,
      );
      continue;
    }
    const misses = (c.state.misses[p.stateKey] ?? 0) + 1;
    if (misses >= s.deloadAfter) {
      const next = roundToStep(used * (1 - s.deloadPct), c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.state.misses[p.stateKey] = 0;
      c.reasons.push(
        `Next ${name} ${c.fmt(next)}, ${Math.round(s.deloadPct * 100)}% lighter. ${misses === 1 ? missText(r) : `You missed reps ${countWord(misses)} sessions in a row.`}`,
      );
    } else {
      c.state.weights[p.stateKey] = used;
      c.state.misses[p.stateKey] = misses;
      c.reasons.push(`${p.name} stays at ${c.fmt(used)}. ${missText(r)} Try it again next time.`);
    }
  }
}

function tableKg(table: { minReps: number; kg: number }[], reps: number): number {
  let kg = 0;
  for (const row of [...table].sort((a, b) => a.minReps - b.minReps)) if (reps >= row.minReps) kg = row.kg;
  return kg;
}

function tmCycle(c: Ctx, s: TmCycleSettings): void {
  if (s.rule === "gzclp") return gzclp(c, s);
  const inc = (lift: LiftKey) => s.increments?.[lift] ?? s.increment;
  for (const r of c.result.exercises) {
    const lift = r.planned.lift;
    if (!lift) continue;
    r.planned.sets.forEach((p, i) => {
      const d = r.sets[i];
      const got = d && d.done ? d.reps : null;
      if (s.rule === "cycle" && p.amrap && got !== null) {
        c.reasons.push(`${LIFT_LABEL[lift]}: ${got} ${got === 1 ? "rep" : "reps"} on the ${p.reps}+ set.`);
        if (got < p.reps) c.state.short[lift] = true;
      }
      const cur = c.state.tms[lift];
      if (!p.drives || cur === undefined) return;
      if (s.rule === "amrap_table") {
        if (got === null) {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. The ${p.reps}+ set wasn't logged.`);
          return;
        }
        const kg = tableKg(s.amrapTable ?? [], got);
        if (kg > 0) {
          const next = round2(cur + kg);
          c.state.tms[lift] = next;
          c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)}. You got ${got} on the ${p.reps}+ set.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. You got ${got} on the ${p.reps}+ set.`);
        }
      } else if (s.rule === "drive_set") {
        if (got !== null && got >= p.reps) {
          const next = round2(cur + inc(lift));
          c.state.tms[lift] = next;
          c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)}. You got all ${p.reps} reps on your top set.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. You got ${got ?? 0} of ${p.reps} on your top set.`);
        }
      }
    });
  }
  if (s.rule === "cycle" && c.atCycleEnd) {
    for (const lift of c.template.lifts) {
      const tm = c.state.tms[lift];
      if (tm === undefined) continue;
      if (c.state.short[lift]) {
        c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(tm)}. You fell short on a + set this cycle.`);
      } else {
        const next = round2(tm + inc(lift));
        c.state.tms[lift] = next;
        c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)} for the next cycle.`);
      }
    }
    c.state.short = {};
  }
}

function gzclp(c: Ctx, s: TmCycleSettings): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses || !p.tier) continue;
    const stages = day?.exercises[p.index]?.stages ?? [];
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
    const name = p.name.toLowerCase();
    const inc = (p.lift ? s.increments?.[p.lift] : undefined) ?? s.increment;
    if (p.tier === "t3") {
      const a = lastAmrap(r);
      if (a && a.got !== null && a.got >= (s.t3AmrapTarget ?? 25)) {
        const next = roundToStep(used + c.stepKg, c.stepKg);
        c.state.weights[p.stateKey] = next;
        c.reasons.push(`Next ${name} ${c.fmt(next)}. You got ${a.got} on the last set.`);
      } else {
        c.state.weights[p.stateKey] = used;
      }
      continue;
    }
    const stage = c.state.stages[p.stateKey] ?? 0;
    if (hitAll(r)) {
      const next = roundToStep(used + inc, c.stepKg);
      c.state.weights[p.stateKey] = next;
      if (p.tier === "t2" && stage === 0) c.state.t2Base[p.stateKey] = next;
      c.reasons.push(`Next ${name} ${c.fmt(next)}. You did every set.`);
    } else if (stage + 1 < stages.length) {
      c.state.stages[p.stateKey] = stage + 1;
      c.state.weights[p.stateKey] = used;
      c.reasons.push(`${p.name} moves to ${schemeLabel(stages[stage + 1])} at ${c.fmt(used)}. ${missText(r)}`);
    } else if (p.tier === "t1") {
      const next = roundToStep(used * 0.85, c.stepKg);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.reasons.push(`${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}, 85% of where it stalled.`);
    } else {
      const next = roundToStep((c.state.t2Base[p.stateKey] ?? used) + (s.t2ResetKg ?? 5), c.stepKg);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.state.t2Base[p.stateKey] = next;
      c.reasons.push(`${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}.`);
    }
  }
}

function fixedBlock(c: Ctx): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  if (day?.test) {
    for (const r of c.result.exercises) {
      const lift = r.planned.lift;
      if (!lift) continue;
      let best: { e1: number; kg: number; reps: number } | null = null;
      for (const d of r.sets) {
        if (!d.done || d.kg === null || d.reps === null) continue;
        const e1 = maxFromSet(d.kg, d.reps);
        if (e1 !== null && (!best || e1 > best.e1)) best = { e1, kg: d.kg, reps: d.reps };
      }
      const label = LIFT_LABEL[lift].toLowerCase();
      if (best) {
        c.state.testMaxes[lift] = best.e1;
        c.reasons.push(`Your new ${label} max is about ${c.fmt(roundToStep(best.e1, c.stepKg))}, from ${c.fmt(best.kg)} x ${best.reps}.`);
      } else {
        c.reasons.push(`No ${label} max from today. Enter one when you start again.`);
      }
    }
  }
  if (c.atCycleEnd) c.reasons.push("Block done. Start it again from your new max when you're ready.");
}

function doubleProgression(c: Ctx): void {
  let firsts = 0;
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used = workingKg(r);
    if (used === null) continue;
    const had = c.state.weights[p.stateKey] !== undefined;
    if (hitTop(r)) {
      const next = roundToStep(used + c.stepKg, c.stepKg);
      c.state.weights[p.stateKey] = next;
      const first = p.sets[0];
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}, back to ${first.reps} reps. You hit ${first.repsMax ?? first.reps} on every set.`);
    } else {
      c.state.weights[p.stateKey] = used;
      if (!had) firsts++;
    }
  }
  if (firsts > 0) c.reasons.push("Weights saved from today. Each one goes up when you reach the top of its rep range on every set.");
}

function fixedVolume(c: Ctx, s: FixedVolumeSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
    const total = p.sets.reduce((n, x) => n + x.reps, 0);
    const got = r.sets.reduce((n, d) => n + (d.done && d.reps ? d.reps : 0), 0);
    if (got >= total) {
      const next = roundToStep(used + s.increment, c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}. You did all ${total} reps.`);
    } else {
      c.state.weights[p.stateKey] = used;
      c.reasons.push(`${p.name} stays at ${c.fmt(used)}. You did ${got} of ${total} reps.`);
    }
  }
}

/** Run the program's engine on the finished session, then move to the next session. */
export function progress(input: ProgressInput): ProgressOutput {
  const t = input.template;
  const c: Ctx = {
    ...input,
    state: clone(input.state),
    atCycleEnd: isLastSession(t, input.state.week, input.state.day),
    reasons: [],
    fmt: (kg) => formatWeight(kg, input.unit),
  };
  const e = t.engine;
  switch (e.key) {
    case "linear":
      linear(c, e);
      break;
    case "tm_cycle":
      tmCycle(c, e);
      break;
    case "fixed_block":
      fixedBlock(c);
      break;
    case "double_progression":
      doubleProgression(c);
      break;
    case "fixed_volume":
      fixedVolume(c, e);
      break;
  }
  if (e.key === "fixed_block" && c.atCycleEnd) {
    c.state.finished = true;
    return { state: c.state, reasons: c.reasons };
  }
  const next = advance(t, c.state);
  c.state.week = next.week;
  c.state.day = next.day;
  c.state.cycle = next.cycle;
  return { state: c.state, reasons: c.reasons };
}

/** Move past a session without running the engine. Skipping a block's last session finishes it. */
export function skipState(t: ProgramTemplate, state: EngineState): EngineState {
  const next = clone(state);
  if (t.engine.key === "fixed_block" && isLastSession(t, state.week, state.day)) {
    next.finished = true;
    return next;
  }
  const a = advance(t, state);
  next.week = a.week;
  next.day = a.day;
  next.cycle = a.cycle;
  return next;
}
```

- [ ] **Step 4: Run the engines test**

Run: `cd app && npm test -- src/lib/programs/engines.test.ts`
Expected: PASS, prints `programs/engines: ok`.

Hand-checked values the test relies on: 102.5 x 0.9 = 92.25 rounds to 92.5; 72.5 x 0.85 = 61.6 rounds to 62.5; 160 x (1 + 2/30) = 170.67, shown rounded to the 2.5 kg jump as 170 kg; 70 + 3 x 6 = 88 reps.

- [ ] **Step 5: Typecheck**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/programs/engines.ts app/src/lib/programs/engines.test.ts
git commit -m "feat(programs): five progression engines with reasons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Template check, simulation harness, registry, and the beginner linear programs

**Files:**
- Create: `app/src/lib/programs/validate.ts`
- Create: `app/src/lib/programs/simulate.ts`
- Create: `app/src/lib/programs/registry.ts`
- Create: `app/src/lib/programs/templates/stronglifts.ts`
- Create: `app/src/lib/programs/templates/startingStrength.ts`
- Create: `app/src/lib/programs/templates/greyskull.ts`
- Test: `app/src/lib/programs/registry.test.ts` (runs over every registered program; later tasks only add programs)
- Test: `app/src/lib/programs/templates/beginner.test.ts`

**Interfaces:**
- Consumes (Tasks 1-2): `dsl.ts` builders, `planner.ts` (`planSession`, `sessionCount`, `summarisePlanned`), `engines.ts` (`initState`, `progress`), `exercises.ts` (`isCanonical`), `types.ts`, `units.ts` (`STEP_5LB_KG`).
- Produces:
  - `validate.ts`: `type TemplateCheck = { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] }`; `parseTemplate(raw: unknown): TemplateCheck` (shape only); `templateErrors(t: ProgramTemplate): string[]` (canonical names, 30%-110%, lifts); `validateTemplate(raw: unknown): TemplateCheck` (both); `copyErrors(original: ProgramTemplate, copy: ProgramTemplate): string[]` (lifts the copy dropped, worded "This version has no exercise that uses the squat max. Smolov base mesocycle needs one.").
  - `simulate.ts`: `type Performer`, `perfect: Performer`, `scriptedMisses(every?: number): Performer`, `plannedSessionCount(t): number`, `interface SimRun { sessions: PlannedSession[]; reasons: string[][]; states: EngineState[]; final: EngineState }`, `simulate(t, opts: { maxes; stepKg?; unit?; sessions?; performer? }): SimRun`, `planAt(t, maxes, week, day, stepKg?): PlannedSession`, `runProblems(run): string[]`, `line(e: PlannedExercise, unit?): string`.
  - `registry.ts`: `PLATFORM_PROGRAMS: ProgramTemplate[]`, `platformProgram(key: string): ProgramTemplate | null`.
  - Program keys: `stronglifts-5x5`, `starting-strength`, `greyskull-lp`.

- [ ] **Step 1: Write `validate.ts`**

```ts
// app/src/lib/programs/validate.ts
/**
 * The template check: every platform program at test time, and every gym
 * copy on save. Shape (zod), then the rules: canonical exercise names, every
 * percentage between 30% and 110%, every lift an exercise takes a max from is
 * one the program asks for, and a block program ends in a test day. Pure.
 */
import { z } from "zod";

import { isCanonical } from "./exercises";
import { LIFT_LABEL, type LiftKey, type ProgramTemplate } from "./types";

const liftZ = z.enum(["squat", "bench", "deadlift", "press", "row"]);
const countZ = z.number().int().min(1).max(100);
const repsZ = z.union([
  countZ,
  z.object({ min: countZ, max: countZ }).refine((r) => r.max >= r.min, { message: "A rep range's top must be at least its bottom." }),
]);
const restZ = z.number().int().min(0).max(900);
const kgZ = z.number().min(0).max(50);

const setZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pct"), pct: z.number(), reps: countZ, rest: restZ, addKg: z.number().min(-100).max(100).optional(), drives: z.boolean().optional() }),
  z.object({ kind: z.literal("amrap"), pct: z.number(), reps: countZ, rest: restZ, addKg: z.number().min(-100).max(100).optional(), drives: z.boolean().optional() }),
  z.object({ kind: z.literal("rpe"), rpe: z.number().min(5).max(10), reps: countZ, rest: restZ }),
  z.object({ kind: z.literal("fixed"), reps: repsZ, rest: restZ, amrap: z.boolean().optional() }),
  z.object({ kind: z.literal("same_as_last"), reps: repsZ, rest: restZ }),
]);

const exerciseZ = z.object({
  name: z.string().trim().min(1).max(80),
  lift: liftZ.optional(),
  tier: z.enum(["t1", "t2", "t3"]).optional(),
  sets: z.array(setZ).min(1).max(20),
  stages: z.array(z.array(setZ).min(1).max(20)).max(5).optional(),
  bodyweight: z.boolean().optional(),
  progress: z.boolean().optional(),
  startPct: z.number().min(0.2).max(1).optional(),
  joined: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

const dayZ = z.object({ name: z.string().trim().min(1).max(60), exercises: z.array(exerciseZ).min(1).max(20), test: z.boolean().optional() });
const weekZ = z.object({ label: z.string().trim().max(60).optional(), days: z.array(dayZ).min(1).max(7) });
const incrementsZ = z.partialRecord(liftZ, kgZ).optional();

const engineZ = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("linear"),
    increment: kgZ,
    increments: incrementsZ,
    deloadAfter: z.number().int().min(1).max(10),
    deloadPct: z.number().min(0).max(0.5),
    startPct: z.number().min(0.2).max(1),
    doubleAt: z.number().int().min(1).max(50).optional(),
  }),
  z.object({
    key: z.literal("tm_cycle"),
    rule: z.enum(["cycle", "amrap_table", "drive_set", "gzclp"]),
    increment: kgZ,
    increments: incrementsZ,
    amrapTable: z.array(z.object({ minReps: z.number().int().min(0).max(50), kg: kgZ })).max(10).optional(),
    t2ResetKg: kgZ.optional(),
    t3AmrapTarget: z.number().int().min(1).max(100).optional(),
    startPct: z.number().min(0.2).max(1).optional(),
  }),
  z.object({ key: z.literal("fixed_block") }),
  z.object({ key: z.literal("double_progression") }),
  z.object({ key: z.literal("fixed_volume"), increment: kgZ, startPct: z.number().min(0.2).max(1) }),
]);

const templateZ = z.object({
  key: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  author: z.string().trim().min(1).max(120),
  family: z.enum(["strength", "peaking", "beginner", "size"]),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  daysPerWeek: z.number().int().min(1).max(7),
  lengthWeeks: z.number().int().min(1).max(52),
  lifts: z.array(liftZ).max(5),
  tmPct: z.number().min(0.5).max(1),
  who: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1200),
  warning: z.string().trim().max(200).optional(),
  engine: engineZ,
  weeks: z.array(weekZ).min(1).max(26),
});

export type TemplateCheck = { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] };

/** Shape only. Unknown keys are dropped. */
export function parseTemplate(raw: unknown): TemplateCheck {
  const parsed = templateZ.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "template"}: ${i.message}`) };
  }
  return { ok: true, template: parsed.data as ProgramTemplate };
}

function usesLift(t: ProgramTemplate, lift: LiftKey): boolean {
  return t.weeks.some((w) => w.days.some((d) => d.exercises.some((e) => e.lift === lift)));
}

/** The rules a well-formed template must also meet. */
export function templateErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  t.weeks.forEach((w, wi) =>
    w.days.forEach((d) =>
      d.exercises.forEach((e) => {
        const where = `Week ${wi + 1}, ${d.name}, ${e.name}`;
        if (!isCanonical(e.name)) errors.push(`${where}: not in the exercise list.`);
        for (const s of [...e.sets, ...(e.stages ?? []).flat()]) {
          if (s.kind !== "pct" && s.kind !== "amrap") continue;
          if (s.pct < 0.3 || s.pct > 1.1) errors.push(`${where}: ${Math.round(s.pct * 1000) / 10}% is outside 30% to 110%.`);
          if (!e.lift) errors.push(`${where}: a percentage needs a lift to take it from.`);
        }
        if (e.lift && !t.lifts.includes(e.lift)) errors.push(`${where}: uses the ${LIFT_LABEL[e.lift].toLowerCase()} max, which this program does not ask for.`);
      }),
    ),
  );
  for (const lift of t.lifts) if (!usesLift(t, lift)) errors.push(`No exercise uses the ${LIFT_LABEL[lift].toLowerCase()} max.`);
  if (t.engine.key === "fixed_block" && !t.weeks[t.weeks.length - 1].days.some((d) => d.test)) errors.push("A block program must end in a test day.");
  return [...new Set(errors)].slice(0, 20);
}

export function validateTemplate(raw: unknown): TemplateCheck {
  const p = parseTemplate(raw);
  if (!p.ok) return p;
  const errors = templateErrors(p.template);
  return errors.length ? { ok: false, errors } : p;
}

/** A gym copy must keep every lift the original's engine needs. Says which one is missing. */
export function copyErrors(original: ProgramTemplate, copy: ProgramTemplate): string[] {
  return original.lifts
    .filter((lift) => !usesLift(copy, lift))
    .map((lift) => `This version has no exercise that uses the ${LIFT_LABEL[lift].toLowerCase()} max. ${original.name} needs one.`);
}
```

- [ ] **Step 2: Write `simulate.ts`**

```ts
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
```

- [ ] **Step 3: Write the three beginner programs**

```ts
// app/src/lib/programs/templates/stronglifts.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const fives = () => times(5, fixed(5, 180));

const A = day("Workout A", [
  ex("Back squat", fives(), { lift: "squat" }),
  ex("Bench press", fives(), { lift: "bench" }),
  ex("Barbell row", fives(), { lift: "row" }),
]);
const B = day("Workout B", [
  ex("Back squat", fives(), { lift: "squat" }),
  ex("Overhead press", fives(), { lift: "press" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);

export const strongLifts: ProgramTemplate = {
  key: "stronglifts-5x5",
  name: "StrongLifts 5x5",
  author: "StrongLifts 5x5 by Mehdi Hadim",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["squat", "bench", "row", "press", "deadlift"],
  tmPct: 1,
  who: "New lifters, and anyone coming back to the barbell after a long break.",
  description:
    "Two workouts, A and B, alternated three days a week. You squat every session. Every lift is five sets of five except the deadlift, which is one set of five. Get every rep and the weight goes up next time: 2.5 kg, or 5 kg on the deadlift. Miss reps three sessions in a row on a lift and it drops 10%.",
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
```

```ts
// app/src/lib/programs/templates/startingStrength.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const threeFives = () => times(3, fixed(5, 180));

const A = day("Workout A", [
  ex("Back squat", threeFives(), { lift: "squat" }),
  ex("Overhead press", threeFives(), { lift: "press" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);
const B = day("Workout B", [
  ex("Back squat", threeFives(), { lift: "squat" }),
  ex("Bench press", threeFives(), { lift: "bench" }),
  ex("Deadlift", [fixed(5, 180)], { lift: "deadlift" }),
]);

export const startingStrength: ProgramTemplate = {
  key: "starting-strength",
  name: "Starting Strength",
  author: "Starting Strength by Mark Rippetoe",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["squat", "press", "bench", "deadlift"],
  tmPct: 1,
  who: "New lifters who want to get strong on the main barbell lifts quickly.",
  description:
    "Two short workouts, A and B, alternated three days a week. Three sets of five on the squat and on the press or bench, then one heavy set of five on the deadlift. The weight goes up every session while you get every rep. Miss reps three sessions in a row on a lift and it drops 10%. This is the first phase of the novice program.",
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
```

```ts
// app/src/lib/programs/templates/greyskull.ts
import { day, ex, fixed, week } from "../dsl";
import type { ProgramTemplate } from "../types";

/** Two sets of five, then a last set for as many reps as you can. */
const twoAndPlus = () => [fixed(5, 180), fixed(5, 180), fixed(5, 180, true)];

const A = day("Workout A", [
  ex("Bench press", twoAndPlus(), { lift: "bench" }),
  ex("Barbell row", twoAndPlus(), { lift: "row" }),
  ex("Back squat", twoAndPlus(), { lift: "squat" }),
]);
const B = day("Workout B", [
  ex("Overhead press", twoAndPlus(), { lift: "press" }),
  ex("Chin-up", twoAndPlus(), { bodyweight: true }),
  ex("Deadlift", [fixed(5, 180, true)], { lift: "deadlift" }),
]);

export const greyskullLp: ProgramTemplate = {
  key: "greyskull-lp",
  name: "Greyskull LP",
  author: "Greyskull LP by John Sheaffer",
  family: "beginner",
  level: "beginner",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: ["bench", "row", "squat", "press", "deadlift"],
  tmPct: 1,
  who: "Newer lifters who like to push the last set.",
  description:
    "Two workouts, alternated three days a week. Two sets of five, then a last set for as many reps as you can. Upper-body lifts go up 1.25 kg a session and lower-body lifts 2.5 kg. Ten or more reps on the last set doubles the next jump. Fall short of five on any set and that lift drops 10%.",
  engine: { key: "linear", increment: 1.25, increments: { squat: 2.5, deadlift: 2.5 }, deloadAfter: 1, deloadPct: 0.1, startPct: 0.5, doubleAt: 10 },
  weeks: [week([A, B, A]), week([B, A, B])],
};
```

- [ ] **Step 4: Write `registry.ts`**

```ts
// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { greyskullLp } from "./templates/greyskull";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [strongLifts, startingStrength, greyskullLp];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
```

- [ ] **Step 5: Write the failing registry test**

```ts
// app/src/lib/programs/registry.test.ts
// Run: npm test -- src/lib/programs/registry.test.ts
//
// The template check over every platform program, and an end-to-end run of
// each with two simulated members (perfect, and scripted misses), in kg and
// in pounds. Later tasks only add programs to the registry.
import assert from "node:assert/strict";

import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { plannedSessionCount, runProblems, scriptedMisses, simulate } from "./simulate";
import { STEP_5LB_KG } from "./units";
import { validateTemplate } from "./validate";

const keys = new Set<string>();
for (const t of PLATFORM_PROGRAMS) {
  assert.ok(!keys.has(t.key), `${t.key}: duplicate key`);
  keys.add(t.key);
  assert.equal(platformProgram(t.key), t);
  const v = validateTemplate(t);
  assert.ok(v.ok, `${t.key}: ${v.ok ? "" : v.errors.join(" | ")}`);
  assert.ok(t.author.trim().length > 0, `${t.key}: needs an author credit`);
  assert.ok(!/\p{Extended_Pictographic}/u.test(JSON.stringify(t)), `${t.key}: no emojis`);
  assert.ok(t.weeks.every((w) => w.days.length <= t.daysPerWeek), `${t.key}: a week has more days than daysPerWeek`);

  const maxes = Object.fromEntries(t.lifts.map((l) => [l, 140]));
  const ideal = simulate(t, { maxes });
  assert.deepEqual(runProblems(ideal), [], `${t.key}: perfect member`);
  assert.equal(ideal.sessions.length, plannedSessionCount(t), `${t.key}: runs its full length`);
  if (t.engine.key === "fixed_block") assert.equal(ideal.final.finished, true, `${t.key}: a block ends finished`);
  assert.deepEqual(runProblems(simulate(t, { maxes, performer: scriptedMisses(3) })), [], `${t.key}: scripted misses`);
  assert.deepEqual(runProblems(simulate(t, { maxes, stepKg: STEP_5LB_KG, unit: "lb" })), [], `${t.key}: pounds`);
}

assert.equal(platformProgram("no-such-program"), null);

// The check refuses what it should.
const sl = platformProgram("stronglifts-5x5")!;
const badName = structuredClone(sl);
badName.weeks[0].days[0].exercises[0].name = "Squat jumps on a bosu";
assert.equal(validateTemplate(badName).ok, false);
const badPct = structuredClone(sl);
badPct.weeks[0].days[0].exercises[0].sets[0] = { kind: "pct", pct: 1.2, reps: 1, rest: 180 };
const badPctCheck = validateTemplate(badPct);
assert.ok(!badPctCheck.ok && badPctCheck.errors.some((e) => e.includes("120% is outside 30% to 110%")));
const noMax = structuredClone(sl);
noMax.lifts = noMax.lifts.filter((l) => l !== "row");
const noMaxCheck = validateTemplate(noMax);
assert.ok(!noMaxCheck.ok && noMaxCheck.errors.some((e) => e.includes("uses the barbell row max, which this program does not ask for")));

console.log(`programs/registry: ${PLATFORM_PROGRAMS.length} programs ok`);
```

- [ ] **Step 6: Write the failing beginner test (published structure pinned)**

```ts
// app/src/lib/programs/templates/beginner.test.ts
// Run: npm test -- src/lib/programs/templates/beginner.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, perfect, planAt, simulate, type Performer } from "../simulate";

// ── StrongLifts 5x5 ──────────────────────────────────────────────────────
const sl = platformProgram("stronglifts-5x5")!;
const slMaxes = { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 };
const a = planAt(sl, slMaxes, 0, 0);
assert.equal(a.dayName, "Workout A");
assert.deepEqual(a.exercises.map((e) => line(e)), ["Back squat 5 x 5 at 50 kg", "Bench press 5 x 5 at 40 kg", "Barbell row 5 x 5 at 35 kg"]);
const b = planAt(sl, slMaxes, 0, 1);
assert.deepEqual(b.exercises.map((e) => line(e)), ["Back squat 5 x 5 at 50 kg", "Overhead press 5 x 5 at 25 kg", "Deadlift 1 x 5 at 60 kg"]);
assert.deepEqual(sl.weeks.map((w) => w.days.map((d) => d.name)), [["Workout A", "Workout B", "Workout A"], ["Workout B", "Workout A", "Workout B"]]);

// 12 weeks, every rep: squat every session (36 x 2.5), deadlift on the 18 B days (x 5)
const slRun = simulate(sl, { maxes: slMaxes });
assert.equal(slRun.sessions.length, 36);
assert.equal(slRun.final.weights["back squat"], 140);
assert.equal(slRun.final.weights["deadlift"], 150);
assert.equal(slRun.final.weights["bench press"], 85);
assert.equal(slRun.final.weights["overhead press"], 70);

// three missed squat sessions in a row: a 10% deload
const squatMisses: Performer = (c) => {
  const p = perfect(c);
  return c.exercise.name === "Back squat" && c.n >= 3 && c.setIndex === 4 ? { ...p, reps: 3 } : p;
};
const slMiss = simulate(sl, { maxes: slMaxes, sessions: 6, performer: squatMisses });
assert.equal(slMiss.final.weights["back squat"], 52.5);
assert.ok(slMiss.reasons[5].includes("Next back squat 52.5 kg, 10% lighter. You missed reps three sessions in a row."));

// ── Starting Strength ────────────────────────────────────────────────────
const ss = platformProgram("starting-strength")!;
const ssMaxes = { squat: 100, press: 50, bench: 80, deadlift: 120 };
assert.deepEqual(planAt(ss, ssMaxes, 0, 0).exercises.map((e) => line(e)), ["Back squat 3 x 5 at 50 kg", "Overhead press 3 x 5 at 25 kg", "Deadlift 1 x 5 at 60 kg"]);
assert.deepEqual(planAt(ss, ssMaxes, 0, 1).exercises.map((e) => line(e)), ["Back squat 3 x 5 at 50 kg", "Bench press 3 x 5 at 40 kg", "Deadlift 1 x 5 at 60 kg"]);
const ssRun = simulate(ss, { maxes: ssMaxes });
assert.equal(ssRun.final.weights["back squat"], 140);
assert.equal(ssRun.final.weights["deadlift"], 240);

// ── Greyskull LP ─────────────────────────────────────────────────────────
const gs = platformProgram("greyskull-lp")!;
const gsMaxes = { bench: 80, row: 70, squat: 100, press: 50, deadlift: 120 };
assert.deepEqual(planAt(gs, gsMaxes, 0, 0).exercises.map((e) => line(e)), [
  "Bench press 2 x 5 at 40 kg, then 1 x 5+ at 40 kg",
  "Barbell row 2 x 5 at 35 kg, then 1 x 5+ at 35 kg",
  "Back squat 2 x 5 at 50 kg, then 1 x 5+ at 50 kg",
]);
assert.deepEqual(planAt(gs, gsMaxes, 0, 1).exercises.map((e) => line(e)), [
  "Overhead press 2 x 5 at 25 kg, then 1 x 5+ at 25 kg",
  "Chin-up 2 x 5, then 1 x 5+",
  "Deadlift 1 x 5+ at 60 kg",
]);
// with small plates: 1.25 kg on upper-body lifts, 2.5 kg on the squat
const gsOne = simulate(gs, { maxes: gsMaxes, sessions: 1, stepKg: 1.25 });
assert.equal(gsOne.final.weights["bench press"], 41.25);
assert.equal(gsOne.final.weights["back squat"], 52.5);

console.log("programs/templates/beginner: ok");
```

- [ ] **Step 7: Run both tests**

Run: `cd app && npm test -- src/lib/programs/registry.test.ts && npm test -- src/lib/programs/templates/beginner.test.ts`
Expected: PASS, prints `programs/registry: 3 programs ok` and `programs/templates/beginner: ok`. (If you write the tests before the implementation files they fail with `Cannot find module`.)

- [ ] **Step 8: Typecheck**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no errors. If zod reports `partialRecord` missing, check `app/package.json` has zod 4 (`"zod": "^4.6.7"`); `z.partialRecord` is the zod 4 API for a record with optional enum keys.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/programs/validate.ts app/src/lib/programs/simulate.ts app/src/lib/programs/registry.ts app/src/lib/programs/templates/stronglifts.ts app/src/lib/programs/templates/startingStrength.ts app/src/lib/programs/templates/greyskull.ts app/src/lib/programs/registry.test.ts app/src/lib/programs/templates/beginner.test.ts
git commit -m "feat(programs): template check, simulation harness, registry and beginner programs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Powerlifting peaking programs (fixed block with re-test)

**Files:**
- Create: `app/src/lib/programs/templates/smolov.ts` (Smolov base mesocycle, Smolov Jr squat, Smolov Jr bench)
- Create: `app/src/lib/programs/templates/rsr.ts`
- Create: `app/src/lib/programs/templates/candito.ts`
- Create: `app/src/lib/programs/templates/sheiko.ts`
- Modify: `app/src/lib/programs/registry.ts` (add the six programs)
- Test: `app/src/lib/programs/templates/peaking.test.ts`

**Interfaces:**
- Consumes (Tasks 1-3): `dsl.ts` (`day`, `ex`, `fixed`, `maxTest`, `MAX_TEST_NOTE`, `pct`, `range`, `sxr`, `times`, `week`), `simulate.ts` (`planAt`, `line`, `simulate`, `perfect`), `registry.ts`.
- Produces program keys: `smolov-base`, `smolov-jr-squat`, `smolov-jr-bench`, `russian-squat-routine`, `candito-style-6-week`, `sheiko-style`. All use `engine: { key: "fixed_block" }` and end in a test day.

Accuracy: Smolov base and Smolov Jr percentages and the Russian Squat Routine's 18 sessions are the published numbers. Smolov base week 3 uses +15 kg over week 1 (sources give +5 to +7.5 kg over week 2). Candito and Sheiko are labelled "-style": their structure follows the originals, their percentages are ours, and their descriptions say so.

- [ ] **Step 1: Write the failing peaking test**

```ts
// app/src/lib/programs/templates/peaking.test.ts
// Run: npm test -- src/lib/programs/templates/peaking.test.ts
import assert from "node:assert/strict";

import { sessionCount, summarisePlanned } from "../planner";
import { platformProgram } from "../registry";
import { line, perfect, planAt, simulate, type Performer } from "../simulate";

const firstLine = (key: string, maxes: Record<string, number>, w: number, d: number) => line(planAt(platformProgram(key)!, maxes, w, d).exercises[0]);

// ── Smolov base mesocycle: week 1 day 1 is 4 x 9 at 70% ─────────────────
const sq100 = { squat: 100 };
assert.equal(firstLine("smolov-base", sq100, 0, 0), "Back squat 4 x 9 at 70 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 1), "Back squat 5 x 7 at 75 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 2), "Back squat 7 x 5 at 80 kg");
assert.equal(firstLine("smolov-base", sq100, 0, 3), "Back squat 10 x 3 at 85 kg");
assert.equal(firstLine("smolov-base", sq100, 1, 0), "Back squat 4 x 9 at 80 kg");
assert.equal(firstLine("smolov-base", sq100, 2, 0), "Back squat 4 x 9 at 85 kg");
assert.equal(firstLine("smolov-base", sq100, 2, 3), "Back squat 10 x 3 at 100 kg");
const smolov = platformProgram("smolov-base")!;
assert.equal(sessionCount(smolov), 13);
assert.equal(smolov.weeks[3].days[0].test, true);
// the test day sets the new max; the block then finishes
const tested: Performer = (c) => (c.session.test && c.setIndex === 4 ? { kg: 110, reps: 1, done: true } : perfect(c));
const smolovRun = simulate(smolov, { maxes: sq100, performer: tested });
assert.equal(smolovRun.sessions.length, 13);
assert.equal(smolovRun.final.finished, true);
assert.equal(smolovRun.final.testMaxes.squat, 110);
assert.ok(smolovRun.reasons[12].includes("Your new squat max is about 110 kg, from 110 kg x 1."));
assert.deepEqual(smolovRun.reasons.slice(0, 12).flat(), [], "no changes inside the block");

// ── Smolov Jr ─────────────────────────────────────────────────────────────
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 0), "Back squat 6 x 6 at 70 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 1), "Back squat 7 x 5 at 75 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 2), "Back squat 8 x 4 at 80 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 0, 3), "Back squat 10 x 3 at 85 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 1, 0), "Back squat 6 x 6 at 75 kg");
assert.equal(firstLine("smolov-jr-squat", sq100, 2, 0), "Back squat 6 x 6 at 80 kg");
assert.equal(firstLine("smolov-jr-bench", { bench: 100 }, 1, 0), "Bench press 6 x 6 at 72.5 kg");
assert.equal(firstLine("smolov-jr-bench", { bench: 100 }, 2, 0), "Bench press 6 x 6 at 75 kg");
assert.equal(sessionCount(platformProgram("smolov-jr-squat")!), 13);

// ── Russian Squat Routine: all 18 sessions ────────────────────────────────
const rsr = platformProgram("russian-squat-routine")!;
const rsrLines = rsr.weeks.flatMap((w, wi) => w.days.map((_d, di) => summarisePlanned(planAt(rsr, sq100, wi, di).exercises[0].sets, "kg")));
assert.deepEqual(rsrLines, [
  "6 x 2 at 80 kg", "6 x 3 at 80 kg", "6 x 2 at 80 kg",
  "6 x 4 at 80 kg", "6 x 2 at 80 kg", "6 x 5 at 80 kg",
  "6 x 2 at 80 kg", "6 x 6 at 80 kg", "6 x 2 at 80 kg",
  "5 x 5 at 85 kg", "6 x 2 at 80 kg", "4 x 4 at 90 kg",
  "6 x 2 at 80 kg", "3 x 3 at 95 kg", "6 x 2 at 80 kg",
  "2 x 2 at 100 kg", "6 x 2 at 80 kg",
  "1 x 5 at 50 kg, then 1 x 3 at 70 kg, then 1 x 1 at 85 kg, then 1 x 1 at 95 kg, then 1 x 1 at 105 kg",
]);
assert.equal(rsr.weeks[5].days[2].test, true);

// ── Candito-style 6-week ──────────────────────────────────────────────────
const all100 = { squat: 100, bench: 100, deadlift: 100 };
const candito = platformProgram("candito-style-6-week")!;
assert.deepEqual(planAt(candito, all100, 0, 0).exercises.map((e) => line(e)), ["Back squat 4 x 6 at 70 kg", "Deadlift 2 x 6 at 65 kg"]);
assert.equal(firstLine("candito-style-6-week", all100, 1, 0), "Back squat 4 x 6 at 72.5 kg");
assert.equal(firstLine("candito-style-6-week", all100, 4, 1), "Bench press 2 x 2 at 90 kg, then 1 x 1 at 95 kg");
assert.equal(sessionCount(candito), 22);
assert.equal(candito.name.endsWith("-style 6-week"), true);

// ── Sheiko-style ──────────────────────────────────────────────────────────
const sheiko = platformProgram("sheiko-style")!;
assert.equal(firstLine("sheiko-style", all100, 0, 0), "Back squat 1 x 5 at 50 kg, then 1 x 4 at 60 kg, then 2 x 3 at 70 kg, then 5 x 2 at 75 kg");
assert.equal(sessionCount(sheiko), 14);
assert.equal(sheiko.name, "Sheiko-style");

// every block ends in a test week
for (const key of ["smolov-base", "smolov-jr-squat", "smolov-jr-bench", "russian-squat-routine", "candito-style-6-week", "sheiko-style"]) {
  const t = platformProgram(key)!;
  assert.equal(t.engine.key, "fixed_block", key);
  assert.ok(t.weeks[t.weeks.length - 1].days.some((d) => d.test), `${key} ends in a test`);
  assert.ok(t.warning, `${key} carries a warning line`);
}

console.log("programs/templates/peaking: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/templates/peaking.test.ts`
Expected: FAIL (the program keys are not registered; `platformProgram(...)` returns null and `planAt` throws on `null!`).

- [ ] **Step 3: Write `smolov.ts`**

```ts
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
    "The base block of Smolov's squat program. Four squat sessions a week for three weeks: 4 x 9 at 70%, 5 x 7 at 75%, 7 x 5 at 80% and 10 x 3 at 85% of your max. Week two adds 10 kg to every set and week three adds 15 kg. Week four is a test of your new max.",
  warning: "Squats four days a week at high volume. Only for lifters with a year or more of steady squatting.",
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
    author: "Smolov Jr, the short version of Sergey Smolov's program",
    family: "peaking",
    level: "intermediate",
    daysPerWeek: 4,
    lengthWeeks: 4,
    lifts: [lift],
    tmPct: 1,
    who: `Lifters who want a quick jump in their ${name.toLowerCase()} max.`,
    description: `A three-week block on one lift, four sessions a week: 6 x 6 at 70%, 7 x 5 at 75%, 8 x 4 at 80% and 10 x 3 at 85% of your max. Week two adds ${adds[0]} kg to every set and week three adds ${adds[1]} kg. A fourth week tests your new max.`,
    warning: "Four heavy sessions a week on one lift. For lifters with at least a year of steady training.",
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
```

- [ ] **Step 4: Write `rsr.ts`**

```ts
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
```

- [ ] **Step 5: Write `candito.ts`**

```ts
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
```

- [ ] **Step 6: Write `sheiko.ts`**

```ts
// app/src/lib/programs/templates/sheiko.ts
import { day, ex, fixed, maxTest, sxr, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx } from "../types";

/** [percentage, reps, sets] steps, climbing to the work sets. */
const pyr = (steps: [number, number, number][]): SetRx[] => steps.flatMap(([p, reps, n]) => sxr(n, reps, p));
const lift = (name: string, l: LiftKey) => (steps: [number, number, number][]): ExerciseRx => ex(name, pyr(steps), { lift: l });
const S = lift("Back squat", "squat");
const B = lift("Bench press", "bench");
const D = lift("Deadlift", "deadlift");
const fly = () => ex("Dumbbell fly", times(5, fixed(10, 90)), { progress: false });
const gm = () => ex("Good morning", times(5, fixed(5, 120)), { progress: false });
const ext = () => ex("Back extension", times(3, fixed(10, 90)), { bodyweight: true });

export const sheikoStyle: ProgramTemplate = {
  key: "sheiko-style",
  name: "Sheiko-style",
  author: "After Boris Sheiko's programs",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 3,
  lengthWeeks: 5,
  lifts: ["squat", "bench", "deadlift"],
  tmPct: 1,
  who: "Powerlifters preparing for a meet who respond well to frequent practice.",
  description:
    "The squat, bench and deadlift practised often at moderate weights. Each lift climbs through lighter sets to work sets of doubles and triples between 70% and 85%, three days a week for four weeks, then a test week. The numbers are ours, in Sheiko's style. This is not one of his numbered programs.",
  warning: "Bench three times a week and a lot of total sets. Built for lifters preparing for a meet.",
  engine: { key: "fixed_block" },
  weeks: [
    week([
      day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.75, 3, 4]]), B([[0.5, 6, 1], [0.6, 5, 1], [0.7, 4, 4]]), gm()]),
      day("Day 3", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 4]]), ext()]),
    ]),
    week([
      day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 5]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 1], [0.8, 2, 4]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 4]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), gm()]),
      day("Day 3", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), B([[0.55, 5, 1], [0.65, 4, 1], [0.75, 3, 5]]), ext()]),
    ]),
    week([
      day("Day 1", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 2], [0.85, 2, 3]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 2], [0.85, 1, 3]]), fly()]),
      day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 1], [0.85, 2, 3]]), B([[0.5, 4, 1], [0.6, 4, 1], [0.7, 3, 2], [0.75, 3, 4]]), gm()]),
      day("Day 3", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 2], [0.8, 2, 4]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 1], [0.8, 2, 4]]), ext()]),
    ]),
    week(
      [
        day("Day 1", [S([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 4]]), B([[0.5, 5, 1], [0.6, 4, 1], [0.7, 3, 4]])]),
        day("Day 2", [D([[0.5, 3, 1], [0.6, 3, 1], [0.7, 3, 3]]), B([[0.5, 4, 1], [0.6, 4, 1], [0.7, 4, 3]])]),
        day("Day 3", [S([[0.5, 3, 1], [0.6, 3, 1], [0.7, 2, 2]]), B([[0.5, 3, 1], [0.6, 3, 1], [0.7, 2, 2]])]),
      ],
      "Lighter week",
    ),
    week([day("Squat and bench test", [maxTest("Back squat", "squat"), maxTest("Bench press", "bench")], true), day("Deadlift test", [maxTest("Deadlift", "deadlift")], true)], "Test"),
  ],
};
```

- [ ] **Step 7: Register them in `registry.ts`**

Replace the whole file with:

```ts
// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { canditoStyle } from "./templates/candito";
import { greyskullLp } from "./templates/greyskull";
import { russianSquatRoutine } from "./templates/rsr";
import { sheikoStyle } from "./templates/sheiko";
import { smolovBase, smolovJrBench, smolovJrSquat } from "./templates/smolov";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [
  // beginner linear
  strongLifts,
  startingStrength,
  greyskullLp,
  // powerlifting peaking
  smolovBase,
  smolovJrSquat,
  smolovJrBench,
  russianSquatRoutine,
  canditoStyle,
  sheikoStyle,
];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
```

- [ ] **Step 8: Run the peaking test and the registry test**

Run: `cd app && npm test -- src/lib/programs/templates/peaking.test.ts && npm test -- src/lib/programs/registry.test.ts`
Expected: PASS, `programs/templates/peaking: ok` and `programs/registry: 9 programs ok`.

Hand-checked: 70% of 100 + 15 = 85; 85% + 15 = 100; Smolov Jr bench 70% + 2.5 = 72.5; RSR week 6 day 3 last set 105% = 105; Candito week 5 upper 1 is 2 x 2 at 90% then 1 x 1 at 95%; Candito has 5 x 4 + 2 = 22 sessions; Sheiko has 4 x 3 + 2 = 14.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/programs/templates/smolov.ts app/src/lib/programs/templates/rsr.ts app/src/lib/programs/templates/candito.ts app/src/lib/programs/templates/sheiko.ts app/src/lib/programs/registry.ts app/src/lib/programs/templates/peaking.test.ts
git commit -m "feat(programs): powerlifting peaking programs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Strength cycles (training-max engine): 5/3/1 BBB and FSL, nSuns-style, Texas Method, GZCLP

**Files:**
- Create: `app/src/lib/programs/templates/wendler.ts` (5/3/1 Boring But Big, 5/3/1 First Set Last)
- Create: `app/src/lib/programs/templates/nsuns.ts`
- Create: `app/src/lib/programs/templates/texas.ts`
- Create: `app/src/lib/programs/templates/gzclp.ts`
- Modify: `app/src/lib/programs/registry.ts` (add the five programs)
- Test: `app/src/lib/programs/templates/strength.test.ts`

**Interfaces:**
- Consumes (Tasks 1-3): `dsl.ts`, `simulate.ts` (`planAt`, `line`, `simulate`), `registry.ts`, `types.ts` (`LiftKey`, `ExerciseRx`, `SetRx`, `ProgramTemplate`).
- Produces program keys: `531-bbb`, `531-fsl` (rule `cycle`, training max 90%), `nsuns-style-5-day` (rule `amrap_table`), `texas-method` (rule `drive_set`, training max = Epley 5-rep max = 6/7 of the max), `gzclp` (rule `gzclp`).

Accuracy: 5/3/1 waves, the 90% training max, BBB (5 x 10 at 50%) and its original assistance, FSL, the Texas Method volume/recovery/intensity percentages and the GZCLP rep schemes are as published. nSuns is labelled "-style": its T1 rows are as commonly published, its T2 rows and kg table should be checked. In the Texas Method the deadlift placement (one top set of five on volume day) and the recovery-day press at 80% are our arrangement.

- [ ] **Step 1: Write the failing strength test**

```ts
// app/src/lib/programs/templates/strength.test.ts
// Run: npm test -- src/lib/programs/templates/strength.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, planAt, simulate } from "../simulate";

// A max of 111.11 kg gives a 90% training max of exactly 100 kg.
const tm100 = { squat: 111.11, bench: 111.11, deadlift: 111.11, press: 111.11 };

// ── 5/3/1 Boring But Big ──────────────────────────────────────────────────
const bbb = platformProgram("531-bbb")!;
assert.deepEqual(bbb.weeks[0].days.map((d) => d.name), ["Press day", "Deadlift day", "Bench day", "Squat day"]);
assert.deepEqual(planAt(bbb, tm100, 0, 0).exercises.map((e) => line(e)), [
  "Overhead press 1 x 5 at 65 kg, then 1 x 5 at 75 kg, then 1 x 5+ at 85 kg",
  "Overhead press 5 x 10 at 50 kg",
  "Chin-up 5 x 10",
]);
assert.equal(line(planAt(bbb, tm100, 1, 3).exercises[0]), "Back squat 1 x 3 at 70 kg, then 1 x 3 at 80 kg, then 1 x 3+ at 90 kg");
assert.equal(line(planAt(bbb, tm100, 2, 2).exercises[0]), "Bench press 1 x 5 at 75 kg, then 1 x 3 at 85 kg, then 1 x 1+ at 95 kg");
const deload = planAt(bbb, tm100, 3, 1);
assert.deepEqual(deload.exercises.map((e) => line(e)), ["Deadlift 1 x 5 at 40 kg, then 1 x 5 at 50 kg, then 1 x 5 at 60 kg", "Hanging leg raise 5 x 15"]);
// three cycles, every rep: +2.5 kg upper, +5 kg lower per cycle
const bbbRun = simulate(bbb, { maxes: tm100 });
assert.equal(bbbRun.sessions.length, 48);
assert.deepEqual(bbbRun.final.tms, { squat: 115, bench: 107.5, deadlift: 115, press: 107.5 });

// ── 5/3/1 First Set Last ──────────────────────────────────────────────────
const fsl = platformProgram("531-fsl")!;
assert.equal(line(planAt(fsl, tm100, 1, 0).exercises[1]), "Overhead press 5 x 5 at 70 kg");
assert.equal(line(planAt(fsl, tm100, 2, 3).exercises[1]), "Back squat 5 x 5 at 75 kg");
assert.equal(planAt(fsl, tm100, 3, 0).exercises.length, 2, "no supplemental sets on the deload");

// ── nSuns-style 5-day ─────────────────────────────────────────────────────
const ns = platformProgram("nsuns-style-5-day")!;
assert.equal(ns.weeks.length, 1);
assert.equal(ns.weeks[0].days.length, 5);
assert.deepEqual(planAt(ns, tm100, 0, 1).exercises.map((e) => line(e)), [
  "Back squat 1 x 5 at 75 kg, then 1 x 3 at 85 kg, then 1 x 1+ at 95 kg, then 1 x 3 at 90 kg, then 1 x 3 at 85 kg, then 1 x 3 at 80 kg, then 1 x 5 at 75 kg, then 1 x 5 at 70 kg, then 1 x 5+ at 65 kg",
  "Sumo deadlift 1 x 5 at 50 kg, then 1 x 5 at 60 kg, then 1 x 3 at 70 kg, then 1 x 5 at 70 kg, then 1 x 7 at 70 kg, then 1 x 4 at 70 kg, then 1 x 6 at 70 kg, then 1 x 8 at 70 kg",
]);
// one week, every rep (3 reps on each 1+ set): +2.5 kg on all four training maxes
assert.deepEqual(simulate(ns, { maxes: tm100, sessions: 5 }).final.tms, { squat: 102.5, bench: 102.5, deadlift: 102.5, press: 102.5 });

// ── Texas Method ─────────────────────────────────────────────────────────
// A max of 116.67 kg gives an estimated 5-rep max (6/7) of exactly 100 kg.
const tx = platformProgram("texas-method")!;
const tx100 = { squat: 116.67, bench: 116.67, press: 116.67, deadlift: 116.67 };
assert.deepEqual(planAt(tx, tx100, 0, 0).exercises.map((e) => line(e)), ["Back squat 5 x 5 at 90 kg", "Bench press 5 x 5 at 90 kg", "Deadlift 1 x 5 at 100 kg"]);
assert.deepEqual(planAt(tx, tx100, 0, 1).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 2 x 5 at 72.5 kg", "Overhead press 3 x 5 at 80 kg"]);
assert.deepEqual(planAt(tx, tx100, 0, 2).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 1 x 5 at 100 kg", "Bench press 1 x 5 at 100 kg"]);
assert.equal(line(planAt(tx, tx100, 1, 2).exercises[1]), "Overhead press 1 x 5 at 100 kg");
assert.deepEqual(simulate(tx, { maxes: tx100, sessions: 3 }).final.tms, { squat: 102.5, bench: 102.5, press: 100, deadlift: 105 });

// ── GZCLP ────────────────────────────────────────────────────────────────
const gz = platformProgram("gzclp")!;
const gz100 = { squat: 100, bench: 100, press: 100, deadlift: 100 };
assert.deepEqual(gz.weeks[0].days.map((d) => d.name), ["A1", "B1", "A2", "B2"]);
assert.deepEqual(planAt(gz, gz100, 0, 0).exercises.map((e) => line(e)), [
  "Back squat 4 x 3 at 72.5 kg, then 1 x 3+ at 72.5 kg",
  "Bench press 3 x 10 at 55 kg",
  "Lat pulldown 2 x 15, then 1 x 15+",
]);
assert.deepEqual(planAt(gz, gz100, 0, 1).exercises.map((e) => line(e)), [
  "Overhead press 4 x 3 at 72.5 kg, then 1 x 3+ at 72.5 kg",
  "Deadlift 3 x 10 at 55 kg",
  "Dumbbell row 2 x 15, then 1 x 15+",
]);
const gzOne = simulate(gz, { maxes: gz100, sessions: 4 }).final.weights;
assert.equal(gzOne["t1:back squat"], 77.5);
assert.equal(gzOne["t2:back squat"], 60);
assert.equal(gzOne["t1:deadlift"], 77.5);
assert.equal(gzOne["t1:bench press"], 75);

console.log("programs/templates/strength: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/templates/strength.test.ts`
Expected: FAIL (programs not registered).

- [ ] **Step 3: Write `wendler.ts`**

```ts
// app/src/lib/programs/templates/wendler.ts
import { amrap, day, ex, fixed, pct, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, WeekRx } from "../types";

/** The 5/3/1 waves as [percentage of training max, reps, last set as many as you can]. */
const WAVES: [number, number, boolean][][] = [
  [[0.65, 5, false], [0.75, 5, false], [0.85, 5, true]],
  [[0.7, 3, false], [0.8, 3, false], [0.9, 3, true]],
  [[0.75, 5, false], [0.85, 3, false], [0.95, 1, true]],
  [[0.4, 5, false], [0.5, 5, false], [0.6, 5, false]],
];
const WEEK_LABELS = ["5s week", "3s week", "5/3/1 week", "Deload"];
const DAYS: { lift: LiftKey; name: string; day: string }[] = [
  { lift: "press", name: "Overhead press", day: "Press day" },
  { lift: "deadlift", name: "Deadlift", day: "Deadlift day" },
  { lift: "bench", name: "Bench press", day: "Bench day" },
  { lift: "squat", name: "Back squat", day: "Squat day" },
];

const main = (w: number) => WAVES[w].map(([p, reps, plus]) => (plus ? amrap(p, reps, 180) : pct(p, reps, 180)));

function wendler(supplemental: (w: number, d: (typeof DAYS)[number]) => ExerciseRx, assistance: Record<LiftKey, ExerciseRx>): WeekRx[] {
  return [0, 1, 2, 3].map((w) =>
    week(
      DAYS.map((d) => day(d.day, [ex(d.name, main(w), { lift: d.lift }), ...(w < 3 ? [supplemental(w, d)] : []), assistance[d.lift]])),
      WEEK_LABELS[w],
    ),
  );
}

const shared = {
  author: "5/3/1 by Jim Wendler",
  family: "strength" as const,
  level: "intermediate" as const,
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: ["press", "deadlift", "bench", "squat"] as LiftKey[],
  tmPct: 0.9,
  engine: { key: "tm_cycle" as const, rule: "cycle" as const, increment: 2.5, increments: { squat: 5, deadlift: 5 } },
};

const WAVE_TEXT =
  "Four days a week, one main lift a day: press, deadlift, bench, squat. Three weeks of waves (5s, 3s, then 5/3/1) at percentages of a training max set at 90% of your max, then a deload week. The last set of each wave is as many reps as you can.";
const TM_TEXT = "The training max goes up after each four-week cycle: 2.5 kg on press and bench, 5 kg on squat and deadlift. A lift whose last set fell short of the minimum reps holds for a cycle.";

export const wendlerBbb: ProgramTemplate = {
  ...shared,
  key: "531-bbb",
  name: "5/3/1 Boring But Big",
  who: "Intermediate lifters who want steady strength gains and some size.",
  description: `${WAVE_TEXT} After the main lift: 5 sets of 10 at 50% of the training max, then one assistance exercise. ${TM_TEXT}`,
  weeks: wendler(
    (_w, d) => ex(d.name, times(5, pct(0.5, 10, 90)), { lift: d.lift, notes: "Boring But Big: 5 sets of 10 at 50% of your training max." }),
    {
      press: ex("Chin-up", times(5, fixed(10, 90)), { bodyweight: true }),
      deadlift: ex("Hanging leg raise", times(5, fixed(15, 60)), { bodyweight: true }),
      bench: ex("Dumbbell row", times(5, fixed(10, 90)), { progress: false }),
      squat: ex("Lying leg curl", times(5, fixed(10, 90)), { progress: false }),
      row: ex("Dumbbell row", times(5, fixed(10, 90)), { progress: false }),
    },
  ),
};

export const wendlerFsl: ProgramTemplate = {
  ...shared,
  key: "531-fsl",
  name: "5/3/1 First Set Last",
  who: "Intermediate lifters who want more practice at the main lifts without long sessions.",
  description: `${WAVE_TEXT} After the main lift: 5 sets of 5 at the first set's weight, then one assistance exercise. ${TM_TEXT}`,
  weeks: wendler(
    (w, d) => ex(d.name, times(5, pct(WAVES[w][0][0], 5, 90)), { lift: d.lift, notes: "First Set Last: 5 sets of 5 at your first set's weight." }),
    {
      press: ex("Dip", times(3, fixed(10, 90)), { bodyweight: true }),
      deadlift: ex("Hanging leg raise", times(3, fixed(15, 60)), { bodyweight: true }),
      bench: ex("Dumbbell row", times(3, fixed(10, 90)), { progress: false }),
      squat: ex("Back extension", times(3, fixed(10, 90)), { bodyweight: true }),
      row: ex("Dumbbell row", times(3, fixed(10, 90)), { progress: false }),
    },
  ),
};
```

(The `row` entries only satisfy the `Record<LiftKey, ExerciseRx>` type; no 5/3/1 day uses them.)

- [ ] **Step 4: Write `nsuns.ts`**

```ts
// app/src/lib/programs/templates/nsuns.ts
import { amrap, day, ex, pct, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate } from "../types";

type Row = [number, number] | [number, number, "plus"] | [number, number, "drives"];

/** Main lift: nine sets; "drives" is the 1+ set whose reps set next week's training max. */
const t1 = (name: string, lift: LiftKey, rows: Row[]): ExerciseRx =>
  ex(
    name,
    rows.map(([p, reps, tag]) => (tag === "drives" ? amrap(p, reps, 180, { drives: true }) : tag === "plus" ? amrap(p, reps, 180) : pct(p, reps, 180))),
    { lift },
  );
/** Second lift: eight sets off the related lift's training max. */
const t2 = (name: string, lift: LiftKey, rows: [number, number][]): ExerciseRx => ex(name, rows.map(([p, reps]) => pct(p, reps, 120)), { lift });

const HEAVY: Row[] = [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 3], [0.8, 3], [0.75, 5], [0.7, 5], [0.65, 5, "plus"]];
const T2_70: [number, number][] = [[0.5, 5], [0.6, 5], [0.7, 3], [0.7, 5], [0.7, 7], [0.7, 4], [0.7, 6], [0.7, 8]];
const T2_60: [number, number][] = [[0.4, 6], [0.5, 5], [0.6, 3], [0.6, 5], [0.6, 7], [0.6, 4], [0.6, 6], [0.6, 8]];

export const nsunsStyle: ProgramTemplate = {
  key: "nsuns-style-5-day",
  name: "nSuns-style 5-day",
  author: "After nSuns' 5/3/1 linear progression",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 5,
  lengthWeeks: 8,
  lifts: ["bench", "squat", "press", "deadlift"],
  tmPct: 0.9,
  who: "Intermediate lifters who like volume and fast weekly progress.",
  description:
    "Five days a week. Each day has a main lift for nine sets that climb to a heavy single and come back down, then a second lift for eight sets. The heavy single is as many reps as you can, and the reps you get set next week's training max: 0 to 1 reps no change, 2 to 3 reps plus 2.5 kg, 4 to 5 reps plus 5 kg, 6 or more plus 7.5 kg.",
  warning: "Long sessions: about 17 working sets a day, five days a week.",
  engine: {
    key: "tm_cycle",
    rule: "amrap_table",
    increment: 0,
    amrapTable: [
      { minReps: 0, kg: 0 },
      { minReps: 2, kg: 2.5 },
      { minReps: 4, kg: 5 },
      { minReps: 6, kg: 7.5 },
    ],
  },
  weeks: [
    week([
      day("Bench and press", [
        t1("Bench press", "bench", [[0.65, 8], [0.75, 6], [0.85, 4], [0.85, 4], [0.85, 4], [0.8, 5], [0.75, 6], [0.7, 7], [0.65, 8, "plus"]]),
        t2("Overhead press", "press", [[0.5, 6], [0.6, 5], [0.7, 3], [0.7, 5], [0.7, 7], [0.7, 4], [0.7, 6], [0.7, 8]]),
      ]),
      day("Squat and sumo", [t1("Back squat", "squat", HEAVY), t2("Sumo deadlift", "deadlift", T2_70)]),
      day("Press and incline", [t1("Overhead press", "press", HEAVY), t2("Incline bench press", "bench", T2_60)]),
      day("Deadlift and front squat", [
        t1("Deadlift", "deadlift", [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 3], [0.8, 3], [0.75, 3], [0.7, 3], [0.65, 3, "plus"]]),
        t2("Front squat", "squat", [[0.35, 5], [0.45, 5], [0.55, 3], [0.55, 5], [0.55, 7], [0.55, 4], [0.55, 6], [0.55, 8]]),
      ]),
      day("Bench and close grip", [
        t1("Bench press", "bench", [[0.75, 5], [0.85, 3], [0.95, 1, "drives"], [0.9, 3], [0.85, 5], [0.8, 3], [0.75, 5], [0.7, 3], [0.65, 5, "plus"]]),
        t2("Close-grip bench press", "bench", T2_60),
      ]),
    ]),
  ],
};
```

- [ ] **Step 5: Write `texas.ts`**

```ts
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
  author: "Texas Method, as written up by Mark Rippetoe",
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
```

- [ ] **Step 6: Write `gzclp.ts`**

```ts
// app/src/lib/programs/templates/gzclp.ts
import { day, ex, fixed, times, week } from "../dsl";
import type { ExerciseRx, LiftKey, ProgramTemplate, SetRx } from "../types";

/** T1: 5x3+, then 6x2+, then 10x1+. */
const T1_STAGES: SetRx[][] = [
  [...times(4, fixed(3, 180)), fixed(3, 180, true)],
  [...times(5, fixed(2, 180)), fixed(2, 180, true)],
  [...times(9, fixed(1, 180)), fixed(1, 180, true)],
];
/** T2: 3x10, then 3x8, then 3x6. */
const T2_STAGES: SetRx[][] = [times(3, fixed(10, 120)), times(3, fixed(8, 120)), times(3, fixed(6, 120))];
/** T3: 3x15 with the last set as many as you can. */
const T3_SETS: SetRx[] = [fixed(15, 60), fixed(15, 60), fixed(15, 60, true)];

const t1 = (name: string, lift: LiftKey): ExerciseRx => ex(name, T1_STAGES[0], { lift, tier: "t1", stages: T1_STAGES, startPct: 0.73 });
const t2 = (name: string, lift: LiftKey): ExerciseRx => ex(name, T2_STAGES[0], { lift, tier: "t2", stages: T2_STAGES, startPct: 0.55 });
const t3 = (name: string): ExerciseRx => ex(name, T3_SETS, { tier: "t3" });

export const gzclp: ProgramTemplate = {
  key: "gzclp",
  name: "GZCLP",
  author: "GZCLP by Cody Lefever",
  family: "strength",
  level: "beginner",
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: ["squat", "bench", "press", "deadlift"],
  tmPct: 1,
  who: "Newer lifters ready for more structure than a beginner program.",
  description:
    "Four workouts in rotation. Each has a heavy main lift (T1: 5 x 3 with a last set for as many as you can), a lighter second lift (T2: 3 x 10) and an accessory (T3: 3 x 15 with a last set for as many as you can). Hit your reps and the weight goes up. Miss, and the lift moves to its next rep scheme: 6 x 2 then 10 x 1 for T1, 3 x 8 then 3 x 6 for T2. T3 goes up once the last set reaches 25.",
  engine: { key: "tm_cycle", rule: "gzclp", increment: 2.5, increments: { squat: 5, deadlift: 5 }, t2ResetKg: 5, t3AmrapTarget: 25 },
  weeks: [
    week([
      day("A1", [t1("Back squat", "squat"), t2("Bench press", "bench"), t3("Lat pulldown")]),
      day("B1", [t1("Overhead press", "press"), t2("Deadlift", "deadlift"), t3("Dumbbell row")]),
      day("A2", [t1("Bench press", "bench"), t2("Back squat", "squat"), t3("Lat pulldown")]),
      day("B2", [t1("Deadlift", "deadlift"), t2("Overhead press", "press"), t3("Dumbbell row")]),
    ]),
  ],
};
```

- [ ] **Step 7: Register them in `registry.ts`**

Replace the whole file with:

```ts
// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { canditoStyle } from "./templates/candito";
import { greyskullLp } from "./templates/greyskull";
import { gzclp } from "./templates/gzclp";
import { nsunsStyle } from "./templates/nsuns";
import { russianSquatRoutine } from "./templates/rsr";
import { sheikoStyle } from "./templates/sheiko";
import { smolovBase, smolovJrBench, smolovJrSquat } from "./templates/smolov";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import { texasMethod } from "./templates/texas";
import { wendlerBbb, wendlerFsl } from "./templates/wendler";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [
  // beginner linear
  strongLifts,
  startingStrength,
  greyskullLp,
  // strength cycles
  wendlerBbb,
  wendlerFsl,
  nsunsStyle,
  texasMethod,
  gzclp,
  // powerlifting peaking
  smolovBase,
  smolovJrSquat,
  smolovJrBench,
  russianSquatRoutine,
  canditoStyle,
  sheikoStyle,
];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
```

- [ ] **Step 8: Run the strength test and the registry test**

Run: `cd app && npm test -- src/lib/programs/templates/strength.test.ts && npm test -- src/lib/programs/registry.test.ts`
Expected: PASS, `programs/templates/strength: ok` and `programs/registry: 14 programs ok`.

Hand-checked: 72% of 100 = 72, rounds to 72.5; GZCLP T1 start 73% of 100 = 73, rounds to 72.5; after the four-day rotation T1 squat and deadlift are 77.5, T1 bench 75 (72.5 + 2.5), T2 squat 60 (55 + 5).

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/programs/templates/wendler.ts app/src/lib/programs/templates/nsuns.ts app/src/lib/programs/templates/texas.ts app/src/lib/programs/templates/gzclp.ts app/src/lib/programs/registry.ts app/src/lib/programs/templates/strength.test.ts
git commit -m "feat(programs): 5/3/1, nSuns-style, Texas Method and GZCLP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Bodybuilding and hypertrophy programs: GVT, PHUL, PHAT, Arnold-style, push/pull/legs, HIT-style

**Files:**
- Modify: `app/src/lib/programs/dsl.ts` (add `rs`)
- Create: `app/src/lib/programs/templates/gvt.ts`
- Create: `app/src/lib/programs/templates/phul.ts`
- Create: `app/src/lib/programs/templates/phat.ts`
- Create: `app/src/lib/programs/templates/arnold.ts`
- Create: `app/src/lib/programs/templates/ppl.ts`
- Create: `app/src/lib/programs/templates/hit.ts`
- Modify: `app/src/lib/programs/registry.ts` (add the six programs; 20 in all)
- Test: `app/src/lib/programs/templates/size.test.ts`

**Interfaces:**
- Consumes (Tasks 1-3): `dsl.ts`, `simulate.ts` (`planAt`, `line`, `simulate`), `registry.ts`.
- Produces: `rs(n: number, min: number, max: number, rest?: number): SetRx[]` in `dsl.ts` (n sets of a rep range, fixed weight). Program keys: `german-volume-training` (engine `fixed_volume`, lifts bench and squat), `phul`, `phat`, `arnold-style-split`, `push-pull-legs`, `hit-style-full-body` (engine `double_progression`, no maxes needed: the member picks each first weight and the engine records it).

Accuracy: GVT's 10 x 10 at 60% with 90 seconds of rest, the paired exercises and the +2.5 kg rule are as the spec states; the A pairs use the bench press and back squat so the 60% has a max to come from. PHUL and PHAT use the published exercise lists and rep ranges; where the published set count is a range ("3-4"), we use the top for main lifts and as published otherwise. Arnold-style and HIT-style are labelled "-style": the splits are theirs, the exercise choices are ours.

- [ ] **Step 1: Add `rs` to `dsl.ts`**

Append to `app/src/lib/programs/dsl.ts`:

```ts
/** n sets of a rep range at a fixed weight: rs(4, 8, 12) is 4 x 8-12. */
export function rs(n: number, min: number, max: number, rest = 90): SetRx[] {
  return times(n, fixed(range(min, max), rest));
}
```

- [ ] **Step 2: Write the failing size test**

```ts
// app/src/lib/programs/templates/size.test.ts
// Run: npm test -- src/lib/programs/templates/size.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, planAt, simulate } from "../simulate";

const names = (key: string) => platformProgram(key)!.weeks.map((w) => w.days.map((d) => d.name));

// ── German Volume Training: 10 x 10 at 60% ───────────────────────────────
const gvt = platformProgram("german-volume-training")!;
const gvtMaxes = { bench: 100, squat: 100 };
const d1 = planAt(gvt, gvtMaxes, 0, 0);
assert.deepEqual(d1.exercises.map((e) => line(e)), ["Bench press 10 x 10 at 60 kg", "Chin-up 10 x 10", "Incline dumbbell fly 3 x 10-12", "Dumbbell row 3 x 10-12"]);
assert.deepEqual(d1.exercises.map((e) => e.joined), [false, true, false, true]);
assert.deepEqual(planAt(gvt, gvtMaxes, 0, 1).exercises.slice(0, 2).map((e) => line(e)), ["Back squat 10 x 10 at 60 kg", "Lying leg curl 10 x 10"]);
assert.equal(d1.exercises[0].sets[0].rest, 90);
const gvtRun = simulate(gvt, { maxes: gvtMaxes });
assert.equal(gvtRun.sessions.length, 18);
assert.equal(gvtRun.final.weights["bench press"], 75);
assert.equal(gvtRun.final.weights["back squat"], 75);

// ── PHUL ─────────────────────────────────────────────────────────────────
assert.deepEqual(names("phul"), [["Upper power", "Lower power", "Upper hypertrophy", "Lower hypertrophy"]]);
const phul = platformProgram("phul")!;
assert.equal(line(planAt(phul, {}, 0, 0).exercises[0]), "Bench press 4 x 3-5");
assert.equal(line(planAt(phul, {}, 0, 3).exercises[0]), "Front squat 4 x 8-12");
// every rep at the top of the range: +2.5 kg each upper power day from a first 20 kg
assert.equal(simulate(phul, { maxes: {} }).final.weights["bench press@3-5"], 50);

// ── PHAT ─────────────────────────────────────────────────────────────────
assert.deepEqual(names("phat"), [["Upper power", "Lower power", "Back and shoulders", "Lower hypertrophy", "Chest and arms"]]);
const phat = platformProgram("phat")!;
const speed = planAt(phat, {}, 0, 2).exercises[0];
assert.equal(line(speed), "Pendlay row 6 x 3");
assert.equal(speed.progresses, false);
assert.equal(simulate(phat, { maxes: {} }).final.weights["pendlay row"], undefined, "speed sets never progress");

// ── Arnold-style split, push/pull/legs, HIT-style ────────────────────────
assert.deepEqual(names("arnold-style-split"), [["Chest and back", "Shoulders and arms", "Legs", "Chest and back", "Shoulders and arms", "Legs"]]);
assert.deepEqual(names("push-pull-legs"), [["Push", "Pull", "Legs", "Push", "Pull", "Legs"]]);
assert.deepEqual(names("hit-style-full-body"), [["Workout A", "Workout B", "Workout A"], ["Workout B", "Workout A", "Workout B"]]);
const hit = platformProgram("hit-style-full-body")!;
assert.ok(hit.weeks.every((w) => w.days.every((d) => d.exercises.every((e) => e.sets.length === 1))), "HIT is one work set per exercise");
assert.equal(line(planAt(hit, {}, 0, 0).exercises[0]), "Leg press 1 x 8-12");

for (const key of ["phul", "phat", "arnold-style-split", "push-pull-legs", "hit-style-full-body"]) {
  const t = platformProgram(key)!;
  assert.equal(t.engine.key, "double_progression", key);
  assert.deepEqual(t.lifts, [], `${key} needs no maxes`);
  assert.equal(t.family, "size", key);
}

console.log("programs/templates/size: ok");
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/templates/size.test.ts`
Expected: FAIL (`rs` and the programs do not exist yet).

- [ ] **Step 4: Write `gvt.ts`**

```ts
// app/src/lib/programs/templates/gvt.ts
import { day, ex, fixed, rs, times, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const TEMPO = "Lower for four seconds, lift in two. Rest 90 seconds, then do the paired exercise.";
const tens = () => times(10, fixed(10, 90));

const chestBack = day("Chest and back", [
  ex("Bench press", tens(), { lift: "bench", notes: TEMPO }),
  ex("Chin-up", tens(), { bodyweight: true, joined: true }),
  ex("Incline dumbbell fly", rs(3, 10, 12, 60), { progress: false }),
  ex("Dumbbell row", rs(3, 10, 12, 60), { progress: false, joined: true }),
]);
const legs = day("Legs", [
  ex("Back squat", tens(), { lift: "squat", notes: TEMPO }),
  ex("Lying leg curl", tens(), { joined: true }),
  ex("Cable crunch", rs(3, 12, 15, 60), { progress: false }),
  ex("Seated calf raise", rs(3, 15, 20, 60), { progress: false, joined: true }),
]);
const armsShoulders = day("Arms and shoulders", [
  ex("Dip", tens(), { bodyweight: true, notes: TEMPO }),
  ex("Hammer curl", tens(), { joined: true }),
  ex("Rear delt fly", rs(3, 10, 12, 60), { progress: false }),
  ex("Lateral raise", rs(3, 10, 12, 60), { progress: false, joined: true }),
]);

export const germanVolumeTraining: ProgramTemplate = {
  key: "german-volume-training",
  name: "German Volume Training",
  author: "German Volume Training, popularised by Charles Poliquin",
  family: "size",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 6,
  lifts: ["bench", "squat"],
  tmPct: 1,
  who: "Lifters who want size and can set heavy strength work aside for six weeks.",
  description:
    "Ten sets of ten on one big lift per session, done back to back with a second exercise, at 60% of your max with 90 seconds of rest. Once you get all 100 reps, the weight goes up 2.5 kg next time. Three sessions a week: chest and back, legs, then arms and shoulders, each finished with two lighter exercises.",
  warning: "Very high volume. Expect to be sore for days after the first sessions.",
  engine: { key: "fixed_volume", increment: 2.5, startPct: 0.6 },
  weeks: [week([chestBack, legs, armsShoulders])],
};
```

- [ ] **Step 5: Write `phul.ts`**

```ts
// app/src/lib/programs/templates/phul.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const upperPower = day("Upper power", [
  ex("Bench press", rs(4, 3, 5, 180)),
  ex("Incline dumbbell press", rs(4, 6, 10)),
  ex("Barbell row", rs(4, 3, 5, 180)),
  ex("Lat pulldown", rs(4, 6, 10)),
  ex("Overhead press", rs(3, 5, 8, 120)),
  ex("Barbell curl", rs(3, 6, 10)),
  ex("Skull crusher", rs(3, 6, 10)),
]);
const lowerPower = day("Lower power", [
  ex("Back squat", rs(4, 3, 5, 180)),
  ex("Deadlift", rs(4, 3, 5, 180)),
  ex("Leg press", rs(4, 10, 15, 120)),
  ex("Lying leg curl", rs(4, 6, 10)),
  ex("Standing calf raise", rs(4, 6, 10, 60)),
]);
const upperHypertrophy = day("Upper hypertrophy", [
  ex("Incline bench press", rs(4, 8, 12)),
  ex("Dumbbell fly", rs(4, 8, 12, 60)),
  ex("Seated cable row", rs(4, 8, 12)),
  ex("Dumbbell row", rs(4, 8, 12)),
  ex("Lateral raise", rs(4, 8, 12, 60)),
  ex("Incline dumbbell curl", rs(4, 8, 12, 60)),
  ex("Triceps pushdown", rs(4, 8, 12, 60)),
]);
const lowerHypertrophy = day("Lower hypertrophy", [
  ex("Front squat", rs(4, 8, 12, 120)),
  ex("Walking lunge", rs(4, 8, 12)),
  ex("Leg extension", rs(4, 10, 15, 60)),
  ex("Lying leg curl", rs(4, 10, 15, 60)),
  ex("Seated calf raise", rs(4, 8, 12, 60)),
  ex("Leg press calf raise", rs(4, 8, 12, 60)),
]);

export const phul: ProgramTemplate = {
  key: "phul",
  name: "PHUL",
  author: "PHUL by Brandon Campbell",
  family: "size",
  level: "intermediate",
  daysPerWeek: 4,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Intermediate lifters who want strength and size on four days a week.",
  description:
    "Power Hypertrophy Upper Lower. An upper and a lower power day with heavy sets of three to five, and an upper and a lower hypertrophy day with sets of eight to fifteen. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its rep range on every set.",
  engine: { key: "double_progression" },
  weeks: [week([upperPower, lowerPower, upperHypertrophy, lowerHypertrophy])],
};
```

- [ ] **Step 6: Write `phat.ts`**

```ts
// app/src/lib/programs/templates/phat.ts
import { day, ex, fixed, rs, times, week } from "../dsl";
import type { ExerciseRx, ProgramTemplate } from "../types";

const speed = (name: string, what: string): ExerciseRx =>
  ex(name, times(6, fixed(3, 90)), { progress: false, notes: `Speed sets: about 65 to 70% of your ${what} weight from the power day, moved fast.` });

const upperPower = day("Upper power", [
  ex("Pendlay row", rs(3, 3, 5, 180)),
  ex("Pull-up", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Chin-up", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Dumbbell bench press", rs(3, 3, 5, 180)),
  ex("Dip", rs(2, 6, 10, 120), { bodyweight: true }),
  ex("Seated dumbbell shoulder press", rs(3, 6, 10, 120)),
  ex("EZ-bar curl", rs(3, 6, 10)),
  ex("Skull crusher", rs(3, 6, 10)),
]);
const lowerPower = day("Lower power", [
  ex("Back squat", rs(3, 3, 5, 180)),
  ex("Hack squat", rs(2, 6, 10, 120)),
  ex("Leg extension", rs(2, 6, 10)),
  ex("Stiff-legged deadlift", rs(3, 5, 8, 120)),
  ex("Lying leg curl", rs(2, 6, 10)),
  ex("Standing calf raise", rs(3, 6, 10, 60)),
  ex("Seated calf raise", rs(2, 6, 10, 60)),
]);
const backShoulders = day("Back and shoulders", [
  speed("Pendlay row", "row"),
  ex("Chin-up", rs(3, 8, 12), { bodyweight: true }),
  ex("Seated cable row", rs(3, 8, 12)),
  ex("Dumbbell shrug", rs(2, 12, 15, 60)),
  ex("Close-grip lat pulldown", rs(2, 15, 20, 60)),
  ex("Seated dumbbell shoulder press", rs(3, 8, 12)),
  ex("Upright row", rs(2, 12, 15, 60)),
  ex("Lateral raise", rs(3, 12, 20, 60)),
]);
const lowerHypertrophy = day("Lower hypertrophy", [
  speed("Back squat", "squat"),
  ex("Hack squat", rs(3, 8, 12, 120)),
  ex("Leg press", rs(2, 12, 15)),
  ex("Leg extension", rs(3, 15, 20, 60)),
  ex("Romanian deadlift", rs(3, 8, 12, 120)),
  ex("Lying leg curl", rs(2, 12, 15, 60)),
  ex("Seated leg curl", rs(2, 15, 20, 60)),
  ex("Donkey calf raise", rs(4, 10, 15, 60)),
  ex("Seated calf raise", rs(3, 15, 20, 60)),
]);
const chestArms = day("Chest and arms", [
  speed("Dumbbell bench press", "dumbbell press"),
  ex("Incline dumbbell press", rs(3, 8, 12)),
  ex("Machine chest press", rs(3, 12, 15)),
  ex("Incline cable fly", rs(2, 15, 20, 60)),
  ex("Preacher curl", rs(3, 8, 12, 60)),
  ex("Concentration curl", rs(2, 12, 15, 60)),
  ex("Spider curl", rs(2, 15, 20, 60)),
  ex("Overhead triceps extension", rs(3, 8, 12, 60)),
  ex("Triceps pushdown", rs(2, 12, 15, 60)),
  ex("Cable triceps kickback", rs(2, 15, 20, 60)),
]);

export const phat: ProgramTemplate = {
  key: "phat",
  name: "PHAT",
  author: "PHAT by Layne Norton",
  family: "size",
  level: "advanced",
  daysPerWeek: 5,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Experienced lifters who can train five days a week.",
  description:
    "Power Hypertrophy Adaptive Training. Two power days, upper and lower, with heavy sets of three to five, then three hypertrophy days. Each hypertrophy day opens with six fast sets of three at about 65 to 70% of your power-day weight. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its rep range on every set. Rack chins are listed as chin-ups.",
  warning: "Five long sessions a week. Plan your recovery and food around it.",
  engine: { key: "double_progression" },
  weeks: [week([upperPower, lowerPower, backShoulders, lowerHypertrophy, chestArms])],
};
```

- [ ] **Step 7: Write `arnold.ts`, `ppl.ts` and `hit.ts`**

```ts
// app/src/lib/programs/templates/arnold.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const chestBack = day("Chest and back", [
  ex("Bench press", rs(4, 8, 12)),
  ex("Incline bench press", rs(4, 8, 12)),
  ex("Dumbbell fly", rs(3, 10, 12, 60)),
  ex("Pull-up", rs(4, 8, 12), { bodyweight: true }),
  ex("Barbell row", rs(4, 8, 12)),
  ex("Seated cable row", rs(3, 10, 12, 60)),
]);
const shouldersArms = day("Shoulders and arms", [
  ex("Overhead press", rs(4, 8, 12)),
  ex("Lateral raise", rs(3, 10, 12, 60)),
  ex("Rear delt fly", rs(3, 10, 12, 60)),
  ex("Barbell curl", rs(4, 8, 12, 60)),
  ex("Incline dumbbell curl", rs(3, 10, 12, 60)),
  ex("Skull crusher", rs(4, 8, 12, 60)),
  ex("Triceps pushdown", rs(3, 10, 12, 60)),
]);
const legs = day("Legs", [
  ex("Back squat", rs(4, 8, 12, 120)),
  ex("Romanian deadlift", rs(4, 8, 12, 120)),
  ex("Leg extension", rs(3, 12, 15, 60)),
  ex("Lying leg curl", rs(3, 10, 12, 60)),
  ex("Walking lunge", rs(3, 10, 12)),
  ex("Standing calf raise", rs(4, 12, 15, 60)),
]);

export const arnoldStyle: ProgramTemplate = {
  key: "arnold-style-split",
  name: "Arnold-style split",
  author: "After Arnold Schwarzenegger's split",
  family: "size",
  level: "advanced",
  daysPerWeek: 6,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Experienced lifters who want to train each muscle twice a week.",
  description:
    "Chest and back, shoulders and arms, then legs, each twice a week over six days. Sets of eight to fifteen. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its range on every set. The split is his; the exercise choice and set counts are ours.",
  warning: "Six sessions a week. Plan your recovery and food around it.",
  engine: { key: "double_progression" },
  weeks: [week([chestBack, shouldersArms, legs, chestBack, shouldersArms, legs])],
};
```

```ts
// app/src/lib/programs/templates/ppl.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const push = day("Push", [
  ex("Bench press", rs(4, 6, 8, 150)),
  ex("Overhead press", rs(3, 8, 10, 120)),
  ex("Incline dumbbell press", rs(3, 8, 12)),
  ex("Lateral raise", rs(3, 12, 15, 60)),
  ex("Triceps pushdown", rs(3, 10, 12, 60)),
  ex("Overhead triceps extension", rs(3, 10, 12, 60)),
]);
const pull = day("Pull", [
  ex("Barbell row", rs(4, 6, 8, 150)),
  ex("Pull-up", rs(3, 6, 10, 120), { bodyweight: true }),
  ex("Seated cable row", rs(3, 8, 12)),
  ex("Face pull", rs(3, 12, 15, 60)),
  ex("Barbell curl", rs(3, 8, 12, 60)),
  ex("Hammer curl", rs(3, 10, 12, 60)),
]);
const legs = day("Legs", [
  ex("Back squat", rs(4, 6, 8, 180)),
  ex("Romanian deadlift", rs(3, 8, 10, 120)),
  ex("Leg press", rs(3, 10, 12, 120)),
  ex("Lying leg curl", rs(3, 10, 12, 60)),
  ex("Standing calf raise", rs(4, 10, 15, 60)),
]);

export const pushPullLegs: ProgramTemplate = {
  key: "push-pull-legs",
  name: "Push, pull, legs",
  author: "A classic split with no single author",
  family: "size",
  level: "intermediate",
  daysPerWeek: 6,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Lifters who want a simple six-day split.",
  description:
    "A push day (chest, shoulders, triceps), a pull day (back, biceps) and a leg day, each twice a week. A heavier compound lift opens each day, then accessories in higher rep ranges. You pick each starting weight; each exercise goes up by your smallest jump once you reach the top of its range on every set.",
  engine: { key: "double_progression" },
  weeks: [week([push, pull, legs, push, pull, legs])],
};
```

```ts
// app/src/lib/programs/templates/hit.ts
import { day, ex, rs, week } from "../dsl";
import type { ProgramTemplate } from "../types";

const one = (min: number, max: number, rest = 120) => rs(1, min, max, rest);

const A = day("Workout A", [
  ex("Leg press", one(8, 12)),
  ex("Lying leg curl", one(8, 12)),
  ex("Standing calf raise", one(12, 15, 90)),
  ex("Machine chest press", one(6, 10)),
  ex("Lat pulldown", one(6, 10)),
  ex("Seated dumbbell shoulder press", one(6, 10)),
  ex("Barbell curl", one(6, 10, 90)),
]);
const B = day("Workout B", [
  ex("Deadlift", one(5, 8, 180)),
  ex("Leg extension", one(8, 12)),
  ex("Dip", one(6, 10), { bodyweight: true }),
  ex("Chin-up", one(6, 10), { bodyweight: true }),
  ex("Dumbbell row", one(6, 10)),
  ex("Lateral raise", one(8, 12, 90)),
  ex("Triceps pushdown", one(6, 10, 90)),
]);

export const hitStyle: ProgramTemplate = {
  key: "hit-style-full-body",
  name: "HIT-style full body",
  author: "After Arthur Jones and Mike Mentzer",
  family: "size",
  level: "intermediate",
  daysPerWeek: 3,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Busy lifters who want short, hard sessions three days a week.",
  description:
    "Two full-body workouts, alternated three days a week. Warm up, then one work set per exercise, taken to failure. When you reach the top of the rep range, the weight goes up by your smallest jump next time. The workouts are ours, in the high-intensity style.",
  warning: "Every work set goes to failure. Use a spotter on presses.",
  engine: { key: "double_progression" },
  weeks: [week([A, B, A]), week([B, A, B])],
};
```

- [ ] **Step 8: Register them in `registry.ts`**

Replace the whole file with:

```ts
// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { arnoldStyle } from "./templates/arnold";
import { canditoStyle } from "./templates/candito";
import { greyskullLp } from "./templates/greyskull";
import { germanVolumeTraining } from "./templates/gvt";
import { gzclp } from "./templates/gzclp";
import { hitStyle } from "./templates/hit";
import { nsunsStyle } from "./templates/nsuns";
import { phat } from "./templates/phat";
import { phul } from "./templates/phul";
import { pushPullLegs } from "./templates/ppl";
import { russianSquatRoutine } from "./templates/rsr";
import { sheikoStyle } from "./templates/sheiko";
import { smolovBase, smolovJrBench, smolovJrSquat } from "./templates/smolov";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import { texasMethod } from "./templates/texas";
import { wendlerBbb, wendlerFsl } from "./templates/wendler";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [
  // beginner linear
  strongLifts,
  startingStrength,
  greyskullLp,
  // strength cycles
  wendlerBbb,
  wendlerFsl,
  nsunsStyle,
  texasMethod,
  gzclp,
  // powerlifting peaking
  smolovBase,
  smolovJrSquat,
  smolovJrBench,
  russianSquatRoutine,
  canditoStyle,
  sheikoStyle,
  // bodybuilding and hypertrophy
  germanVolumeTraining,
  phul,
  phat,
  arnoldStyle,
  pushPullLegs,
  hitStyle,
];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
```

- [ ] **Step 9: Run every programs test**

Run: `cd app && for f in src/lib/programs/*.test.ts src/lib/programs/templates/*.test.ts; do npm test -- "$f" || exit 1; done`
Expected: every file passes; the registry test prints `programs/registry: 20 programs ok`.

Hand-checked: GVT runs 18 sessions, six on each day, so bench and squat go 60 to 75; PHUL's first upper power day logs 20 kg x 5 (the top of 3-5), so bench goes up every one of the 12 upper power days: 20 + 12 x 2.5 = 50.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/programs/dsl.ts app/src/lib/programs/templates/gvt.ts app/src/lib/programs/templates/phul.ts app/src/lib/programs/templates/phat.ts app/src/lib/programs/templates/arnold.ts app/src/lib/programs/templates/ppl.ts app/src/lib/programs/templates/hit.ts app/src/lib/programs/registry.ts app/src/lib/programs/templates/size.test.ts
git commit -m "feat(programs): hypertrophy programs, 20 in the library

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tenant DB tables and columns, and the library store (hide switches, gym copies)

**Files:**
- Modify: `app/src/lib/db/tenant.ts` (inside `ensureTenantTables`, just before the line `  // Dashboard slice 2: stamp each event recorder's start date once.`)
- Modify: `app/src/lib/db/schema.ts` (three tables get columns; four new tables appended at the end)
- Create: `app/src/lib/programs/library.ts`
- Test: `app/src/lib/programs/library.test.ts`

**Interfaces:**
- Consumes (Tasks 1-6): `registry.ts` (`PLATFORM_PROGRAMS`, `platformProgram`), `validate.ts` (`parseTemplate`, `templateErrors`, `copyErrors`), `types.ts` (`ProgramTemplate`).
- Produces:
  - Tenant tables `program_templates`, `program_library_hidden`, `program_enrolments`, `program_enrolment_events`; columns `clients.training_mode` (TEXT NOT NULL DEFAULT 'coach'), `clients.weight_unit` (TEXT NOT NULL DEFAULT 'kg'), `clients.plate_step_kg` (REAL NOT NULL DEFAULT 2.5), `workout_sessions.enrolment_id` (INTEGER), `workout_session_exercises.rx_json` (TEXT), `workout_set_logs.target_weight_kg` (REAL), `workout_set_logs.rpe` (REAL).
  - Drizzle: `clients.trainingMode: "coach" | "diy"`, `clients.weightUnit: "kg" | "lb"`, `clients.plateStepKg: number`; `workoutSessions.enrolmentId: number | null`; `workoutSessionExercises.rxJson: string | null`; `workoutSetLogs.targetWeightKg: number | null`, `workoutSetLogs.rpe: number | null`; tables `programTemplates`, `programLibraryHidden`, `programEnrolments`, `programEnrolmentEvents`.
  - `library.ts`: `COPY_PREFIX = "copy-"`, `copyKey(id): string`, `parseCopyKey(key): number | null`, `hiddenKeys(): Set<string>`, `setHidden(key, hidden, userId): boolean`, `interface CopyRow { id; basedOn; basedOnName; name; template; updatedAt }`, `listCopies(): CopyRow[]`, `getCopy(id): CopyRow | null`, `makeCopy(platformKey, userId): number | null`, `saveCopy(id, raw: unknown): { ok: true } | { ok: false; errors: string[] }`, `deleteCopy(id): boolean`, `interface LibraryEntry { template: ProgramTemplate; basedOnName: string | null; copyId: number | null; hidden: boolean }`, `programByKey(key, opts?: { includeHidden?: boolean }): LibraryEntry | null`, `memberPrograms(): LibraryEntry[]` (gym copies first, then platform programs that are not hidden).

- [ ] **Step 1: Add the tables and columns to `ensureTenantTables`**

In `app/src/lib/db/tenant.ts`, insert this block immediately before the line `  // Dashboard slice 2: stamp each event recorder's start date once.` (these are additive, so they belong here and NOT in `TENANT_MIGRATIONS`):

```ts
  // DIY training and the program library (lib/programs). Gym copies of
  // platform programs, platform programs a gym hid, member enrolments (each
  // with a snapshot of the template it started from) and their change log.
  // Additive; idempotent.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS program_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      based_on TEXT NOT NULL,
      engine TEXT NOT NULL,
      name TEXT NOT NULL,
      template_json TEXT NOT NULL,
      created_by INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_library_hidden (
      program_key TEXT PRIMARY KEY,
      hidden_by INTEGER,
      hidden_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS program_enrolments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      program_key TEXT,
      copy_id INTEGER REFERENCES program_templates(id) ON DELETE SET NULL,
      template_json TEXT NOT NULL,
      maxes_json TEXT NOT NULL DEFAULT '{}',
      tms_json TEXT NOT NULL DEFAULT '{}',
      week INTEGER NOT NULL DEFAULT 0,
      day INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      weekdays TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_program_enrolments_client ON program_enrolments(client_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_program_enrolments_live ON program_enrolments(client_id) WHERE status IN ('active', 'paused');
    CREATE TABLE IF NOT EXISTS program_enrolment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enrolment_id INTEGER NOT NULL REFERENCES program_enrolments(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      actor_name TEXT,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      session_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_program_events_enrolment ON program_enrolment_events(enrolment_id, at);
  `);
  {
    const addColumn = (table: string, column: string, ddl: string) => {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length && !cols.some((c) => c.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    addColumn("clients", "training_mode", "training_mode TEXT NOT NULL DEFAULT 'coach'");
    addColumn("clients", "weight_unit", "weight_unit TEXT NOT NULL DEFAULT 'kg'");
    addColumn("clients", "plate_step_kg", "plate_step_kg REAL NOT NULL DEFAULT 2.5");
    addColumn("workout_sessions", "enrolment_id", "enrolment_id INTEGER");
    addColumn("workout_session_exercises", "rx_json", "rx_json TEXT");
    addColumn("workout_set_logs", "target_weight_kg", "target_weight_kg REAL");
    addColumn("workout_set_logs", "rpe", "rpe REAL");
  }

```

- [ ] **Step 2: Update the drizzle schema**

In `app/src/lib/db/schema.ts`, in the `clients` table, add three columns right after the `gdprConsentDate` line:

```ts
  /** "coach" (the default) or "diy": a DIY member can run library programs on their own. */
  trainingMode: text("training_mode", { enum: ["coach", "diy"] }).notNull().default("coach"),
  /** The member's display unit. Weights are always stored in kg. */
  weightUnit: text("weight_unit", { enum: ["kg", "lb"] }).notNull().default("kg"),
  /** Their smallest jump in kg: 2.5, 1.25, or 2.26796 (5 lb). */
  plateStepKg: real("plate_step_kg").notNull().default(2.5),
```

In `workoutSessions`, after `programId`:

```ts
  /** The DIY program enrolment this session belongs to (lib/programs/enrolments.ts). */
  enrolmentId: integer("enrolment_id"),
```

In `workoutSessionExercises`, after `joined`:

```ts
  /** A program session's planned sets for this exercise (PlannedExercise JSON). */
  rxJson: text("rx_json"),
```

In `workoutSetLogs`, after `done`:

```ts
  /** The weight the program planned for this set (kg). */
  targetWeightKg: real("target_weight_kg"),
  /** How hard the set felt, 1 to 10, if the member said. */
  rpe: real("rpe"),
```

Append at the end of the file:

```ts
/** A gym's own version of a platform program (lib/programs/library.ts). */
export const programTemplates = sqliteTable("program_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** The platform program key it was copied from. */
  basedOn: text("based_on").notNull(),
  engine: text("engine").notNull(),
  name: text("name").notNull(),
  templateJson: text("template_json").notNull(),
  createdBy: integer("created_by"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** A platform program the gym hid from its members. */
export const programLibraryHidden = sqliteTable("program_library_hidden", {
  programKey: text("program_key").primaryKey(),
  hiddenBy: integer("hidden_by"),
  hiddenAt: integer("hidden_at").notNull(),
});

/** A member running a library program. One active or paused per member. */
export const programEnrolments = sqliteTable("program_enrolments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  /** Platform program key; null for a gym copy. */
  programKey: text("program_key"),
  copyId: integer("copy_id").references(() => programTemplates.id, { onDelete: "set null" }),
  /** The template as it was when the member started. */
  templateJson: text("template_json").notNull(),
  maxesJson: text("maxes_json").notNull().default("{}"),
  tmsJson: text("tms_json").notNull().default("{}"),
  week: integer("week").notNull().default(0),
  day: integer("day").notNull().default(0),
  /** The rest of the engine state (weights, misses, stages, cycle, finished...). */
  stateJson: text("state_json").notNull().default("{}"),
  status: text("status", { enum: ["active", "paused", "ended"] }).notNull().default("active"),
  /** YYYY-MM-DD. */
  startDate: text("start_date").notNull(),
  /** Training weekdays, "1,3,5" (1 = Monday). */
  weekdays: text("weekdays").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  endedAt: integer("ended_at"),
});

/** Every change to an enrolment, with who made it and why. */
export const programEnrolmentEvents = sqliteTable("program_enrolment_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  enrolmentId: integer("enrolment_id")
    .notNull()
    .references(() => programEnrolments.id, { onDelete: "cascade" }),
  at: integer("at").notNull(),
  /** "engine", "member" or "staff:<userId>". */
  actor: text("actor").notNull(),
  actorName: text("actor_name"),
  kind: text("kind").notNull(),
  reason: text("reason").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  sessionId: integer("session_id"),
});
```

- [ ] **Step 3: Typecheck the schema change**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no errors. If a file builds a `Client` object literal by hand (a test fixture or mock), add `trainingMode: "coach", weightUnit: "kg", plateStepKg: 2.5` to it; nothing else should need touching because inserts get the column defaults.

- [ ] **Step 4: Write the failing library test**

```ts
// app/src/lib/programs/library.test.ts
// Run: npm test -- src/lib/programs/library.test.ts
//
// Hide switches and gym copies against a scratch tenant (control row + a real
// tenant DB file, so ensureTenantTables creates the new tables).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// ./library -> @/lib/db (ambient db proxy) -> @/lib/db/tenant (react cache)
// and @/lib/tenants -> @/lib/auth -> next/navigation. Same shim as forms.test.ts.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/library.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const lib = requireLocal("./library") as typeof import("./library");
  const { PLATFORM_PROGRAMS } = requireLocal("./registry") as typeof import("./registry");

  const slug = "programs-library-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Library Test", dbFile) as {
      id: number;
    }
  ).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    runWithTenant(tid, () => {
      // ── hide switches ──
      assert.equal(lib.hiddenKeys().size, 0);
      assert.equal(lib.setHidden("smolov-base", true, 7), true);
      assert.equal(lib.setHidden("smolov-base", true, 7), true, "hiding twice is harmless");
      assert.equal(lib.setHidden("not-a-program", true, 7), false);
      assert.deepEqual([...lib.hiddenKeys()], ["smolov-base"]);
      assert.equal(lib.programByKey("smolov-base"), null, "a member cannot open a hidden program");
      assert.equal(lib.programByKey("smolov-base", { includeHidden: true })?.hidden, true);
      assert.ok(!lib.memberPrograms().some((e) => e.template.key === "smolov-base"));

      // ── make our version ──
      const id = lib.makeCopy("smolov-base", 7);
      assert.ok(id);
      const copy = lib.getCopy(id)!;
      assert.equal(copy.template.key, `copy-${id}`);
      assert.equal(copy.name, "Smolov base mesocycle");
      assert.equal(copy.basedOnName, "Smolov base mesocycle");
      assert.equal(lib.parseCopyKey(`copy-${id}`), id);
      assert.equal(lib.parseCopyKey("smolov-base"), null);
      assert.equal(lib.makeCopy("not-a-program", 7), null);

      // ── edit it: rename, change a percentage, add a note; an engine change is ignored ──
      const edited = structuredClone(copy.template);
      edited.name = "Our Smolov";
      edited.weeks[0].days[0].exercises[0].sets[0] = { kind: "pct", pct: 0.68, reps: 9, rest: 150 };
      edited.weeks[0].days[0].exercises[0].notes = "Belt on for the last two sets.";
      (edited as { engine: unknown }).engine = { key: "double_progression" };
      assert.deepEqual(lib.saveCopy(id, edited), { ok: true });
      const saved = lib.getCopy(id)!;
      assert.equal(saved.name, "Our Smolov");
      assert.equal(saved.template.engine.key, "fixed_block", "the original's engine always runs a copy");
      const firstSet = saved.template.weeks[0].days[0].exercises[0].sets[0];
      assert.ok(firstSet.kind === "pct" && firstSet.pct === 0.68);
      assert.equal(lib.listCopies().length, 1);

      // ── a copy that drops a lift the engine needs is refused, naming the lift ──
      const dropped = structuredClone(saved.template);
      for (const w of dropped.weeks) for (const d of w.days) d.exercises = d.exercises.map(() => ({ name: "Front squat", sets: [{ kind: "fixed" as const, reps: 5, rest: 120 }] }));
      assert.deepEqual(lib.saveCopy(id, dropped), {
        ok: false,
        errors: ["This version has no exercise that uses the squat max. Smolov base mesocycle needs one."],
      });
      const badName = structuredClone(saved.template);
      badName.weeks[0].days[0].exercises[0].name = "Zercher thing";
      const badCheck = lib.saveCopy(id, badName);
      assert.ok(!badCheck.ok && badCheck.errors[0].includes("not in the exercise list"));
      assert.equal(lib.getCopy(id)!.name, "Our Smolov", "a refused save changes nothing");

      // ── members see the gym's copies first, then the platform programs not hidden ──
      const keys = lib.memberPrograms().map((e) => e.template.key);
      assert.equal(keys[0], `copy-${id}`);
      assert.ok(keys.includes("stronglifts-5x5"));
      assert.equal(keys.length, PLATFORM_PROGRAMS.length - 1 + 1);
      assert.equal(lib.programByKey(`copy-${id}`)?.copyId, id);
      assert.equal(lib.programByKey(`copy-${id}`)?.basedOnName, "Smolov base mesocycle");

      // ── unhide, delete ──
      assert.equal(lib.setHidden("smolov-base", false, 7), true);
      assert.equal(lib.hiddenKeys().size, 0);
      assert.equal(lib.deleteCopy(id), true);
      assert.equal(lib.getCopy(id), null);
      assert.equal(lib.programByKey(`copy-${id}`), null);
    });
    console.log("programs/library: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/library.test.ts`
Expected: FAIL with `Cannot find module './library'`.

- [ ] **Step 6: Write `library.ts`**

```ts
// app/src/lib/programs/library.ts
import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { programLibraryHidden, programTemplates } from "@/lib/db/schema";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import type { ProgramTemplate } from "./types";
import { copyErrors, parseTemplate, templateErrors } from "./validate";

/**
 * What one gym's members can pick from: the gym's own versions of platform
 * programs (tenant DB) plus the platform programs it has not hidden. Ambient
 * tenant `db`.
 */

export const COPY_PREFIX = "copy-";

export function copyKey(id: number): string {
  return `${COPY_PREFIX}${id}`;
}

export function parseCopyKey(key: string): number | null {
  if (!key.startsWith(COPY_PREFIX)) return null;
  const n = Number(key.slice(COPY_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function hiddenKeys(): Set<string> {
  return new Set(db.select({ k: programLibraryHidden.programKey }).from(programLibraryHidden).all().map((r) => r.k));
}

/** Hide or show a platform program for this gym's members. Unknown keys are refused. */
export function setHidden(key: string, hidden: boolean, userId: number | null): boolean {
  if (!platformProgram(key)) return false;
  if (hidden) db.insert(programLibraryHidden).values({ programKey: key, hiddenBy: userId, hiddenAt: Date.now() }).onConflictDoNothing().run();
  else db.delete(programLibraryHidden).where(eq(programLibraryHidden.programKey, key)).run();
  return true;
}

export interface CopyRow {
  id: number;
  basedOn: string;
  basedOnName: string;
  name: string;
  template: ProgramTemplate;
  updatedAt: number;
}

function toCopy(r: typeof programTemplates.$inferSelect): CopyRow | null {
  let template: ProgramTemplate;
  try {
    template = JSON.parse(r.templateJson) as ProgramTemplate;
  } catch (err) {
    console.error("[programs] unreadable gym copy", r.id, err);
    return null;
  }
  return {
    id: r.id,
    basedOn: r.basedOn,
    basedOnName: platformProgram(r.basedOn)?.name ?? r.basedOn,
    name: r.name,
    template: { ...template, key: copyKey(r.id), name: r.name },
    updatedAt: r.updatedAt,
  };
}

export function listCopies(): CopyRow[] {
  return db
    .select()
    .from(programTemplates)
    .orderBy(desc(programTemplates.updatedAt))
    .all()
    .map(toCopy)
    .filter((c): c is CopyRow => c !== null);
}

export function getCopy(id: number): CopyRow | null {
  const r = db.select().from(programTemplates).where(eq(programTemplates.id, id)).get();
  return r ? toCopy(r) : null;
}

/** "Make our version": a copy of a platform program in this gym's DB. */
export function makeCopy(platformKey: string, userId: number | null): number | null {
  const original = platformProgram(platformKey);
  if (!original) return null;
  const now = Date.now();
  const [row] = db
    .insert(programTemplates)
    .values({ basedOn: original.key, engine: original.engine.key, name: original.name, templateJson: JSON.stringify(original), createdBy: userId, createdAt: now, updatedAt: now })
    .returning({ id: programTemplates.id })
    .all();
  return row.id;
}

/**
 * Save an edited copy. The engine, the lifts it needs, the training-max rule,
 * family and author always come from the original; the copy must still use
 * every lift the engine needs. Nothing is written unless it all passes.
 */
export function saveCopy(id: number, raw: unknown): { ok: true } | { ok: false; errors: string[] } {
  const row = getCopy(id);
  if (!row) return { ok: false, errors: ["That version no longer exists."] };
  const original = platformProgram(row.basedOn);
  if (!original) return { ok: false, errors: ["The program it was based on is no longer in the library."] };
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return parsed;
  const t: ProgramTemplate = {
    ...parsed.template,
    key: copyKey(id),
    engine: original.engine,
    lifts: original.lifts,
    tmPct: original.tmPct,
    family: original.family,
    author: original.author,
  };
  const missing = copyErrors(original, t);
  if (missing.length) return { ok: false, errors: missing };
  const errors = templateErrors(t);
  if (errors.length) return { ok: false, errors };
  db.update(programTemplates).set({ name: t.name, templateJson: JSON.stringify(t), updatedAt: Date.now() }).where(eq(programTemplates.id, id)).run();
  return { ok: true };
}

export function deleteCopy(id: number): boolean {
  return db.delete(programTemplates).where(eq(programTemplates.id, id)).run().changes > 0;
}

export interface LibraryEntry {
  template: ProgramTemplate;
  /** For a gym copy: the platform program it is based on. */
  basedOnName: string | null;
  copyId: number | null;
  hidden: boolean;
}

/** A program by its key: a platform key, or "copy-<id>". Hidden platform programs only with includeHidden. */
export function programByKey(key: string, opts: { includeHidden?: boolean } = {}): LibraryEntry | null {
  const copyId = parseCopyKey(key);
  if (copyId) {
    const c = getCopy(copyId);
    return c ? { template: c.template, basedOnName: c.basedOnName, copyId: c.id, hidden: false } : null;
  }
  const t = platformProgram(key);
  if (!t) return null;
  const hidden = hiddenKeys().has(key);
  if (hidden && !opts.includeHidden) return null;
  return { template: t, basedOnName: null, copyId: null, hidden };
}

/** What a member can browse: the gym's copies, then the platform programs it has not hidden. */
export function memberPrograms(): LibraryEntry[] {
  const hidden = hiddenKeys();
  return [
    ...listCopies().map((c) => ({ template: c.template, basedOnName: c.basedOnName, copyId: c.id, hidden: false })),
    ...PLATFORM_PROGRAMS.filter((t) => !hidden.has(t.key)).map((t) => ({ template: t, basedOnName: null, copyId: null, hidden: false })),
  ];
}
```

- [ ] **Step 7: Run the library test**

Run: `cd app && npm test -- src/lib/programs/library.test.ts`
Expected: PASS, prints `programs/library: ok`.

- [ ] **Step 8: Run the existing tenant DB tests to prove the migration is additive**

Run: `cd app && npm test -- src/lib/db/tenant.test.ts && npm test -- src/lib/db/agentsTable.test.ts && npm test -- src/lib/db/migrations/index.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/db/tenant.ts app/src/lib/db/schema.ts app/src/lib/programs/library.ts app/src/lib/programs/library.test.ts
git commit -m "feat(programs): tenant tables for copies, hides and enrolments; library store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Program sessions in the workout log, and the enrolment store

**Files:**
- Modify: `app/src/lib/workoutLogModel.ts` (optional `targetKg`/`rpe` on `LoggedSet`, `plan` on `SessionExercise`, `enrolmentId` on `SessionView`)
- Modify: `app/src/lib/workoutLog.ts` (`startPlannedSession`, free-session matcher, `assemble`, `saveSessionSets`)
- Create: `app/src/lib/programs/enrolments.ts`
- Test: `app/src/lib/programs/enrolments.test.ts`

**Interfaces:**
- Consumes: Task 7 schema (`programEnrolments`, `programEnrolmentEvents`, `clients.trainingMode/weightUnit/plateStepKg`, `workoutSessions.enrolmentId`, `workoutSessionExercises.rxJson`, `workoutSetLogs.targetWeightKg/rpe`) and `library.ts` (`programByKey`); Tasks 1-2 (`initState`, `progress`, `skipState`, `planSession`, `dayAt`, `positionOf`, `stateKey`, `weekNumber`, `repsLabel`, `matchLibraryId`, `namesFor`, `maxFromSet`, `trainingMax`, `formatWeight`, `MAX_SET_REPS`); existing `listExercises()` (`@/lib/exerciseLibrary`), `exerciseHistory`, `getSession`, `listSessions` (`@/lib/workoutLog`), `planWeek`, `dateKey`, `mondayOf`, `parseWeekdays` (`@/lib/trainingProgress`).
- Produces:
  - `workoutLogModel.ts`: `LoggedSet { weightKg; reps; done; targetKg?: number | null; rpe?: number | null }`, `SessionExercise.plan?: PlannedExercise | null`, `SessionView.enrolmentId?: number | null`.
  - `workoutLog.ts`: `interface PlannedSessionInput { enrolmentId: number; position: number; programTitle: string; dayName: string; exercises: { exerciseId: number | null; name: string; plan: PlannedExercise }[] }`; `startPlannedSession(clientId, input): StartResult` (resumes an open session for the same enrolment and position). `saveSessionSets` keeps each set's `target_weight_kg` and saves `rpe`. `startFreeSession` never resumes a program session.
  - `enrolments.ts`: `Actor`, `StaffActor`, `EnrolmentStatus`, `EnrolmentView { id; clientId; status; programKey; copyId; template; state; startDate; weekdays; unit; stepKg; createdAt; endedAt }`, `EnrolmentEvent { id; at; actor; actorName; kind; reason; sessionId }`, `liveEnrolment(clientId)`, `getEnrolmentFor(clientId, enrolmentId)`, `listEnrolments(clientId)`, `enrolmentEvents(enrolmentId, limit?)`, `EnrolInput { key; maxesKg; unit; stepKg; startDate; weekdays }`, `enrol(clientId, input)`, `planFor(view): PlannedSession | null`, `sessionTitle(view, plan): string`, `startEnrolmentSession(clientId): StartResult`, `finishEnrolmentSession(clientId, sessionId): { reasons: string[]; finished: boolean } | null`, `skipEnrolmentSession(clientId)`, `endEnrolment(clientId, actor): boolean`, `setTrainingMode(clientId, mode: "coach" | "diy", actor): boolean`, `setEnrolmentDays(clientId, weekdays): boolean`, `restartFromTest(clientId, maxesKg)`, `coachSetMax(clientId, enrolmentId, lift, kg, actor: StaffActor)`, `coachMoveToWeek(clientId, enrolmentId, weekIndex, actor: StaffActor)`, `bestLoggedSet(clientId, lift, now?): { kg; reps; e1rm; at } | null`, `programWeek(view, now?): PlanDay[]`. Result-returning functions use `{ ok: true } | { ok: false; error: string }`.
  - Event kinds: `start`, `progress`, `skip`, `pause`, `resume`, `end`, `restart`, `max`, `week`, `note`. Actor column: `engine`, `member` or `staff:<userId>` (with `actor_name`).

- [ ] **Step 1: Extend the workout log model**

In `app/src/lib/workoutLogModel.ts`, add at the top, below the first comment line:

```ts
import type { PlannedExercise } from "@/lib/programs/types";
```

Replace the `LoggedSet` interface with:

```ts
export interface LoggedSet {
  weightKg: number | null;
  reps: number | null;
  done: boolean;
  /** A program session: the weight the program planned for this set. */
  targetKg?: number | null;
  /** How hard the set felt, 1 to 10, if the member said. */
  rpe?: number | null;
}
```

In `SessionExercise`, add after `joined?: boolean;`:

```ts
  /** A program session: the planned sets this exercise was started with. */
  plan?: PlannedExercise | null;
```

In `SessionView`, add after `programId: number | null;`:

```ts
  /** The DIY program enrolment this session belongs to. */
  enrolmentId?: number | null;
```

- [ ] **Step 2: Update `workoutLog.ts`**

(a) Imports: below the existing `import { DEFAULT_REST_SECONDS, ... } from "@/lib/workoutLogModel";` line add:

```ts
import { repsLabel } from "@/lib/programs/planner";
import type { PlannedExercise } from "@/lib/programs/types";
```

(b) In `startFreeSession`, replace

```ts
  const blocked = clearOpenSessions(clientId, (s) => s.programId === null);
```

with

```ts
  // A program session also has no programId; never resume one as an own workout.
  const blocked = clearOpenSessions(clientId, (s) => s.programId === null && s.enrolmentId === null);
```

(c) Directly after the `startFreeSession` function, add:

```ts
export interface PlannedSessionInput {
  enrolmentId: number;
  /** The session's position in the program (the day_position). */
  position: number;
  programTitle: string;
  dayName: string;
  exercises: { exerciseId: number | null; name: string; plan: PlannedExercise }[];
}

/**
 * Start (or resume) a DIY program session. Every set carries the weight the
 * program planned (target_weight_kg); each exercise keeps its planned sets
 * (rx_json) so finishing it can run the program's progression.
 */
export function startPlannedSession(clientId: number, input: PlannedSessionInput): StartResult {
  if (input.exercises.length === 0) return { ok: false, error: "This session has no exercises." };
  const blocked = clearOpenSessions(clientId, (s) => s.enrolmentId === input.enrolmentId && s.dayPosition === input.position);
  if (blocked) return blocked;
  return db.transaction((tx) => {
    const now = Date.now();
    const [row] = tx
      .insert(workoutSessions)
      .values({ clientId, programId: null, enrolmentId: input.enrolmentId, dayPosition: input.position, programTitle: input.programTitle, dayName: input.dayName, startedAt: now, updatedAt: now })
      .returning({ id: workoutSessions.id })
      .all();
    input.exercises.forEach((ex, i) => {
      const sets = ex.plan.sets.slice(0, MAX_SETS);
      const first = sets[0];
      const [exRow] = tx
        .insert(workoutSessionExercises)
        .values({
          sessionId: row.id,
          position: i,
          section: "workout",
          exerciseKey: exerciseKey(ex.exerciseId, ex.name),
          name: ex.name.trim(),
          targetSets: Math.max(1, sets.length),
          targetReps: first ? repsLabel(first) : null,
          restSeconds: restFor(first?.rest),
          joined: ex.plan.joined,
          notes: ex.plan.notes,
          rxJson: JSON.stringify(ex.plan),
        })
        .returning({ id: workoutSessionExercises.id })
        .all();
      sets.forEach((s, k) => tx.insert(workoutSetLogs).values({ sessionExerciseId: exRow.id, setNumber: k + 1, done: false, targetWeightKg: s.kg }).run());
    });
    return { ok: true as const, sessionId: row.id };
  });
}

/** The planned sets a program session was started with, or null. */
function parsePlan(raw: string | null): PlannedExercise | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PlannedExercise;
    return Array.isArray(p?.sets) ? p : null;
  } catch {
    return null;
  }
}
```

(d) In `assemble`, replace

```ts
  for (const s of setRows) {
    const list = setsBy.get(s.sessionExerciseId) ?? [];
    list.push({ weightKg: s.weightKg, reps: s.reps, done: s.done });
    setsBy.set(s.sessionExerciseId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    programId: r.programId,
```

with

```ts
  for (const s of setRows) {
    const list = setsBy.get(s.sessionExerciseId) ?? [];
    list.push({ weightKg: s.weightKg, reps: s.reps, done: s.done, targetKg: s.targetWeightKg, rpe: s.rpe });
    setsBy.set(s.sessionExerciseId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    programId: r.programId,
    enrolmentId: r.enrolmentId,
```

and replace

```ts
          notes: e.notes,
          joined: e.joined,
          sets: setsBy.get(e.id) ?? [],
```

with

```ts
          notes: e.notes,
          joined: e.joined,
          plan: parsePlan(e.rxJson),
          sets: setsBy.get(e.id) ?? [],
```

(e) In `saveSessionSets`, replace

```ts
  db.transaction((tx) => {
    for (const ex of exercises) {
      if (!owned.has(ex.id)) continue;
      tx.delete(workoutSetLogs).where(eq(workoutSetLogs.sessionExerciseId, ex.id)).run();
      ex.sets.slice(0, MAX_SETS).forEach((s, i) => {
        tx.insert(workoutSetLogs).values({ sessionExerciseId: ex.id, setNumber: i + 1, weightKg: s.weightKg, reps: s.reps, done: s.done }).run();
      });
    }
```

with

```ts
  // A program session's planned weight lives on the set row and the app never
  // sends it back, so carry it across the delete-and-insert by set number.
  const targets = new Map<string, number | null>();
  if (owned.size > 0) {
    const rows = db
      .select({ ex: workoutSetLogs.sessionExerciseId, n: workoutSetLogs.setNumber, t: workoutSetLogs.targetWeightKg })
      .from(workoutSetLogs)
      .where(inArray(workoutSetLogs.sessionExerciseId, [...owned]))
      .all();
    for (const r of rows) targets.set(`${r.ex}:${r.n}`, r.t);
  }
  db.transaction((tx) => {
    for (const ex of exercises) {
      if (!owned.has(ex.id)) continue;
      tx.delete(workoutSetLogs).where(eq(workoutSetLogs.sessionExerciseId, ex.id)).run();
      ex.sets.slice(0, MAX_SETS).forEach((s, i) => {
        tx.insert(workoutSetLogs)
          .values({
            sessionExerciseId: ex.id,
            setNumber: i + 1,
            weightKg: s.weightKg,
            reps: s.reps,
            done: s.done,
            targetWeightKg: targets.get(`${ex.id}:${i + 1}`) ?? null,
            rpe: s.rpe ?? null,
          })
          .run();
      });
    }
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no errors. (`LoggedSet` and `SessionView` only gained optional fields, so existing callers are unchanged.)

- [ ] **Step 4: Write the failing enrolments test**

```ts
// app/src/lib/programs/enrolments.test.ts
// Run: npm test -- src/lib/programs/enrolments.test.ts
//
// A member runs StrongLifts end to end against a scratch tenant: enrol, start
// a session from the plan, log it (planned weights survive saves), finish it
// (the engine runs once), skip, pause and resume with the training mode, coach
// changes logged with the actor, best logged set, end and start again.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/enrolments.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { db } = requireLocal("../db") as typeof import("../db");
  const { clients } = requireLocal("../db/schema") as typeof import("../db/schema");
  const log = requireLocal("../workoutLog") as typeof import("../workoutLog");
  const en = requireLocal("./enrolments") as typeof import("./enrolments");

  const slug = "programs-enrolments-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Enrolments Test", dbFile) as {
      id: number;
    }
  ).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const staff = { kind: "staff" as const, userId: 1, name: "Coach Ann" };
  const maxes = { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 };
  const input = { key: "stronglifts-5x5", maxesKg: maxes, unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 3, 5] };

  try {
    runWithTenant(tid, () => {
      const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Lifter", phone: "0" }).returning({ id: clients.id }).all();
      const clientId = c.id;
      assert.equal(db.select().from(clients).all()[0].trainingMode, "coach", "members start coach guided");

      // ── enrol ──
      const missing = en.enrol(clientId, { ...input, maxesKg: { ...maxes, row: 0 } });
      assert.deepEqual(missing, { ok: false, error: "Add your barbell row max." });
      const e = en.enrol(clientId, input);
      assert.ok(e.ok);
      assert.deepEqual(en.enrol(clientId, input), { ok: false, error: "End your current program before you start another." });
      const view = en.liveEnrolment(clientId)!;
      assert.equal(view.status, "active");
      assert.equal(view.state.weights["back squat"], 50);
      assert.deepEqual(view.weekdays, [1, 3, 5]);
      assert.equal(view.template.key, "stronglifts-5x5");
      const plan = en.planFor(view)!;
      assert.equal(plan.dayName, "Workout A");
      assert.equal(en.sessionTitle(view, plan), "Workout A, week 1");

      // ── start a session from the plan; starting again resumes it ──
      const s = en.startEnrolmentSession(clientId);
      assert.ok(s.ok);
      const again = en.startEnrolmentSession(clientId);
      assert.ok(again.ok && again.sessionId === s.sessionId);
      const session = log.getSession(clientId, s.sessionId)!;
      assert.equal(session.enrolmentId, view.id);
      assert.equal(session.programId, null);
      assert.equal(session.dayName, "Workout A, week 1");
      assert.equal(session.exercises[0].plan?.sets[0].kg, 50);
      assert.equal(session.exercises[0].sets[0].targetKg, 50);
      assert.equal(session.exercises[0].targetReps, "5");

      // ── log every set as planned: planned weights survive the save, RPE is kept ──
      log.saveSessionSets(
        clientId,
        session.id,
        session.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p) => ({ weightKg: p.kg, reps: p.reps, done: true, rpe: 8 })) })),
      );
      const saved = log.getSession(clientId, session.id)!;
      assert.equal(saved.exercises[0].sets[0].targetKg, 50);
      assert.equal(saved.exercises[0].sets[0].rpe, 8);

      // ── finish: the engine runs once ──
      assert.equal(log.finishSession(clientId, session.id), true);
      const out = en.finishEnrolmentSession(clientId, session.id)!;
      assert.ok(out.reasons.includes("Next back squat 52.5 kg. You did all 5 sets of 5."));
      assert.equal(out.finished, false);
      const after = en.liveEnrolment(clientId)!;
      assert.equal(after.state.day, 1);
      assert.equal(after.state.weights["back squat"], 52.5);
      const dup = en.finishEnrolmentSession(clientId, session.id)!;
      assert.deepEqual(dup.reasons, ["This wasn't your current session, so your program did not move on."]);
      assert.equal(en.liveEnrolment(clientId)!.state.day, 1, "a second finish does not move the program again");

      // ── skip ──
      assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
      assert.equal(en.liveEnrolment(clientId)!.state.day, 2);

      // ── switching to coach guided pauses; back to DIY resumes ──
      assert.equal(en.setTrainingMode(clientId, "coach", staff), true);
      assert.equal(en.liveEnrolment(clientId)!.status, "paused");
      assert.deepEqual(en.startEnrolmentSession(clientId), { ok: false, error: "Your program is paused while you're coach guided." });
      assert.equal(en.setTrainingMode(clientId, "diy", staff), true);
      assert.equal(en.liveEnrolment(clientId)!.status, "active");
      assert.equal(db.select().from(clients).all()[0].trainingMode, "diy");

      // ── coach changes, logged with who made them ──
      assert.deepEqual(en.coachSetMax(clientId, view.id, "squat", 140, staff), { ok: true });
      const cm = en.liveEnrolment(clientId)!;
      assert.equal(cm.state.maxes.squat, 140);
      assert.equal(cm.state.weights["back squat"], 70);
      assert.deepEqual(en.coachSetMax(clientId, view.id, "squat", 0, staff), { ok: false, error: "Enter a max between 1 and 600 kg." });
      assert.deepEqual(en.coachSetMax(clientId + 999, view.id, "squat", 140, staff), { ok: false, error: "That program has ended." });
      assert.deepEqual(en.coachMoveToWeek(clientId, view.id, 1, staff), { ok: true });
      assert.deepEqual([en.liveEnrolment(clientId)!.state.week, en.liveEnrolment(clientId)!.state.day], [1, 0]);
      assert.deepEqual(en.coachMoveToWeek(clientId, view.id, 9, staff), { ok: false, error: "That week isn't in the program." });

      const events = en.enrolmentEvents(view.id);
      const kinds = events.map((x) => x.kind);
      for (const k of ["start", "progress", "note", "skip", "pause", "resume", "max", "week"]) assert.ok(kinds.includes(k), `logged a ${k} event`);
      const maxEvent = events.find((x) => x.kind === "max")!;
      assert.equal(maxEvent.actor, "staff:1");
      assert.equal(maxEvent.actorName, "Coach Ann");
      assert.equal(maxEvent.reason, "Coach Ann set the squat max to 140 kg, training max 140 kg. Its working weights start again from there.");
      assert.equal(events.find((x) => x.kind === "progress")!.actor, "engine");

      // ── best logged set of a lift (for prefilling a max) ──
      const best = en.bestLoggedSet(clientId, "squat")!;
      assert.equal(best.kg, 50);
      assert.equal(best.reps, 5);
      assert.equal(en.bestLoggedSet(clientId, "squat", Date.now() + 91 * 86400000), null, "only the last 90 days count");

      // ── this week's plan on the member's training days ──
      assert.equal(en.programWeek(en.liveEnrolment(clientId)!).length, 7);
      assert.equal(en.setEnrolmentDays(clientId, [2, 4, 6]), true);
      assert.deepEqual(en.liveEnrolment(clientId)!.weekdays, [2, 4, 6]);

      // ── an own workout never resumes a program session ──
      const ps = en.startEnrolmentSession(clientId);
      assert.ok(ps.ok);
      const free = log.startFreeSession(clientId);
      assert.ok(free.ok && free.sessionId !== ps.sessionId);
      log.deleteSession(clientId, free.ok ? free.sessionId : 0);

      // ── end keeps the history; a new program can start ──
      assert.equal(en.endEnrolment(clientId, { kind: "member" }), true);
      assert.equal(en.liveEnrolment(clientId), null);
      assert.equal(en.listEnrolments(clientId)[0].status, "ended");
      assert.ok(en.enrolmentEvents(view.id).some((x) => x.kind === "end"));
      assert.ok(en.enrol(clientId, input).ok);
    });
    console.log("programs/enrolments: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/enrolments.test.ts`
Expected: FAIL with `Cannot find module './enrolments'`.

- [ ] **Step 6: Write `enrolments.ts`**

```ts
// app/src/lib/programs/enrolments.ts
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, programEnrolmentEvents, programEnrolments, workoutSessionExercises, workoutSessions, workoutSetLogs } from "@/lib/db/schema";
import { listExercises } from "@/lib/exerciseLibrary";
import { dateKey, mondayOf, parseWeekdays, planWeek, type PlanDay } from "@/lib/trainingProgress";
import { exerciseHistory, getSession, listSessions, startPlannedSession, type StartResult } from "@/lib/workoutLog";
import { exerciseKey } from "@/lib/workoutLogModel";
import { initState, progress, skipState } from "./engines";
import { matchLibraryId, namesFor } from "./exercises";
import { programByKey } from "./library";
import { dayAt, planSession, positionOf, stateKey, weekNumber } from "./planner";
import { LIFT_EXERCISE, LIFT_LABEL, emptyState, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type SessionResult, type WeightUnit } from "./types";
import { MAX_SET_REPS, formatWeight, maxFromSet, trainingMax } from "./units";

/**
 * A member running a library program, for the CURRENT tenant (ambient `db`).
 * Member functions take the member's clientId and only ever touch that
 * member's enrolment. Coach functions also take the enrolment id and check it
 * belongs to the client. Every change is written to program_enrolment_events
 * with who made it and why.
 */

export type Actor = { kind: "engine" } | { kind: "member" } | { kind: "staff"; userId: number; name: string };
export type StaffActor = Extract<Actor, { kind: "staff" }>;
export type EnrolmentStatus = "active" | "paused" | "ended";

export interface EnrolmentView {
  id: number;
  clientId: number;
  status: EnrolmentStatus;
  programKey: string | null;
  copyId: number | null;
  /** The snapshot taken at the start: later edits to a gym copy never change it. */
  template: ProgramTemplate;
  state: EngineState;
  startDate: string;
  weekdays: number[];
  unit: WeightUnit;
  stepKg: number;
  createdAt: number;
  endedAt: number | null;
}

export interface EnrolmentEvent {
  id: number;
  at: number;
  actor: string;
  actorName: string | null;
  kind: string;
  reason: string;
  sessionId: number | null;
}

type Row = typeof programEnrolments.$inferSelect;
type Result = { ok: true } | { ok: false; error: string };

const MAX_KG = 600;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function unitsFor(clientId: number): { unit: WeightUnit; stepKg: number } {
  const c = db.select({ unit: clients.weightUnit, step: clients.plateStepKg }).from(clients).where(eq(clients.id, clientId)).get();
  return { unit: c?.unit === "lb" ? "lb" : "kg", stepKg: c && c.step > 0 ? c.step : 2.5 };
}

function toView(row: Row): EnrolmentView | null {
  const template = parseJson<ProgramTemplate | null>(row.templateJson, null);
  if (!template) return null;
  const rest = parseJson<Partial<EngineState>>(row.stateJson, {});
  const state: EngineState = {
    ...emptyState(),
    ...rest,
    week: row.week,
    day: row.day,
    maxes: parseJson(row.maxesJson, {}),
    tms: parseJson(row.tmsJson, {}),
  };
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status,
    programKey: row.programKey,
    copyId: row.copyId,
    template,
    state,
    startDate: row.startDate,
    weekdays: parseWeekdays(row.weekdays),
    ...unitsFor(row.clientId),
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  };
}

function stateColumns(state: EngineState) {
  const { week, day, maxes, tms, ...rest } = state;
  return { week, day, maxesJson: JSON.stringify(maxes), tmsJson: JSON.stringify(tms), stateJson: JSON.stringify(rest), updatedAt: Date.now() };
}

function saveState(id: number, state: EngineState): void {
  db.update(programEnrolments).set(stateColumns(state)).where(eq(programEnrolments.id, id)).run();
}

function snapshot(s: EngineState) {
  return { week: s.week, day: s.day, cycle: s.cycle, maxes: s.maxes, tms: s.tms, weights: s.weights };
}

function logEvent(enrolmentId: number, actor: Actor, kind: string, reason: string, before: EngineState | null, after: EngineState | null, sessionId: number | null = null): void {
  db.insert(programEnrolmentEvents)
    .values({
      enrolmentId,
      at: Date.now(),
      actor: actor.kind === "staff" ? `staff:${actor.userId}` : actor.kind,
      actorName: actor.kind === "staff" ? actor.name : null,
      kind,
      reason,
      beforeJson: before ? JSON.stringify(snapshot(before)) : null,
      afterJson: after ? JSON.stringify(snapshot(after)) : null,
      sessionId,
    })
    .run();
}

function tmLine(t: ProgramTemplate, s: EngineState, unit: WeightUnit): string {
  const parts = t.lifts.filter((l) => s.tms[l] !== undefined).map((l) => `${LIFT_LABEL[l]} ${formatWeight(s.tms[l]!, unit)}`);
  return parts.length ? ` Training maxes: ${parts.join(", ")}.` : "";
}

function libraryIndex(): { id: number; name: string }[] {
  return listExercises().map((e) => ({ id: e.id, name: e.name }));
}

function maxesProblem(t: ProgramTemplate, maxesKg: Partial<Record<LiftKey, number>>): string | null {
  for (const lift of t.lifts) {
    const m = maxesKg[lift];
    if (!m || !Number.isFinite(m) || m <= 0 || m > MAX_KG) return `Add your ${LIFT_LABEL[lift].toLowerCase()} max.`;
  }
  return null;
}

/** The member's active or paused program, if any. */
export function liveEnrolment(clientId: number): EnrolmentView | null {
  const row = db
    .select()
    .from(programEnrolments)
    .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"])))
    .orderBy(desc(programEnrolments.id))
    .get();
  return row ? toView(row) : null;
}

export function getEnrolmentFor(clientId: number, enrolmentId: number): EnrolmentView | null {
  const row = db.select().from(programEnrolments).where(and(eq(programEnrolments.id, enrolmentId), eq(programEnrolments.clientId, clientId))).get();
  return row ? toView(row) : null;
}

/** Every program the member has run, newest first. */
export function listEnrolments(clientId: number): EnrolmentView[] {
  return db
    .select()
    .from(programEnrolments)
    .where(eq(programEnrolments.clientId, clientId))
    .orderBy(desc(programEnrolments.id))
    .all()
    .map(toView)
    .filter((v): v is EnrolmentView => v !== null);
}

/** The change log, newest first. */
export function enrolmentEvents(enrolmentId: number, limit = 50): EnrolmentEvent[] {
  return db
    .select()
    .from(programEnrolmentEvents)
    .where(eq(programEnrolmentEvents.enrolmentId, enrolmentId))
    .orderBy(desc(programEnrolmentEvents.id))
    .limit(limit)
    .all()
    .map((e) => ({ id: e.id, at: e.at, actor: e.actor, actorName: e.actorName, kind: e.kind, reason: e.reason, sessionId: e.sessionId }));
}

export interface EnrolInput {
  key: string;
  maxesKg: Partial<Record<LiftKey, number>>;
  unit: WeightUnit;
  stepKg: number;
  startDate: string;
  weekdays: number[];
}

/** Start a program. One at a time: a live one must be ended first. */
export function enrol(clientId: number, input: EnrolInput): { ok: true; id: number } | { ok: false; error: string } {
  const busy = { ok: false as const, error: "End your current program before you start another." };
  if (liveEnrolment(clientId)) return busy;
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  const t = entry.template;
  const problem = maxesProblem(t, input.maxesKg);
  if (problem) return { ok: false, error: problem };
  const state = initState(t, input.maxesKg, input.stepKg);
  const now = Date.now();
  let id: number;
  try {
    id = db.transaction((tx) => {
      tx.update(clients).set({ weightUnit: input.unit, plateStepKg: input.stepKg }).where(eq(clients.id, clientId)).run();
      const [row] = tx
        .insert(programEnrolments)
        .values({
          clientId,
          programKey: entry.copyId ? null : t.key,
          copyId: entry.copyId,
          templateJson: JSON.stringify(t),
          ...stateColumns(state),
          status: "active",
          startDate: input.startDate,
          weekdays: parseWeekdays(input.weekdays.join(",")).join(","),
          createdAt: now,
        })
        .returning({ id: programEnrolments.id })
        .all();
      return row.id;
    });
  } catch (err) {
    // The partial unique index allows one live enrolment per member.
    if (String(err).includes("UNIQUE")) return busy;
    throw err;
  }
  logEvent(id, { kind: "member" }, "start", `Started ${t.name}.${tmLine(t, state, input.unit)}`, null, state);
  return { ok: true, id };
}

/** The next session with every weight worked out, or null when finished or ended. */
export function planFor(view: EnrolmentView): PlannedSession | null {
  if (view.status === "ended" || view.state.finished) return null;
  const d = dayAt(view.template, view.state.week, view.state.day);
  if (!d) return null;
  // RPE sets on an exercise with no max of its own take their weight from the member's logs.
  const lib = libraryIndex();
  const keys = d.exercises.map((ex) => exerciseKey(matchLibraryId(ex.name, lib), ex.name));
  const { best } = exerciseHistory(view.clientId, keys);
  const e1rm: Record<string, number> = {};
  d.exercises.forEach((ex, i) => {
    const b = best[keys[i]];
    if (b && !ex.lift) e1rm[stateKey(ex)] = b;
  });
  return planSession(view.template, view.state, { stepKg: view.stepKg, e1rm });
}

/** "Workout A, week 3". */
export function sessionTitle(view: EnrolmentView, plan: PlannedSession): string {
  return `${plan.dayName}, week ${weekNumber(view.template, view.state)}`;
}

/** Start (or resume) the member's next program session in the logger. */
export function startEnrolmentSession(clientId: number): StartResult {
  const view = liveEnrolment(clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  if (view.status === "paused") return { ok: false, error: "Your program is paused while you're coach guided." };
  const plan = planFor(view);
  if (!plan) return { ok: false, error: "Your program is finished. Enter your new max to run it again." };
  const lib = libraryIndex();
  return startPlannedSession(clientId, {
    enrolmentId: view.id,
    position: plan.position,
    programTitle: view.template.name,
    dayName: sessionTitle(view, plan),
    exercises: plan.exercises.map((ex) => ({ exerciseId: matchLibraryId(ex.name, lib), name: ex.name, plan: ex })),
  });
}

/**
 * After a program session is finished: run the engine on what the member
 * actually lifted and move the program on. Only the member's current session
 * moves it, so re-saving an old one changes nothing.
 */
export function finishEnrolmentSession(clientId: number, sessionId: number): { reasons: string[]; finished: boolean } | null {
  const session = getSession(clientId, sessionId);
  if (!session?.enrolmentId) return null;
  const view = liveEnrolment(clientId);
  if (!view || view.id !== session.enrolmentId) return null;
  if (view.status !== "active") return { reasons: ["Your program is paused, so it did not move on."], finished: false };
  if (view.state.finished || positionOf(view.template, view.state.week, view.state.day) !== session.dayPosition) {
    const reason = "This wasn't your current session, so your program did not move on.";
    logEvent(view.id, { kind: "member" }, "note", reason, null, null, session.id);
    return { reasons: [reason], finished: view.state.finished };
  }
  const result: SessionResult = {
    exercises: session.exercises
      .filter((e) => e.plan)
      .map((e) => ({ planned: e.plan!, sets: e.sets.map((s) => ({ kg: s.weightKg, reps: s.reps, done: s.done })) })),
  };
  const out = progress({ template: view.template, state: view.state, result, stepKg: view.stepKg, unit: view.unit });
  saveState(view.id, out.state);
  logEvent(view.id, { kind: "engine" }, "progress", out.reasons.join("\n") || "Session done. Nothing changes until the next one.", view.state, out.state, session.id);
  return { reasons: out.reasons, finished: out.state.finished };
}

/** Move past the next session without doing it. Recorded. */
export function skipEnrolmentSession(clientId: number): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active" || view.state.finished) return { ok: false, error: "There's no session to skip." };
  const d = dayAt(view.template, view.state.week, view.state.day);
  const next = skipState(view.template, view.state);
  saveState(view.id, next);
  logEvent(view.id, { kind: "member" }, "skip", `Skipped ${d ? `${d.name}, week ${weekNumber(view.template, view.state)}` : "a session"}.`, view.state, next);
  return { ok: true };
}

/** End the live program. Its sessions and change log are kept. */
export function endEnrolment(clientId: number, actor: Actor): boolean {
  const view = liveEnrolment(clientId);
  if (!view) return false;
  const now = Date.now();
  db.update(programEnrolments).set({ status: "ended", endedAt: now, updatedAt: now }).where(eq(programEnrolments.id, view.id)).run();
  logEvent(view.id, actor, "end", "Program ended. Its history is kept.", view.state, null);
  return true;
}

/**
 * Coach guided or DIY. Nothing is deleted: switching to coach pauses an
 * active program, switching back to DIY resumes a paused one.
 */
export function setTrainingMode(clientId: number, mode: "coach" | "diy", actor: Actor): boolean {
  const r = db.update(clients).set({ trainingMode: mode }).where(eq(clients.id, clientId)).run();
  if (r.changes === 0) return false;
  const view = liveEnrolment(clientId);
  if (view && mode === "coach" && view.status === "active") {
    db.update(programEnrolments).set({ status: "paused", updatedAt: Date.now() }).where(eq(programEnrolments.id, view.id)).run();
    logEvent(view.id, actor, "pause", "Paused: switched to coach guided.", null, null);
  }
  if (view && mode === "diy" && view.status === "paused") {
    db.update(programEnrolments).set({ status: "active", updatedAt: Date.now() }).where(eq(programEnrolments.id, view.id)).run();
    logEvent(view.id, actor, "resume", "Resumed: switched back to DIY.", null, null);
  }
  return true;
}

/** The member's training weekdays for their program (1 = Monday). */
export function setEnrolmentDays(clientId: number, weekdays: number[]): boolean {
  const view = liveEnrolment(clientId);
  if (!view) return false;
  db.update(programEnrolments)
    .set({ weekdays: parseWeekdays(weekdays.join(",")).join(","), updatedAt: Date.now() })
    .where(eq(programEnrolments.id, view.id))
    .run();
  return true;
}

/** A finished block starts again from the member's new maxes. */
export function restartFromTest(clientId: number, maxesKg: Partial<Record<LiftKey, number>>): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active" || !view.state.finished) return { ok: false, error: "Your program isn't at its end yet." };
  const problem = maxesProblem(view.template, maxesKg);
  if (problem) return { ok: false, error: problem };
  const fresh = initState(view.template, maxesKg, view.stepKg);
  fresh.cycle = view.state.cycle + 1;
  saveState(view.id, fresh);
  logEvent(view.id, { kind: "member" }, "restart", `Started ${view.template.name} again.${tmLine(view.template, fresh, view.unit)}`, view.state, fresh);
  return { ok: true };
}

/** A coach corrects a member's max. Working weights that came from it start again from the new one. */
export function coachSetMax(clientId: number, enrolmentId: number, lift: LiftKey, kg: number, actor: StaffActor): Result {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  if (!view.template.lifts.includes(lift)) return { ok: false, error: "This program doesn't use that lift." };
  if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_KG) return { ok: false, error: "Enter a max between 1 and 600 kg." };
  const next = clone(view.state);
  next.maxes[lift] = round2(kg);
  next.tms[lift] = trainingMax(kg, view.template.tmPct);
  const fresh = initState(view.template, { [lift]: kg }, view.stepKg);
  for (const [k, w] of Object.entries(fresh.weights)) next.weights[k] = w;
  for (const [k, w] of Object.entries(fresh.t2Base)) next.t2Base[k] = w;
  saveState(view.id, next);
  const fmt = (n: number) => formatWeight(n, view.unit);
  const reset = Object.keys(fresh.weights).length ? " Its working weights start again from there." : "";
  logEvent(view.id, actor, "max", `${actor.name} set the ${LIFT_LABEL[lift].toLowerCase()} max to ${fmt(next.maxes[lift]!)}, training max ${fmt(next.tms[lift]!)}.${reset}`, view.state, next);
  return { ok: true };
}

/** A coach moves a member to the start of another week of their program (0-based week). */
export function coachMoveToWeek(clientId: number, enrolmentId: number, weekIndex: number, actor: StaffActor): Result {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex >= view.template.weeks.length) return { ok: false, error: "That week isn't in the program." };
  const next = clone(view.state);
  next.week = weekIndex;
  next.day = 0;
  next.finished = false;
  saveState(view.id, next);
  logEvent(view.id, actor, "week", `${actor.name} moved the program to week ${weekIndex + 1}.`, view.state, next);
  return { ok: true };
}

/** The member's best logged set of a lift in the last 90 days, 1 to 10 reps, by estimated max. */
export function bestLoggedSet(clientId: number, lift: LiftKey, now = Date.now()): { kg: number; reps: number; e1rm: number; at: number } | null {
  const name = LIFT_EXERCISE[lift];
  const keys = new Set(namesFor(name).map((n) => exerciseKey(null, n)));
  const libId = matchLibraryId(name, libraryIndex());
  if (libId) keys.add(exerciseKey(libId, name));
  const rows = db
    .select({ id: workoutSessionExercises.id, at: workoutSessions.finishedAt })
    .from(workoutSessionExercises)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSessionExercises.sessionId))
    .where(
      and(
        eq(workoutSessions.clientId, clientId),
        isNotNull(workoutSessions.finishedAt),
        gte(workoutSessions.finishedAt, now - 90 * 86400000),
        inArray(workoutSessionExercises.exerciseKey, [...keys]),
      ),
    )
    .all();
  if (rows.length === 0) return null;
  const at = new Map(rows.map((r) => [r.id, r.at as number]));
  const sets = db.select().from(workoutSetLogs).where(inArray(workoutSetLogs.sessionExerciseId, rows.map((r) => r.id))).all();
  let best: { kg: number; reps: number; e1rm: number; at: number } | null = null;
  for (const s of sets) {
    if (!s.done || !s.weightKg || !s.reps || s.reps > MAX_SET_REPS) continue;
    const e1rm = maxFromSet(s.weightKg, s.reps);
    if (e1rm !== null && (!best || e1rm > best.e1rm)) best = { kg: s.weightKg, reps: s.reps, e1rm, at: at.get(s.sessionExerciseId) ?? now };
  }
  return best;
}

/** This week on the member's training days: done, missed, today and planned program sessions. */
export function programWeek(view: EnrolmentView, now = Date.now()): PlanDay[] {
  const names: string[] = [];
  view.template.weeks.forEach((w, wi) => w.days.forEach((d) => names.push(`${d.name}, week ${wi + 1}`)));
  const monday = mondayOf(dateKey(now));
  const logged = listSessions(view.clientId, 30)
    .filter((s) => s.enrolmentId === view.id && mondayOf(dateKey(s.finishedAt!)) === monday)
    .map((s) => ({ at: s.finishedAt!, title: s.dayName }));
  const pos = view.state.finished ? 0 : positionOf(view.template, view.state.week, view.state.day);
  return planWeek({ now, weekdays: view.weekdays, dayNames: names, nextDayPosition: pos, logged });
}
```

- [ ] **Step 7: Run the enrolments test**

Run: `cd app && npm test -- src/lib/programs/enrolments.test.ts`
Expected: PASS, prints `programs/enrolments: ok`.

- [ ] **Step 8: Run the existing workout log tests**

Run: `cd app && npm test -- src/lib/workoutLogModel.test.ts && npm test -- src/lib/trainingProgress.test.ts`
Expected: PASS. (If `src/lib/trainingProgress.test.ts` does not exist, run `ls src/lib/*.test.ts | grep -i -E "workout|training"` and run each match.)

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/workoutLogModel.ts app/src/lib/workoutLog.ts app/src/lib/programs/enrolments.ts app/src/lib/programs/enrolments.test.ts
git commit -m "feat(programs): program sessions in the workout log and the enrolment store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Programs module flag (default Nobody), training mode on the staff side, and member-app gating

**Files:**
- Modify: `app/src/lib/features.ts` (`ModuleDef.defaultRollout`, the `programs` catalog entry)
- Modify: `app/src/lib/platform/flags.ts` (an absent row uses the module's default rollout)
- Modify: `app/src/lib/platform/flags.test.ts`, `app/src/lib/features.test.ts`
- Create: `app/src/lib/programs/access.ts`
- Test: `app/src/lib/programs/access.test.ts`
- Create: `app/src/lib/programs/staffActor.ts`
- Create: `app/src/app/clients/[id]/programActions.ts`
- Create: `app/src/components/clients/TrainingModeSwitch.tsx`
- Modify: `app/src/app/clients/[id]/page.tsx` (the Coach guided / DIY chip)
- Modify: `app/src/components/clients/ClientForm.tsx`, `app/src/app/clients/new/page.tsx`, `app/src/app/clients/actions.ts` (training mode on the add-member form)
- Modify: `app/src/components/clientapp/ClientAppFrame.tsx`, `app/src/app/layout.tsx` (the Programs tab)
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: `setTrainingMode(clientId, mode, actor)` and `StaffActor` (Task 8); existing `getFeatureFlagsForTenant(tenantId)` (`@/lib/settings`, effective flags after rollout), `isModuleOn`, `applyRollout`, `listPlatformFlags`, `setPlatformFlag`, `requireUser()` (`@/lib/auth`), `getCurrentTenant()` (`@/lib/db/tenant`), `getCurrentClient()` / `requireClientPage()` / `CurrentClient` (`@/lib/clientAuth`).
- Produces:
  - `MODULE_CATALOG` entry `{ key: "programs", label: "Programs", paths: ["/workout/library"], defaultRollout: "none" }`; `ModuleDef.defaultRollout?: "all" | "none"`.
  - `access.ts`: `programsOn(tenantId: number): boolean` (fails closed), `memberSeesPrograms(c: Pick<CurrentClient, "tenantId" | "client"> | null): boolean` (DIY and module on), `requireProgramsPage(): CurrentClient` (redirects to `/app/workouts` otherwise).
  - `staffActor.ts`: `currentStaffActor(): Promise<StaffActor | null>` (the signed-in staff member as a change-log actor; null when Programs is off for the business). Later staff actions reuse it. It lives outside the `"use server"` file on purpose: every export of a `"use server"` file becomes a callable endpoint.
  - `programActions.ts`: `setTrainingModeAction(clientId: number, mode: string): Promise<{ ok: true } | { ok: false; error: string }>`.
  - `TrainingModeSwitch({ clientId: number; mode: "coach" | "diy" })`.
  - `ClientForm` prop `showTrainingMode?: boolean`; form field `trainingMode` (`coach` | `diy`).
  - `ClientAppFrame` prop `showPrograms?: boolean`; tab `{ href: "/app/programs", label: "Programs" }` between Workouts and Profile.

How the Nobody default is guaranteed: `listPlatformFlags()` treats a module with no `platform_flags` row as its catalog `defaultRollout` (Programs: `"none"`), instead of `"all"`. Nothing is written at boot, so there is no row to lose and nothing to clean up; the first time an owner saves the Programs rollout in the console, the saved row takes over. A business's own Features switch can still turn it off.

- [ ] **Step 1: Write the failing flag tests**

In `app/src/lib/platform/flags.test.ts`, replace

```ts
    assert.ok(fresh.every((f) => f.mode === "all" && f.percent === 100 && f.allow.length === 0), "default all");
```

with

```ts
    assert.ok(
      fresh.every((f) => f.mode === (MODULE_CATALOG.find((m) => m.key === f.key)!.defaultRollout ?? "all") && f.percent === 100 && f.allow.length === 0),
      "with no row: everyone, except a module that starts with nobody",
    );
    assert.equal(fresh.find((f) => f.key === "programs")!.mode, "none", "Programs starts with nobody");
    setPlatformFlag({ key: "programs", mode: "allow", percent: 100, allow: [42] });
    assert.deepEqual(listPlatformFlags().find((f) => f.key === "programs"), { key: "programs", mode: "allow", percent: 100, allow: [42] }, "a saved rollout wins");
```

In `app/src/lib/features.test.ts`, insert before the final `console.log(\`features: ${passed} checks passed.\`);` line:

```ts
// ── Programs: the library tab sits under /workout but is its own module ──
check("/workout/library is programs", moduleForPath("/workout/library")?.key === "programs");
check("/workout/library/smolov-base is programs", moduleForPath("/workout/library/smolov-base")?.key === "programs");
check("/workout/exercises is still workout", moduleForPath("/workout/exercises")?.key === "workout");
check("Programs starts with nobody", MODULE_CATALOG.find((m) => m.key === "programs")?.defaultRollout === "none");
check("a rollout of nobody switches Programs off", applyRollout({}, [{ key: "programs", mode: "none", percent: 0, allow: [] }], 5).programs === false);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd app && npm test -- src/lib/features.test.ts; npm test -- src/lib/platform/flags.test.ts`
Expected: both FAIL (no `programs` module).

- [ ] **Step 3: Add the module and its default rollout**

In `app/src/lib/features.ts`, add to `interface ModuleDef` after `paths: string[];`:

```ts
  /**
   * The platform rollout before an owner has set one in the console. Absent
   * means everyone. A module that is not ready for the fleet says "none".
   */
  defaultRollout?: "all" | "none";
```

and add this entry to `MODULE_CATALOG` directly after the `workout` entry:

```ts
  { key: "programs", label: "Programs", blurb: "The program library members run on their own, and DIY training mode.", paths: ["/workout/library"], defaultRollout: "none" },
```

In `app/src/lib/platform/flags.ts`, replace

```ts
    // Anything other than a known mode is treated as "all", so an odd row can never switch a module off.
    const mode: PlatformFlag["mode"] = r && MODES.has(r.mode as PlatformFlag["mode"]) ? (r.mode as PlatformFlag["mode"]) : "all";
```

with

```ts
    // No row yet: the module's default rollout (everyone, unless the catalog
    // says a new module starts with nobody). A row with an unknown mode is
    // treated as "all", so an odd row can never switch a module off.
    const mode: PlatformFlag["mode"] = !r
      ? (m.defaultRollout ?? "all")
      : MODES.has(r.mode as PlatformFlag["mode"])
        ? (r.mode as PlatformFlag["mode"])
        : "all";
```

- [ ] **Step 4: Run the flag tests**

Run: `cd app && npm test -- src/lib/features.test.ts && npm test -- src/lib/platform/flags.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing access test**

```ts
// app/src/lib/programs/access.test.ts
// Run: npm test -- src/lib/programs/access.test.ts
//
// The Programs tab shows only to DIY members of a business where the module
// is on: platform rollout (default nobody) and the business's own switch.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("redirect");
      },
    };
  }
  if (request === "next/headers") {
    return {
      cookies: () => {
        throw new Error("no request");
      },
      headers: () => new Map(),
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { setFeatureFlags } = requireLocal("../settings") as typeof import("../settings");
  const { setPlatformFlag } = requireLocal("../platform/flags") as typeof import("../platform/flags");
  const { memberSeesPrograms, programsOn } = requireLocal("./access") as typeof import("./access");

  const slug = "programs-access-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Access Test", dbFile) as { id: number }
  ).id;
  const saved = controlSqlite.prepare("SELECT key, mode, percent, allow, updated_at FROM platform_flags WHERE key = 'programs'").get() as
    | { key: string; mode: string; percent: number; allow: string; updated_at: number }
    | undefined;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'programs'").run();
    if (saved) controlSqlite.prepare("INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES (?,?,?,?,?)").run(saved.key, saved.mode, saved.percent, saved.allow, saved.updated_at);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  type Member = Parameters<typeof memberSeesPrograms>[0];
  const member = (mode: "coach" | "diy") => ({ tenantId: tid, client: { trainingMode: mode } }) as unknown as Member;

  try {
    controlSqlite.prepare("DELETE FROM platform_flags WHERE key = 'programs'").run();
    assert.equal(programsOn(tid), false, "nobody by default");
    assert.equal(memberSeesPrograms(member("diy")), false);

    setPlatformFlag({ key: "programs", mode: "allow", percent: 100, allow: [tid] });
    assert.equal(programsOn(tid), true, "a named business has it");
    assert.equal(memberSeesPrograms(member("diy")), true);
    assert.equal(memberSeesPrograms(member("coach")), false, "coach guided members never see the tab");
    assert.equal(memberSeesPrograms(null), false);

    runWithTenant(tid, () => setFeatureFlags({ programs: false }));
    assert.equal(programsOn(tid), false, "the business's own switch still wins");
    console.log("programs/access: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Write `access.ts`**

```ts
// app/src/lib/programs/access.ts
import "server-only";
import { redirect } from "next/navigation";

import { requireClientPage, type CurrentClient } from "@/lib/clientAuth";
import { isModuleOn } from "@/lib/features";
import { getFeatureFlagsForTenant } from "@/lib/settings";

/** The Programs module is on for this business: its own switch and the platform rollout. Fails closed. */
export function programsOn(tenantId: number): boolean {
  try {
    return isModuleOn(getFeatureFlagsForTenant(tenantId), "programs");
  } catch (err) {
    console.error("[programs] module flags unreadable:", err);
    return false;
  }
}

/** A member sees Programs only in DIY mode, and only where the module is on. */
export function memberSeesPrograms(c: Pick<CurrentClient, "tenantId" | "client"> | null): boolean {
  return !!c && c.client.trainingMode === "diy" && programsOn(c.tenantId);
}

/** Page guard for /app/programs: signed in, past the welcome steps, DIY, module on. */
export function requireProgramsPage(): CurrentClient {
  const c = requireClientPage();
  if (!memberSeesPrograms(c)) redirect("/app/workouts");
  return c;
}
```

- [ ] **Step 7: Run the access test**

Run: `cd app && npm test -- src/lib/programs/access.test.ts`
Expected: PASS, prints `programs/access: ok`.

- [ ] **Step 8: Staff action and switch**

```ts
// app/src/lib/programs/staffActor.ts
import "server-only";

import { requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { programsOn } from "./access";
import type { StaffActor } from "./enrolments";

/** The signed-in staff member as a change-log actor, or null when Programs is off for this business. */
export async function currentStaffActor(): Promise<StaffActor | null> {
  const user = await requireUser();
  if (!programsOn(getCurrentTenant().id)) return null;
  return { kind: "staff", userId: user.id, name: user.name?.trim() || user.email };
}
```

```ts
// app/src/app/clients/[id]/programActions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setTrainingMode } from "@/lib/programs/enrolments";
import { currentStaffActor } from "@/lib/programs/staffActor";

type Result = { ok: true } | { ok: false; error: string };

export async function setTrainingModeAction(clientId: number, mode: string): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false, error: "Programs aren't switched on for this business." };
  const id = z.number().int().positive().safeParse(clientId);
  const m = z.enum(["coach", "diy"]).safeParse(mode);
  if (!id.success || !m.success) return { ok: false, error: "That change doesn't make sense." };
  if (!setTrainingMode(id.data, m.data, actor)) return { ok: false, error: "Member not found." };
  revalidatePath(`/clients/${id.data}`);
  return { ok: true };
}
```

```tsx
// app/src/components/clients/TrainingModeSwitch.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setTrainingModeAction } from "@/app/clients/[id]/programActions";

/** Coach guided or DIY, on the client page. DIY adds the program library to the member's app. */
export function TrainingModeSwitch({ clientId, mode }: { clientId: number; mode: "coach" | "diy" }) {
  const router = useRouter();
  const [value, setValue] = useState(mode);
  const [pending, start] = useTransition();

  function pick(next: "coach" | "diy") {
    if (next === value) return;
    start(async () => {
      const r = await setTrainingModeAction(clientId, next);
      if (!r.ok) return void toast.error(r.error);
      setValue(next);
      toast.success(next === "diy" ? "Switched to DIY. Programs now show in their app." : "Switched to coach guided. Any DIY program is paused.");
      router.refresh();
    });
  }

  return (
    <span className="tm-switch" role="group" aria-label="Training mode">
      <button type="button" aria-pressed={value === "coach"} disabled={pending} onClick={() => pick("coach")}>
        Coach guided
      </button>
      <button type="button" aria-pressed={value === "diy"} disabled={pending} onClick={() => pick("diy")}>
        DIY
      </button>
    </span>
  );
}
```

- [ ] **Step 9: Show the switch on the client page**

In `app/src/app/clients/[id]/page.tsx`:
- add imports: `import { TrainingModeSwitch } from "@/components/clients/TrainingModeSwitch";` and `import { programsOn } from "@/lib/programs/access";`
- after the line `  const membership = getCurrentMembership();` add:

```ts
  const programsEnabled = membership ? programsOn(membership.tenant.id) : false;
```

- replace

```tsx
              {cancelNotice && <Badge tone="amber">Asked to cancel</Badge>}
```

with

```tsx
              {cancelNotice && <Badge tone="amber">Asked to cancel</Badge>}
              {programsEnabled && <TrainingModeSwitch clientId={id} mode={client.trainingMode} />}
```

- [ ] **Step 10: Training mode on the add-member form**

In `app/src/components/clients/ClientForm.tsx`, replace

```tsx
interface Props {
  client?: Client;
}

export function ClientForm({ client }: Props) {
```

with

```tsx
interface Props {
  client?: Client;
  /** The Programs module is on: offer coach guided or DIY when adding a member. */
  showTrainingMode?: boolean;
}

export function ClientForm({ client, showTrainingMode = false }: Props) {
```

and insert, immediately before

```tsx
      <Card>
        <CardLabel>Consent</CardLabel>
```

this block:

```tsx
      {!client && showTrainingMode && (
        <Card>
          <CardLabel>Training</CardLabel>
          <div className="tm-choice" role="radiogroup" aria-label="Training mode">
            <label>
              <input type="radio" name="trainingMode" value="coach" defaultChecked />
              <span>
                <b>Coach guided</b>
                The member follows the programs you assign.
              </span>
            </label>
            <label>
              <input type="radio" name="trainingMode" value="diy" />
              <span>
                <b>DIY</b>
                The member can also pick and run a program from the library on their own.
              </span>
            </label>
          </div>
        </Card>
      )}

```

In `app/src/app/clients/new/page.tsx`, add imports `import { getCurrentTenant } from "@/lib/db/tenant";` and `import { programsOn } from "@/lib/programs/access";`, and replace `<ClientForm />` with `<ClientForm showTrainingMode={programsOn(getCurrentTenant().id)} />`.

In `app/src/app/clients/actions.ts`, add imports `import { getCurrentTenant } from "@/lib/db/tenant";` and `import { programsOn } from "@/lib/programs/access";`. In `createClientAction` (not the quick-add), replace

```ts
      gdprConsent: v.gdprConsent ?? false,
      gdprConsentDate: v.gdprConsent ? new Date() : null,
    })
    .returning({ id: clients.id })
    .all();

  const id = result[0].id;
```

with

```ts
      gdprConsent: v.gdprConsent ?? false,
      gdprConsentDate: v.gdprConsent ? new Date() : null,
      trainingMode: formData.get("trainingMode") === "diy" && programsOn(getCurrentTenant().id) ? "diy" : "coach",
    })
    .returning({ id: clients.id })
    .all();

  const id = result[0].id;
```

- [ ] **Step 11: The Programs tab in the member app**

In `app/src/components/clientapp/ClientAppFrame.tsx`:

replace

```tsx
import { CalendarRange, ChevronLeft, Dumbbell, LayoutDashboard, Salad, User } from "lucide-react";
```

with

```tsx
import { BookOpen, CalendarRange, ChevronLeft, Dumbbell, LayoutDashboard, Salad, User, type LucideIcon } from "lucide-react";
```

replace

```tsx
const TABS = [
  { href: "/app", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/app/timetable", label: "Classes", icon: CalendarRange },
  { href: "/app/nutrition", label: "Nutrition", icon: Salad },
  { href: "/app/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/app/profile", label: "Profile", icon: User },
];
const TAB_HREFS = new Set(TABS.map((t) => t.href));
```

with

```tsx
type Tab = { href: string; label: string; icon: LucideIcon; exact?: boolean };
const BASE_TABS: Tab[] = [
  { href: "/app", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/app/timetable", label: "Classes", icon: CalendarRange },
  { href: "/app/nutrition", label: "Nutrition", icon: Salad },
  { href: "/app/workouts", label: "Workouts", icon: Dumbbell },
  { href: "/app/profile", label: "Profile", icon: User },
];
/** DIY members of a business with the Programs module on (lib/programs/access.ts). */
const PROGRAMS_TAB: Tab = { href: "/app/programs", label: "Programs", icon: BookOpen };

function tabsFor(showPrograms: boolean): Tab[] {
  return showPrograms ? [...BASE_TABS.slice(0, 4), PROGRAMS_TAB, BASE_TABS[4]] : BASE_TABS;
}
```

replace

```tsx
export function ClientAppFrame({
  logoSrc,
  businessName,
  children,
}: {
  logoSrc: string | null;
  businessName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
```

with

```tsx
export function ClientAppFrame({
  logoSrc,
  businessName,
  showPrograms = false,
  children,
}: {
  logoSrc: string | null;
  businessName: string;
  showPrograms?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const tabs = tabsFor(showPrograms);
  const tabHrefs = new Set(tabs.map((t) => t.href));
```

then replace `!TAB_HREFS.has(pathname)` with `!tabHrefs.has(pathname)`, `` gridTemplateColumns: `repeat(${TABS.length}, 1fr)`, `` with `` gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, ``, and `{TABS.map((t) => {` with `{tabs.map((t) => {`.

In `app/src/app/layout.tsx`:
- replace `import { getClientSession } from "@/lib/clientAuth";` with `import { getClientSession, getCurrentClient } from "@/lib/clientAuth";`
- add `import { memberSeesPrograms } from "@/lib/programs/access";`
- in the `/app` branch, immediately before the final

```tsx
    return (
      <html lang="en" className={FONT_VARS}>
        {appHead}
        <body>
          <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: clientThemeStyle }} />
          <MotionRoot>
```

insert

```tsx
    // The Programs tab: DIY members of a business with the module on.
    let showPrograms = false;
    if (pathname !== "/app/login") {
      try {
        showPrograms = memberSeesPrograms(getCurrentClient());
      } catch (err) {
        console.error("[programs] could not resolve the member for the tab bar:", err);
      }
    }
```

- and replace `<ClientAppFrame logoSrc={clientLogo} businessName={clientBusiness}>` with `<ClientAppFrame logoSrc={clientLogo} businessName={clientBusiness} showPrograms={showPrograms}>`.

- [ ] **Step 12: Styles**

Append to `app/src/app/globals.css`:

```css
/* Training mode (Programs module): the switch on the client page and the add-member choice. */
.tm-switch { display: inline-flex; border: 1px solid var(--hairline); border-radius: var(--radius); overflow: hidden; }
.tm-switch button { min-height: 32px; padding: 0 14px; border: 0; background: transparent; color: var(--text-tertiary); font: inherit; font-size: 12.5px; cursor: pointer; }
.tm-switch button + button { border-left: 1px solid var(--hairline); }
.tm-switch button[aria-pressed="true"] { background: var(--surface-2); color: var(--text-primary); font-weight: 600; }
.tm-switch button:disabled { cursor: default; opacity: 0.7; }
.tm-choice { display: grid; gap: 10px; }
.tm-choice label { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--radius); cursor: pointer; }
.tm-choice label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
.tm-choice input { margin-top: 3px; }
.tm-choice span { display: grid; gap: 2px; font-size: 13px; color: var(--text-secondary); }
.tm-choice b { font-size: 14px; color: var(--text-primary); font-weight: 600; }
```

- [ ] **Step 13: Check everything builds and the layout test still holds**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/components/layout/commandKCoverage.test.ts && npm test -- src/lib/programs/access.test.ts`
Expected: no type errors; both tests PASS (the client-app document still contains `<ClientAppFrame`).

- [ ] **Step 14: Commit**

```bash
git add app/src/lib/features.ts app/src/lib/platform/flags.ts app/src/lib/platform/flags.test.ts app/src/lib/features.test.ts app/src/lib/programs/access.ts app/src/lib/programs/access.test.ts app/src/lib/programs/staffActor.ts "app/src/app/clients/[id]/programActions.ts" app/src/components/clients/TrainingModeSwitch.tsx "app/src/app/clients/[id]/page.tsx" app/src/components/clients/ClientForm.tsx app/src/app/clients/new/page.tsx app/src/app/clients/actions.ts app/src/components/clientapp/ClientAppFrame.tsx app/src/app/layout.tsx app/src/app/globals.css
git commit -m "feat(programs): Programs module (rollout nobody), training mode, member tab gating

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The logger shows the plan, takes RPE, and finishing a program session runs progression

**Files:**
- Modify: `app/src/lib/programs/planner.ts` (add `planSetLabel`)
- Test: `app/src/lib/programs/planLabel.test.ts`
- Modify: `app/src/app/app/actions.ts` (`rpe` in the set schema; `finishWorkoutAction` runs progression once)
- Modify: `app/src/components/clientapp/WorkoutLogger.tsx`
- Modify: `app/src/app/app/workouts/log/[id]/page.tsx` (pass the member's unit)
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: `finishEnrolmentSession(clientId, sessionId)` (Task 8); `SessionView.enrolmentId`, `SessionExercise.plan`, `LoggedSet.rpe/targetKg` (Task 8); `repsLabel`, `PlannedSet` (Task 1); `formatWeight`, `formatSetIn`, `kgToUnit`, `parseRpe`, `parseWeightIn` from `units.ts` and `WeightUnit` from `types.ts` (Task 1); `clients.weightUnit` (Task 7).
- Produces:
  - `planSetLabel(p: PlannedSet, unit: WeightUnit): string` in `planner.ts`.
  - `FinishResult` ok branch gains `program: { reasons: string[]; finished: boolean } | null`.
  - `WorkoutLogger` prop `unit?: WeightUnit` (default `"kg"`). For a program session it shows a Plan column ("102.5 x 9", "70 x 5+", "RPE 8, 140"), placeholders from the plan, an optional RPE box per set, notes for + sets and RPE sets, and after finishing a "Your program" card with the engine's reasons.

- [ ] **Step 1: Write the failing label test**

```ts
// app/src/lib/programs/planLabel.test.ts
// Run: npm test -- src/lib/programs/planLabel.test.ts
import assert from "node:assert/strict";

import { planSetLabel } from "./planner";
import type { PlannedSet } from "./types";

const base: Omit<PlannedSet, "kg" | "reps"> = { repsMax: null, amrap: false, rpe: null, pct: null, rest: 90, drives: false };
assert.equal(planSetLabel({ ...base, kg: 102.5, reps: 9 }, "kg"), "102.5 x 9");
assert.equal(planSetLabel({ ...base, kg: 70, reps: 5, amrap: true }, "kg"), "70 x 5+");
assert.equal(planSetLabel({ ...base, kg: 140, reps: 3, rpe: 8 }, "kg"), "RPE 8, 140");
assert.equal(planSetLabel({ ...base, kg: null, reps: 1, rpe: 10 }, "kg"), "RPE 10");
assert.equal(planSetLabel({ ...base, kg: null, reps: 8, repsMax: 12 }, "kg"), "8-12 reps");
assert.equal(planSetLabel({ ...base, kg: 102.058, reps: 5 }, "lb"), "225 x 5");
console.log("programs/planLabel: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/planLabel.test.ts`
Expected: FAIL (`planSetLabel` is not exported).

- [ ] **Step 3: Add `planSetLabel` to `planner.ts`**

Change the units import at the top of `app/src/lib/programs/planner.ts` to:

```ts
import { formatWeight, kgToUnit, roundToStep, weightForRpe } from "./units";
```

and append:

```ts
/** One planned set in the logger's Plan column: "102.5 x 9", "70 x 5+", "RPE 8, 140", "8-12 reps". */
export function planSetLabel(p: PlannedSet, unit: WeightUnit): string {
  const w = p.kg !== null ? String(kgToUnit(p.kg, unit)) : null;
  if (p.rpe !== null) return w ? `RPE ${p.rpe}, ${w}` : `RPE ${p.rpe}`;
  return w ? `${w} x ${repsLabel(p)}` : `${repsLabel(p)} reps`;
}
```

Run: `cd app && npm test -- src/lib/programs/planLabel.test.ts`
Expected: PASS.

- [ ] **Step 4: Finishing a program session runs progression once**

In `app/src/app/app/actions.ts`:

add the import

```ts
import { finishEnrolmentSession } from "@/lib/programs/enrolments";
```

replace

```ts
const setSchema = z.object({
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(1).max(999).nullable(),
  done: z.boolean(),
});
```

with

```ts
const setSchema = z.object({
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(1).max(999).nullable(),
  done: z.boolean(),
  rpe: z.number().min(1).max(10).nullable().optional(),
});
```

replace

```ts
export type FinishResult = { ok: true; bests: { name: string; weightKg: number; reps: number }[] } | { ok: false; error: string };
```

with

```ts
export type FinishResult =
  | { ok: true; bests: { name: string; weightKg: number; reps: number }[]; program: { reasons: string[]; finished: boolean } | null }
  | { ok: false; error: string };
```

and replace

```ts
  const { best } = exerciseHistory(clientId, session.exercises.map((e) => e.exerciseKey), session.id);
  finishSession(clientId, session.id);
  revalidatePath("/app/workouts");
  revalidatePath("/app");
  return { ok: true, bests: personalBests(session.exercises, best) };
```

with

```ts
  const { best } = exerciseHistory(clientId, session.exercises.map((e) => e.exerciseKey), session.id);
  // Only the first finish moves a DIY program on; saving changes to a finished workout does not.
  const firstFinish = finishSession(clientId, session.id);
  const program = firstFinish && session.enrolmentId ? finishEnrolmentSession(clientId, session.id) : null;
  revalidatePath("/app/workouts");
  revalidatePath("/app");
  if (session.enrolmentId) revalidatePath("/app/programs/mine");
  return { ok: true, bests: personalBests(session.exercises, best), program };
```

- [ ] **Step 5: Pass the member's unit to the logger**

In `app/src/app/app/workouts/log/[id]/page.tsx`, replace `const { clientId } = requireClientPage();` with `const { clientId, client } = requireClientPage();` and replace

```tsx
  return <WorkoutLogger session={session} previous={previous} previousAt={previousAt} />;
```

with

```tsx
  return <WorkoutLogger session={session} previous={previous} previousAt={previousAt} unit={client.weightUnit === "lb" ? "lb" : "kg"} />;
```

- [ ] **Step 6: Update `WorkoutLogger.tsx`**

Make these replacements in `app/src/components/clientapp/WorkoutLogger.tsx` (each old block appears exactly once).

(a) Icons:

```tsx
import { Check, Minus, Plus, Timer, Trash2, TrendingUp, Trophy } from "lucide-react";
```

becomes

```tsx
import { Check, ListChecks, Minus, Plus, Timer, Trash2, TrendingUp, Trophy } from "lucide-react";
```

(b) The model imports:

```tsx
import {
  DEFAULT_REST_SECONDS,
  beatsPrevious,
  completeSet,
  durationLabel,
  formatSet,
  parseReps,
  parseWeight,
  restLabel,
  targetRepsNumber,
  volumeKg,
  type LoggedSet,
  type SessionExercise,
  type SessionView,
} from "@/lib/workoutLogModel";
```

becomes

```tsx
import {
  DEFAULT_REST_SECONDS,
  beatsPrevious,
  completeSet,
  durationLabel,
  parseReps,
  restLabel,
  targetRepsNumber,
  volumeKg,
  type LoggedSet,
  type SessionExercise,
  type SessionView,
} from "@/lib/workoutLogModel";
import { planSetLabel } from "@/lib/programs/planner";
import type { PlannedSet, WeightUnit } from "@/lib/programs/types";
import { formatSetIn, formatWeight, kgToUnit, parseRpe, parseWeightIn } from "@/lib/programs/units";
```

(c) Draft sets carry RPE and the unit:

```tsx
interface DraftSet {
  w: string;
  r: string;
  done: boolean;
}
type Draft = Record<number, DraftSet[]>;

function toDraft(s: LoggedSet): DraftSet {
  return { w: s.weightKg === null ? "" : String(s.weightKg), r: s.reps === null ? "" : String(s.reps), done: s.done };
}
function toLogged(d: DraftSet): LoggedSet {
  return { weightKg: parseWeight(d.w), reps: parseReps(d.r), done: d.done };
}
```

becomes

```tsx
interface DraftSet {
  w: string;
  r: string;
  rpe: string;
  done: boolean;
}
type Draft = Record<number, DraftSet[]>;

/** Boxes show the member's unit; everything saved is kg. */
function toDraft(s: LoggedSet, unit: WeightUnit): DraftSet {
  return {
    w: s.weightKg === null ? "" : String(kgToUnit(s.weightKg, unit)),
    r: s.reps === null ? "" : String(s.reps),
    rpe: s.rpe == null ? "" : String(s.rpe),
    done: s.done,
  };
}
function toLogged(d: DraftSet, unit: WeightUnit): LoggedSet {
  return { weightKg: parseWeightIn(d.w, unit), reps: parseReps(d.r), done: d.done, rpe: parseRpe(d.rpe) };
}
```

(d) The props and initial state:

```tsx
export function WorkoutLogger({
  session,
  previous,
  previousAt = {},
}: {
  session: SessionView;
  previous: Record<string, LoggedSet[]>;
  /** When each exercise was last done (the session "Last time" comes from). */
  previousAt?: Record<string, number>;
}) {
  const router = useRouter();
  const finishedAlready = session.finishedAt !== null;
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(session.exercises.map((e) => [e.id, e.sets.map(toDraft)])));
```

becomes

```tsx
export function WorkoutLogger({
  session,
  previous,
  previousAt = {},
  unit = "kg",
}: {
  session: SessionView;
  previous: Record<string, LoggedSet[]>;
  /** When each exercise was last done (the session "Last time" comes from). */
  previousAt?: Record<string, number>;
  /** The member's display unit. Weights are still saved in kg. */
  unit?: WeightUnit;
}) {
  const router = useRouter();
  const finishedAlready = session.finishedAt !== null;
  const draftOf = (s: LoggedSet) => toDraft(s, unit);
  const loggedOf = (d: DraftSet) => toLogged(d, unit);
  /** A DIY program session: show the plan and an RPE box. */
  const isProgram = session.exercises.some((e) => e.plan);
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(session.exercises.map((e) => [e.id, e.sets.map((s) => toDraft(s, unit))])));
```

(e) The save payload:

```tsx
  const payload = useCallback(
    () => Object.entries(latest.current).map(([id, sets]) => ({ id: Number(id), sets: sets.map(toLogged) })),
    [],
  );
```

becomes

```tsx
  const payload = useCallback(
    () => Object.entries(latest.current).map(([id, sets]) => ({ id: Number(id), sets: sets.map((d) => toLogged(d, unit)) })),
    [unit],
  );
```

(f) Ticking a set fills from the plan first. Replace

```tsx
  function tick(exId: number, i: number, restSeconds: number, targetReps: string | null, prev: LoggedSet | undefined, opts: { rests: boolean; nextId: number | null; suggestKg: number | null }) {
```

with

```tsx
  function tick(
    exId: number,
    i: number,
    restSeconds: number,
    targetReps: string | null,
    prev: LoggedSet | undefined,
    opts: { rests: boolean; nextId: number | null; suggestKg: number | null; plan?: PlannedSet },
  ) {
```

and replace

```tsx
    const base = !s.w && opts.suggestKg !== null && i === 0 ? { ...s, w: String(opts.suggestKg) } : s;
    const filled = completeSet(toLogged(base), prev && opts.suggestKg !== null ? { ...prev, weightKg: opts.suggestKg } : prev, i > 0 ? toLogged(sets[i - 1]) : undefined, targetReps);
    update(exId, (xs) => xs.map((x, k) => (k === i ? toDraft(filled) : x)));
```

with

```tsx
    const base = !s.w && opts.suggestKg !== null && i === 0 ? { ...s, w: String(kgToUnit(opts.suggestKg, unit)) } : s;
    // A planned set fills from the plan: its weight, and its reps (the minimum on a + set).
    const planned = opts.plan ? { weightKg: opts.plan.kg, reps: opts.plan.reps } : undefined;
    const filled = completeSet(
      loggedOf(base),
      planned ?? (prev && opts.suggestKg !== null ? { ...prev, weightKg: opts.suggestKg } : prev),
      i > 0 ? loggedOf(sets[i - 1]) : undefined,
      targetReps,
    );
    update(exId, (xs) => xs.map((x, k) => (k === i ? { ...draftOf(filled), rpe: x.rpe } : x)));
```

(g) In `addExercise`, replace `r.exercise.sets.map(toDraft)` with `r.exercise.sets.map(draftOf)`.

(h) The finished screen. Replace

```tsx
    const logged = exercises.map((e) => ({ sets: (draft[e.id] ?? []).map(toLogged) }));
```

with

```tsx
    const logged = exercises.map((e) => ({ sets: (draft[e.id] ?? []).map(loggedOf) }));
```

insert, immediately before `        {result.bests.length > 0 && (`:

```tsx
        {result.program && (
          <Card style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>
              <ListChecks size={17} style={{ color: "var(--accent-ink)" }} />
              {result.program.finished ? "Program done" : "Your program"}
            </div>
            {result.program.reasons.length === 0 ? (
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Nothing changes until your next session.</div>
            ) : (
              result.program.reasons.map((r) => (
                <div key={r} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {r}
                </div>
              ))
            )}
          </Card>
        )}
```

replace

```tsx
                <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatSet(b)}</span>
```

with

```tsx
                <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatSetIn(b, unit)}</span>
```

and replace

```tsx
          <Button variant="secondary" onClick={() => router.push("/app/workouts")} style={{ width: "100%" }}>
            Back to workouts
          </Button>
```

with

```tsx
          <Button variant="secondary" onClick={() => router.push(session.enrolmentId ? "/app/programs/mine" : "/app/workouts")} style={{ width: "100%" }}>
            {session.enrolmentId ? "Back to my program" : "Back to workouts"}
          </Button>
```

(i) Each working exercise reads its plan. Replace

```tsx
              const sug = nextWeight(prev, ex.targetReps);
```

with

```tsx
              const plan = ex.plan ?? null;
              // A program session plans every weight; the "try X today" hint is for coach programs.
              const sug = plan ? null : nextWeight(prev, ex.targetReps);
```

replace

```tsx
                          <b>{sug.change === "up" ? `Try ${sug.weightKg} kg today.` : `${sug.weightKg} kg again.`}</b> {sug.reason}
```

with

```tsx
                          <b>{sug.change === "up" ? `Try ${formatWeight(sug.weightKg, unit)} today.` : `${formatWeight(sug.weightKg, unit)} again.`}</b> {sug.reason}
```

and insert, immediately after the closing `</div>` of the `<div className="wl-ex-target">` block (the one that ends with `" · then straight on"}`):

```tsx
                    {plan && plan.sets.some((p) => p.amrap) && !allDone && (
                      <div className="wl-ex-notes">Sets marked + are as many as you can. Type the reps you got.</div>
                    )}
                    {plan && plan.sets.some((p) => p.rpe !== null) && !allDone && (
                      <div className="wl-ex-notes">RPE is how hard a set feels: 10 is your limit, 8 leaves two reps in the tank. The weight shown is a suggestion.</div>
                    )}
```

(j) The column heads. Replace

```tsx
                  <div className="wl-grid wl-grid-head" aria-hidden>
                    <span>Set</span>
                    <span>Last time</span>
                    <span>kg</span>
                    <span>Reps</span>
                    <span />
                  </div>
```

with

```tsx
                  <div className={`wl-grid wl-grid-head${isProgram ? " wl-grid--rpe" : ""}`} aria-hidden>
                    <span>Set</span>
                    <span>{plan ? "Plan" : "Last time"}</span>
                    <span>{unit}</span>
                    <span>Reps</span>
                    {isProgram && <span>RPE</span>}
                    <span />
                  </div>
```

(k) The set rows. Replace the whole `{sets.map((s, i) => { ... })}` block inside the working-exercise card, from

```tsx
                  {sets.map((s, i) => {
                    const p = prev[i] && prev[i].done ? prev[i] : undefined;
                    const beat = beatsPrevious(toLogged(s), p);
```

through the line `                  })}` that closes it, with:

```tsx
                  {sets.map((s, i) => {
                    const p = prev[i] && prev[i].done ? prev[i] : undefined;
                    const ps = plan?.sets[i];
                    const beat = beatsPrevious(loggedOf(s), p);
                    const kgHint = ps && ps.kg !== null ? ps.kg : sug ? sug.weightKg : (p?.weightKg ?? null);
                    const repsHint = ps ? ps.reps : (p?.reps ?? targetRepsNumber(ex.targetReps));
                    return (
                      <div key={i} className={`wl-grid wl-set${isProgram ? " wl-grid--rpe" : ""}`} data-done={s.done} data-beat={beat}>
                        <span className="wl-setno">{i + 1}</span>
                        <span className="wl-prev">
                          {ps ? planSetLabel(ps, unit) : p && (p.weightKg !== null || p.reps !== null) ? formatSetIn(p, unit) : "-"}
                          {beat && !ps && <TrendingUp size={14} strokeWidth={2.5} aria-label="Beat last time" />}
                        </span>
                        <input
                          className="wl-input"
                          inputMode="decimal"
                          enterKeyHint="next"
                          aria-label={`${ex.name} set ${i + 1} weight in ${unit}`}
                          placeholder={kgHint !== null ? String(kgToUnit(kgHint, unit)) : ""}
                          value={s.w}
                          onChange={(e) => update(ex.id, (xs) => xs.map((x, k) => (k === i ? { ...x, w: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) } : x)))}
                        />
                        <input
                          className="wl-input"
                          inputMode="numeric"
                          enterKeyHint="done"
                          aria-label={`${ex.name} set ${i + 1} reps`}
                          placeholder={repsHint != null ? String(repsHint) : ""}
                          value={s.r}
                          onChange={(e) => update(ex.id, (xs) => xs.map((x, k) => (k === i ? { ...x, r: e.target.value.replace(/\D/g, "").slice(0, 3) } : x)))}
                        />
                        {isProgram && (
                          <input
                            className="wl-input"
                            inputMode="decimal"
                            aria-label={`${ex.name} set ${i + 1} effort, RPE 1 to 10, optional`}
                            placeholder={ps?.rpe != null ? String(ps.rpe) : ""}
                            value={s.rpe}
                            onChange={(e) => update(ex.id, (xs) => xs.map((x, k) => (k === i ? { ...x, rpe: e.target.value.replace(/[^\d.,]/g, "").slice(0, 4) } : x)))}
                          />
                        )}
                        <button
                          type="button"
                          className="wl-tick"
                          aria-pressed={s.done}
                          aria-label={s.done ? `Untick set ${i + 1}` : `Tick off set ${i + 1}`}
                          onClick={() =>
                            tick(ex.id, i, groupRest, ex.targetReps, p, { rests, nextId: rests ? null : (inSection[xi + 1]?.id ?? null), suggestKg: sug?.weightKg ?? null, plan: ps })
                          }
                        >
                          <Check size={18} strokeWidth={2.6} />
                        </button>
                      </div>
                    );
                  })}
```

(l) Adding a set carries an empty RPE. Replace

```tsx
[...xs, { w: xs[xs.length - 1]?.w ?? "", r: "", done: false }]
```

with

```tsx
[...xs, { w: xs[xs.length - 1]?.w ?? "", r: "", rpe: "", done: false }]
```

After the edits, search the file for any remaining `toDraft(`/`toLogged(` call that passes one argument, `formatSet(` or `parseWeight(`: `grep -n -E "toDraft\([a-z]+\)|toLogged\([a-z]+\)|formatSet\(|parseWeight\(" app/src/components/clientapp/WorkoutLogger.tsx` must print nothing.

- [ ] **Step 7: Styles**

Append to `app/src/app/globals.css`:

```css
/* Program sessions in the logger: a Plan column and an optional RPE box. */
.wl-grid--rpe { grid-template-columns: 22px minmax(0, 1fr) 58px 46px 42px 44px; gap: 6px; }
```

- [ ] **Step 8: Typecheck, test, build**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/workoutLogModel.test.ts && npm test -- src/lib/programs/enrolments.test.ts`
Expected: no type errors; tests PASS. (A coach-program session has no `plan`, so its screen is unchanged: same columns, same hints, kg labels for kg members.)

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/programs/planner.ts app/src/lib/programs/planLabel.test.ts app/src/app/app/actions.ts app/src/components/clientapp/WorkoutLogger.tsx "app/src/app/app/workouts/log/[id]/page.tsx" app/src/app/globals.css
git commit -m "feat(programs): planned weights, RPE and progression reasons in the logger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Member app Programs tab: browse with filters, program detail, and the start flow

**Files:**
- Create: `app/src/lib/programs/cards.ts`
- Test: `app/src/lib/programs/cards.test.ts`
- Create: `app/src/app/app/programs/actions.ts`
- Create: `app/src/app/app/programs/page.tsx`
- Create: `app/src/app/app/programs/[key]/page.tsx`
- Create: `app/src/app/app/programs/[key]/start/page.tsx`
- Create: `app/src/components/clientapp/ProgramBrowser.tsx`
- Create: `app/src/components/clientapp/StartProgramForm.tsx`
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: `requireProgramsPage()`, `memberSeesPrograms()` (Task 9); `memberPrograms()`, `programByKey()` (Task 7); `liveEnrolment()`, `bestLoggedSet()`, `enrol()` (Task 8); `setsFor`, `summariseRx` (Task 1); `STEP_OPTIONS`, `StepKey`, `keyFromStep`, `stepFromKey`, `unitToKg`, `maxFromSet`, `parseWeightIn`, `formatWeight`, `trainingMax` (Task 1); existing `requireClient()`, `WEEKDAY_SHORT`, `dateKey`, `Card`, `PageTitle`, `SectionTitle`, `Button`, CSS classes `td-label`, `td-days`, `td-day`.
- Produces:
  - `cards.ts`: `interface ProgramCard { key; name; author; family; familyLabel; levelLabel; daysPerWeek; lengthWeeks; who; warning: string | null; basedOn: string | null; lifts: LiftKey[] }`, `toCard(t, basedOn?)`, `cardLine(c): string` ("4 days a week for 4 weeks"), `byline(c): string` (author, or "Our version, based on X"), `type CardFilter = { family: Family | "all"; days: "any" | "3" | "4" | "5+"; length: "any" | "short" | "medium" | "long" }`, `NO_FILTER`, `filterCards(cards, f)`, `defaultWeekdays(daysPerWeek): number[]`, `actorLabel(actor, actorName, forMember): string`.
  - `app/src/app/app/programs/actions.ts` (`"use server"`): `type MaxEntry = { lift: LiftKey; kind: "one_rm" | "set" | "logged"; weight: number | null; reps: number | null }` (weight in the member's unit), `type StartProgramInput`, `startProgramAction(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }>`. Task 12 adds more actions to this file.
  - Routes: `/app/programs` (browse), `/app/programs/[key]` (detail), `/app/programs/[key]/start` (start flow). A program key is a platform key or `copy-<id>`.

- [ ] **Step 1: Write the failing cards test**

```ts
// app/src/lib/programs/cards.test.ts
// Run: npm test -- src/lib/programs/cards.test.ts
import assert from "node:assert/strict";

import { NO_FILTER, actorLabel, byline, cardLine, defaultWeekdays, filterCards, toCard } from "./cards";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";

const cards = PLATFORM_PROGRAMS.map((t) => toCard(t));
const smolov = toCard(platformProgram("smolov-base")!);
assert.equal(cardLine(smolov), "4 days a week for 4 weeks");
assert.equal(smolov.familyLabel, "Powerlifting peak");
assert.equal(smolov.warning, "Squats four days a week at high volume. Only for lifters with a year or more of steady squatting.");
assert.equal(byline(smolov), "Smolov by Sergey Smolov");
const copy = toCard({ ...platformProgram("smolov-base")!, key: "copy-3", name: "Our Smolov" }, "Smolov base mesocycle");
assert.equal(byline(copy), "Our version, based on Smolov base mesocycle");
assert.equal(cardLine({ daysPerWeek: 1, lengthWeeks: 1 }), "1 day a week for 1 week");

assert.equal(filterCards(cards, NO_FILTER).length, PLATFORM_PROGRAMS.length);
assert.equal(filterCards(cards, { ...NO_FILTER, family: "peaking" }).length, 6);
assert.equal(filterCards(cards, { ...NO_FILTER, family: "beginner" }).length, 3);
assert.deepEqual(
  filterCards(cards, { ...NO_FILTER, days: "5+" }).map((c) => c.key).sort(),
  ["arnold-style-split", "nsuns-style-5-day", "phat", "push-pull-legs"],
);
assert.ok(filterCards(cards, { ...NO_FILTER, days: "3" }).every((c) => c.daysPerWeek <= 3));
assert.equal(filterCards(cards, { ...NO_FILTER, length: "short" }).length, 7);
assert.ok(filterCards(cards, { ...NO_FILTER, length: "medium" }).every((c) => c.lengthWeeks >= 7 && c.lengthWeeks <= 12));
assert.equal(filterCards(cards, { family: "peaking", days: "4", length: "short" }).length, 4);

assert.deepEqual(defaultWeekdays(3), [1, 3, 5]);
assert.deepEqual(defaultWeekdays(4), [1, 2, 4, 5]);
assert.deepEqual(defaultWeekdays(6), [1, 2, 3, 4, 5, 6]);
assert.deepEqual(defaultWeekdays(9), [1, 2, 3, 4, 5, 6, 7]);

assert.equal(actorLabel("engine", null, true), "Program");
assert.equal(actorLabel("member", null, true), "You");
assert.equal(actorLabel("member", null, false), "Member");
assert.equal(actorLabel("staff:4", "Ann Byrne", true), "Coach Ann Byrne");
assert.equal(actorLabel("staff:4", null, false), "Coach");

console.log("programs/cards: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/cards.test.ts`
Expected: FAIL with `Cannot find module './cards'`.

- [ ] **Step 3: Write `cards.ts`**

```ts
// app/src/lib/programs/cards.ts
/** Library cards, filters and small display helpers for the member app and staff screens. Pure. */
import { FAMILY_LABEL, LEVEL_LABEL, type Family, type LiftKey, type ProgramTemplate } from "./types";

export interface ProgramCard {
  key: string;
  name: string;
  author: string;
  family: Family;
  familyLabel: string;
  levelLabel: string;
  daysPerWeek: number;
  lengthWeeks: number;
  who: string;
  warning: string | null;
  /** A gym copy: the platform program it is based on. */
  basedOn: string | null;
  lifts: LiftKey[];
}

export function toCard(t: ProgramTemplate, basedOn: string | null = null): ProgramCard {
  return {
    key: t.key,
    name: t.name,
    author: t.author,
    family: t.family,
    familyLabel: FAMILY_LABEL[t.family],
    levelLabel: LEVEL_LABEL[t.level],
    daysPerWeek: t.daysPerWeek,
    lengthWeeks: t.lengthWeeks,
    who: t.who,
    warning: t.warning ?? null,
    basedOn,
    lifts: t.lifts,
  };
}

/** "4 days a week for 13 weeks". */
export function cardLine(c: Pick<ProgramCard, "daysPerWeek" | "lengthWeeks">): string {
  return `${c.daysPerWeek} ${c.daysPerWeek === 1 ? "day" : "days"} a week for ${c.lengthWeeks} ${c.lengthWeeks === 1 ? "week" : "weeks"}`;
}

/** The author credit, or for a gym copy "Our version, based on Smolov base mesocycle". */
export function byline(c: Pick<ProgramCard, "author" | "basedOn">): string {
  return c.basedOn ? `Our version, based on ${c.basedOn}` : c.author;
}

export interface CardFilter {
  family: Family | "all";
  /** "3" is three or fewer. */
  days: "any" | "3" | "4" | "5+";
  /** short: up to 6 weeks; medium: 7 to 12; long: 13 or more. */
  length: "any" | "short" | "medium" | "long";
}

export const NO_FILTER: CardFilter = { family: "all", days: "any", length: "any" };

export function filterCards(cards: ProgramCard[], f: CardFilter): ProgramCard[] {
  return cards.filter((c) => {
    if (f.family !== "all" && c.family !== f.family) return false;
    if (f.days === "3" && c.daysPerWeek > 3) return false;
    if (f.days === "4" && c.daysPerWeek !== 4) return false;
    if (f.days === "5+" && c.daysPerWeek < 5) return false;
    if (f.length === "short" && c.lengthWeeks > 6) return false;
    if (f.length === "medium" && (c.lengthWeeks < 7 || c.lengthWeeks > 12)) return false;
    if (f.length === "long" && c.lengthWeeks < 13) return false;
    return true;
  });
}

const DEFAULT_DAYS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

/** Training weekdays to suggest for a program's days per week (1 = Monday). */
export function defaultWeekdays(daysPerWeek: number): number[] {
  return DEFAULT_DAYS[Math.max(1, Math.min(7, Math.round(daysPerWeek)))];
}

/** Who made a change-log entry, for the member ("You") or for staff ("Member"). */
export function actorLabel(actor: string, actorName: string | null, forMember: boolean): string {
  if (actor === "engine") return "Program";
  if (actor === "member") return forMember ? "You" : "Member";
  return actorName ? `Coach ${actorName}` : "Coach";
}
```

- [ ] **Step 4: Run the cards test**

Run: `cd app && npm test -- src/lib/programs/cards.test.ts`
Expected: PASS. (Short programs: Smolov base, Smolov Jr x2, RSR, Candito-style, Sheiko-style and GVT make 7. Peaking, exactly 4 days and short: Smolov base, both Smolov Jr and Candito-style make 4; RSR and Sheiko-style are 3 days a week.)

- [ ] **Step 5: Write the member actions**

```ts
// app/src/app/app/programs/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import { bestLoggedSet, enrol } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";
import { maxFromSet, stepFromKey, unitToKg } from "@/lib/programs/units";

// The member's own program. Every action takes the member from their client
// session; lib/programs/enrolments only ever touches that member's enrolment.

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false as const, error: "Programs aren't switched on for you." };

const liftZ = z.enum(["squat", "bench", "deadlift", "press", "row"]);
const maxEntryZ = z.object({
  lift: liftZ,
  kind: z.enum(["one_rm", "set", "logged"]),
  /** In the member's unit. */
  weight: z.number().min(0).max(1500).nullable(),
  reps: z.number().int().min(1).max(30).nullable(),
});
const startZ = z.object({
  key: z.string().min(1).max(80),
  unit: z.enum(["kg", "lb"]),
  step: z.enum(["2.5kg", "1.25kg", "5lb"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7),
  maxes: z.array(maxEntryZ).max(5),
});

export type MaxEntry = z.infer<typeof maxEntryZ>;
export type StartProgramInput = z.infer<typeof startZ>;

function member() {
  const c = requireClient();
  return memberSeesPrograms(c) ? c : null;
}

/** Each lift's max in kg: a 1-rep max, a recent set (Epley, 10 reps or fewer) or the best logged set. */
function resolveMaxes(clientId: number, unit: WeightUnit, entries: MaxEntry[]): { ok: true; kg: Partial<Record<LiftKey, number>> } | { ok: false; error: string } {
  const kg: Partial<Record<LiftKey, number>> = {};
  for (const m of entries) {
    const label = LIFT_LABEL[m.lift].toLowerCase();
    if (m.kind === "logged") {
      const best = bestLoggedSet(clientId, m.lift);
      if (!best) return { ok: false, error: `No ${label} logged in the last 90 days. Enter a max instead.` };
      kg[m.lift] = best.e1rm;
    } else if (m.kind === "one_rm") {
      if (!m.weight) return { ok: false, error: `Enter your ${label} max.` };
      kg[m.lift] = unitToKg(m.weight, unit);
    } else {
      const e1rm = m.weight && m.reps ? maxFromSet(unitToKg(m.weight, unit), m.reps) : null;
      if (e1rm === null) return { ok: false, error: `Use a ${label} set of 10 reps or fewer.` };
      kg[m.lift] = e1rm;
    }
  }
  return { ok: true, kg };
}

export async function startProgramAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = startZ.safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entries and try again." };
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false, error: "Pick a smallest jump in the same unit." };
  if (!programByKey(v.key)) return { ok: false, error: "That program isn't available." };
  const maxes = resolveMaxes(c.clientId, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const r = enrol(c.clientId, { key: v.key, maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays });
  if (!r.ok) return r;
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
  return { ok: true };
}
```

- [ ] **Step 6: The browse page and browser**

```tsx
// app/src/app/app/programs/page.tsx
import { requireProgramsPage } from "@/lib/programs/access";
import { toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { PageTitle } from "@/components/clientapp/ui";
import { ProgramBrowser } from "@/components/clientapp/ProgramBrowser";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const { clientId } = requireProgramsPage();
  const cards = memberPrograms().map((e) => toCard(e.template, e.basedOnName));
  const live = liveEnrolment(clientId);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Well-known programs, with your weights worked out">Programs</PageTitle>
      <ProgramBrowser cards={cards} current={live ? { name: live.template.name, paused: live.status === "paused" } : null} />
    </div>
  );
}
```

```tsx
// app/src/components/clientapp/ProgramBrowser.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Play } from "lucide-react";

import { Card } from "@/components/clientapp/ui";
import { NO_FILTER, byline, cardLine, filterCards, type CardFilter, type ProgramCard } from "@/lib/programs/cards";

const GOALS: [CardFilter["family"], string][] = [
  ["all", "All"],
  ["strength", "Strength"],
  ["peaking", "Powerlifting peak"],
  ["beginner", "Beginner"],
  ["size", "Size"],
];
const DAYS: [CardFilter["days"], string][] = [
  ["any", "Any"],
  ["3", "3 or fewer"],
  ["4", "4"],
  ["5+", "5 or more"],
];
const LENGTHS: [CardFilter["length"], string][] = [
  ["any", "Any"],
  ["short", "Up to 6 weeks"],
  ["medium", "7 to 12 weeks"],
  ["long", "Longer"],
];

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="td-label">{label}</div>
      <div className="pg-chips" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" className="pg-chip" aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The program library: filter by goal, days a week and length. */
export function ProgramBrowser({ cards, current }: { cards: ProgramCard[]; current: { name: string; paused: boolean } | null }) {
  const [f, setF] = useState<CardFilter>(NO_FILTER);
  const list = filterCards(cards, f);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {current && (
        <Link href="/app/programs/mine">
          <Card style={{ display: "flex", alignItems: "center", gap: 12, borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <Play size={18} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{current.name}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{current.paused ? "Paused while you're coach guided" : "Your program. Open it to train."}</div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          </Card>
        </Link>
      )}
      <Chips label="Goal" options={GOALS} value={f.family} onChange={(family) => setF({ ...f, family })} />
      <Chips label="Days a week" options={DAYS} value={f.days} onChange={(days) => setF({ ...f, days })} />
      <Chips label="Length" options={LENGTHS} value={f.length} onChange={(length) => setF({ ...f, length })} />
      {list.length === 0 ? (
        <Card style={{ textAlign: "center", fontSize: 13.5, color: "var(--text-secondary)" }}>No programs match. Try fewer filters.</Card>
      ) : (
        list.map((c) => (
          <Link key={c.key} href={`/app/programs/${encodeURIComponent(c.key)}`}>
            <Card style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                <span className="pg-tag">{c.familyLabel}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{byline(c)}</div>
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {cardLine(c)}. {c.who}
              </div>
              {c.warning && (
                <div className="pg-warning">
                  <AlertTriangle size={14} aria-hidden />
                  <span>{c.warning}</span>
                </div>
              )}
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 7: The detail page**

```tsx
// app/src/app/app/programs/[key]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, cardLine, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { setsFor, summariseRx } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

export default async function ProgramDetailPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId } = requireProgramsPage();
  const entry = programByKey(decodeURIComponent(key));
  if (!entry) notFound();
  const t = entry.template;
  const card = toCard(t, entry.basedOnName);
  const live = liveEnrolment(clientId);
  const firstWeek = t.weeks[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={byline(card)}>{t.name}</PageTitle>
      <Card style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>
          {cardLine(card)}. {card.levelLabel} level.
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t.who}</div>
        {t.warning && (
          <div className="pg-warning">
            <AlertTriangle size={14} aria-hidden />
            <span>{t.warning}</span>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{t.description}</p>
        {t.lifts.length > 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>You need a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.</div>
        )}
      </Card>

      <SectionTitle>{firstWeek.label ? `Week 1: ${firstWeek.label}` : "Week 1"}</SectionTitle>
      {firstWeek.days.map((d, i) => (
        <Card key={i} style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{d.name}</div>
          {d.exercises.map((ex, j) => (
            <div key={j} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span>
              <span style={{ color: "var(--text-secondary)", textAlign: "right" }}>{summariseRx(setsFor(ex, {}))}</span>
            </div>
          ))}
        </Card>
      ))}
      {t.weeks.length > 1 && (
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", textAlign: "center" }}>
          {t.weeks.length} different weeks in all. Your weights are worked out when you start.
        </div>
      )}

      {live ? (
        <Card style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
          You&rsquo;re running {live.template.name}. End it on{" "}
          <Link href="/app/programs/mine" style={{ color: "var(--accent-ink)" }}>
            My program
          </Link>{" "}
          before you start another.
        </Card>
      ) : (
        <Link href={`/app/programs/${encodeURIComponent(t.key)}/start`} className="pg-cta">
          Start this program
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 8: The start page and form**

```tsx
// app/src/app/app/programs/[key]/start/page.tsx
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { PageTitle } from "@/components/clientapp/ui";
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";

export const dynamic = "force-dynamic";

export default async function StartProgramPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const entry = programByKey(decodeURIComponent(key));
  if (!entry) notFound();
  if (liveEnrolment(clientId)) redirect("/app/programs/mine");
  const t = entry.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={t.name}>Start program</PageTitle>
      <StartProgramForm
        programKey={t.key}
        tmPct={t.tmPct}
        lifts={lifts}
        initialUnit={unit}
        initialStep={keyFromStep(client.plateStepKg)}
        defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
        today={dateKey(Date.now())}
      />
    </div>
  );
}
```

```tsx
// app/src/components/clientapp/StartProgramForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/clientapp/ui";
import { startProgramAction, type MaxEntry } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, maxFromSet, parseWeightIn, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

interface LiftRow {
  lift: LiftKey;
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
}
interface RowState {
  mode: MaxEntry["kind"];
  weight: string;
  reps: string;
}

/** Maxes three ways, units, smallest jump, start date and training days. */
export function StartProgramForm({
  programKey,
  tmPct,
  lifts,
  initialUnit,
  initialStep,
  defaultWeekdays,
  today,
}: {
  programKey: string;
  tmPct: number;
  lifts: LiftRow[];
  initialUnit: WeightUnit;
  initialStep: StepKey;
  defaultWeekdays: number[];
  today: string;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [step, setStep] = useState<StepKey>(initialUnit === "lb" ? "5lb" : initialStep === "5lb" ? "2.5kg" : initialStep);
  const [rows, setRows] = useState<RowState[]>(lifts.map((l) => ({ mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })));
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState<number[]>(defaultWeekdays);
  const [pending, start] = useTransition();

  const setRow = (i: number, patch: Partial<RowState>) => setRows((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  function estimate(i: number): number | null {
    const r = rows[i];
    if (r.mode === "logged") return lifts[i].logged?.e1rm ?? null;
    const kg = parseWeightIn(r.weight, unit);
    if (kg === null || kg <= 0) return null;
    return r.mode === "one_rm" ? kg : maxFromSet(kg, Number(r.reps));
  }

  function pickUnit(u: WeightUnit) {
    setUnit(u);
    setStep(u === "lb" ? "5lb" : "2.5kg");
  }

  function toggleDay(d: number) {
    setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)));
  }

  function submit() {
    start(async () => {
      const maxes: MaxEntry[] = rows.map((r, i) => ({
        lift: lifts[i].lift,
        kind: r.mode,
        weight: r.mode === "logged" ? null : Number(r.weight.replace(",", ".")) || null,
        reps: r.mode === "set" ? Number(r.reps) || null : null,
      }));
      const res = await startProgramAction({ key: programKey, unit, step, startDate, weekdays: days, maxes });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Program started");
      router.push("/app/programs/mine");
      router.refresh();
    });
  }

  const steps = STEP_OPTIONS.filter((s) => s.unit === unit);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ display: "grid", gap: 12 }}>
        <div className="td-label">Units</div>
        <div className="pg-chips" role="group" aria-label="Units">
          {(["kg", "lb"] as const).map((u) => (
            <button key={u} type="button" className="pg-chip" aria-pressed={unit === u} onClick={() => pickUnit(u)}>
              {u === "kg" ? "Kilograms" : "Pounds"}
            </button>
          ))}
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="td-label">Smallest jump</span>
          <select className="pg-input" value={step} onChange={(e) => setStep(e.target.value as StepKey)}>
            {steps.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Every weight rounds to this jump.</div>
      </Card>

      {lifts.map((l, i) => {
        const r = rows[i];
        const est = estimate(i);
        return (
          <Card key={l.lift} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</div>
            <div className="pg-chips" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
              {l.logged && (
                <button type="button" className="pg-chip" aria-pressed={r.mode === "logged"} onClick={() => setRow(i, { mode: "logged" })}>
                  Best logged
                </button>
              )}
              <button type="button" className="pg-chip" aria-pressed={r.mode === "one_rm"} onClick={() => setRow(i, { mode: "one_rm" })}>
                1-rep max
              </button>
              <button type="button" className="pg-chip" aria-pressed={r.mode === "set"} onClick={() => setRow(i, { mode: "set" })}>
                A recent set
              </button>
            </div>
            {r.mode === "logged" && l.logged && (
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                Your best in the last 90 days: {formatWeight(l.logged.kg, unit)} x {l.logged.reps}.
              </div>
            )}
            {r.mode === "one_rm" && (
              <input className="pg-input" inputMode="decimal" aria-label={`${l.label} 1-rep max in ${unit}`} placeholder={`Max in ${unit}`} value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} />
            )}
            {r.mode === "set" && (
              <div className="pg-row">
                <input className="pg-input" inputMode="decimal" aria-label={`${l.label} weight in ${unit}`} placeholder={`Weight in ${unit}`} value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} />
                <input className="pg-input" inputMode="numeric" aria-label={`${l.label} reps`} placeholder="Reps, 1 to 10" value={r.reps} onChange={(e) => setRow(i, { reps: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </div>
            )}
            {est !== null ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Max about {formatWeight(est, unit)}
                {tmPct !== 1 ? `. Training max ${formatWeight(trainingMax(est, tmPct), unit)}.` : "."}
              </div>
            ) : r.mode === "set" && Number(r.reps) > 10 ? (
              <div style={{ fontSize: 13, color: "var(--danger)" }}>Use a set of 10 reps or fewer.</div>
            ) : null}
          </Card>
        );
      })}

      <Card style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="td-label">Start date</span>
          <input className="pg-input" type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value || today)} />
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="td-label">Days you train</div>
          <div className="td-days">
            {WEEKDAY_SHORT.map((label, i) => (
              <button key={label} type="button" className="td-day" aria-pressed={days.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Your program moves on when you finish a session, so a missed day just waits for you.</div>
        </div>
      </Card>

      <Button onClick={submit} loading={pending} style={{ width: "100%" }}>
        Start program
      </Button>
    </div>
  );
}
```

- [ ] **Step 9: Styles**

Append to `app/src/app/globals.css`:

```css
/* Member app: the program library (Programs tab). Tenant brand tokens. */
.pg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pg-chip { min-height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.pg-chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.pg-tag { flex-shrink: 0; align-self: flex-start; padding: 2px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-tertiary); font-size: 11.5px; }
.pg-warning { display: flex; gap: 6px; align-items: flex-start; font-size: 12.5px; line-height: 1.4; color: var(--text-secondary); }
.pg-warning svg { flex-shrink: 0; margin-top: 2px; color: var(--danger); }
.pg-input { width: 100%; height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--hairline); background-color: var(--surface-2); color: var(--text-primary); font: inherit; font-size: 15px; }
select.pg-input { padding-right: 36px; }
.pg-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pg-cta { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 18px; border-radius: var(--radius); background: var(--accent); color: var(--accent-contrast); font-size: 15px; font-weight: 600; text-decoration: none; }
```

- [ ] **Step 10: Typecheck and build**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/cards.test.ts && rm -rf .next && npx next build`
Expected: no errors; the build lists `/app/programs`, `/app/programs/[key]`, `/app/programs/[key]/start`.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/programs/cards.ts app/src/lib/programs/cards.test.ts app/src/app/app/programs/actions.ts app/src/app/app/programs/page.tsx "app/src/app/app/programs/[key]/page.tsx" "app/src/app/app/programs/[key]/start/page.tsx" app/src/components/clientapp/ProgramBrowser.tsx app/src/components/clientapp/StartProgramForm.tsx app/src/app/globals.css
git commit -m "feat(programs): member Programs tab with filters, detail and start flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: My program: the program page, the My program card on Home and Workouts, skip, end, days and restart

**Files:**
- Modify: `app/src/app/app/programs/actions.ts` (add five actions)
- Create: `app/src/app/app/programs/mine/page.tsx`
- Create: `app/src/components/clientapp/StartProgramSessionButton.tsx`
- Create: `app/src/components/clientapp/MyProgramControls.tsx`
- Create: `app/src/components/clientapp/RestartProgramForm.tsx`
- Create: `app/src/components/clientapp/MyProgramCard.tsx`
- Modify: `app/src/app/app/page.tsx` (Home), `app/src/app/app/workouts/page.tsx` (Workouts)

**Interfaces:**
- Consumes: Task 8 (`liveEnrolment`, `planFor`, `sessionTitle`, `programWeek`, `enrolmentEvents`, `startEnrolmentSession`, `skipEnrolmentSession`, `endEnrolment`, `setEnrolmentDays`, `restartFromTest`), Task 9 (`requireProgramsPage`, `memberSeesPrograms`), Task 11 (`actions.ts` with `member()`, `resolveMaxes()`, `OFF`, `maxEntryZ`, `MaxEntry`; `actorLabel` in `cards.ts`), Task 1 (`summarisePlanned`, `weekNumber`, `formatWeight`, `kgToUnit`, `parseWeightIn`, `LIFT_LABEL`); existing `openSession` (`@/lib/workoutLog`), `StartResult`, `WeekStrip`, `useConfirm`, `Button`, `Card`, `PageTitle`, `SectionTitle`, `WEEKDAY_SHORT`, `dateKey`.
- Produces:
  - Actions: `startProgramSessionAction(): Promise<StartResult>`, `skipProgramSessionAction(): Promise<Result>`, `endProgramAction(): Promise<Result>`, `setProgramDaysAction(weekdays: number[]): Promise<Result>`, `restartProgramAction(raw: { maxes: MaxEntry[] }): Promise<Result>`.
  - `/app/programs/mine`: week x of y, next session with every weight worked out, Start or Continue, this week's strip, maxes and training maxes, training days, Skip, End, the change log, and a restart form when a block is done.
  - `MyProgramCard({ clientId })` (server component; renders nothing unless the member has an active program).

- [ ] **Step 1: Add the actions**

In `app/src/app/app/programs/actions.ts`, replace

```ts
import { bestLoggedSet, enrol } from "@/lib/programs/enrolments";
```

with

```ts
import { bestLoggedSet, endEnrolment, enrol, liveEnrolment, restartFromTest, setEnrolmentDays, skipEnrolmentSession, startEnrolmentSession } from "@/lib/programs/enrolments";
import type { StartResult } from "@/lib/workoutLog";
```

and append:

```ts
function refresh() {
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
}

/** Start (or continue) the next session of the member's program in the logger. */
export async function startProgramSessionAction(): Promise<StartResult> {
  const c = member();
  if (!c) return OFF;
  const r = startEnrolmentSession(c.clientId);
  refresh();
  return r;
}

export async function skipProgramSessionAction(): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const r = skipEnrolmentSession(c.clientId);
  refresh();
  return r;
}

export async function endProgramAction(): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  if (!endEnrolment(c.clientId, { kind: "member" })) return { ok: false, error: "You don't have a program running." };
  refresh();
  return { ok: true };
}

export async function setProgramDaysAction(weekdays: number[]): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const d = z.array(z.number().int().min(1).max(7)).max(7).safeParse(weekdays);
  if (!d.success) return { ok: false, error: "Couldn't save your training days." };
  if (!setEnrolmentDays(c.clientId, d.data)) return { ok: false, error: "You don't have a program running." };
  refresh();
  return { ok: true };
}

/** A finished block: start it again from the member's new maxes (in their unit). */
export async function restartProgramAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = z.object({ maxes: z.array(maxEntryZ).max(5) }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entries and try again." };
  const view = liveEnrolment(c.clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  const maxes = resolveMaxes(c.clientId, view.unit, p.data.maxes);
  if (!maxes.ok) return maxes;
  const r = restartFromTest(c.clientId, maxes.kg);
  refresh();
  return r;
}
```

- [ ] **Step 2: The start/continue button**

```tsx
// app/src/components/clientapp/StartProgramSessionButton.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { startProgramSessionAction } from "@/app/app/programs/actions";

/** Opens the member's next program session in the logger (or the one already open). */
export function StartProgramSessionButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function go() {
    start(async () => {
      const r = await startProgramSessionAction();
      if (r.ok) return router.push(`/app/workouts/log/${r.sessionId}`);
      const openId = "inProgressId" in r ? r.inProgressId : undefined;
      toast.error(r.error, openId ? { action: { label: "Open it", onClick: () => router.push(`/app/workouts/log/${openId}`) } } : undefined);
    });
  }

  return (
    <Button onClick={go} loading={pending} style={{ width: "100%" }}>
      <Play size={16} /> {label}
    </Button>
  );
}
```

- [ ] **Step 3: Training days, skip and end**

```tsx
// app/src/components/clientapp/MyProgramControls.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card } from "@/components/clientapp/ui";
import { endProgramAction, setProgramDaysAction, skipProgramSessionAction } from "@/app/app/programs/actions";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

export function MyProgramControls({ canSkip, weekdays }: { canSkip: boolean; weekdays: number[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [days, setDays] = useState<number[]>(weekdays);
  const [pending, start] = useTransition();
  const changed = days.join(",") !== weekdays.join(",");

  function toggle(d: number) {
    setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)));
  }

  function saveDays() {
    start(async () => {
      const r = await setProgramDaysAction(days);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Training days saved");
      router.refresh();
    });
  }

  function skip() {
    start(async () => {
      const ok = await confirm({ title: "Skip this session?", body: "Your program moves on to the next session. The skip is recorded.", confirmLabel: "Skip it" });
      if (!ok) return;
      const r = await skipProgramSessionAction();
      if (!r.ok) return void toast.error(r.error);
      toast.success("Session skipped");
      router.refresh();
    });
  }

  function end() {
    start(async () => {
      const ok = await confirm({
        title: "End this program?",
        body: "Your sessions and the change log are kept. You can then start another program.",
        confirmLabel: "End program",
        destructive: true,
      });
      if (!ok) return;
      const r = await endProgramAction();
      if (!r.ok) return void toast.error(r.error);
      toast.success("Program ended");
      router.push("/app/programs");
      router.refresh();
    });
  }

  return (
    <Card style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div className="td-label">Days you train</div>
        <div className="td-days">
          {WEEKDAY_SHORT.map((label, i) => (
            <button key={label} type="button" className="td-day" aria-pressed={days.includes(i + 1)} onClick={() => toggle(i + 1)}>
              {label}
            </button>
          ))}
        </div>
        {changed && (
          <Button variant="secondary" onClick={saveDays} loading={pending}>
            Save training days
          </Button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: canSkip ? "1fr 1fr" : "1fr", gap: 8 }}>
        {canSkip && (
          <Button variant="secondary" onClick={skip} disabled={pending}>
            Skip next session
          </Button>
        )}
        <Button variant="secondary" onClick={end} disabled={pending}>
          End program
        </Button>
      </div>
    </Card>
  );
}
```

- [ ] **Step 4: The restart form (a finished block)**

```tsx
// app/src/components/clientapp/RestartProgramForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { restartProgramAction } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { kgToUnit } from "@/lib/programs/units";

/** New maxes, prefilled from the test day, to run the block again. */
export function RestartProgramForm({ unit, lifts }: { unit: WeightUnit; lifts: { lift: LiftKey; label: string; suggestionKg: number | null }[] }) {
  const router = useRouter();
  const [values, setValues] = useState<string[]>(lifts.map((l) => (l.suggestionKg ? String(kgToUnit(l.suggestionKg, unit)) : "")));
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const maxes = lifts.map((l, i) => ({ lift: l.lift, kind: "one_rm" as const, weight: Number(values[i].replace(",", ".")) || null, reps: null }));
      const r = await restartProgramAction({ maxes });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Started again from your new max");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {lifts.map((l, i) => (
        <label key={l.lift} style={{ display: "grid", gap: 6 }}>
          <span className="td-label">{l.label} max</span>
          <input
            className="pg-input"
            inputMode="decimal"
            aria-label={`New ${l.label.toLowerCase()} max in ${unit}`}
            placeholder={`Max in ${unit}`}
            value={values[i]}
            onChange={(e) => setValues((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
          />
        </label>
      ))}
      <Button onClick={submit} loading={pending} style={{ width: "100%" }}>
        Start again
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: The My program page**

```tsx
// app/src/app/app/programs/mine/page.tsx
import { redirect } from "next/navigation";
import { AlertTriangle, Pause } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { summarisePlanned, weekNumber } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { formatWeight } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { openSession } from "@/lib/workoutLog";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";

export const dynamic = "force-dynamic";

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

export default async function MyProgramPage() {
  const { clientId } = requireProgramsPage();
  const view = liveEnrolment(clientId);
  if (!view) redirect("/app/programs");
  const t = view.template;
  const plan = view.status === "active" ? planFor(view) : null;
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  const events = enrolmentEvents(view.id, 30);
  const today = dateKey(Date.now());
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  const startsLater = view.startDate > today ? `. Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`Week ${weekNumber(t, view.state)} of ${t.lengthWeeks}${startsLater}`}>{t.name}</PageTitle>

      {view.status === "paused" && (
        <Card style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Pause size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
          <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Paused while you&rsquo;re coach guided. Nothing is lost.</span>
        </Card>
      )}

      {plan && (
        <Card style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{inProgress ? "In progress" : "Next session"}</div>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text-primary)" }}>{sessionTitle(view, plan)}</div>
          {plan.test && (
            <div className="pg-warning">
              <AlertTriangle size={14} aria-hidden />
              <span>Test day. Work up to a new max with a spotter or safety bars.</span>
            </div>
          )}
          {plan.exercises.map((ex) => (
            <div key={ex.index} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span> {summarisePlanned(ex.sets, view.unit)}
            </div>
          ))}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </Card>
      )}

      {view.status === "active" && view.state.finished && (
        <Card style={{ display: "grid", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, color: "var(--text-primary)" }}>Program done</div>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Enter your new max to run it again, or end it and pick another.</div>
          <RestartProgramForm unit={view.unit} lifts={t.lifts.map((l) => ({ lift: l, label: LIFT_LABEL[l], suggestionKg: view.state.testMaxes[l] ?? view.state.maxes[l] ?? null }))} />
        </Card>
      )}

      {view.status === "active" && !view.state.finished && (
        <Card style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>This week</div>
          <WeekStrip days={programWeek(view)} todayKey={today} />
        </Card>
      )}

      {t.lifts.length > 0 && (
        <Card style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Your maxes</div>
          {t.lifts.map((l) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5 }}>
              <span style={{ color: "var(--text-secondary)" }}>{LIFT_LABEL[l]}</span>
              <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {view.state.maxes[l] !== undefined ? fmt(view.state.maxes[l]!) : "-"}
                {t.tmPct !== 1 && view.state.tms[l] !== undefined ? `, training max ${fmt(view.state.tms[l]!)}` : ""}
              </span>
            </div>
          ))}
        </Card>
      )}

      {view.status === "active" && <MyProgramControls canSkip={!!plan} weekdays={view.weekdays} />}

      <SectionTitle>Changes</SectionTitle>
      {events.map((e) => (
        <Card key={e.id} style={{ display: "grid", gap: 4, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {when(e.at)}, {actorLabel(e.actor, e.actorName, true)}
          </div>
          {e.reason.split("\n").map((line, i) => (
            <div key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {line}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: The My program card**

```tsx
// app/src/components/clientapp/MyProgramCard.tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { liveEnrolment, planFor, sessionTitle } from "@/lib/programs/enrolments";
import { summarisePlanned, weekNumber } from "@/lib/programs/planner";
import { openSession } from "@/lib/workoutLog";
import { Card } from "@/components/clientapp/ui";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";

/** Home and Workouts: the member's DIY program and its next session, every weight worked out. */
export function MyProgramCard({ clientId }: { clientId: number }) {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active") return null;
  const plan = planFor(view);
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  return (
    <Card style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>My program</span>
        <Link href="/app/programs/mine" style={{ fontSize: 13, color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", gap: 2 }}>
          Details <ChevronRight size={14} />
        </Link>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        {view.template.name}, week {weekNumber(view.template, view.state)} of {view.template.lengthWeeks}
      </div>
      {plan ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{sessionTitle(view, plan)}</div>
          {plan.exercises.slice(0, 4).map((ex) => (
            <div key={ex.index} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span> {summarisePlanned(ex.sets, view.unit)}
            </div>
          ))}
          {plan.exercises.length > 4 && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>And {plan.exercises.length - 4} more</div>}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </>
      ) : (
        <Link href="/app/programs/mine" style={{ fontSize: 13.5, color: "var(--accent-ink)" }}>
          Program done. Enter your new max to run it again.
        </Link>
      )}
    </Card>
  );
}
```

- [ ] **Step 7: Show the card on Home and Workouts**

In `app/src/app/app/page.tsx`:
- add imports `import { MyProgramCard } from "@/components/clientapp/MyProgramCard";` and `import { memberSeesPrograms } from "@/lib/programs/access";`
- after `  const { clientId, client, tenantId } = requireClientPage();` add `  const programsVisible = memberSeesPrograms({ tenantId, client });`
- replace `      {/* training */}` with:

```tsx
      {programsVisible && <MyProgramCard clientId={clientId} />}

      {/* training */}
```

In `app/src/app/app/workouts/page.tsx`:
- add the same two imports
- replace `  const { clientId } = requireClientPage();` with:

```tsx
  const { clientId, client, tenantId } = requireClientPage();
  const programsVisible = memberSeesPrograms({ tenantId, client });
```

- replace `      <PageTitle sub="Plan, log and track your training">Workouts</PageTitle>` with:

```tsx
      <PageTitle sub="Plan, log and track your training">Workouts</PageTitle>
      {programsVisible && <MyProgramCard clientId={clientId} />}
```

- [ ] **Step 8: Typecheck and build**

Run: `cd app && npx tsc --noEmit -p . && rm -rf .next && npx next build`
Expected: no errors; the build lists `/app/programs/mine`.

- [ ] **Step 9: Commit**

```bash
git add app/src/app/app/programs/actions.ts app/src/app/app/programs/mine/page.tsx app/src/components/clientapp/StartProgramSessionButton.tsx app/src/components/clientapp/MyProgramControls.tsx app/src/components/clientapp/RestartProgramForm.tsx app/src/components/clientapp/MyProgramCard.tsx app/src/app/app/page.tsx app/src/app/app/workouts/page.tsx
git commit -m "feat(programs): My program page and card, skip, end, days and restart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Staff client page: the DIY program panel and coach changes

**Files:**
- Create: `app/src/lib/programs/panel.ts` (pure)
- Test: `app/src/lib/programs/panel.test.ts`
- Create: `app/src/lib/programs/staffView.ts`
- Modify: `app/src/app/clients/[id]/programActions.ts` (add `coachSetMaxAction`, `coachMoveWeekAction`)
- Create: `app/src/components/clients/ClientProgramPanel.tsx`
- Modify: `app/src/app/clients/[id]/page.tsx` (the Workout log tab)
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: Task 8 (`liveEnrolment`, `listEnrolments`, `enrolmentEvents`, `planFor`, `getEnrolmentFor`, `coachSetMax`, `coachMoveToWeek`), Task 7 (`getCopy`), Task 9 (`currentStaffActor`, `programsEnabled` in the client page, `programActions.ts`), Task 11 (`actorLabel`), Task 1 (`summarisePlanned`, `weekNumber`, `formatWeight`, `kgToUnit`, `unitToKg`, `LIFT_LABEL`).
- Produces:
  - `panel.ts`: `interface PanelInput`, `interface ProgramPanelData { live: null | { enrolmentId; name; byline; status: "active" | "paused"; finished; weekLine; unit; weeks: { index; label }[]; currentWeek; lifts: { lift; label; max; tm: string | null; maxInUnit: number | null }[]; next: { title; lines: string[] } | null; events: { id; when; who; lines: string[] }[]; skipped: { when; text }[] }; past: { name; ended }[] }`, `panelFrom(input: PanelInput): ProgramPanelData`.
  - `staffView.ts`: `programPanelData(clientId): ProgramPanelData | null` (null when the member has never run a program).
  - Actions: `coachSetMaxAction(clientId, enrolmentId, lift: string, value: number)` (value in the member's unit), `coachMoveWeekAction(clientId, enrolmentId, weekIndex: number)` (0-based). Both return `{ ok: true } | { ok: false; error: string }` and log the change with the staff member's name.
  - `ClientProgramPanel({ clientId: number; data: ProgramPanelData })`.

- [ ] **Step 1: Write the failing panel test**

```ts
// app/src/lib/programs/panel.test.ts
// Run: npm test -- src/lib/programs/panel.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { panelFrom } from "./panel";
import { planSession } from "./planner";
import { platformProgram } from "./registry";

const sl = platformProgram("stronglifts-5x5")!;
const state = initState(sl, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5);
const at = Date.UTC(2026, 10, 12, 12);
const data = panelFrom({
  enrolment: { id: 9, status: "active", template: sl, state, unit: "kg", basedOnName: null },
  plan: planSession(sl, state, { stepKg: 2.5 }),
  events: [
    { id: 3, at, actor: "staff:4", actorName: "Ann Byrne", kind: "max", reason: "Ann Byrne set the squat max to 140 kg, training max 140 kg." },
    { id: 2, at, actor: "member", actorName: null, kind: "skip", reason: "Skipped Workout B, week 1." },
    { id: 1, at, actor: "engine", actorName: null, kind: "progress", reason: "Next back squat 52.5 kg. You did all 5 sets of 5.\nNext bench press 42.5 kg. You did all 5 sets of 5." },
  ],
  past: [{ name: "Starting Strength", endedAt: at }],
});
assert.ok(data.live);
const live = data.live!;
assert.equal(live.weekLine, "Week 1 of 12");
assert.equal(live.byline, "StrongLifts 5x5 by Mehdi Hadim");
assert.deepEqual(live.lifts[0], { lift: "squat", label: "Squat", max: "100 kg", tm: null, maxInUnit: 100 });
assert.deepEqual(live.next, { title: "Workout A, week 1", lines: ["Back squat 5 x 5 at 50 kg", "Bench press 5 x 5 at 40 kg", "Barbell row 5 x 5 at 35 kg"] });
assert.deepEqual(live.events.map((e) => e.who), ["Coach Ann Byrne", "Member", "Program"]);
assert.equal(live.events[2].lines.length, 2);
assert.deepEqual(live.skipped.map((s) => s.text), ["Skipped Workout B, week 1."]);
assert.deepEqual(live.weeks, [{ index: 0, label: "Week 1" }, { index: 1, label: "Week 2" }]);
assert.equal(data.past[0].name, "Starting Strength");
assert.equal(data.past[0].ended, "12 Nov 2026");

// a training max shows where the program uses one; pounds format in pounds
const bbb = platformProgram("531-bbb")!;
const b = panelFrom({ enrolment: { id: 1, status: "paused", template: bbb, state: initState(bbb, { press: 100, deadlift: 100, bench: 100, squat: 100 }, 2.5), unit: "lb", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(b.live!.status, "paused");
assert.equal(b.live!.lifts[0].max, "220.5 lb");
assert.equal(b.live!.lifts[0].tm, "198.4 lb");
assert.equal(b.live!.next, null);

// nothing live
assert.equal(panelFrom({ enrolment: null, plan: null, events: [], past: [] }).live, null);

console.log("programs/panel: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/panel.test.ts`
Expected: FAIL with `Cannot find module './panel'`.

- [ ] **Step 3: Write `panel.ts`**

```ts
// app/src/lib/programs/panel.ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { summarisePlanned, weekNumber } from "./planner";
import { LIFT_LABEL, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: { id: number; status: "active" | "paused" | "ended"; template: ProgramTemplate; state: EngineState; unit: WeightUnit; basedOnName: string | null } | null;
  plan: PlannedSession | null;
  events: { id: number; at: number; actor: string; actorName: string | null; kind: string; reason: string }[];
  past: { name: string; endedAt: number | null }[];
}

export interface ProgramPanelData {
  live: null | {
    enrolmentId: number;
    name: string;
    byline: string;
    status: "active" | "paused";
    finished: boolean;
    weekLine: string;
    unit: WeightUnit;
    weeks: { index: number; label: string }[];
    currentWeek: number;
    lifts: { lift: LiftKey; label: string; max: string; tm: string | null; maxInUnit: number | null }[];
    next: { title: string; lines: string[] } | null;
    events: { id: number; when: string; who: string; lines: string[] }[];
    skipped: { when: string; text: string }[];
  };
  past: { name: string; ended: string }[];
}

const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

export function panelFrom(input: PanelInput): ProgramPanelData {
  const past = input.past.map((p) => ({ name: p.name, ended: p.endedAt ? dayText(p.endedAt) : "-" }));
  const e = input.enrolment;
  if (!e || e.status === "ended") return { live: null, past };
  const t = e.template;
  const fmt = (kg: number) => formatWeight(kg, e.unit);
  return {
    live: {
      enrolmentId: e.id,
      name: t.name,
      byline: e.basedOnName ? `Our version, based on ${e.basedOnName}` : t.author,
      status: e.status,
      finished: e.state.finished,
      weekLine: e.state.finished ? "Block finished. Waiting for a new max." : `Week ${weekNumber(t, e.state)} of ${t.lengthWeeks}`,
      unit: e.unit,
      weeks: t.weeks.map((w, i) => ({ index: i, label: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}` })),
      currentWeek: e.state.week,
      lifts: t.lifts.map((lift) => {
        const max = e.state.maxes[lift];
        const tm = e.state.tms[lift];
        return {
          lift,
          label: LIFT_LABEL[lift],
          max: max !== undefined ? fmt(max) : "-",
          tm: t.tmPct !== 1 && tm !== undefined ? fmt(tm) : null,
          maxInUnit: max !== undefined ? kgToUnit(max, e.unit) : null,
        };
      }),
      next: input.plan
        ? { title: `${input.plan.dayName}, week ${weekNumber(t, e.state)}`, lines: input.plan.exercises.map((x) => `${x.name} ${summarisePlanned(x.sets, e.unit)}`) }
        : null,
      events: input.events.map((ev) => ({ id: ev.id, when: dayText(ev.at), who: actorLabel(ev.actor, ev.actorName, false), lines: ev.reason.split("\n") })),
      skipped: input.events.filter((ev) => ev.kind === "skip").map((ev) => ({ when: dayText(ev.at), text: ev.reason })),
    },
    past,
  };
}
```

- [ ] **Step 4: Run the panel test**

Run: `cd app && npm test -- src/lib/programs/panel.test.ts`
Expected: PASS. (100 kg is 220.5 lb; the 90% training max, 90 kg, is 198.4 lb.)

- [ ] **Step 5: Write `staffView.ts`**

```ts
// app/src/lib/programs/staffView.ts
import "server-only";

import { enrolmentEvents, listEnrolments, liveEnrolment, planFor } from "./enrolments";
import { getCopy } from "./library";
import { panelFrom, type ProgramPanelData } from "./panel";

/** The client page's DIY program panel, or null when the member has never run a program. */
export function programPanelData(clientId: number): ProgramPanelData | null {
  const live = liveEnrolment(clientId);
  const past = listEnrolments(clientId).filter((e) => e.status === "ended").slice(0, 10);
  if (!live && past.length === 0) return null;
  return panelFrom({
    enrolment: live
      ? { id: live.id, status: live.status, template: live.template, state: live.state, unit: live.unit, basedOnName: live.copyId ? (getCopy(live.copyId)?.basedOnName ?? null) : null }
      : null,
    plan: live && live.status === "active" ? planFor(live) : null,
    events: live ? enrolmentEvents(live.id, 40) : [],
    past: past.map((p) => ({ name: p.template.name, endedAt: p.endedAt })),
  });
}
```

- [ ] **Step 6: Coach actions**

In `app/src/app/clients/[id]/programActions.ts`, replace

```ts
import { setTrainingMode } from "@/lib/programs/enrolments";
```

with

```ts
import { coachMoveToWeek, coachSetMax, getEnrolmentFor, setTrainingMode } from "@/lib/programs/enrolments";
import { unitToKg } from "@/lib/programs/units";
```

and append:

```ts
const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };
const idZ = z.number().int().positive();

/** Correct a member's max. The value is in the member's unit; the change is logged with the coach's name. */
export async function coachSetMaxAction(clientId: number, enrolmentId: number, lift: string, value: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z
    .object({ clientId: idZ, enrolmentId: idZ, lift: z.enum(["squat", "bench", "deadlift", "press", "row"]), value: z.number().positive().max(1500) })
    .safeParse({ clientId, enrolmentId, lift, value });
  if (!p.success) return { ok: false, error: "Enter a max to save." };
  const view = getEnrolmentFor(p.data.clientId, p.data.enrolmentId);
  if (!view) return { ok: false, error: "That program has ended." };
  const r = coachSetMax(p.data.clientId, p.data.enrolmentId, p.data.lift, unitToKg(p.data.value, view.unit), actor);
  if (r.ok) revalidatePath(`/clients/${p.data.clientId}`);
  return r;
}

/** Move a member to the start of another week of their program (0-based). Logged with the coach's name. */
export async function coachMoveWeekAction(clientId: number, enrolmentId: number, weekIndex: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ clientId: idZ, enrolmentId: idZ, weekIndex: z.number().int().min(0).max(51) }).safeParse({ clientId, enrolmentId, weekIndex });
  if (!p.success) return { ok: false, error: "That week isn't in the program." };
  const r = coachMoveToWeek(p.data.clientId, p.data.enrolmentId, p.data.weekIndex, actor);
  if (r.ok) revalidatePath(`/clients/${p.data.clientId}`);
  return r;
}
```

- [ ] **Step 7: The panel component**

```tsx
// app/src/components/clients/ClientProgramPanel.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { coachMoveWeekAction, coachSetMaxAction } from "@/app/clients/[id]/programActions";
import type { ProgramPanelData } from "@/lib/programs/panel";

/** Staff view of a member's DIY program: where they are, their maxes, the next session, and every change with its reason. */
export function ClientProgramPanel({ clientId, data }: { clientId: number; data: ProgramPanelData }) {
  const router = useRouter();
  const live = data.live;
  const [lift, setLift] = useState(live?.lifts[0]?.lift ?? "squat");
  const [value, setValue] = useState("");
  const [weekIndex, setWeekIndex] = useState(live?.currentWeek ?? 0);
  const [pending, start] = useTransition();

  function saveMax(e: React.FormEvent) {
    e.preventDefault();
    if (!live) return;
    start(async () => {
      const r = await coachSetMaxAction(clientId, live.enrolmentId, lift, Number(value.replace(",", ".")));
      if (!r.ok) return void toast.error(r.error);
      toast.success("Max saved. The member sees the change in their log.");
      setValue("");
      router.refresh();
    });
  }

  function moveWeek(e: React.FormEvent) {
    e.preventDefault();
    if (!live) return;
    start(async () => {
      const r = await coachMoveWeekAction(clientId, live.enrolmentId, weekIndex);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Moved to week ${weekIndex + 1}.`);
      router.refresh();
    });
  }

  return (
    <section className="dp" aria-label="DIY program">
      {live ? (
        <>
          <div className="dp-head">
            <div>
              <div className="dp-eyebrow">DIY program</div>
              <h3 className="dp-title">{live.name}</h3>
              <p className="dp-sub">{live.byline}</p>
            </div>
            <span className="dp-status" data-status={live.status}>
              {live.status === "paused" ? "Paused" : live.finished ? "Finished" : "Active"}
            </span>
          </div>

          <div className="dp-tiles">
            <div className="dp-tile">
              <span className="dp-tile-label">Where they are</span>
              <span className="dp-tile-value">{live.weekLine}</span>
            </div>
            {live.lifts.map((l) => (
              <div key={l.lift} className="dp-tile">
                <span className="dp-tile-label">{l.label} max</span>
                <span className="dp-tile-value">{l.max}</span>
                {l.tm && <span className="dp-tile-label">Training max {l.tm}</span>}
              </div>
            ))}
          </div>

          {live.next && (
            <div className="dp-card">
              <div className="dp-card-title">Next session: {live.next.title}</div>
              {live.next.lines.map((line) => (
                <div key={line} className="dp-line">
                  {line}
                </div>
              ))}
            </div>
          )}

          <div className="dp-forms">
            {live.lifts.length > 0 && (
              <form className="dp-form" onSubmit={saveMax}>
                <select value={lift} onChange={(e) => setLift(e.target.value as typeof lift)} aria-label="Lift">
                  {live.lifts.map((l) => (
                    <option key={l.lift} value={l.lift}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`New max in ${live.unit}`} style={{ width: 150 }} />
                <Button type="submit" variant="secondary" loading={pending} disabled={!value.trim()}>
                  Correct max
                </Button>
              </form>
            )}
            <form className="dp-form" onSubmit={moveWeek}>
              <select value={weekIndex} onChange={(e) => setWeekIndex(Number(e.target.value))} aria-label="Week">
                {live.weeks.map((w) => (
                  <option key={w.index} value={w.index}>
                    {w.label}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" loading={pending}>
                Move to this week
              </Button>
            </form>
          </div>

          <div className="dp-card">
            <div className="dp-card-title">Skipped sessions: {live.skipped.length}</div>
            {live.skipped.map((s, i) => (
              <div key={i} className="dp-line">
                {s.when}: {s.text}
              </div>
            ))}
          </div>

          <div className="dp-card">
            <div className="dp-card-title">Change log</div>
            {live.events.length === 0 && <div className="dp-line">No changes yet.</div>}
            {live.events.map((ev) => (
              <div key={ev.id} className="dp-event">
                <span className="dp-event-meta">
                  {ev.when}, {ev.who}
                </span>
                {ev.lines.map((line, i) => (
                  <span key={i} className="dp-line">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="dp-sub">No DIY program running.</p>
      )}

      {data.past.length > 0 && (
        <div className="dp-card">
          <div className="dp-card-title">Past programs</div>
          {data.past.map((p, i) => (
            <div key={i} className="dp-line">
              {p.name}, ended {p.ended}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Wire it into the client page**

In `app/src/app/clients/[id]/page.tsx`:
- add imports `import { ClientProgramPanel } from "@/components/clients/ClientProgramPanel";` and `import { programPanelData } from "@/lib/programs/staffView";`
- replace

```ts
  const showWorkoutLog = assignedWk.length > 0 || workoutSessions.length > 0 || openWorkout !== null;
```

with

```ts
  const programPanel = programsEnabled ? programPanelData(id) : null;
  const hasProgram = programPanel !== null;
  const showWorkoutLog = assignedWk.length > 0 || workoutSessions.length > 0 || openWorkout !== null || hasProgram;
```

- replace

```tsx
            <ClientWorkoutLog sessions={workoutSessions} records={lifts} open={openWorkout} overview={training} />
```

with

```tsx
            {programPanel && <ClientProgramPanel clientId={id} data={programPanel} />}
            <ClientWorkoutLog sessions={workoutSessions} records={lifts} open={openWorkout} overview={training} />
```

(`programsEnabled` is defined in Task 9, right after `const membership = getCurrentMembership();`, which comes before `showWorkoutLog`.)

- [ ] **Step 9: Styles**

Append to `app/src/app/globals.css`:

```css
/* Staff: a member's DIY program on the client page (Workout log tab). */
.dp { display: grid; gap: 14px; margin-bottom: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--hairline); }
.dp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.dp-eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
.dp-title { margin: 2px 0 0; font-size: 18px; font-weight: 600; color: var(--text-primary); }
.dp-sub { margin: 2px 0 0; font-size: 13px; color: var(--text-tertiary); }
.dp-status { padding: 4px 10px; border-radius: var(--radius); background: var(--surface-2); font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.dp-status[data-status="active"] { color: var(--success); }
.dp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
.dp-tile { display: grid; gap: 2px; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
.dp-tile-label { font-size: 12px; color: var(--text-tertiary); }
.dp-tile-value { font-size: 15px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.dp-card { display: grid; gap: 8px; padding: 14px 16px; border: 1px solid var(--hairline); border-radius: var(--radius); background: var(--surface-1); }
.dp-card-title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
.dp-line { display: block; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
.dp-forms { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
.dp-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 14px; border: 1px solid var(--hairline); border-radius: var(--radius); }
.dp-form select { min-width: 160px; height: 36px; }
.dp-event { display: grid; gap: 2px; padding: 8px 0; border-top: 1px solid var(--hairline); }
.dp-event:first-of-type { border-top: 0; padding-top: 0; }
.dp-event-meta { font-size: 12px; color: var(--text-tertiary); }
```

- [ ] **Step 10: Typecheck and build**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/panel.test.ts && rm -rf .next && npx next build`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/programs/panel.ts app/src/lib/programs/panel.test.ts app/src/lib/programs/staffView.ts "app/src/app/clients/[id]/programActions.ts" app/src/components/clients/ClientProgramPanel.tsx "app/src/app/clients/[id]/page.tsx" app/src/app/globals.css
git commit -m "feat(programs): DIY program panel and coach changes on the client page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Workout module Program library tab: list, preview for a 100 kg lifter, and the Hide switch

**Files:**
- Create: `app/src/lib/programs/preview.ts`
- Test: `app/src/lib/programs/preview.test.ts`
- Create: `app/src/app/workout/library/actions.ts`
- Create: `app/src/app/workout/library/page.tsx`
- Create: `app/src/app/workout/library/[key]/page.tsx`
- Create: `app/src/components/workout/ProgramLibraryView.tsx`
- Create: `app/src/components/workout/ProgramPreviewTable.tsx`
- Modify: `app/src/components/layout/Sidebar.tsx` (a Program library link in the Workout group)
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: Task 2 (`initState`), Task 1 (`planExercise`, `setsFor`, `summarisePlanned`, `summariseRx`, `ENGINE_LABEL`, `FAMILY_LABEL`, `LIFT_LABEL`), Task 3 (`PLATFORM_PROGRAMS`), Task 7 (`hiddenKeys`, `setHidden`, `programByKey`), Task 9 (`currentStaffActor`; the `programs` module owns `/workout/library`, so the layout gate and the sidebar hide it where the module is off), Task 11 (`cardLine`, `toCard`, `byline`); existing `requireUser`, `PageHeader`, `Button`, `cp-back` class.
- Produces:
  - `preview.ts`: `interface PreviewRow { day: string; test: boolean; exercise: string; rx: string; example: string }`, `interface PreviewWeek { label: string; rows: PreviewRow[] }`, `previewProgram(t, maxKg?: number, stepKg?: number): PreviewWeek[]`.
  - `actions.ts` (`"use server"`): `setHiddenAction(key: string, hidden: boolean): Promise<{ ok: true } | { ok: false; error: string }>`. Task 15 adds the copy actions here.
  - `ProgramLibraryView({ rows: LibraryRow[] })` with `LibraryRow { key; name; author; family; days; weeks; engine; warning: string | null; hidden: boolean }`. Task 15 extends its props.
  - `ProgramPreviewTable({ weeks: PreviewWeek[] })` (server-safe, no hooks).
  - Routes: `/workout/library`, `/workout/library/[key]`.

- [ ] **Step 1: Write the failing preview test**

```ts
// app/src/lib/programs/preview.test.ts
// Run: npm test -- src/lib/programs/preview.test.ts
import assert from "node:assert/strict";

import { previewProgram } from "./preview";
import { platformProgram } from "./registry";

const smolov = previewProgram(platformProgram("smolov-base")!);
assert.equal(smolov.length, 4);
assert.equal(smolov[0].label, "Week 1: Base");
assert.deepEqual(smolov[0].rows[0], { day: "Day 1", test: false, exercise: "Back squat", rx: "4 x 9 at 70%", example: "4 x 9 at 70 kg" });
assert.deepEqual(smolov[1].rows[0], { day: "Day 1", test: false, exercise: "Back squat", rx: "4 x 9 at 70% + 10 kg", example: "4 x 9 at 80 kg" });
assert.equal(smolov[3].rows[0].test, true);

// 5/3/1: percentages of a 90 kg training max (90% of 100 kg)
const bbb = previewProgram(platformProgram("531-bbb")!);
assert.equal(bbb[0].rows[0].rx, "1 x 5 at 65%, then 1 x 5 at 75%, then 1 x 5+ at 85%");
assert.equal(bbb[0].rows[0].example, "1 x 5 at 57.5 kg, then 1 x 5 at 67.5 kg, then 1 x 5+ at 77.5 kg");

// linear programs show starting weights; rep-range programs leave the weight to the member
assert.equal(previewProgram(platformProgram("stronglifts-5x5")!)[0].rows[0].example, "5 x 5 at 50 kg");
assert.equal(previewProgram(platformProgram("phul")!)[0].rows[0].example, "Member picks the weight");
assert.equal(previewProgram(platformProgram("german-volume-training")!)[0].rows[1].example, "Bodyweight");

console.log("programs/preview: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/preview.test.ts`
Expected: FAIL with `Cannot find module './preview'`.

- [ ] **Step 3: Write `preview.ts`**

```ts
// app/src/lib/programs/preview.ts
/**
 * The staff preview: every week of a program as prescribed (percentages,
 * RPE, rep ranges) beside example weights for a lifter whose maxes are all
 * 100 kg. Linear programs show starting weights. Pure.
 */
import { initState } from "./engines";
import { planExercise, setsFor, summarisePlanned, summariseRx } from "./planner";
import type { LiftKey, ProgramTemplate } from "./types";

export interface PreviewRow {
  day: string;
  test: boolean;
  exercise: string;
  rx: string;
  example: string;
}

export interface PreviewWeek {
  label: string;
  rows: PreviewRow[];
}

export function previewProgram(t: ProgramTemplate, maxKg = 100, stepKg = 2.5): PreviewWeek[] {
  const maxes: Partial<Record<LiftKey, number>> = Object.fromEntries(t.lifts.map((l) => [l, maxKg]));
  const base = initState(t, maxes, stepKg);
  return t.weeks.map((w, wi) => ({
    label: w.label ? `Week ${wi + 1}: ${w.label}` : `Week ${wi + 1}`,
    rows: w.days.flatMap((d, di) =>
      d.exercises.map((ex, xi) => {
        const planned = planExercise(ex, xi, { ...base, week: wi, day: di }, { stepKg });
        const example = planned.bodyweight ? "Bodyweight" : planned.sets.some((s) => s.kg !== null) ? summarisePlanned(planned.sets, "kg") : "Member picks the weight";
        return { day: d.name, test: d.test === true, exercise: ex.name, rx: summariseRx(setsFor(ex, base.stages)), example };
      }),
    ),
  }));
}
```

- [ ] **Step 4: Run the preview test**

Run: `cd app && npm test -- src/lib/programs/preview.test.ts`
Expected: PASS. (90 x 0.65 = 58.5 rounds to 57.5; 90 x 0.85 = 76.5 rounds to 77.5.)

- [ ] **Step 5: The hide action**

```ts
// app/src/app/workout/library/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setHidden } from "@/lib/programs/library";
import { currentStaffActor } from "@/lib/programs/staffActor";

type Result = { ok: true } | { ok: false; error: string };
const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };

/** Hide a platform program from this gym's members, or show it again. */
export async function setHiddenAction(key: string, hidden: boolean): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ key: z.string().min(1).max(80), hidden: z.boolean() }).safeParse({ key, hidden });
  if (!p.success || !setHidden(p.data.key, p.data.hidden, actor.userId)) return { ok: false, error: "That program isn't in the library." };
  revalidatePath("/workout/library");
  return { ok: true };
}
```

- [ ] **Step 6: The library page and list**

```tsx
// app/src/app/workout/library/page.tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramLibraryView, type LibraryRow } from "@/components/workout/ProgramLibraryView";
import { requireUser } from "@/lib/auth";
import { hiddenKeys } from "@/lib/programs/library";
import { PLATFORM_PROGRAMS } from "@/lib/programs/registry";
import { ENGINE_LABEL, FAMILY_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramLibraryPage() {
  await requireUser();
  const hidden = hiddenKeys();
  const rows: LibraryRow[] = PLATFORM_PROGRAMS.map((t) => ({
    key: t.key,
    name: t.name,
    author: t.author,
    family: FAMILY_LABEL[t.family],
    days: t.daysPerWeek,
    weeks: t.lengthWeeks,
    engine: ENGINE_LABEL[t.engine.key],
    warning: t.warning ?? null,
    hidden: hidden.has(t.key),
  }));
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Program library"
        subtitle="Well-known programs your DIY members can run on their own, with every weight worked out from their maxes. Hide any you don't want offered."
      />
      <ProgramLibraryView rows={rows} />
    </div>
  );
}
```

```tsx
// app/src/components/workout/ProgramLibraryView.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

import { setHiddenAction } from "@/app/workout/library/actions";

export interface LibraryRow {
  key: string;
  name: string;
  author: string;
  family: string;
  days: number;
  weeks: number;
  engine: string;
  warning: string | null;
  hidden: boolean;
}

/** Every platform program, with a preview and a switch for whether members see it. */
export function ProgramLibraryView({ rows }: { rows: LibraryRow[] }) {
  const [hidden, setHiddenState] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, r.hidden])));
  const [pending, start] = useTransition();

  function toggle(key: string) {
    const next = !hidden[key];
    start(async () => {
      const r = await setHiddenAction(key, next);
      if (!r.ok) return void toast.error(r.error);
      setHiddenState((h) => ({ ...h, [key]: next }));
      toast.success(next ? "Hidden from members" : "Shown to members");
    });
  }

  return (
    <div className="pl">
      <div className="pl-table" role="table" aria-label="Program library">
        <div className="pl-row pl-row--head" role="row">
          <span role="columnheader">Program</span>
          <span role="columnheader">Goal</span>
          <span role="columnheader">Days</span>
          <span role="columnheader">Weeks</span>
          <span role="columnheader">Members see it</span>
          <span role="columnheader" />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="pl-row" role="row">
            <span role="cell" className="pl-name">
              <b>{r.name}</b>
              <small>
                {r.author}. {r.engine}.
              </small>
              {r.warning && (
                <small className="pl-warning">
                  <AlertTriangle size={12} aria-hidden /> {r.warning}
                </small>
              )}
            </span>
            <span role="cell">{r.family}</span>
            <span role="cell">{r.days}</span>
            <span role="cell">{r.weeks}</span>
            <span role="cell">
              <button
                type="button"
                role="switch"
                className="pl-switch"
                aria-checked={!hidden[r.key]}
                aria-label={`${r.name}: ${hidden[r.key] ? "hidden from members" : "shown to members"}`}
                disabled={pending}
                onClick={() => toggle(r.key)}
              >
                <span className="pl-switch-knob" />
              </button>
            </span>
            <span role="cell" className="pl-actions">
              <Link href={`/workout/library/${encodeURIComponent(r.key)}`} className="pl-link">
                <Eye size={14} /> Preview
              </Link>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: The preview page and table**

```tsx
// app/src/components/workout/ProgramPreviewTable.tsx
import type { PreviewWeek } from "@/lib/programs/preview";

/** Week by week: what the program prescribes, and what that is for a lifter whose maxes are 100 kg. */
export function ProgramPreviewTable({ weeks }: { weeks: PreviewWeek[] }) {
  return (
    <div className="pv">
      {weeks.map((w) => (
        <section key={w.label} className="pv-week">
          <h3 className="pv-week-title">{w.label}</h3>
          <div className="pv-table" role="table" aria-label={w.label}>
            <div className="pv-row pv-row--head" role="row">
              <span role="columnheader">Day</span>
              <span role="columnheader">Exercise</span>
              <span role="columnheader">Prescribed</span>
              <span role="columnheader">For a 100 kg lifter</span>
            </div>
            {w.rows.map((r, i) => (
              <div key={i} className="pv-row" role="row" data-test={r.test}>
                <span role="cell">{i === 0 || w.rows[i - 1].day !== r.day ? r.day : ""}</span>
                <span role="cell">{r.exercise}</span>
                <span role="cell">{r.rx}</span>
                <span role="cell">{r.example}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

```tsx
// app/src/app/workout/library/[key]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramPreviewTable } from "@/components/workout/ProgramPreviewTable";
import { requireUser } from "@/lib/auth";
import { byline, cardLine, toCard } from "@/lib/programs/cards";
import { programByKey } from "@/lib/programs/library";
import { previewProgram } from "@/lib/programs/preview";
import { ENGINE_LABEL, LIFT_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramPreviewPage(props: { params: Promise<{ key: string }> }) {
  await requireUser();
  const { key } = await props.params;
  const entry = programByKey(decodeURIComponent(key), { includeHidden: true });
  if (!entry) notFound();
  const t = entry.template;
  const card = toCard(t, entry.basedOnName);
  return (
    <div className="app-page">
      <Link href="/workout/library" className="cp-back">
        <ArrowLeft size={14} /> Program library
      </Link>
      <PageHeader eyebrow={byline(card)} title={t.name} subtitle={`${cardLine(card)}. ${card.levelLabel} level. ${ENGINE_LABEL[t.engine.key]}.`} />
      <div className="pv-meta">
        <p>{t.description}</p>
        <p>{t.who}</p>
        {t.warning && (
          <p className="pl-warning">
            <AlertTriangle size={14} aria-hidden /> {t.warning}
          </p>
        )}
        {t.lifts.length > 0 && (
          <p>
            Members give a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.
            {t.tmPct !== 1 ? ` Percentages are of a training max set at ${Math.round(t.tmPct * 1000) / 10}% of that max.` : ""}
          </p>
        )}
        {entry.hidden && <p>Hidden from your members.</p>}
      </div>
      <ProgramPreviewTable weeks={previewProgram(t)} />
    </div>
  );
}
```

- [ ] **Step 8: The sidebar link**

In `app/src/components/layout/Sidebar.tsx`, in the Workout group, replace

```tsx
          { href: "/workout/circuits", label: "Circuits", icon: Dumbbell },
```

with

```tsx
          { href: "/workout/circuits", label: "Circuits", icon: Dumbbell },
          // The programs module owns this path, so pathAllowed hides it where Programs is off.
          { href: "/workout/library", label: "Program library", icon: Dumbbell },
```

- [ ] **Step 9: Styles**

Append to `app/src/app/globals.css`:

```css
/* Staff: the program library (Workout > Program library) and its preview. */
.pl-table, .pv-table { border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; background: var(--surface-1); }
.pl-row { display: grid; grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr) 60px 60px 130px 150px; gap: 12px; align-items: center; padding: 12px 16px; border-top: 1px solid var(--hairline); font-size: 13.5px; color: var(--text-secondary); }
.pl-row--head { border-top: 0; padding-top: 10px; padding-bottom: 10px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); background: var(--surface-2); }
.pl-name { display: grid; gap: 2px; min-width: 0; }
.pl-name b { color: var(--text-primary); font-weight: 600; }
.pl-name small { font-size: 12px; color: var(--text-tertiary); }
.pl-warning { display: inline-flex; align-items: flex-start; gap: 5px; color: var(--text-secondary); }
.pl-warning svg { flex-shrink: 0; margin-top: 2px; color: var(--danger); }
.pl-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.pl-link { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: var(--radius); font-size: 12.5px; color: var(--text-primary); text-decoration: none; background: transparent; cursor: pointer; font-family: inherit; }
.pl-link:hover { background: var(--surface-2); }
.pl-switch { position: relative; width: 40px; height: 24px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface-2); cursor: pointer; padding: 0; }
.pl-switch[aria-checked="true"] { background: var(--accent); border-color: var(--accent); }
.pl-switch-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--text-primary); transition: transform 0.15s ease; }
.pl-switch[aria-checked="true"] .pl-switch-knob { transform: translateX(16px); background: var(--accent-contrast); }
.pl-switch:disabled { opacity: 0.6; cursor: default; }
.pv { display: grid; gap: 22px; }
.pv-meta { display: grid; gap: 6px; max-width: 75ch; margin-bottom: 22px; font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); }
.pv-meta p { margin: 0; }
.pv-week-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.pv-row { display: grid; grid-template-columns: 140px minmax(0, 1.2fr) minmax(0, 1.6fr) minmax(0, 1.6fr); gap: 12px; padding: 9px 16px; border-top: 1px solid var(--hairline); font-size: 13px; color: var(--text-secondary); }
.pv-row--head { border-top: 0; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); background: var(--surface-2); }
.pv-row[data-test="true"] { background: color-mix(in srgb, var(--accent) 7%, transparent); }
@media (max-width: 900px) {
  .pl-row { grid-template-columns: minmax(0, 1fr) auto; }
  .pl-row > :nth-child(2), .pl-row > :nth-child(3), .pl-row > :nth-child(4) { display: none; }
  .pl-row--head { display: none; }
  .pl-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .pv-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .pv-row > :first-child { grid-column: 1 / -1; font-weight: 600; color: var(--text-primary); }
}
```

- [ ] **Step 10: Typecheck and build**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/preview.test.ts && npm test -- src/lib/features.test.ts && rm -rf .next && npx next build`
Expected: no errors; the build lists `/workout/library` and `/workout/library/[key]`.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/programs/preview.ts app/src/lib/programs/preview.test.ts app/src/app/workout/library/actions.ts app/src/app/workout/library/page.tsx "app/src/app/workout/library/[key]/page.tsx" app/src/components/workout/ProgramLibraryView.tsx app/src/components/workout/ProgramPreviewTable.tsx app/src/components/layout/Sidebar.tsx app/src/app/globals.css
git commit -m "feat(programs): Program library tab with previews and hide switches

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Gym copies: "Make our version", the copy editor, and the copies list

**Files:**
- Create: `app/src/lib/programs/editing.ts` (pure helpers for the editor)
- Test: `app/src/lib/programs/editing.test.ts`
- Modify: `app/src/app/workout/library/actions.ts` (add `makeCopyAction`, `saveCopyAction`, `deleteCopyAction`)
- Create: `app/src/app/workout/library/copies/[id]/page.tsx`
- Create: `app/src/components/workout/ProgramCopyEditor.tsx`
- Modify: `app/src/components/workout/ProgramLibraryView.tsx` (replace the whole file)
- Modify: `app/src/app/workout/library/page.tsx` (pass the copies)
- Modify: `app/src/app/globals.css` (append)

**Interfaces:**
- Consumes: Task 7 (`makeCopy`, `saveCopy`, `deleteCopy`, `getCopy`, `listCopies`, `copyKey`), Task 3 (`platformProgram`, `validateTemplate`), Task 1 (`schemeLabel`, `LIFT_LABEL`, `ENGINE_LABEL`, types), Task 14 (`setHiddenAction`, `LibraryRow`, the `pl-*` styles), Task 9 (`currentStaffActor`); existing `Button`, `Input`, `Textarea`, `useConfirm`, `PageHeader`, `requireUser`.
- Produces:
  - `editing.ts`: `SET_KINDS: { value: SetRx["kind"]; label: string }[]`, `repsMin(r: Reps): number`, `repsMax(r: Reps): number | null`, `withReps(min: number, max: number | null): Reps`, `convertSet(s: SetRx, kind: SetRx["kind"]): SetRx`, `blankExercise(): ExerciseRx`.
  - Actions: `makeCopyAction(key: string): Promise<{ ok: true; id: number } | { ok: false; error: string }>`, `saveCopyAction(id: number, template: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }>`, `deleteCopyAction(id: number): Promise<{ ok: true } | { ok: false; error: string }>`.
  - `ProgramLibraryView({ rows: LibraryRow[]; copies: CopyListRow[] })`, `CopyListRow { id: number; name: string; basedOnName: string; updatedAt: number }`.
  - `ProgramCopyEditor({ id: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean })`.
  - Route `/workout/library/copies/[id]`. Members already see copies through `memberPrograms()` (Task 7) on the Programs tab (Task 11); a copy's key is `copy-<id>`.

- [ ] **Step 1: Write the failing editing test**

```ts
// app/src/lib/programs/editing.test.ts
// Run: npm test -- src/lib/programs/editing.test.ts
import assert from "node:assert/strict";

import { fixed, pct, range } from "./dsl";
import { blankExercise, convertSet, repsMax, repsMin, withReps } from "./editing";
import { platformProgram } from "./registry";
import { validateTemplate } from "./validate";

assert.deepEqual(convertSet(pct(0.7, 5, 180), "rpe"), { kind: "rpe", rpe: 8, reps: 5, rest: 180 });
assert.deepEqual(convertSet(fixed(range(8, 12), 90), "pct"), { kind: "pct", pct: 0.7, reps: 8, rest: 90 });
assert.deepEqual(convertSet({ kind: "amrap", pct: 0.85, reps: 5, rest: 180 }, "pct"), { kind: "pct", pct: 0.85, reps: 5, rest: 180 });
assert.deepEqual(convertSet(pct(0.8, 3, 120), "fixed"), { kind: "fixed", reps: 3, rest: 120 });
assert.deepEqual(convertSet(fixed(range(8, 12), 90), "same_as_last"), { kind: "same_as_last", reps: { min: 8, max: 12 }, rest: 90 });

assert.equal(repsMin(range(8, 12)), 8);
assert.equal(repsMax(range(8, 12)), 12);
assert.equal(repsMax(5), null);
assert.deepEqual(withReps(8, 12), { min: 8, max: 12 });
assert.equal(withReps(8, null), 8);
assert.equal(withReps(8, 6), 8, "a top below the bottom is dropped");

assert.equal(blankExercise().name, "Back squat");

// an edited Smolov still passes the template check
const t = structuredClone(platformProgram("smolov-base")!);
t.name = "Our Smolov";
t.weeks[0].days[0].exercises[0].sets = t.weeks[0].days[0].exercises[0].sets.map((s) => convertSet(s, "amrap"));
t.weeks[0].days.push({ name: "Day 5", exercises: [{ ...blankExercise(), lift: "squat", sets: [pct(0.6, 5, 120)] }] });
assert.ok(validateTemplate(t).ok);

console.log("programs/editing: ok");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd app && npm test -- src/lib/programs/editing.test.ts`
Expected: FAIL with `Cannot find module './editing'`.

- [ ] **Step 3: Write `editing.ts`**

```ts
// app/src/lib/programs/editing.ts
/** Helpers for the gym-copy editor. Pure. */
import type { ExerciseRx, Reps, SetRx } from "./types";

export const SET_KINDS: { value: SetRx["kind"]; label: string }[] = [
  { value: "pct", label: "% of training max" },
  { value: "amrap", label: "% and as many as you can" },
  { value: "rpe", label: "RPE target" },
  { value: "fixed", label: "Weight from progression" },
  { value: "same_as_last", label: "Same as the set before" },
];

export function repsMin(r: Reps): number {
  return typeof r === "number" ? r : r.min;
}

export function repsMax(r: Reps): number | null {
  return typeof r === "number" ? null : r.max;
}

/** A plain rep count, or a range when the top is above the bottom. */
export function withReps(min: number, max: number | null): Reps {
  return max !== null && max > min ? { min, max } : min;
}

/** Change a set's type, keeping its reps, rest and percentage where they still make sense. */
export function convertSet(s: SetRx, kind: SetRx["kind"]): SetRx {
  const reps = repsMin(s.reps);
  const p = s.kind === "pct" || s.kind === "amrap" ? s.pct : 0.7;
  switch (kind) {
    case "pct":
      return { kind: "pct", pct: p, reps, rest: s.rest };
    case "amrap":
      return { kind: "amrap", pct: p, reps, rest: s.rest };
    case "rpe":
      return { kind: "rpe", rpe: 8, reps, rest: s.rest };
    case "fixed":
      return { kind: "fixed", reps: s.reps, rest: s.rest };
    case "same_as_last":
      return { kind: "same_as_last", reps: s.reps, rest: s.rest };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export function blankExercise(): ExerciseRx {
  return { name: "Back squat", sets: [{ kind: "fixed", reps: 5, rest: 120 }] };
}
```

- [ ] **Step 4: Run the editing test**

Run: `cd app && npm test -- src/lib/programs/editing.test.ts`
Expected: PASS.

- [ ] **Step 5: The copy actions**

In `app/src/app/workout/library/actions.ts`, replace

```ts
import { setHidden } from "@/lib/programs/library";
```

with

```ts
import { deleteCopy, makeCopy, saveCopy, setHidden } from "@/lib/programs/library";
```

and append:

```ts
const idZ = z.number().int().positive();

/** "Make our version": copy a platform program into this gym's own library. */
export async function makeCopyAction(key: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const k = z.string().min(1).max(80).safeParse(key);
  const id = k.success ? makeCopy(k.data, actor.userId) : null;
  if (!id) return { ok: false, error: "That program isn't in the library." };
  revalidatePath("/workout/library");
  return { ok: true, id };
}

/** Save the editor. Refused, with the reasons, if it breaks the template check or drops a lift the engine needs. */
export async function saveCopyAction(id: number, template: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false, errors: [OFF.error] };
  const i = idZ.safeParse(id);
  if (!i.success) return { ok: false, errors: ["That version no longer exists."] };
  const r = saveCopy(i.data, template);
  if (r.ok) {
    revalidatePath("/workout/library");
    revalidatePath(`/workout/library/copies/${i.data}`);
  }
  return r;
}

/** Delete a gym version. Members already running it keep their own snapshot. */
export async function deleteCopyAction(id: number): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const i = idZ.safeParse(id);
  if (!i.success || !deleteCopy(i.data)) return { ok: false, error: "That version no longer exists." };
  revalidatePath("/workout/library");
  return { ok: true };
}
```

- [ ] **Step 6: Replace `ProgramLibraryView.tsx` with the version that knows about copies**

```tsx
// app/src/components/workout/ProgramLibraryView.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { deleteCopyAction, makeCopyAction, setHiddenAction } from "@/app/workout/library/actions";

export interface LibraryRow {
  key: string;
  name: string;
  author: string;
  family: string;
  days: number;
  weeks: number;
  engine: string;
  warning: string | null;
  hidden: boolean;
}

export interface CopyListRow {
  id: number;
  name: string;
  basedOnName: string;
  updatedAt: number;
}

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** The gym's own versions, then every platform program with a preview, "Make our version" and a switch for whether members see it. */
export function ProgramLibraryView({ rows, copies }: { rows: LibraryRow[]; copies: CopyListRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [hidden, setHiddenState] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, r.hidden])));
  const [pending, start] = useTransition();

  function toggle(key: string) {
    const next = !hidden[key];
    start(async () => {
      const r = await setHiddenAction(key, next);
      if (!r.ok) return void toast.error(r.error);
      setHiddenState((h) => ({ ...h, [key]: next }));
      toast.success(next ? "Hidden from members" : "Shown to members");
    });
  }

  function copy(key: string) {
    start(async () => {
      const r = await makeCopyAction(key);
      if (!r.ok) return void toast.error(r.error);
      router.push(`/workout/library/copies/${r.id}`);
    });
  }

  function remove(c: CopyListRow) {
    start(async () => {
      const ok = await confirm({
        title: `Delete ${c.name}?`,
        body: "Members already running it keep going with their own copy. No one new can start it.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      const r = await deleteCopyAction(c.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Deleted");
      router.refresh();
    });
  }

  return (
    <div className="pl">
      {copies.length > 0 && (
        <section className="pl-copies">
          <h2 className="pl-section-title">Your versions</h2>
          <div className="pl-table" role="table" aria-label="Your versions">
            {copies.map((c) => (
              <div key={c.id} className="pl-row pl-row--copy" role="row">
                <span role="cell" className="pl-name">
                  <b>{c.name}</b>
                  <small>
                    Our version, based on {c.basedOnName}. Changed {day(c.updatedAt)}.
                  </small>
                </span>
                <span role="cell" className="pl-actions">
                  <Link href={`/workout/library/copies/${c.id}`} className="pl-link">
                    <Pencil size={14} /> Edit
                  </Link>
                  <Link href={`/workout/library/copy-${c.id}`} className="pl-link">
                    <Eye size={14} /> Preview
                  </Link>
                  <button type="button" className="pl-link" onClick={() => remove(c)} disabled={pending} aria-label={`Delete ${c.name}`}>
                    <Trash2 size={14} /> Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="pl-section-title">Platform programs</h2>
      <div className="pl-table" role="table" aria-label="Program library">
        <div className="pl-row pl-row--head" role="row">
          <span role="columnheader">Program</span>
          <span role="columnheader">Goal</span>
          <span role="columnheader">Days</span>
          <span role="columnheader">Weeks</span>
          <span role="columnheader">Members see it</span>
          <span role="columnheader" />
        </div>
        {rows.map((r) => (
          <div key={r.key} className="pl-row" role="row">
            <span role="cell" className="pl-name">
              <b>{r.name}</b>
              <small>
                {r.author}. {r.engine}.
              </small>
              {r.warning && (
                <small className="pl-warning">
                  <AlertTriangle size={12} aria-hidden /> {r.warning}
                </small>
              )}
            </span>
            <span role="cell">{r.family}</span>
            <span role="cell">{r.days}</span>
            <span role="cell">{r.weeks}</span>
            <span role="cell">
              <button
                type="button"
                role="switch"
                className="pl-switch"
                aria-checked={!hidden[r.key]}
                aria-label={`${r.name}: ${hidden[r.key] ? "hidden from members" : "shown to members"}`}
                disabled={pending}
                onClick={() => toggle(r.key)}
              >
                <span className="pl-switch-knob" />
              </button>
            </span>
            <span role="cell" className="pl-actions">
              <Link href={`/workout/library/${encodeURIComponent(r.key)}`} className="pl-link">
                <Eye size={14} /> Preview
              </Link>
              <button type="button" className="pl-link" onClick={() => copy(r.key)} disabled={pending}>
                <Copy size={14} /> Make our version
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

In `app/src/app/workout/library/page.tsx`, change the library import to `import { hiddenKeys, listCopies } from "@/lib/programs/library";`, and replace `<ProgramLibraryView rows={rows} />` with:

```tsx
      <ProgramLibraryView rows={rows} copies={listCopies().map((c) => ({ id: c.id, name: c.name, basedOnName: c.basedOnName, updatedAt: c.updatedAt }))} />
```

Also change `.pl-row` actions column width: in the CSS appended in Step 9, `.pl-row` gets a wider last column.

- [ ] **Step 7: The editor**

```tsx
// app/src/components/workout/ProgramCopyEditor.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { saveCopyAction } from "@/app/workout/library/actions";
import { SET_KINDS, blankExercise, convertSet, repsMax, repsMin, withReps } from "@/lib/programs/editing";
import { CANONICAL_EXERCISES } from "@/lib/programs/exercises";
import { schemeLabel } from "@/lib/programs/planner";
import { LIFT_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type SetRx } from "@/lib/programs/types";

const num = (v: string, fallback: number) => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : fallback;
};

function ExerciseEditor({
  ex,
  lifts,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  ex: ExerciseRx;
  lifts: LiftKey[];
  first: boolean;
  last: boolean;
  onChange: (fn: (e: ExerciseRx) => void) => void;
  onRemove?: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const known = CANONICAL_EXERCISES.some((c) => c.name === ex.name);
  return (
    <div className="pe-ex">
      <div className="pe-ex-head">
        <select value={ex.name} aria-label="Exercise" onChange={(e) => onChange((x) => void (x.name = e.target.value))}>
          {!known && <option value={ex.name}>{ex.name}</option>}
          {CANONICAL_EXERCISES.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={ex.lift ?? ""} aria-label="The max it uses" onChange={(e) => onChange((x) => void (x.lift = (e.target.value || undefined) as LiftKey | undefined))}>
          <option value="">No max</option>
          {lifts.map((l) => (
            <option key={l} value={l}>
              {LIFT_LABEL[l]} max
            </option>
          ))}
        </select>
        <div className="pe-ex-tools">
          <button type="button" className="pe-icon" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="pe-icon" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
            <ArrowDown size={14} />
          </button>
          {onRemove && (
            <button type="button" className="pe-icon" aria-label={`Remove ${ex.name}`} onClick={onRemove}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <Input value={ex.notes ?? ""} placeholder="Notes for the member (optional)" onChange={(e) => onChange((x) => void (x.notes = e.target.value || undefined))} />
      {ex.stages && ex.stages.length > 0 ? (
        <p className="pe-hint">Rep schemes set by the progression: {ex.stages.map((s) => schemeLabel(s)).join(", then ")}.</p>
      ) : (
        <div className="pe-sets">
          <div className="pe-set pe-set--head" aria-hidden>
            <span>Set</span>
            <span>Type</span>
            <span>Load</span>
            <span>Reps</span>
            <span>Up to</span>
            <span>Rest (s)</span>
            <span />
          </div>
          {ex.sets.map((s, si) => (
            <div key={si} className="pe-set">
              <span className="pe-setno">{si + 1}</span>
              <select value={s.kind} aria-label={`Set ${si + 1} type`} onChange={(e) => onChange((x) => void (x.sets[si] = convertSet(x.sets[si], e.target.value as SetRx["kind"])))}>
                {SET_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <span className="pe-load">
                {(s.kind === "pct" || s.kind === "amrap") && (
                  <>
                    <Input
                      type="number"
                      step="0.5"
                      aria-label={`Set ${si + 1} percentage`}
                      value={Math.round(s.pct * 1000) / 10}
                      onChange={(e) =>
                        onChange((x) => {
                          const cur = x.sets[si];
                          if (cur.kind === "pct" || cur.kind === "amrap") cur.pct = num(e.target.value, cur.pct * 100) / 100;
                        })
                      }
                    />
                    <span className="pe-muted">%{s.addKg ? ` + ${s.addKg} kg` : ""}</span>
                  </>
                )}
                {s.kind === "rpe" && (
                  <>
                    <span className="pe-muted">RPE</span>
                    <Input
                      type="number"
                      step="0.5"
                      min={5}
                      max={10}
                      aria-label={`Set ${si + 1} RPE`}
                      value={s.rpe}
                      onChange={(e) =>
                        onChange((x) => {
                          const cur = x.sets[si];
                          if (cur.kind === "rpe") cur.rpe = Math.max(5, Math.min(10, num(e.target.value, cur.rpe)));
                        })
                      }
                    />
                  </>
                )}
                {s.kind === "fixed" && <span className="pe-muted">From progression{s.amrap ? ", as many as you can" : ""}</span>}
                {s.kind === "same_as_last" && <span className="pe-muted">As the set before</span>}
              </span>
              <Input
                type="number"
                min={1}
                aria-label={`Set ${si + 1} reps`}
                value={repsMin(s.reps)}
                onChange={(e) =>
                  onChange((x) => {
                    const cur = x.sets[si];
                    const min = Math.max(1, Math.round(num(e.target.value, repsMin(cur.reps))));
                    if (cur.kind === "fixed" || cur.kind === "same_as_last") cur.reps = withReps(min, repsMax(cur.reps));
                    else cur.reps = min;
                  })
                }
              />
              {s.kind === "fixed" || s.kind === "same_as_last" ? (
                <Input
                  type="number"
                  min={1}
                  aria-label={`Set ${si + 1} top of the rep range`}
                  placeholder="-"
                  value={repsMax(s.reps) ?? ""}
                  onChange={(e) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "fixed" || cur.kind === "same_as_last") cur.reps = withReps(repsMin(cur.reps), e.target.value ? Math.round(num(e.target.value, 0)) : null);
                    })
                  }
                />
              ) : (
                <span />
              )}
              <Input
                type="number"
                min={0}
                max={900}
                step={15}
                aria-label={`Set ${si + 1} rest in seconds`}
                value={s.rest}
                onChange={(e) => onChange((x) => void (x.sets[si].rest = Math.max(0, Math.min(900, Math.round(num(e.target.value, x.sets[si].rest))))))}
              />
              <button type="button" className="pe-icon" aria-label={`Remove set ${si + 1}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => void x.sets.splice(si, 1))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="pl-link" style={{ justifySelf: "start" }} onClick={() => onChange((x) => void x.sets.push({ ...x.sets[x.sets.length - 1] }))}>
            <Plus size={14} /> Add set
          </button>
        </div>
      )}
    </div>
  );
}

/** Weeks, then days, then exercises, then set rows, in the style of the Detailed builder. */
export function ProgramCopyEditor({ id, initial, lifts, engineLabel, isBlock }: { id: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean }) {
  const router = useRouter();
  const [t, setT] = useState<ProgramTemplate>(initial);
  const [wi, setWi] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];

  function edit(fn: (draft: ProgramTemplate) => void) {
    setT((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  function save() {
    start(async () => {
      const r = await saveCopyAction(id, t);
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Not saved. See what needs fixing at the top.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setErrors([]);
      toast.success("Saved. Members who start this version from now on get these changes.");
      router.refresh();
    });
  }

  return (
    <div className="pe">
      {errors.length > 0 && (
        <div className="pe-errors" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="pe-card">
        <div className="pe-grid">
          <label className="pe-field">
            <span>Name</span>
            <Input value={t.name} onChange={(e) => edit((d) => void (d.name = e.target.value))} />
          </label>
          <label className="pe-field">
            <span>Who it is for</span>
            <Input value={t.who} onChange={(e) => edit((d) => void (d.who = e.target.value))} />
          </label>
          <label className="pe-field">
            <span>Warning line (optional)</span>
            <Input value={t.warning ?? ""} onChange={(e) => edit((d) => void (d.warning = e.target.value || undefined))} />
          </label>
          <label className="pe-field">
            <span>Days a week</span>
            <select value={t.daysPerWeek} onChange={(e) => edit((d) => void (d.daysPerWeek = Number(e.target.value)))}>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="pe-field">
            <span>Length in weeks</span>
            <Input type="number" min={1} max={52} value={t.lengthWeeks} onChange={(e) => edit((d) => void (d.lengthWeeks = Math.max(1, Math.min(52, Math.round(num(e.target.value, d.lengthWeeks))))))} />
          </label>
        </div>
        <label className="pe-field">
          <span>Description</span>
          <Textarea rows={3} value={t.description} onChange={(e) => edit((d) => void (d.description = e.target.value))} />
        </label>
        <p className="pe-hint">
          Progression: {engineLabel}. It stays the original&rsquo;s.
          {lifts.length > 0 ? ` Keep at least one exercise using each of these maxes: ${lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.` : ""}
        </p>
      </section>

      <div className="pe-weeks" role="tablist" aria-label="Weeks">
        {t.weeks.map((_, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === w} className="pe-tab" onClick={() => setWi(i)}>
            Week {i + 1}
          </button>
        ))}
        <button
          type="button"
          className="pe-tab"
          onClick={() => {
            edit((d) => void d.weeks.splice(w + 1, 0, structuredClone(d.weeks[w])));
            setWi(w + 1);
          }}
        >
          <Plus size={14} /> Copy this week
        </button>
        {t.weeks.length > 1 && (
          <button
            type="button"
            className="pe-tab"
            onClick={() => {
              edit((d) => void d.weeks.splice(w, 1));
              setWi(Math.max(0, w - 1));
            }}
          >
            <Trash2 size={14} /> Remove this week
          </button>
        )}
      </div>
      <label className="pe-field" style={{ maxWidth: 360 }}>
        <span>Week {w + 1} label (optional)</span>
        <Input value={week.label ?? ""} onChange={(e) => edit((d) => void (d.weeks[w].label = e.target.value || undefined))} />
      </label>

      {week.days.map((dayRx, di) => (
        <section key={`${w}-${di}`} className="pe-card">
          <div className="pe-day-head">
            <Input aria-label="Day name" value={dayRx.name} onChange={(e) => edit((d) => void (d.weeks[w].days[di].name = e.target.value))} style={{ maxWidth: 280 }} />
            {isBlock && (
              <label className="pe-check">
                <input type="checkbox" checked={dayRx.test === true} onChange={(e) => edit((d) => void (d.weeks[w].days[di].test = e.target.checked || undefined))} /> Test day
              </label>
            )}
            {week.days.length > 1 && (
              <Button variant="ghost" onClick={() => edit((d) => void d.weeks[w].days.splice(di, 1))}>
                <Trash2 size={14} /> Remove day
              </Button>
            )}
          </div>
          {dayRx.exercises.map((ex, xi) => (
            <ExerciseEditor
              key={xi}
              ex={ex}
              lifts={lifts}
              first={xi === 0}
              last={xi === dayRx.exercises.length - 1}
              onChange={(fn) => edit((d) => fn(d.weeks[w].days[di].exercises[xi]))}
              onRemove={dayRx.exercises.length > 1 ? () => edit((d) => void d.weeks[w].days[di].exercises.splice(xi, 1)) : undefined}
              onMove={(dir) =>
                edit((d) => {
                  const list = d.weeks[w].days[di].exercises;
                  const j = xi + dir;
                  if (j < 0 || j >= list.length) return;
                  [list[xi], list[j]] = [list[j], list[xi]];
                })
              }
            />
          ))}
          <Button variant="secondary" onClick={() => edit((d) => void d.weeks[w].days[di].exercises.push(blankExercise()))}>
            <Plus size={14} /> Add exercise
          </Button>
        </section>
      ))}

      <Button variant="secondary" onClick={() => edit((d) => void d.weeks[w].days.push({ name: `Day ${week.days.length + 1}`, exercises: [blankExercise()] }))}>
        <Plus size={14} /> Add day
      </Button>

      <div className="pe-save">
        <Button onClick={save} loading={pending}>
          Save our version
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: The editor page**

```tsx
// app/src/app/workout/library/copies/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import { requireUser } from "@/lib/auth";
import { getCopy } from "@/lib/programs/library";
import { platformProgram } from "@/lib/programs/registry";
import { ENGINE_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramCopyPage(props: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await props.params;
  const copy = getCopy(Number(id));
  if (!copy) notFound();
  const original = platformProgram(copy.basedOn);
  return (
    <div className="app-page">
      <Link href="/workout/library" className="cp-back">
        <ArrowLeft size={14} /> Program library
      </Link>
      <PageHeader
        eyebrow={`Our version, based on ${copy.basedOnName}`}
        title={copy.name}
        subtitle="Change exercises, sets, reps, percentages, RPE, rest and notes, and add or remove days and weeks. Members already running it keep the version they started."
      />
      <ProgramCopyEditor
        id={copy.id}
        initial={copy.template}
        lifts={original?.lifts ?? copy.template.lifts}
        engineLabel={ENGINE_LABEL[copy.template.engine.key]}
        isBlock={copy.template.engine.key === "fixed_block"}
      />
    </div>
  );
}
```

- [ ] **Step 9: Styles**

Append to `app/src/app/globals.css`:

```css
/* Staff: gym copies in the program library, and the copy editor. */
.pl { display: grid; gap: 14px; }
.pl-section-title { margin: 8px 0 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.pl-row { grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) 56px 56px 120px 260px; }
.pl-row--copy { grid-template-columns: minmax(0, 1fr) auto; }
.pe { display: grid; gap: 14px; max-width: 1100px; }
.pe-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); }
.pe-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.pe-field { display: grid; gap: 6px; }
.pe-field > span { font-size: 12px; color: var(--text-tertiary); }
.pe-hint { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); }
.pe-errors { padding: 12px 16px; border: 1px solid var(--danger); border-radius: 12px; font-size: 13px; color: var(--text-primary); }
.pe-errors ul { margin: 6px 0 0; padding-left: 18px; color: var(--text-secondary); }
.pe-weeks { display: flex; flex-wrap: wrap; gap: 6px; }
.pe-tab { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 0 14px; border-radius: var(--radius); border: 1px solid var(--hairline); background: transparent; color: var(--text-secondary); font: inherit; font-size: 13px; cursor: pointer; }
.pe-tab[aria-selected="true"] { border-color: var(--accent); color: var(--text-primary); background: var(--surface-2); font-weight: 600; }
.pe-day-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pe-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.pe-ex { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--hairline); border-radius: 10px; }
.pe-ex-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.pe-ex-head select { min-width: 220px; height: 36px; }
.pe-ex-tools { display: flex; gap: 4px; margin-left: auto; }
.pe-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; border: 1px solid var(--hairline); background: transparent; color: var(--text-secondary); cursor: pointer; }
.pe-icon:disabled { opacity: 0.4; cursor: default; }
.pe-sets { display: grid; gap: 6px; }
.pe-set { display: grid; grid-template-columns: 36px minmax(180px, 1.4fr) minmax(150px, 1.2fr) 76px 76px 90px 36px; gap: 8px; align-items: center; }
.pe-set select { height: 36px; }
.pe-set--head { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
.pe-setno { font-size: 13px; color: var(--text-tertiary); text-align: center; }
.pe-load { display: flex; align-items: center; gap: 6px; }
.pe-muted { font-size: 12.5px; color: var(--text-tertiary); }
.pe-save { position: sticky; bottom: 0; display: flex; justify-content: flex-end; padding: 12px 0; background: linear-gradient(transparent, var(--bg) 40%); }
@media (max-width: 900px) {
  .pe-set { grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1fr); }
  .pe-set--head { display: none; }
}
```

- [ ] **Step 10: Typecheck, test and build**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/editing.test.ts && npm test -- src/lib/programs/library.test.ts && rm -rf .next && npx next build`
Expected: no errors; the build lists `/workout/library/copies/[id]`.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/programs/editing.ts app/src/lib/programs/editing.test.ts app/src/app/workout/library/actions.ts "app/src/app/workout/library/copies/[id]/page.tsx" app/src/components/workout/ProgramCopyEditor.tsx app/src/components/workout/ProgramLibraryView.tsx app/src/app/workout/library/page.tsx app/src/app/globals.css
git commit -m "feat(programs): gym versions of platform programs with an editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Full checks, a local browser check, deploy, and switching Programs on for Inspire

**Files:**
- Modify: `CLAUDE.md` (one line in the module list so future sessions know where Programs lives)

**Interfaces:**
- Consumes: everything above.
- Produces: `main` deployed to Railway with the Programs module live in code and rolled out to nobody, then to Inspire by an owner from the console.

- [ ] **Step 1: Full checks**

Run: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`
Expected: no type errors; every test file passes (the summary line reports 0 failed); the build succeeds and lists `/app/programs`, `/app/programs/[key]`, `/app/programs/[key]/start`, `/app/programs/mine`, `/workout/library`, `/workout/library/[key]`, `/workout/library/copies/[id]`.

- [ ] **Step 2: No emojis in anything new**

Run:

```bash
cd app && node -e "
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk('src/lib/programs'), ...walk('src/app/app/programs'), ...walk('src/app/workout/library'),
  'src/components/clientapp/ProgramBrowser.tsx', 'src/components/clientapp/StartProgramForm.tsx', 'src/components/clientapp/MyProgramCard.tsx',
  'src/components/clientapp/MyProgramControls.tsx', 'src/components/clientapp/RestartProgramForm.tsx', 'src/components/clientapp/StartProgramSessionButton.tsx',
  'src/components/clients/ClientProgramPanel.tsx', 'src/components/clients/TrainingModeSwitch.tsx',
  'src/components/workout/ProgramLibraryView.tsx', 'src/components/workout/ProgramPreviewTable.tsx', 'src/components/workout/ProgramCopyEditor.tsx'];
const bad = files.filter((f) => /\p{Extended_Pictographic}/u.test(fs.readFileSync(f, 'utf8')));
console.log(bad.length ? bad.join('\n') : 'no emojis');
process.exit(bad.length ? 1 : 0);
"
```

Expected: `no emojis`.

- [ ] **Step 3: Switch Programs on in the local dev control DB only**

The rollout defaults to nobody, so locally it is off too. Turn it on for the dev copy (this never touches production):

Run: `cd app && sqlite3 data/control.db "INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES ('programs', 'all', 100, '[]', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET mode = 'all', percent = 100, allow = '[]'"`
Expected: no output.

- [ ] **Step 4: Browser check, staff side**

Run `cd app && npm run dev` (Node at `/usr/local/bin`) and open http://localhost:3000 signed in as a staff admin of the business whose member app you will test (the test member `aoife.brennan@example.com` / `password123` belongs to one of the local tenants; open Clients in that business and find her).

Check, and fix anything that is wrong before moving on:
1. Workout in the sidebar has a Program library link. The page lists 20 programs with goal, days, weeks, a Members see it switch, Preview and Make our version.
2. Preview Smolov base mesocycle: Week 1 Day 1 reads `4 x 9 at 70%` and `4 x 9 at 70 kg`; week 2 reads `+ 10 kg` and `80 kg`; the test week is tinted.
3. Hide Smolov base mesocycle, then show it again.
4. Make our version of Smolov base mesocycle. In the editor rename it, change Day 1's first set to 68%, save: a success toast. Then change every Back squat's max to No max and save: the save is refused with "This version has no exercise that uses the squat max. Smolov base mesocycle needs one." Reload the page to drop the unsaved change.
5. Clients > Aoife: the header shows the Coach guided / DIY switch. Switch to DIY.
6. Clients > New: a Training card with Coach guided and DIY.

- [ ] **Step 5: Browser check, member side**

Open http://localhost:3000/app/login in a private window and sign in as the test member (DIY from Step 4).

1. The tab bar shows Programs between Workouts and Profile.
2. Programs: the filters work (Powerlifting peak shows 6 plus your version; 5 or more days shows 4). Your version shows "Our version, based on Smolov base mesocycle".
3. Open Smolov base mesocycle: the description, warning and week 1 show. Start this program: give a 1-rep max of 100 kg, keep 2.5 kg, pick Mon/Tue/Thu/Fri, Start program.
4. My program: "Week 1 of 4", next session "Day 1, week 1" with "Back squat 4 x 9 at 70 kg", this week's strip, the maxes card, the change log showing "Started Smolov base mesocycle." from You.
5. Start session: the logger shows a Plan column (`70 x 9`), an RPE column and the planned weight as the placeholder. Tick all four sets, type 8 in one RPE box, Finish workout: a "Your program" card says nothing changes until the next session (a block makes no changes inside it). Back to my program: the next session is Day 2 at 75 kg.
6. Skip the next session (confirm): the change log records it. Home shows the My program card.
7. In the staff window, Aoife's Workout log tab shows the DIY program panel: week, maxes, next session, the skip and the change log. Correct her squat max to 110: the member's next session goes up to match (Day 3 7 x 5 at 87.5 kg is 80% of 110 rounded) and the change log names you.
8. Switch Aoife to Coach guided: the member's Programs tab disappears; Workouts no longer shows the card. Switch back: the program is resumed where it was.
9. Change the member's units: end the program, start StrongLifts 5x5 in pounds with a 5 lb jump; weights show in lb (multiples of 5) on My program and in the logger.

Then put the local flag back: `cd app && sqlite3 data/control.db "DELETE FROM platform_flags WHERE key = 'programs'"`.

- [ ] **Step 6: Note the module in CLAUDE.md**

In `CLAUDE.md`, in the module list under "The modules", replace

```
- **Programmes:** `/nutrition`, `/workout`, `/forms`, `/automations`, `/training`
  (sales-training programme, `optimal-health` + `renova` only).
```

with

```
- **Programmes:** `/nutrition`, `/workout`, `/forms`, `/automations`, `/training`
  (sales-training programme, `optimal-health` + `renova` only).
- **Program library (module `programs`, rollout defaults to nobody):** platform
  programs in code (`src/lib/programs/templates`, `registry.ts`), five progression
  engines (`engines.ts`), gym copies and hides in the tenant DB, member enrolments
  (`enrolments.ts`); staff at `/workout/library`, members on the Programs tab
  (`/app/programs`, DIY training mode only).
```

Commit:

```bash
git add CLAUDE.md
git commit -m "docs: where the program library lives

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Land on main and deploy**

Run: `git status --short` and confirm nothing from this plan is left uncommitted (unrelated untracked files that were there before are fine; do not add them).
Run: `git push origin main`
Run: `cd app && railway up --detach`
Expected: the upload starts and returns a build URL. The main app deploy causes a few minutes of 502s while the volume swaps; that is expected. Once it settles, `curl -s -o /dev/null -w "%{http_code}" https://www.adonisagent.ie/api/health` returns `200`.

Every tenant DB gains the new tables and columns the first time it opens after the deploy (`ensureTenantTables`). Nothing is visible to any business yet: Programs rolls out to nobody.

- [ ] **Step 8: Switch Programs on for Inspire (an owner does this in the console)**

Tell the user, word for word:

"Programs is deployed and switched off for everyone. To turn it on for Inspire: open the admin console (admin.adonisagent.ie), Feature flags, find Programs, choose Named businesses, tick Inspire, and save. Only an owner can change rollouts. Then on Inspire, open a member who lifts, switch them to DIY on their client page, and the Programs tab appears in their app. When you are happy, change Programs to Everyone."

Also tell the user which programs are labelled "-style" and the choices listed under "Notes for the user: program accuracy" at the top of this plan, so they can check the numbers before members rely on them.

---

## Self-review

Spec coverage, section by section:

| Spec | Where |
|---|---|
| 1. Training mode `coach`/`diy`, set on the client page and add-member form | Task 9 (switch, form, `clients.training_mode`) |
| 1. Switching never deletes; DIY program paused, not ended | Task 8 `setTrainingMode`, tested |
| 1. Programs tab and My program card; coach programs unchanged | Tasks 9, 11, 12; logger change is additive (Task 10) |
| 1. Mode only shows where the module is on | Task 9 `memberSeesPrograms`, `programsEnabled` |
| 2. Programs in code, read from a registry; metadata; engine and settings | Tasks 1, 3-6 |
| 2. Set kinds pct, amrap, rpe, fixed, same_as_last; reps or a range; rest | Task 1 `SetRx`, planner |
| 2. Canonical names matched to the gym's library, `lib:<id>` or `name:<lower>` | Task 1 `matchLibraryId`, Task 8 `startEnrolmentSession` |
| 2. Launch programs and author credits | Tasks 3-6 (20 programs; see the notes on Smolov) |
| 2. Gym copies: copy, rename, edit, add/remove days and weeks; engine fixed; refuse a dropped lift naming it; "Our version, based on"; hide switch; members see copies plus unhidden | Tasks 7, 14, 15 |
| 3. Browse filters goal, days, length; cards with who, days, weeks, warning | Task 11 |
| 3. Maxes three ways, Epley capped at 10, best logged in 90 days prefilled; training max rule | Tasks 1, 8, 11 |
| 3. Units kg/lb, stored in kg; rounding 2.5 / 1.25 / 5 lb | Tasks 1, 10, 11 |
| 3. Start date and weekdays | Task 11 (form), Task 8 (`weekdays`, `programWeek`); see the training_plans note |
| 3. One program at a time; ended keeps history | Task 8 (partial unique index, `endEnrolment`) |
| 4. Every weight worked out; AMRAP and RPE wording | Tasks 1, 10, 12 |
| 4. Planned weight per set; optional RPE; session linked to enrolment | Tasks 7, 8, 10 |
| 4. Advance on finish, not calendar; Skip recorded | Task 8 |
| 4. Five engines with the listed rules; use what was actually lifted | Task 2 |
| 4. Every change says why; stored in the change log | Tasks 2, 8, 10, 12, 13 |
| 5. Client page chip; DIY program panel; change log; skipped sessions | Tasks 9, 13 |
| 5. Coach corrects a max or moves a week, logged with who | Tasks 8, 13 |
| 5. Program library tab, preview table for a 100 kg lifter, Make our version, Hide | Tasks 14, 15 |
| 6. Data: every listed table and column | Task 7 (plus `rx_json`, see notes) |
| 6. Engine unit tests: all reps, missed set, three misses, AMRAP, end of cycle, test day | Task 2 |
| 6. End-to-end per program with two simulated members, pinned published numbers | Tasks 3-6 (`registry.test.ts` runs every program twice, plus kg and lb) |
| 6. Template check over every program | Task 3 `validate.ts`, `registry.test.ts` |
| 6. Rounding and unit tests | Task 1 `units.test.ts` |
| 6. Module `programs`, rollout Nobody, switched on from the console | Tasks 9, 16 |
| 6. Warning lines; existing health consent applies | Tasks 3-6 (warnings), nothing new needed for consent |

Out of scope, as the spec says: Adonis reading programs, coaches building programs from scratch, new videos, plate calculators and warm-up generators.
