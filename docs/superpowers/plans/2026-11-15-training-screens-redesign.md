# Training Screens Redesign and Program Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the member app's Home, Workouts, My program and Progress screens dashboard-first with a clear visual hierarchy, and add program progress (a per-lift path chart, so far against planned, plus + sets) that is useful from the first day.

**Architecture:** The progress logic is two layers:
- a pure module (`lib/programs/progressSeries.ts`) turns the program's existing change-log snapshots and the engine itself into chart series;
- a server module (`lib/programs/progressData.ts`) reads the events and logged sessions for one enrolment.

The UI gets four new kit pieces in the existing `.pk-` kit (StatStrip, SessionTable, QuietRow, PathChart) plus one composed `ProgramProgress` section. The four screens and the coach panel are rebuilt on them.

**Tech Stack:** Next.js 15 App Router server components, better-sqlite3 + drizzle, TypeScript, plain SVG. Tests are tsx files run by `npm test`.

Spec: `docs/superpowers/specs/2026-11-15-training-screens-redesign-design.md`.

## Global Constraints

- Colours come from the gym's brand CSS variables only (`--accent`, `--accent-soft`, `--accent-ink`, `--text-*`, `--hairline`, `--surface-*`, `--success`). No hard-coded colours. Optimal Health and Inspire must each look like themselves.
- New CSS goes in the existing `.pk-` block in `app/src/app/globals.css`. Do not reuse any other prefix. `components/clientapp/programs/kit.test.ts` must keep passing: every `.pk-` class defined is used, and every used class is defined.
- Hierarchy rules on Home, Workouts, My program and Progress:
  - at most one filled accent button per screen;
  - one white card holds the main content, and everything secondary is a QuietRow or plain page background;
  - a number is always larger and heavier than its label;
  - an empty state is one QuietRow with a next step, never a full card or a zero tile.
- Member copy says "program", never "programme".
- Controls are at least 44px. The layout works at 320px with no horizontal scroll. Inputs are 16px. Icons are lucide. NO EMOJIS anywhere.
- No claim of results. The planned line is labelled exactly "Dashed: if each + set hits its reps" for programs with + sets, and "Dashed: if you get every rep" otherwise.
- No chart library. Charts are plain SVG.
- No new database tables.
- Program features stay behind the Programs module. Do not change progression logic, the logger screen, or coach-set rules.
- Commits: never `git add -A`. Add files by name. End every message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before a task is done: `cd app && npx tsc --noEmit -p .` is clean, and the task's tests pass. Pure tests run via `npx tsx <file>`, DB tests via `npm test -- <file>`. UI tasks also run `rm -rf .next && npx next build` once.

---

## File Structure

- Create `app/src/lib/programs/progressSeries.ts` (pure): `chartKind`, `liftValue`, `soFarSeries`, `plannedSeries`, `plusSetRows`.
- Create `app/src/lib/programs/progressSeries.test.ts`.
- Create `app/src/lib/programs/progressData.ts` (server): `programProgress(view)`.
- Create `app/src/lib/programs/progressData.test.ts` (DB).
- Modify `app/src/components/clientapp/programs/kit.tsx`: add `StatStrip`, `SessionTable`, `QuietRow` and `PathChart`.
- Modify `app/src/app/globals.css`: `.pk-` styles for the new pieces.
- Create `app/src/components/clientapp/programs/ProgramProgress.tsx`: the progress section, with a client lift switcher in `LiftSwitch.tsx`.
- Modify `app/src/app/app/workouts/page.tsx`, `app/src/app/app/page.tsx`, `app/src/app/app/programs/mine/page.tsx`, `app/src/app/app/progress/page.tsx`, `app/src/components/clientapp/MyProgramCard.tsx`.
- Modify the coach panel: `app/src/lib/programs/panel.ts`, `staffView.ts` and `app/src/components/clients/ClientProgramPanel.tsx`.

---

### Task 1: Progress series (pure)

**Files:**
- Create: `app/src/lib/programs/progressSeries.ts`
- Test: `app/src/lib/programs/progressSeries.test.ts`

**Interfaces:**
- Consumes:
  - `planSession`, `weekNumber`, `weekInRound` from `./planner`;
  - `progress`, `initState` from `./engines`;
  - `perfect` from `./simulate`;
  - types `ProgramTemplate`, `EngineState`, `LiftKey`, `WeightUnit`, `PlannedExercise` from `./types`.
- Produces:

```ts
export type ChartKind = "tm" | "weight" | "top";
/** What the chart plots: the training max (tm_cycle except GZCLP), the working weight (linear, GZCLP, double_progression, fixed_volume, own_rules), or the planned top set each week (fixed_block). */
export function chartKind(t: ProgramTemplate): ChartKind;
export const CHART_LABEL: Record<ChartKind, string>; // { tm: "Training max", weight: "Working weight", top: "Top set" }
/** The lifts a chart can be drawn for: the template's lifts that have a value in `state`. Empty when none. */
export function chartLifts(t: ProgramTemplate, state: EngineState, stepKg: number): LiftKey[];
/** The plotted value for one lift in one state, in kg, or null. */
export function liftValue(t: ProgramTemplate, state: EngineState, lift: LiftKey, stepKg: number): number | null;
export interface SeriesPoint { week: number; kg: number }
/** A change-log snapshot as stored in program_enrolment_events.after_json. */
export interface Snapshot { week: number; day: number; cycle: number; maxes: EngineState["maxes"]; tms: EngineState["tms"]; weights: EngineState["weights"] }
/** The value after each recorded change since the latest start or restart, one point per program week (the last value in that week wins). */
export function soFarSeries(t: ProgramTemplate, snapshots: Snapshot[], lift: LiftKey, stepKg: number): SeriesPoint[];
/** From the current state to the end of this round of the program, every planned rep hit: one point per program week. */
export function plannedSeries(t: ProgramTemplate, state: EngineState, lift: LiftKey, stepKg: number, unit: WeightUnit): SeriesPoint[];
export function hasPlusSets(t: ProgramTemplate): boolean;
export interface LoggedExercise { at: number; week: number; plan: PlannedExercise; sets: { kg: number | null; reps: number | null; done: boolean }[] }
export interface PlusSetRow { at: number; week: number; lift: string; planned: string; got: string }
/** The + sets (AMRAP or drives) logged, newest first; for programs without + sets, the heaviest done set of each logged exercise that has a lift. */
export function plusSetRows(rows: LoggedExercise[], plus: boolean, fmt: (kg: number) => string): PlusSetRow[];
```

- [ ] **Step 1: Write the failing tests.** Create `progressSeries.test.ts`:

```ts
// Run: npm test -- src/lib/programs/progressSeries.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { platformProgram } from "./registry";
import { CHART_LABEL, chartKind, chartLifts, hasPlusSets, liftValue, plannedSeries, plusSetRows, soFarSeries, type Snapshot } from "./progressSeries";
import { simulate } from "./simulate";

const get = (k: string) => platformProgram(k)!;
const snap = (s: ReturnType<typeof initState>): Snapshot => ({ week: s.week, day: s.day, cycle: s.cycle, maxes: s.maxes, tms: s.tms, weights: s.weights });

// kinds
assert.equal(chartKind(get("531-bbb")), "tm");
assert.equal(chartKind(get("texas-method")), "tm");
assert.equal(chartKind(get("stronglifts-5x5")), "weight");
assert.equal(chartKind(get("gzclp")), "weight");
assert.equal(chartKind(get("smolov-base")), "top");
assert.equal(CHART_LABEL.tm, "Training max");

// 5/3/1: the training max rises each 4-week cycle, planned to week 12
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.5);
  assert.deepEqual(chartLifts(t, s, 2.5), ["press", "deadlift", "bench", "squat"]);
  assert.equal(liftValue(t, s, "squat", 2.5), 100);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  assert.equal(p[0].week, 1);
  assert.equal(p[0].kg, 100);
  assert.equal(p.at(-1)!.week, 12);
  assert.equal(p.at(-1)!.kg, 110, "two rises of 5 kg inside 12 weeks: after weeks 4 and 8");
  // so far, from the change log: start, then a finished cycle
  const run = simulate(t, { maxes: { squat: 100, bench: 80, deadlift: 120, press: 50 }, sessions: 16 });
  const snaps = [snap(s), ...run.states.map(snap)];
  const sf = soFarSeries(t, snaps, "squat", 2.5);
  assert.equal(sf[0].week, 1);
  assert.equal(sf[0].kg, 100);
  assert.equal(sf.at(-1)!.kg, 105, "after one cycle the squat training max is 105");
  assert.ok(sf.every((pt, i) => i === 0 || pt.week > sf[i - 1].week), "one point per week, in order");
}

// StrongLifts: the working weight rises each session the lift is done
{
  const t = get("stronglifts-5x5");
  const s = initState(t, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5);
  assert.equal(liftValue(t, s, "squat", 2.5), 50);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  assert.ok(p.at(-1)!.kg > p[0].kg);
  assert.equal(p.at(-1)!.week, t.lengthWeeks);
}

// Smolov: the planned top set each week; it does not need a session to show
{
  const t = get("smolov-base");
  const s = initState(t, { squat: 100 }, 2.5);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  assert.equal(p.length, t.weeks.length);
  assert.ok(p.every((pt) => pt.kg > 0));
}

// pounds: the planned values follow the member's step
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.26796);
  const p = plannedSeries(t, s, "squat", 2.26796, "lb");
  assert.ok(Math.abs(p.at(-1)!.kg - (100 + 2 * 4.536)) < 0.01, "5/3/1 rises 10 lb a cycle for a pounds member");
}

// day one: one so-far point
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.5);
  assert.deepEqual(soFarSeries(t, [snap(s)], "squat", 2.5), [{ week: 1, kg: 100 }]);
}

// + sets
assert.equal(hasPlusSets(get("531-bbb")), true);
assert.equal(hasPlusSets(get("stronglifts-5x5")), true, "StrongLifts has no AMRAP: check the template");
{
  const plan = (amrap: boolean) => ({ index: 0, name: "Back squat", lift: "squat" as const, tier: null, stateKey: "back squat", bodyweight: false, progresses: false, joined: false, notes: null, sets: [{ kg: 85, reps: 5, repsMax: null, amrap: false, rpe: null, pct: 0.85, rest: 180, drives: false }, { kg: 95, reps: 5, repsMax: null, amrap, rpe: null, pct: 0.95, rest: 180, drives: false }] });
  const rows = plusSetRows(
    [
      { at: 1, week: 1, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 8, done: true }] },
      { at: 2, week: 2, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 6, done: true }] },
      { at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }] },
    ],
    true,
    (kg) => `${kg} kg`,
  );
  assert.deepEqual(rows.map((r) => [r.week, r.planned, r.got]), [[2, "95% x 5+", "95 kg x 6"], [1, "95% x 5+", "95 kg x 8"]], "only + sets, newest first");
  const tops = plusSetRows([{ at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }, { kg: 100, reps: 3, done: false }] }], false, (kg) => `${kg} kg`);
  assert.deepEqual(tops.map((r) => r.got), ["95 kg x 5"], "top set = heaviest DONE set");
}

console.log("programs/progressSeries: ok");
```

Check `hasPlusSets` against the real StrongLifts template (`templates/stronglifts.ts`). If it has no AMRAP set, change that assertion to `false`, and keep it non-vacuous.

- [ ] **Step 2: Run the tests to see them fail.**
  - Run: `cd app && npx tsx src/lib/programs/progressSeries.test.ts`
  - Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement it.** Rules:
  - **`chartKind`:**
    - `fixed_block` gives `"top"`;
    - `tm_cycle` with `rule !== "gzclp"` gives `"tm"`;
    - everything else gives `"weight"`.
  - **`liftValue`:**
    - `tm`: `state.tms[lift] ?? null`.
    - `weight`: `state.weights[stateKey(ex)]` for the first exercise in the template with `ex.lift === lift` and `progresses(ex)` (`stateKey` and `progresses` come from `./planner`). It is null if missing.
    - `top`: the heaviest planned `kg` of that lift's exercises in the week `state.week`, across all its days. Use `planSession(t, { ...state, day: d }, { stepKg })` for each day `d` of that week, ignoring test days. It is null if there are none.
  - **`chartLifts`:** `t.lifts.filter((l) => liftValue(t, state, l, stepKg) !== null)`.
  - **`soFarSeries`:** for each snapshot, build a state (`{ ...emptyState(), ...snapshot }`) and take `week = weekNumber(t, snapshot)`. If `liftValue` is non-null, write `kg` into a map keyed by week; later snapshots overwrite. Return the points sorted by week.
  - **`plannedSeries`:**
    - Start `s = structuredClone(state)`. The round end is `end = weekInRound(t, s).round * t.lengthWeeks`, in overall week numbers.
    - Record the current week's value. Then loop: `const plan = planSession(t, s, { stepKg })`. If `!plan` (finished block) or `weekNumber(t, s) > end`, stop.
    - Build a result with `perfect` (from `./simulate`: every set at its planned kg, top of range, + sets two over), run `progress({ template: t, state: s, result, stepKg, unit })`, and set `s = out.state`.
    - Record `liftValue` at `weekNumber(t, s)` when that week is `<= end`. The last value in a week wins.
    - For `top`, record each week's value before running it. Guard with a maximum of 400 sessions.
  - **`hasPlusSets`:** any set in the template is `amrap`, or `fixed` with `amrap: true`, or has `drives`.
  - **`plusSetRows`:**
    - **`plus === true`:** for each row and each planned set with `amrap || drives` where the logged set is `done` with reps, emit `{ at, week, lift: plan.name, planned: `${Math.round(pct*1000)/10}% x ${reps}+` (or `${reps}+` when pct is null), got: `${fmt(kg)} x ${reps}` }`.
    - **`plus === false`:** for each row with `plan.lift`, emit the heaviest done set.
    - Sort by `at` descending.

- [ ] **Step 4: Run the tests to see them pass.**
  - Run: `cd app && npx tsx src/lib/programs/progressSeries.test.ts && npx tsc --noEmit -p .`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/programs/progressSeries.ts app/src/lib/programs/progressSeries.test.ts
git commit -m "feat(programs): progress series from the change log and the engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Progress data for one enrolment (server)

**Files:**
- Create: `app/src/lib/programs/progressData.ts`
- Test: `app/src/lib/programs/progressData.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `chartKind`, `CHART_LABEL`, `chartLifts`, `soFarSeries`, `plannedSeries`, `hasPlusSets`, `plusSetRows`;
  - types `Snapshot`, `SeriesPoint`, `PlusSetRow`, `LoggedExercise`.
- Consumes (existing): `EnrolmentView`, `planFor` (`./enrolments`); `weekNumber` (`./planner`); tables `programEnrolmentEvents`, `workoutSessions`, `workoutSessionExercises`, `workoutSetLogs`; `formatWeight` (`./units`).
- Produces:

```ts
export interface LiftChart { lift: LiftKey; label: string; soFar: SeriesPoint[]; planned: SeriesPoint[]; nowKg: number | null; endKg: number | null }
export interface ProgramProgressData {
  kindLabel: string;        // "Training max" | "Working weight" | "Top set"
  plannedNote: string;      // "Dashed: if each + set hits its reps" | "Dashed: if you get every rep"
  totalWeeks: number;       // the round's last overall week
  charts: LiftChart[];      // empty when the program has no lifts
  rowsTitle: string;        // "Your + sets" | "Top sets"
  rows: PlusSetRow[];       // newest first, at most 12
  unit: WeightUnit;
}
export function programProgress(view: EnrolmentView): ProgramProgressData;
```

- [ ] **Step 1: Write the failing DB test.** Copy the scratch-tenant harness from the top of `app/src/lib/programs/enrolments.test.ts` (Module._load stub, requireLocal, tenant insert, cleanup, `newMember`, the `test()` runner, `runWithTenant`). Use the slug `programs-progress-test`. Use `en.enrol` and the file's `logNext` pattern (start the next session and log every planned set as done, then finish it) to log two 5/3/1 sessions. Cases:
  - Before any session: `charts.length === 4`. The squat chart's `soFar` has one point `{ week: 1, kg: 100 }`, its `planned` ends at week 12, `rows` is `[]` and `rowsTitle === "Your + sets"`.
  - After logging the press day with its + set at 8 reps: `rows[0].lift === "Overhead press"` and `rows[0].got` ends in `x 8`.
  - A program without lifts (`phul`): `charts` is `[]` and `rowsTitle === "Top sets"`.
  - The `plannedNote` text exactly matches the Global Constraints.

- [ ] **Step 2: Run the test to see it fail.**
  - Run: `cd app && npm test -- src/lib/programs/progressData.test.ts`
  - Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement it.**
  - **Snapshots:** select `program_enrolment_events` rows for `view.id`, ordered by id, with kind in `("start","restart","progress","skip","edit","max","week")` and non-null `after_json`. Keep only those after the latest `start` or `restart` (inclusive), and parse `after_json` into `Snapshot`.
  - **Logged exercises:** select finished `workout_sessions` with `enrolment_id = view.id`, their `workout_session_exercises` with non-null `rx_json`, and their `workout_set_logs` ordered by `set_number`.
    - Each set's kg is `weight_kg ?? (done ? target_weight_kg : null)`.
    - `week` is `weekNumber(view.template, { week: plan week, cycle })`. The session table has no week, so derive it from `workout_sessions.day_position` and the cycle in effect: the cycle of the latest snapshot at or before the session's `finished_at`. If that is too involved, take the week from the nearest `progress` event whose `session_id` equals the session id; that event's `before_json` has the week and cycle. Use whichever is simpler and say which in the report.
  - **Assemble** `charts` for `chartLifts(view.template, view.state, view.stepKg)`:
    - `soFar = soFarSeries(...)`, `planned = plannedSeries(view.template, view.state, lift, view.stepKg, view.unit)`;
    - `nowKg` = the last `soFar` kg, `endKg` = the last `planned` kg.
    - `label` is `LIFT_LABEL[lift]`.
  - **Rows:** `rows = plusSetRows(logged, hasPlusSets(t), (kg) => formatWeight(kg, view.unit)).slice(0, 12)`.
  - **`totalWeeks`:** `weekInRound(t, view.state).round * t.lengthWeeks`.

- [ ] **Step 4: Run the tests.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/progressData.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/programs/progressData.ts app/src/lib/programs/progressData.test.ts
git commit -m "feat(programs): progress data for a running program

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Kit pieces and the progress section

**Files:**
- Modify: `app/src/components/clientapp/programs/kit.tsx`
- Modify: `app/src/app/globals.css` (the `.pk-` block)
- Create: `app/src/components/clientapp/programs/ProgramProgress.tsx`
- Create: `app/src/components/clientapp/programs/LiftSwitch.tsx` (client)
- Test: `app/src/components/clientapp/programs/kit.test.ts` (must pass); add `app/src/components/clientapp/programs/pathChart.test.ts` for the pure geometry.

**Interfaces:**
- Consumes (Task 2): `ProgramProgressData`, `LiftChart`.
- Produces (kit.tsx, plain markup, no hooks):

```ts
export function StatStrip({ items }: { items: { label: string; value: string; sub?: string }[] }): JSX.Element; // 3 across; value large, bold, tabular
export function SessionTable({ exercises, unit }: { exercises: PlannedExercise[]; unit: WeightUnit }): JSX.Element; // per exercise: name left; each set "weight x reps" on its own line right; + set in accent; bodyweight: reps only; rpe: "RPE 8 · about 140 kg"
export function QuietRow({ href, label, value, icon }: { href?: string; label: string; value?: string; icon?: "chevron" | "plus" }): JSX.Element; // one line, 44px min height, hairline bottom
export function PathChart({ chart, totalWeeks, unit }: { chart: LiftChart; totalWeeks: number; unit: WeightUnit }): JSX.Element; // SVG: solid accent so-far, dashed planned, labels
/** Pure geometry for PathChart, exported for tests. */
export function pathGeometry(chart: LiftChart, totalWeeks: number, w: number, h: number): { soFar: string; planned: string; yMin: number; yMax: number }; // SVG points strings
```

- `ProgramProgress({ data }: { data: ProgramProgressData })`: a server component. It renders a `PkSection` with `data.kindLabel` as its label, a `LiftSwitch` (a client segmented control switching which lift's PathChart shows; all charts render server-side and the switch toggles `hidden`), the `plannedNote` line, then a `PkSection` titled `data.rowsTitle` holding the rows ("Week 3 · 95% x 1+" on the left, `got` in bold on the right). When `rows` is empty, it shows one `QuietRow` with the label "Your + sets show here after your first session." (or "Your top sets show here after your first session."). When `charts` is empty, the chart section is left out.

- [ ] **Step 1: Write the failing geometry test** (`pathChart.test.ts`):

```ts
import assert from "node:assert/strict";
import { pathGeometry } from "./kit";

const chart = { lift: "squat" as const, label: "Squat", soFar: [{ week: 1, kg: 100 }, { week: 5, kg: 105 }], planned: [{ week: 5, kg: 105 }, { week: 9, kg: 110 }, { week: 12, kg: 110 }], nowKg: 105, endKg: 110 };
const g = pathGeometry(chart, 12, 260, 120);
assert.equal(g.yMin <= 100 && g.yMax >= 110, true, "the y range covers both lines");
assert.equal(g.soFar.split(" ").length, 2 * 2, "step line: a point per value change plus its step");
assert.ok(g.planned.length > 0);
const day1 = pathGeometry({ ...chart, soFar: [{ week: 1, kg: 100 }], planned: [{ week: 1, kg: 100 }, { week: 12, kg: 110 }] }, 12, 260, 120);
assert.ok(day1.soFar.split(" ").length >= 1, "one point on day one");
console.log("programs/pathChart: ok");
```

If the step-line point count works out differently, make the assertion pin the actual step shape. A step line holds the value until the next week, then rises. Never loosen it to `> 0` alone.

- [ ] **Step 2:** Run it and see it fail (`npx tsx src/components/clientapp/programs/pathChart.test.ts`).
- [ ] **Step 3: Implement it.**
  - Add the four components to `kit.tsx` and `ProgramProgress.tsx`. `LiftSwitch.tsx` is a `"use client"` component taking `lifts: { lift, label }[]` and `children: ReactNode[]` (one panel per lift), with keyboard-accessible buttons (`aria-pressed`) at least 44px tall.
  - Add the CSS under `.pk-` with these classes:
    - `.pk-strip`, `.pk-strip-item`, `.pk-strip-value`;
    - `.pk-table`, `.pk-table-row`, `.pk-table-name`, `.pk-table-sets`, `.pk-table-set`, `.pk-table-set--plus`;
    - `.pk-row`, `.pk-row-value`;
    - `.pk-chart`, `.pk-chart-solid`, `.pk-chart-planned`, `.pk-chart-label`;
    - `.pk-switch`, `.pk-switch-btn`.

    Use brand variables only, and `font-variant-numeric: tabular-nums` on numbers.
  - The chart SVG uses `viewBox="0 0 260 120"`, `width="100%"`, and `role="img"` with an `aria-label` such as "Squat training max: 105 kg now, 110 kg planned by week 12".
- [ ] **Step 4: Run the checks.**
  - Run: `cd app && npx tsx src/components/clientapp/programs/pathChart.test.ts && npx tsx src/components/clientapp/programs/kit.test.ts && npx tsc --noEmit -p .`
  - Expected: PASS. kit.test fails until every new class is used. If needed, use them all in `ProgramProgress.tsx` and the components above before running it.
- [ ] **Step 5: Commit.**

```bash
git add app/src/components/clientapp/programs/kit.tsx app/src/components/clientapp/programs/ProgramProgress.tsx app/src/components/clientapp/programs/LiftSwitch.tsx app/src/components/clientapp/programs/pathChart.test.ts app/src/app/globals.css
git commit -m "feat(app): stat strip, session table, quiet rows and the path chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Workouts screen

**Files:**
- Modify: `app/src/app/app/workouts/page.tsx`
- Modify: `app/src/components/clientapp/MyProgramCard.tsx` (add a `variant: "full" | "line"`)
- Modify: the member-facing "programme" copy in `app/src/app/app/workouts/plan/page.tsx`, `app/src/app/app/workouts/history/page.tsx`, `app/src/app/app/actions.ts`, `app/src/components/clientapp/TrainingDaysForm.tsx`, `WorkoutLogger.tsx` and `StartWorkoutButton.tsx`. Visible strings only; leave identifiers and comments alone.

**Interfaces:**
- Consumes (Task 3): `StatStrip`, `SessionTable`, `QuietRow`, `PkCard`, `PkHeader`. Existing: `trainingOverview(clientId)` gives `{ plan, next, open, streak, weeks, totalWorkouts }`; `WeekStrip`; `liveEnrolment`, `planFor`, `sessionTitle`, `sessionMinutes` (`lib/programs/outline.ts`).
- Produces: `MyProgramCard({ clientId, variant })`.
  - `"full"` (Workouts): the white card with the day name, about-N-minutes, the `SessionTable`, and Start or Continue session.
  - `"line"` (Home): one row "Press day · Week 1 of 12" with a compact Start button.

- [ ] **Step 1: Restructure the page, in this order:**
  1. `PkHeader` with the title "Workouts".
  2. A `StatStrip` with three items:
     - Sessions this week: done/planned from `t.plan.days` (`done` count / `done+planned+today+missed`). Without a plan, use the count of this week's workouts.
     - A headline number: with a running training-max program, its first lift's training max ("Squat TM", `formatMax`); otherwise "Last 30 days" workouts.
     - Streak: `t.streak` weeks.
  3. `WeekStrip` when there is a plan or a program.
  4. The open-session continue card, if any (keep its behaviour).
  5. `MyProgramCard variant="full"` when a program is visible, else the coach plan's next-up card, restyled as the one white card.
  6. QuietRows: "Log your own workout" (plus), "History" (chevron, value "N this week"), "Progress" (chevron).
  7. The coach's assigned workout programs as QuietRows ("Your programs").
  8. Recent workouts as QuietRows (day name, date and sets as the value).
- [ ] **Step 2: Remove the "No programme yet" card.** Show the empty QuietRow "No program yet. Your coach can add one, or log your own." only when there is no DIY program, no coach plan and no assigned programs.
- [ ] **Step 3:** Change visible "programme" to "program" in the files listed above.
- [ ] **Step 4: Verify.**
  - Run: `cd app && npx tsc --noEmit -p . && npx tsx src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts`, then `rm -rf .next && npx next build`.
  - Expected: all pass.
- [ ] **Step 5: Commit.**

```bash
git add app/src/app/app/workouts/page.tsx app/src/components/clientapp/MyProgramCard.tsx app/src/app/app/workouts/plan/page.tsx app/src/app/app/workouts/history/page.tsx app/src/app/app/actions.ts app/src/components/clientapp/TrainingDaysForm.tsx app/src/components/clientapp/WorkoutLogger.tsx app/src/components/clientapp/StartWorkoutButton.tsx
git commit -m "feat(app): Workouts leads with your week and today's session table

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Home screen

**Files:**
- Modify: `app/src/app/app/page.tsx`

**Interfaces:**
- Consumes: `StatStrip`, `QuietRow`, `MyProgramCard variant="line"` (Task 4); existing Home data (next class, membership, nutrition).

- [ ] **Step 1: Restructure Home.** Keep every existing data source and gate (features, venue, coach-set). The order is:
  1. "Welcome back" and the member's first name.
  2. A `StatStrip`: "This week" (sessions done/planned, or workouts this week), "Streak" (weeks), "Next class" (short day and time, or "None").
  3. With a program: `MyProgramCard variant="line"`. With a coach plan and no program: one row with the next workout and a compact Start.
  4. QuietRows: log a meal (when nutrition is on), the next class or "Browse the timetable", membership ("No active membership" with the value "Ask your coach"), and any other existing Home links, each as one row.

  Remove the full-card empty states. At most one filled accent button on the page: the program or plan Start button, if present.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .`, kit test, `next build`.
- [ ] **Step 3: Commit.**

```bash
git add app/src/app/app/page.tsx
git commit -m "feat(app): Home is a one-glance summary of your week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: My program screen

**Files:**
- Modify: `app/src/app/app/programs/mine/page.tsx`

**Interfaces:**
- Consumes: `programProgress(view)` (Task 2), `ProgramProgress` (Task 3), `StatStrip`, `SessionTable`.

- [ ] **Step 1: Restructure the screen.** Keep every control and coach-set rule. The order is:
  1. The header with the week and phase, and the phase bar (as now).
  2. A `StatStrip`: "Sessions" done/total in the round (`enrolmentCounts` and `sessionCount(t) * rounds`), "Skipped", and "Phase" (the current phase name).
  3. The next session: the one white card with the day title, the `SessionTable` and Start or Continue session.
  4. `<ProgramProgress data={programProgress(view)} />`.
  5. "Your numbers" (the existing maxes, keeping the `showsTrainingMax` sub line).
  6. Recent changes, "See the whole program", and the existing controls.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .`, `npm test -- src/lib/programs/progressData.test.ts`, kit test, `next build`.
- [ ] **Step 3: Commit.**

```bash
git add app/src/app/app/programs/mine/page.tsx
git commit -m "feat(programs): My program shows the training max path and your + sets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Progress screen

**Files:**
- Modify: `app/src/app/app/progress/page.tsx`

- [ ] **Step 1: Restructure the screen.**
  - With a live, active enrolment whose member sees programs (`memberSeesPrograms`), open with `<ProgramProgress data={programProgress(view)} />` under the label "Your program", with a QuietRow link "See your program" to `/app/programs/mine`.
  - Then the existing sections (strength trend, workouts each week, lifts, body scans, wearables), each restyled with the kit.
  - Each section with no data becomes one QuietRow:
    - "Log a lift twice to see your strength trend";
    - "Log a workout to see your weeks";
    - "Log a workout with weights to see your lifts";
    - body scans keeps its existing empty copy, as a row.
  - No zero tiles: replace the four zero tiles with a `StatStrip` only when there is at least one workout; otherwise leave it out.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .`, kit test, `next build`.
- [ ] **Step 3: Commit.**

```bash
git add app/src/app/app/progress/page.tsx
git commit -m "feat(app): Progress leads with your program and drops empty tiles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Coach panel chart (read-only)

**Files:**
- Modify: `app/src/lib/programs/staffView.ts` (attach `programProgress(live)` as `progress` to the panel data; wrap it in try/catch so a bad row never breaks the client page)
- Modify: `app/src/lib/programs/panel.ts` (`ProgramPanelData["live"]` gains `progress: ProgramProgressData | null`)
- Modify: `app/src/components/clients/ClientProgramPanel.tsx` (render the progress section above the change log)
- Test: `app/src/lib/programs/panel.test.ts` (a `progress` passed through; null when absent)

- [ ] **Step 1:** Add the field and pass it through. Then render it in the panel. `ProgramProgress` is a server component using kit markup, so render its parts directly with the same kit pieces, or make the panel's chart a small client-safe render using `PathChart` (plain markup, usable from a client component) and `LiftSwitch`. The panel already uses `.dp-` styles; the chart keeps `.pk-` classes, whose brand variables also resolve on staff pages.
- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .`, `npx tsx src/lib/programs/panel.test.ts`, `next build`, full `npm test`.
- [ ] **Step 3: Commit.**

```bash
git add app/src/lib/programs/staffView.ts app/src/lib/programs/panel.ts app/src/components/clients/ClientProgramPanel.tsx app/src/lib/programs/panel.test.ts
git commit -m "feat(programs): coaches see the member's training max path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final: browser check, whole-branch review, deploy

- [ ] Controller browser check (dev copy only; recipe in memory `diy-program-library.md`):
  - Back up `control.db` and the tenant DB.
  - Check Home, Workouts, My program and Progress at 320px and 390px, in Optimal Health's and Inspire's colours, for three members: no program, day 1 of 5/3/1, and two sessions logged.
  - Expected: no horizontal scroll, no console errors, one accent button per screen. Restore the dev data afterwards.
- [ ] Whole-branch review, then `npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`. Then push main and run `railway up --detach` from `app/`. The health check must return 200.
