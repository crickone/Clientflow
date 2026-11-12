# Member-Built Programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a DIY member build their own program in the member app (from blank, a library program, or their current program), with a progression rule per exercise, and run it on the existing enrolment, logger and change-log machinery, editable while it runs.

**Architecture:** A member program is an ordinary `ProgramTemplate` with `engine: { key: "own_rules" }` and a `rule` on each exercise. The sets keep doing what they do now (fixed, percentage, RPE), so the planner plans them unchanged; a new `own_rules` engine dispatches each exercise to the per-exercise logic split out of the library engines. Programs live in a new tenant table `member_programs`, owned by the member; starting one creates a normal enrolment with `program_key = "member:<id>"`, and an edit to the running one carries its state onto the new version in one transaction.

**Tech Stack:** Next.js 15 App Router, TypeScript, drizzle-orm over better-sqlite3 (tenant DB per business), zod 4, lucide-react, plain `node:assert/strict` test scripts run with tsx.

Spec (source of truth): `docs/superpowers/specs/2026-11-12-member-built-programs-design.md`. It builds on the DIY program library (`docs/superpowers/specs/2026-11-12-diy-program-library-design.md`, plan `docs/superpowers/plans/2026-11-12-diy-program-library.md`), shipped the same day.

## Global Constraints

- NO EMOJIS anywhere: UI, code, comments, log lines, commit messages, docs. Where a glyph is needed, use a `lucide-react` icon.
- Copy is plain sentence case and short factual sentences. No "X rather than Y", no "not just X", no filler.
- Every member has a training mode: `coach` (default) or `diy`. Switching never deletes anything; switching to coach pauses an active DIY program, it does not end it.
- Platform programs live in code (`app/src/lib/programs/templates/*.ts`, read from `app/src/lib/programs/registry.ts`) and are never copied into a database. Gym copies, hide switches and member-built programs live in the tenant DB.
- An enrolment stores a snapshot of the template it started from. An edit to a running member program replaces that snapshot from the next session on; nothing already logged changes.
- Everything is stored in kg. The member chooses kg or lb for display. 5 lb is stored as 2.26796 kg.
- Weights round to the member's smallest jump: 2.5 kg by default, 1.25 kg for small plates, 5 lb (2.26796 kg) for pounds.
- A max can come from a 1-rep max, a recent set (Epley, only sets of 1 to 10 reps), or the best logged set of that lift in the last 90 days.
- The program advances when a session is finished, never by the calendar. Skips are recorded.
- One live (active or paused) DIY program per member. Ending one keeps its history.
- Every engine change returns a reason sentence, shown to the member and stored in the enrolment's change log.
- Library programs behave exactly as before: an exercise without a `rule` keeps its state key and its plan, and every existing engine, planner, template and enrolment test stays green.
- A member program is private to its member. Every store function takes the member's `clientId` and filters by it; every member page calls `requireProgramsPage()`; every member action checks `requireClient()` and `memberSeesPrograms()` (through the file's `member()` helper) before anything else. Staff see it read-only on the client page.
- A member program's maxes are asked for at start only for the lifts its `percent` exercises use. Its training max is the max (`tmPct` 1).
- Builder limits: 12 weeks, 7 days a week, 15 exercises a day, 10 sets per exercise, names up to 80 characters, notes up to 300. Save validates on the server and returns plain errors with the week, day and exercise ("Week 2, Push A, exercise 3: add reps.").
- An edit to a running member program writes the program row, the enrolment's template, its state and a "You edited the program." change-log event in one transaction, or none of them.
- The member app (`/app`) uses the tenant's brand CSS variables (`--accent`, `--accent-soft`, `--accent-ink`, `--text-*`, `--hairline`, `--surface-*`). Member controls are at least 44px tall and every member screen works at 320px wide with no sideways scroll. Staff pages use the admin theme tokens in `globals.css`.
- Staff `<select>` elements use the global select style in `app/src/app/globals.css` (36px right padding, chevron 12px in). Never set a smaller right padding on a select (`select.pg-input` already has 36px). Buttons and toggles are never cramped.
- Tenant DB changes are ADDITIVE and go in `ensureTenantTables` in `app/src/lib/db/tenant.ts`, inside the existing DIY block, which deliberately throws on failure (never wrap it in a swallowing try/catch). Do NOT add them to `TENANT_MIGRATIONS` in `app/src/lib/db/migrations/index.ts`.
- Never diagnose tenant state from the local `app/data/` files; they are stale dev copies.
- Tests are plain `node:assert/strict` scripts with no framework. Run one with `cd app && npm test -- src/path/file.test.ts`. DB tests make a scratch tenant (control row plus a real tenant DB file) and clean it up.
- Commit after every task with `git add <exact paths>` (never `git add -A` or `git add .`; unrelated untracked files exist). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Full checks before deploy: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`. Deploy is `cd app && railway up --detach`, from `main`.

## Controller decisions (override the plan text where they differ)

- Commit trailer is exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No `railway up` and no `git push` in any task except Task 11, and only when the controller says so.
- Unrelated modified and untracked files exist (`.claude/settings.local.json`, `app/next-env.d.ts`, `design-preview/`, `docs/lead-engine/`, and others). Never stage them.

---

## Decisions the spec left open, and how this plan settles them

1. **Where each rule's numbers live.** The rule sits on the exercise (`ExerciseRx.rule`); the sets keep the per-set numbers they already carry. A range's min and max are on each fixed set, a percent exercise's lift is `ExerciseRx.lift`, RPE targets are RPE sets. Nothing is stored twice, and the planner needs no new set types.
2. **Linear and range starting weights.** The spec asks for maxes only for percent lifts, so a converted StrongLifts cannot work its start weights out from a max. Instead: copying a library program fills each linear and range exercise's optional "Start at" from the member's best logged sets (90 days) where they have them; copying the current program brings its working weights; otherwise the first session plans last time's logged weight for that exercise, or none. The conversion test pins that, given the original's weights, every set the original planned a weight for still gets one.
3. **Percentages and training maxes.** Converted percentages become percentages of the max (`pct x tmPct`), and the member program's training max is its max. From the current program the max carried is `training max / tmPct`, so every planned weight stays the same. A 5/3/1 cycle's automatic training-max rise is not kept: an own-rules max moves on a test day, a member's "Change a max" on My program, or a coach's correction, as the spec says.
4. **RPE sets inside percent exercises.** No platform exercise is RPE-only; RPE sets appear only as the last set of a test day. They convert to the percentage they planned (RPE 10 x 1 is 100%). An RPE-only exercise becomes `rpe` with no lift, so its weight comes from the member's logs.
5. **"Anything else becomes manual"** in detail: bodyweight and `progress: false` exercises, 5/3/1 and fixed-block accessories, GZCLP T3 and mixed sets become `manual`; GZCLP T1 and T2 become `linear`; fixed volume (GVT) becomes `linear` with 10 misses before a deload, the nearest to "never".
6. **Kept maxes need a home.** The spec's table has no column for the maxes a copied current program brings until it is started, so `member_programs` gets `maxes_json`. The start form fills them in as the 1-rep max.
7. **"The max moves on a member edit"** is a "Change a max" form on My program for a member program (`memberSetMax`), not a field in the builder. A percent lift added while running has no max until then; the change log says so.
8. **State key = rule + GZCLP tier + name + rep range.** So a changed rule or a new rep range starts that exercise again (the change log says which). The same exercise with the same rule twice in a program shares one weight, as library programs do.
9. **Following the member through an edit.** The builder sends each week's origin (the saved week it came from), so moving or removing weeks keeps the member on their week; a removed current week moves them to the nearest earlier one, at its first day. Within a kept week the member stays on the same day by name. An open session's `day_position` moves with them, so finishing it runs on the sets it started with; an exercise removed by the edit changes nothing when it finishes.
10. **Changing a weight while running.** Changing an exercise's "Start at" in an edit sets its working weight from the next session; the builder shows the current weight beside it. Untouched start weights leave working weights alone.
11. **Length.** A member program repeats; its weeks are shown as rounds of about 12 weeks in whole blocks (`memberLength`), so a one-week program reads "Week 3 of 12", not "week 1 of 1, round 3".
12. **Day names up to 80 characters.** The shared check allowed 60; it now allows 80 for everyone, to match "names up to 80".
13. **A coach max must not reset rule weights.** `coachSetMax` re-runs `initState` for the lift, which for a member program would reset every rule's working weight to its start. Task 10 skips that for own-rules programs.
14. **Nothing is stored until Save.** A blank program is a draft in the builder; the first Save creates the row. Every stored row passes the check.
15. **Units in the builder** change the unit weights are typed in; everything is stored in kg. The member's display unit is set at start, as now.

**Checked before handing over:** on 2026-11-12 every code block and replacement in this plan was applied, task by task, to a scratch copy of `main` at `3bf1a74`. After each task `npx tsc --noEmit -p .` was clean and that task's tests (plus the library tests it touches) passed. At the end all 369 test files passed and `npx next build` succeeded with the three new routes. The scratch copy was then thrown away. If `main` has moved on, a "replace" text may need finding again, but the code is consistent.

---

## File structure

| File | Responsibility |
|---|---|
| `app/src/lib/programs/types.ts` (modify) | `OwnRule`, `RuleKind`, `RULE_LABEL`, `OwnRulesSettings`; `rule` on exercises and planned exercises |
| `app/src/lib/programs/planner.ts` (modify) | Rule in the state key; last session's weight for an unweighted fixed set |
| `app/src/lib/programs/validate.ts` (modify) | Shape check for rules and own_rules; plain "add reps."; day names to 80 |
| `app/src/lib/programs/engines.ts` (modify) | Per-exercise helpers split out; the `own_rules` engine; start weights in `initState` |
| `app/src/lib/programs/memberTemplate.ts` (create, pure) | Keys, limits, fixed fields, length, the member check |
| `app/src/lib/programs/convert.ts` (create, pure) | A library or current program to own rules |
| `app/src/lib/programs/memberEdit.ts` (create, pure) | Carrying a running state onto an edited version, and the change-log lines |
| `app/src/lib/programs/memberEditing.ts` (create, pure) | Builder helpers: rule switching, weeks with origins, days, exercises |
| `app/src/lib/db/tenant.ts`, `app/src/lib/db/schema.ts` (modify) | Table `member_programs`, drizzle `memberBuiltPrograms` |
| `app/src/lib/programs/enrolments.ts` (modify) | `enrolTemplate`, `writeTemplateEdit`, `memberSetMax`, `lastKg` in `planFor`; coach max fix |
| `app/src/lib/programs/memberPrograms.ts` (create, server) | The member's programs: list, get, starting drafts, create, save (edit while running), delete, start |
| `app/src/app/app/programs/built/actions.ts` (create) | Save and delete actions |
| `app/src/components/clientapp/MemberProgramBuilder.tsx` (create) | The phone builder |
| `app/src/app/app/programs/built/new/page.tsx`, `built/[id]/page.tsx`, `built/[id]/start/page.tsx` (create) | Starting points, edit, start |
| `app/src/components/clientapp/BuiltProgramList.tsx`, `OwnMaxForm.tsx` (create) | Build your own and My programs; a member's own max |
| `app/src/app/app/programs/page.tsx`, `mine/page.tsx`, `actions.ts`, `components/clientapp/StartProgramForm.tsx` (modify) | Programs tab list; Edit program and Change a max; member keys at start; kept maxes |
| `app/src/lib/programs/panel.ts`, `staffView.ts`, `components/clients/ClientProgramPanel.tsx` (modify) | Staff read-only view |
| `app/src/app/globals.css` (modify) | `.mb-*` builder and list styles |

---

### Task 1: The own-rules format: a rule on each exercise, the rule in the state key, last session's weight, and the template check

Library programs must not change: an exercise without a rule keeps its state key and plan exactly as now, so the existing planner, engine and template tests stay green.

**Files:**
- Modify: `app/src/lib/programs/types.ts`
- Modify: `app/src/lib/programs/planner.ts`
- Modify: `app/src/lib/programs/validate.ts`
- Test (create): `app/src/lib/programs/rules.test.ts`

**Interfaces:**
- Consumes: Nothing new. Existing `types.ts`, `planner.ts`, `validate.ts`.
- Produces:
  - `types.ts`: `EngineKey` gains `"own_rules"`; `ENGINE_LABEL.own_rules = "Your own rules"`; `interface OwnRulesSettings { key: "own_rules" }` joins `EngineSettings`.
  - `types.ts`: `type OwnRule = { kind: "linear"; incKg: number; deloadAfter: number; startKg?: number } | { kind: "range"; incKg?: number; startKg?: number } | { kind: "percent" } | { kind: "rpe" } | { kind: "manual"; startKg?: number }`; `type RuleKind = OwnRule["kind"]`; `RULE_KINDS: readonly RuleKind[]` (linear, range, percent, rpe, manual); `RULE_LABEL: Record<RuleKind, string>` ("Add weight", "Rep range", "Percent of max", "RPE", "Manual"); `OWN_DELOAD_PCT = 0.1`.
  - `types.ts`: `ExerciseRx.rule?: OwnRule` and `PlannedExercise.rule?: OwnRule` (so a session's `rx_json` carries the rule it started with).
  - Where each rule's numbers live: a range's min and max are on each set (`{ kind: "fixed", reps: { min, max } }`), a percent exercise's lift is `ExerciseRx.lift`, RPE targets are `{ kind: "rpe" }` sets. The rule holds only what the sets cannot.
  - `planner.ts`: `stateKey(ex: Pick<ExerciseRx, "name" | "tier" | "sets" | "rule">)` puts `"<rule.kind>:"` in front when a rule is set (`"linear:bench press"`, `"range:cable row@8-12"`); unchanged without one. `PlanContext.lastKg?: Record<string, number>` (by state key) is planned for a fixed set the engine has no weight for. `planExercise` copies `rule` onto the planned exercise only when there is one.
  - `validate.ts`: `parseTemplate` accepts `engine: { key: "own_rules" }` and `exercise.rule`; day names take up to 80 characters; an empty rep box (0 or missing) reads "add reps."; rule fields have plain messages ("pick a rule.", "the weight to add must be between 0.5 and 50 kg.", ...); notes read "the notes are too long". `templateErrors` skips the canonical-name check for `own_rules` (members name their own exercises).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/rules.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/rules.test.ts
//
// The own-rules format: a rule on each exercise, the rule in the state key,
// last session's weight for a fixed set with no engine weight, and the
// template check (shape, plain words, any exercise name).
import assert from "node:assert/strict";

import { planExercise, planSession, stateKey } from "./planner";
import { emptyState, type ExerciseRx, type ProgramTemplate } from "./types";
import { parseTemplate, validateTemplate } from "./validate";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const curl: ExerciseRx = { name: "Cable curl", sets: [{ kind: "fixed", reps: { min: 10, max: 15 }, rest: 60 }], rule: { kind: "range" } };

// ── the rule goes in front of the state key; library keys are unchanged ──
assert.equal(stateKey(bench), "linear:bench press");
assert.equal(stateKey(curl), "range:cable curl@10-15");
assert.equal(stateKey({ name: "Bench press", sets: bench.sets }), "bench press");
assert.equal(stateKey({ ...bench, rule: { kind: "manual" } }), "manual:bench press");

// ── a planned exercise carries its rule; a library one has no rule key at all ──
const planned = planExercise(bench, 0, emptyState(), { stepKg: 2.5 });
assert.deepEqual(planned.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3 });
assert.equal("rule" in planExercise({ name: "Bench press", sets: bench.sets }, 0, emptyState(), { stepKg: 2.5 }), false);

// ── fixed sets: the engine's weight, else last session's, else none ──
assert.equal(planExercise(bench, 0, emptyState(), { stepKg: 2.5 }).sets[0].kg, null);
assert.equal(planExercise(bench, 0, emptyState(), { stepKg: 2.5, lastKg: { "linear:bench press": 60 } }).sets[0].kg, 60);
const withWeight = { ...emptyState(), weights: { "linear:bench press": 62.5 } };
assert.equal(planExercise(bench, 0, withWeight, { stepKg: 2.5, lastKg: { "linear:bench press": 60 } }).sets[0].kg, 62.5);

// ── the template check ──
const own = (exercises: ExerciseRx[]): ProgramTemplate => ({
  key: "member:1",
  name: "My program",
  author: "Built by the member",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 1,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Built by the member.",
  description: "Built in the member app.",
  engine: { key: "own_rules" },
  weeks: [{ days: [{ name: "Push A", exercises }] }],
});
assert.ok(validateTemplate(own([bench, curl])).ok, "own rules with a name outside the canonical list pass");
const ownPlan = planSession(own([bench, curl]), emptyState(), { stepKg: 2.5 })!;
assert.equal(ownPlan.exercises[1].rule?.kind, "range");

const libraryStyle = { ...own([curl]), engine: { key: "double_progression" as const } };
const notListed = validateTemplate(libraryStyle);
assert.equal(notListed.ok, false);
assert.deepEqual(!notListed.ok && notListed.errors, ["Week 1, Push A, Cable curl: not in the exercise list."]);

const errorsOf = (t: unknown): string[] => {
  const r = parseTemplate(t);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors;
};
const noReps = errorsOf(own([{ ...bench, sets: [{ kind: "fixed", reps: 0, rest: 120 }] }]));
assert.deepEqual(noReps, ["Week 1, Push A, exercise 1, set 1: add reps."]);
const noTop = errorsOf(own([{ ...curl, sets: [{ kind: "fixed", reps: { min: 10, max: 0 }, rest: 60 }] }]));
assert.equal(noTop[0], "Week 1, Push A, exercise 1, set 1: add reps.");
const tooMany = errorsOf(own([{ ...bench, sets: [{ kind: "fixed", reps: 150, rest: 120 }] }]));
assert.deepEqual(tooMany, ["Week 1, Push A, exercise 1, set 1: reps must be a whole number from 1 to 100."]);
const badInc = errorsOf(own([{ ...bench, rule: { kind: "linear", incKg: 0, deloadAfter: 3 } }]));
assert.deepEqual(badInc, ["Week 1, Push A, exercise 1: the weight to add must be between 0.5 and 50 kg."]);
const badDeload = errorsOf(own([{ ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 0 } }]));
assert.deepEqual(badDeload, ["Week 1, Push A, exercise 1: misses before it gets lighter must be a whole number from 1 to 10."]);
const badStart = errorsOf(own([{ ...bench, rule: { kind: "manual", startKg: 900 } }]));
assert.deepEqual(badStart, ["Week 1, Push A, exercise 1: the starting weight must be between 0 and 600 kg."]);
const badKind = errorsOf(own([{ ...bench, rule: { kind: "guess" } as never }]));
assert.deepEqual(badKind, ["Week 1, Push A, exercise 1: pick a rule."]);
const longDay = own([bench]);
longDay.weeks[0].days[0].name = "x".repeat(80);
assert.ok(parseTemplate(longDay).ok, "day names take up to 80 characters");

console.log("programs/rules: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/rules.test.ts`
Expected: FAIL with an `AssertionError` on the first check: `'bench press' == 'linear:bench press'`.

- [ ] **Step 3: Change `app/src/lib/programs/types.ts`**

In `app/src/lib/programs/types.ts`, make these 7 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export type EngineKey = "linear" | "tm_cycle" | "fixed_block" | "double_progression" | "fixed_volume";
export const ENGINE_LABEL: Record<EngineKey, string> = {
  linear: "Linear, with deloads",
```

with:

```ts
export const LEVEL_LABEL: Record<Level, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" };

export type EngineKey = "linear" | "tm_cycle" | "fixed_block" | "double_progression" | "fixed_volume" | "own_rules";
export const ENGINE_LABEL: Record<EngineKey, string> = {
  linear: "Linear, with deloads",
```

2. Replace:

```ts
  double_progression: "Double progression",
  fixed_volume: "Fixed volume",
};
```

with:

```ts
  double_progression: "Double progression",
  fixed_volume: "Fixed volume",
  own_rules: "Your own rules",
};
```

3. Replace:

```ts
  | { kind: "same_as_last"; reps: Reps; rest: number };

export interface ExerciseRx {
  /** A name from the canonical list (exercises.ts). */
```

with:

```ts
  | { kind: "same_as_last"; reps: Reps; rest: number };

/**
 * How a member-built program (engine own_rules) moves one exercise's weight.
 * - linear: every set is a fixed rep count; a session with every rep adds incKg,
 *   and deloadAfter misses in a row make it 10% lighter.
 * - range: every set is a rep range; when every set reaches the top it adds incKg
 *   (default: the member's smallest jump) and goes back to the bottom.
 * - percent: every set is a percentage of the exercise's lift max (ExerciseRx.lift).
 * - rpe: every set is an RPE target; the weight is suggested from the member's
 *   best logged set of the exercise.
 * - manual: nothing changes; the planned weight is last time's.
 * startKg is the weight the exercise starts at (linear, range, manual).
 */
export type OwnRule =
  | { kind: "linear"; incKg: number; deloadAfter: number; startKg?: number }
  | { kind: "range"; incKg?: number; startKg?: number }
  | { kind: "percent" }
  | { kind: "rpe" }
  | { kind: "manual"; startKg?: number };
export type RuleKind = OwnRule["kind"];
export const RULE_KINDS: readonly RuleKind[] = ["linear", "range", "percent", "rpe", "manual"];
export const RULE_LABEL: Record<RuleKind, string> = {
  linear: "Add weight",
  range: "Rep range",
  percent: "Percent of max",
  rpe: "RPE",
  manual: "Manual",
};
/** An own-rules deload is always 10% lighter. */
export const OWN_DELOAD_PCT = 0.1;

export interface ExerciseRx {
  /** A name from the canonical list (exercises.ts). */
```

4. Replace:

```ts
  joined?: boolean;
  notes?: string;
}
```

with:

```ts
  joined?: boolean;
  notes?: string;
  /** Member-built programs only: how this exercise progresses. */
  rule?: OwnRule;
}
```

5. Replace:

```ts
}

export interface FixedVolumeSettings {
  key: "fixed_volume";
```

with:

```ts
}

/** A member-built program: each exercise carries its own rule. */
export interface OwnRulesSettings {
  key: "own_rules";
}

export interface FixedVolumeSettings {
  key: "fixed_volume";
```

6. Replace:

```ts
}

export type EngineSettings = LinearSettings | TmCycleSettings | FixedBlockSettings | DoubleProgressionSettings | FixedVolumeSettings;

export interface ProgramTemplate {
```

with:

```ts
}

export type EngineSettings = LinearSettings | TmCycleSettings | FixedBlockSettings | DoubleProgressionSettings | FixedVolumeSettings | OwnRulesSettings;

export interface ProgramTemplate {
```

7. Replace:

```ts
  notes: string | null;
  sets: PlannedSet[];
}
```

with:

```ts
  notes: string | null;
  sets: PlannedSet[];
  /** Member-built programs: the exercise's rule, kept in the session's rx_json so an open session finishes on the version it started from. */
  rule?: OwnRule;
}
```


- [ ] **Step 4: Change `app/src/lib/programs/planner.ts`**

In `app/src/lib/programs/planner.ts`, make these 4 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
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
```

with:

```ts
 * The key an exercise's working weight is kept under: its name, its GZCLP
 * tier, and its rep range, so the same lift done in two rep ranges (PHAT)
 * keeps two weights. A member-built exercise's rule goes in front
 * ("linear:bench press"), so changing the rule starts the exercise again.
 */
export function stateKey(ex: Pick<ExerciseRx, "name" | "tier" | "sets" | "rule">): string {
  const base = ex.name.trim().toLowerCase().replace(/\s+/g, " ");
  const first = ex.sets[0];
  const rangeTag = first && first.kind === "fixed" && typeof first.reps !== "number" ? `@${first.reps.min}-${first.reps.max}` : "";
  return `${ex.rule ? `${ex.rule.kind}:` : ""}${ex.tier ? `${ex.tier}:` : ""}${base}${rangeTag}`;
}
```

2. Replace:

```ts
  /** Best estimated max per state key, from the member's logs, for RPE sets. */
  e1rm?: Record<string, number>;
}
```

with:

```ts
  /** Best estimated max per state key, from the member's logs, for RPE sets. */
  e1rm?: Record<string, number>;
  /** Member-built programs: last session's weight per state key, for a fixed set the engine has no weight for yet. */
  lastKg?: Record<string, number>;
}
```

3. Replace:

```ts
    }
    case "fixed":
      return { kg: state.weights[key] ?? null, ...repsOf(s.reps), amrap: s.amrap === true, rpe: null, pct: null, rest: s.rest, drives: false };
    case "same_as_last":
      return { kg: prev ? prev.kg : null, ...repsOf(s.reps), amrap: false, rpe: null, pct: null, rest: s.rest, drives: false };
```

with:

```ts
    }
    case "fixed":
      return { kg: state.weights[key] ?? ctx.lastKg?.[key] ?? null, ...repsOf(s.reps), amrap: s.amrap === true, rpe: null, pct: null, rest: s.rest, drives: false };
    case "same_as_last":
      return { kg: prev ? prev.kg : null, ...repsOf(s.reps), amrap: false, rpe: null, pct: null, rest: s.rest, drives: false };
```

4. Replace:

```ts
    notes: ex.notes ?? null,
    sets,
  };
}
```

with:

```ts
    notes: ex.notes ?? null,
    sets,
    ...(ex.rule ? { rule: ex.rule } : {}),
  };
}
```


- [ ] **Step 5: Change `app/src/lib/programs/validate.ts`**

In `app/src/lib/programs/validate.ts`, make these 7 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
]);

const exerciseZ = z.object({
  name: z.string().trim().min(1).max(80),
```

with:

```ts
]);

const startKgZ = z.number().min(0).max(600).optional();
const ruleZ = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("linear"), incKg: z.number().min(0.5).max(50), deloadAfter: z.number().int().min(1).max(10), startKg: startKgZ }),
  z.object({ kind: z.literal("range"), incKg: z.number().min(0.5).max(50).optional(), startKg: startKgZ }),
  z.object({ kind: z.literal("percent") }),
  z.object({ kind: z.literal("rpe") }),
  z.object({ kind: z.literal("manual"), startKg: startKgZ }),
]);

const exerciseZ = z.object({
  name: z.string().trim().min(1).max(80),
```

2. Replace:

```ts
  joined: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

const dayZ = z.object({ name: z.string().trim().min(1).max(60), exercises: z.array(exerciseZ).min(1).max(20), test: z.boolean().optional() });
const weekZ = z.object({ label: z.string().trim().max(60).optional(), days: z.array(dayZ).min(1).max(7) });
const incrementsZ = z.partialRecord(liftZ, kgZ).optional();
```

with:

```ts
  joined: z.boolean().optional(),
  notes: z.string().max(300).optional(),
  rule: ruleZ.optional(),
});

const dayZ = z.object({ name: z.string().trim().min(1).max(80), exercises: z.array(exerciseZ).min(1).max(20), test: z.boolean().optional() });
const weekZ = z.object({ label: z.string().trim().max(60).optional(), days: z.array(dayZ).min(1).max(7) });
const incrementsZ = z.partialRecord(liftZ, kgZ).optional();
```

3. Replace:

```ts
  z.object({ key: z.literal("double_progression") }),
  z.object({ key: z.literal("fixed_volume"), increment: kgZ, startPct: z.number().min(0.2).max(1) }),
]);
```

with:

```ts
  z.object({ key: z.literal("double_progression") }),
  z.object({ key: z.literal("fixed_volume"), increment: kgZ, startPct: z.number().min(0.2).max(1) }),
  z.object({ key: z.literal("own_rules") }),
]);
```

4. Replace:

```ts
}

function plainMessage(issue: z.core.$ZodIssue, field: string | null): string {
  const max = "maximum" in issue ? Number(issue.maximum) : NaN;
  const label = field ? (FIELD_LABEL[field] ?? field) : "value";
  if (issue.code === "custom") return "the top of the rep range must be at least the bottom.";
  switch (field) {
    case "name":
```

with:

```ts
}

/** A rep count left empty in an editor arrives as nothing or 0. */
function blankReps(v: unknown): boolean {
  return v === undefined || v === null || v === "" || v === 0;
}

function plainMessage(issue: z.core.$ZodIssue, field: string | null, value: unknown): string {
  const max = "maximum" in issue ? Number(issue.maximum) : NaN;
  const label = field ? (FIELD_LABEL[field] ?? field) : "value";
  if (issue.code === "custom") return "the top of the rep range must be at least the bottom.";
  if (issue.path.includes("exercises") && issue.path.includes("rule") && (field === "rule" || field === "kind")) return "pick a rule.";
  switch (field) {
    case "name":
```

5. Replace:

```ts
      return issue.code === "too_big" ? `the ${label} is too long (${max} characters at most).` : `add a ${label}.`;
    case "notes":
    case "warning":
    case "label":
      return `the ${label} is too long (${max} characters at most).`;
    case "reps":
      return "reps must be a whole number from 1 to 100.";
    case "rest":
      return "rest must be between 0 and 900 seconds.";
```

with:

```ts
      return issue.code === "too_big" ? `the ${label} is too long (${max} characters at most).` : `add a ${label}.`;
    case "notes":
      return `the notes are too long (${max} characters at most).`;
    case "warning":
    case "label":
      return `the ${label} is too long (${max} characters at most).`;
    case "reps":
    case "min":
    case "max":
      return blankReps(value) ? "add reps." : "reps must be a whole number from 1 to 100.";
    case "incKg":
      return "the weight to add must be between 0.5 and 50 kg.";
    case "deloadAfter":
      return "misses before it gets lighter must be a whole number from 1 to 10.";
    case "startKg":
      return "the starting weight must be between 0 and 600 kg.";
    case "rest":
      return "rest must be between 0 and 900 seconds.";
```

6. Replace:

```ts
    const messages = parsed.error.issues.map((i) => {
      const { where, field } = whereLabel(raw, i.path);
      const msg = plainMessage(i, field);
      return where ? `${where}: ${msg}` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}`;
    });
```

with:

```ts
    const messages = parsed.error.issues.map((i) => {
      const { where, field } = whereLabel(raw, i.path);
      const msg = plainMessage(i, field, at(raw, i.path));
      return where ? `${where}: ${msg}` : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}`;
    });
```

7. Replace:

```ts
      d.exercises.forEach((e) => {
        const where = `Week ${wi + 1}, ${d.name}, ${e.name}`;
        if (!isCanonical(e.name)) errors.push(`${where}: not in the exercise list.`);
        for (const s of [...e.sets, ...(e.stages ?? []).flat()]) {
          if (s.kind !== "pct" && s.kind !== "amrap") continue;
```

with:

```ts
      d.exercises.forEach((e) => {
        const where = `Week ${wi + 1}, ${d.name}, ${e.name}`;
        // A member names their own exercises (the gym's library or typed in); library programs use the canonical list.
        if (t.engine.key !== "own_rules" && !isCanonical(e.name)) errors.push(`${where}: not in the exercise list.`);
        for (const s of [...e.sets, ...(e.stages ?? []).flat()]) {
          if (s.kind !== "pct" && s.kind !== "amrap") continue;
```


- [ ] **Step 6: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/rules.test.ts
cd app && npm test -- src/lib/programs/validate.test.ts
cd app && npm test -- src/lib/programs/planner.test.ts
cd app && npm test -- src/lib/programs/engines.test.ts
cd app && npm test -- src/lib/programs/registry.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`rules.test.ts` prints `programs/rules: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/programs/types.ts app/src/lib/programs/planner.ts app/src/lib/programs/validate.ts app/src/lib/programs/rules.test.ts
git commit -m "feat(programs): own-rules format, rule-aware state keys and the template check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The own_rules engine, reusing the library engines' per-exercise logic

`linear`, `doubleProgression` and the block test-day reader are split into per-exercise helpers (`linearExercise`, `rangeExercise`, `bestTestSet`) that the library engines and `own_rules` both call. Library behaviour is unchanged; the existing engine and template tests prove it.

**Files:**
- Test (create): `app/src/lib/programs/ownRulesEngine.test.ts`
- Modify: `app/src/lib/programs/engines.ts`

**Interfaces:**
- Consumes: Task 1: `OwnRule`, `OWN_DELOAD_PCT`, `ExerciseRx.rule`, `PlannedExercise.rule`, rule-aware `stateKey`.
- Produces:
  - `progress()` runs `engine.key === "own_rules"`: per planned exercise, by `planned.rule.kind`: `linear` adds `incKg` after every rep, keeps the weight after a miss, and drops 10% after `deloadAfter` misses in a row (the bar floor applies only to an exercise with a lift, as now); `range` adds `incKg ?? stepKg` once every set reaches the top; `manual` keeps the weight used ("Next hammer curl 16 kg, the weight you used."); `percent` and `rpe` change nothing.
  - A test day (`day.test`) in an own-rules program sets `maxes[lift]` to the best set's estimated max and `tms[lift] = trainingMax(max, tmPct)`, with the reason "Your new squat max is about 150 kg, from 150 kg x 1. Its percentages use it from the next session."
  - A result whose `planned.stateKey` is no longer in the template (an open session finished after an edit) changes nothing.
  - `initState` sets `weights[stateKey(ex)] = roundToStep(rule.startKg, stepKg)` for linear, range and manual exercises with a start weight. Nothing else about `initState` changes.
  - Skipping and wrapping are the library's: own-rules programs repeat (`advance` wraps, `finished` stays false).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/ownRulesEngine.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/ownRulesEngine.test.ts
//
// The own_rules engine: one session with all five rules gives the right
// weights and reasons; starting weights; a linear deload; a range with its own
// jump; a test day moves the max; an exercise no longer in the program
// changes nothing; skipping and finishing wrap a repeating week.
import assert from "node:assert/strict";

import { initState, progress, skipSession } from "./engines";
import { planSession } from "./planner";
import type { DoneSet, EngineState, ExerciseRx, PlannedSession, ProgramTemplate, SessionResult } from "./types";

const squat: ExerciseRx = {
  name: "Back squat",
  lift: "squat",
  sets: [
    { kind: "pct", pct: 0.75, reps: 5, rest: 180 },
    { kind: "amrap", pct: 0.85, reps: 3, rest: 180 },
  ],
  rule: { kind: "percent" },
};
const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 2, startKg: 60 } };
const row: ExerciseRx = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }, { kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range", incKg: 5, startKg: 50 } };
const press: ExerciseRx = { name: "Incline dumbbell press", sets: [{ kind: "rpe", rpe: 8, reps: 8, rest: 120 }], rule: { kind: "rpe" } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual", startKg: 15 } };

const t: ProgramTemplate = {
  key: "member:1",
  name: "My program",
  author: "Built by the member",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 2,
  lengthWeeks: 12,
  lifts: ["squat"],
  tmPct: 1,
  who: "Built by the member.",
  description: "Built in the member app.",
  engine: { key: "own_rules" },
  weeks: [{ days: [{ name: "Day A", exercises: [squat, bench, row, press, curl] }, { name: "Test", exercises: [{ ...squat, sets: [{ kind: "pct", pct: 0.9, reps: 1, rest: 240 }, { kind: "pct", pct: 1, reps: 1, rest: 300 }] }], test: true }] }],
};
const ctx = { stepKg: 2.5, e1rm: { "rpe:incline dumbbell press": 40 } };

// ── starting weights come from each rule; percentages from the max ──
const s0 = initState(t, { squat: 140 }, 2.5);
assert.deepEqual(s0.weights, { "linear:bench press": 60, "range:cable row@8-12": 50, "manual:hammer curl": 15 });
assert.equal(s0.tms.squat, 140);
const plan = planSession(t, s0, ctx)!;
assert.deepEqual(plan.exercises.map((e) => e.sets.map((s) => s.kg)), [[105, 120], [60, 60], [50, 50], [30], [15]]);
assert.deepEqual(plan.exercises.map((e) => e.rule?.kind), ["percent", "linear", "range", "rpe", "manual"]);

const done = (p: PlannedSession, pick: (exIndex: number, setIndex: number, kg: number | null, reps: number, repsMax: number | null) => DoneSet): SessionResult => ({
  exercises: p.exercises.map((e, ei) => ({ planned: e, sets: e.sets.map((s, si) => pick(ei, si, s.kg, s.reps, s.repsMax)) })),
});
const run = (state: EngineState, result: SessionResult) => progress({ template: t, state, result, stepKg: 2.5, unit: "kg" });

// ── the rule mix: every rep, the top of the range, a heavier curl ──
const r1 = run(
  s0,
  done(plan, (ei, _si, kg, reps, repsMax) => ({ kg: ei === 4 ? 16 : kg, reps: repsMax ?? reps, done: true })),
);
assert.deepEqual(r1.state.weights, { "linear:bench press": 62.5, "range:cable row@8-12": 55, "manual:hammer curl": 16 });
assert.deepEqual(r1.reasons, [
  "Next bench press 62.5 kg. You did all 2 sets of 5.",
  "Next cable row 55 kg, back to 8 reps. You hit 12 on every set.",
  "Next hammer curl 16 kg, the weight you used.",
]);
assert.equal(r1.state.tms.squat, 140, "a percent exercise never moves the max on a normal day");
assert.deepEqual([r1.state.week, r1.state.day], [0, 1]);

// ── misses: bench stays, then drops 10% after two in a row; the row keeps its weight ──
const missAll = (state: EngineState) => run(state, done(planSession(t, state, ctx)!, (_ei, si, kg, reps) => ({ kg, reps: si === 1 ? reps - 2 : reps, done: true })));
const m1 = missAll({ ...r1.state, day: 0 });
assert.equal(m1.state.weights["linear:bench press"], 62.5);
assert.equal(m1.reasons[0], "Bench press stays at 62.5 kg. You got 3 of 5 on set 2. Try it again next time.");
assert.equal(m1.state.weights["range:cable row@8-12"], 55);
const m2 = missAll({ ...m1.state, day: 0 });
assert.equal(m2.state.weights["linear:bench press"], 57.5);
assert.equal(m2.reasons[0], "Next bench press 57.5 kg, 10% lighter. You missed reps two sessions in a row.");

// ── a range rule with no jump of its own uses the smallest jump ──
const tSmall: ProgramTemplate = { ...t, weeks: [{ days: [{ name: "Day A", exercises: [{ ...row, rule: { kind: "range" } }] }] }] };
const sSmall = initState(tSmall, {}, 2.5);
assert.equal(sSmall.weights["range:cable row@8-12"], undefined, "no start weight: the first session sets it");
const pSmall = planSession(tSmall, sSmall, { stepKg: 2.5, lastKg: { "range:cable row@8-12": 45 } })!;
assert.equal(pSmall.exercises[0].sets[0].kg, 45, "last session's weight is planned");
const rSmall = progress({ template: tSmall, state: sSmall, result: done(pSmall, (_e, _s, kg, _r, repsMax) => ({ kg, reps: repsMax!, done: true })), stepKg: 2.5, unit: "kg" });
assert.equal(rSmall.state.weights["range:cable row@8-12"], 47.5);

// ── a test day moves the squat max, and its percentages follow ──
const atTest = { ...r1.state, week: 0, day: 1 };
const testPlan = planSession(t, atTest, ctx)!;
assert.equal(testPlan.test, true);
const rt = run(atTest, done(testPlan, (_ei, si, kg) => ({ kg: si === 1 ? 150 : kg, reps: 1, done: true })));
assert.equal(rt.state.maxes.squat, 150);
assert.equal(rt.state.tms.squat, 150);
assert.equal(rt.reasons.at(-1), "Your new squat max is about 150 kg, from 150 kg x 1. Its percentages use it from the next session.");
assert.deepEqual([rt.state.week, rt.state.day, rt.state.cycle], [0, 0, 1], "the week repeats");
assert.equal(planSession(t, rt.state, ctx)!.exercises[0].sets[0].kg, 112.5);
const noTest = run(atTest, done(testPlan, () => ({ kg: null, reps: null, done: false })));
assert.equal(noTest.state.maxes.squat, 140);
assert.equal(noTest.reasons.at(-1), "No squat max from today. It stays at 140 kg.");

// ── an exercise no longer in the program (finished after an edit) changes nothing ──
const edited: ProgramTemplate = { ...t, weeks: [{ days: [{ name: "Day A", exercises: [squat, row, press, curl] }, t.weeks[0].days[1]] }] };
const r2 = progress({ template: edited, state: s0, result: done(plan, (_ei, _si, kg, reps, repsMax) => ({ kg, reps: repsMax ?? reps, done: true })), stepKg: 2.5, unit: "kg" });
assert.equal(r2.state.weights["linear:bench press"], 60, "bench was removed, so its weight is untouched");
assert.ok(!r2.reasons.some((x) => x.includes("bench")));

// ── skipping moves on and wraps ──
const sk = skipSession(t, { ...s0, day: 1 });
assert.deepEqual([sk.state.week, sk.state.day, sk.state.cycle, sk.state.finished], [0, 0, 1, false]);
assert.deepEqual(sk.reasons, []);

console.log("programs/ownRulesEngine: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/ownRulesEngine.test.ts`
Expected: FAIL with an `AssertionError` on the first `deepEqual`: `initState` returns `{}` for the weights.

- [ ] **Step 3: Change `app/src/lib/programs/engines.ts`**

In `app/src/lib/programs/engines.ts`, make these 8 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
import {
  LIFT_LABEL,
  emptyState,
  type EngineState,
  type ExerciseResult,
  type FixedVolumeSettings,
  type LiftKey,
```

with:

```ts
import {
  LIFT_LABEL,
  OWN_DELOAD_PCT,
  emptyState,
  type EngineState,
  type ExerciseResult,
  type ExerciseRx,
  type FixedVolumeSettings,
  type LiftKey,
```

2. Replace:

```ts
}

/** The state a member starts a program with, from their maxes. */
export function initState(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, stepKg: number): EngineState {
```

with:

```ts
}

/** A member-built exercise's starting weight, if its rule has one. */
function ownStartKg(ex: ExerciseRx): number | undefined {
  const r = ex.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return undefined;
  return r.startKg !== undefined && r.startKg > 0 ? r.startKg : undefined;
}

/** The state a member starts a program with, from their maxes. */
export function initState(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, stepKg: number): EngineState {
```

3. Replace:

```ts
      for (const ex of d.exercises) {
        const key = stateKey(ex);
        if (key in s.weights || !progresses(ex) || !ex.lift) continue;
        const startPct = ex.startPct ?? fallback;
        const max = s.maxes[ex.lift];
```

with:

```ts
      for (const ex of d.exercises) {
        const key = stateKey(ex);
        if (key in s.weights || !progresses(ex)) continue;
        const own = ownStartKg(ex);
        if (own !== undefined) {
          s.weights[key] = roundToStep(own, stepKg);
          continue;
        }
        if (!ex.lift) continue;
        const startPct = ex.startPct ?? fallback;
        const max = s.maxes[ex.lift];
```

4. Replace:

```ts
}

function linear(c: Ctx, s: LinearSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const prev: number | undefined = c.state.weights[p.stateKey];
    const used: number | undefined = workingKg(r) ?? prev;
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
      const raw = roundToStep(used * (1 - s.deloadPct), c.stepKg);
      const bar = p.lift ? barKg(c.stepKg) : 0;
      const next = Math.max(bar, raw);
      c.state.weights[p.stateKey] = next;
      c.state.misses[p.stateKey] = 0;
      const why = misses === 1 ? missText(r) : `You missed reps ${countWord(misses)} sessions in a row.`;
      if (raw >= bar) c.reasons.push(`Next ${name} ${c.fmt(next)}, ${Math.round(s.deloadPct * 100)}% lighter. ${why}`);
      else if (prev !== undefined && sameKg(prev, next)) c.reasons.push(`${p.name} stays at ${c.fmt(next)}, the empty bar. ${why}`);
      else c.reasons.push(`Next ${name} ${c.fmt(next)}, the empty bar. ${why}`);
    } else {
      c.state.weights[p.stateKey] = used;
      c.state.misses[p.stateKey] = misses;
      if (prev !== undefined && sameKg(prev, used)) c.reasons.push(`${p.name} stays at ${c.fmt(used)}. ${missText(r)} Try it again next time.`);
      else c.reasons.push(`Next ${name} ${c.fmt(used)}, the weight you used. ${missText(r)}`);
    }
  }
}
```

with:

```ts
}

type LinearRule = Pick<LinearSettings, "increment" | "increments" | "deloadAfter" | "deloadPct" | "doubleAt">;

/** One exercise under linear progression: up after every rep, the same after a miss, lighter after deloadAfter misses in a row. */
function linearExercise(c: Ctx, r: ExerciseResult, s: LinearRule): void {
  const p = r.planned;
  if (!p.progresses) return;
  const prev: number | undefined = c.state.weights[p.stateKey];
  const used: number | undefined = workingKg(r) ?? prev;
  if (used === undefined) return;
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
    return;
  }
  const misses = (c.state.misses[p.stateKey] ?? 0) + 1;
  if (misses >= s.deloadAfter) {
    const raw = roundToStep(used * (1 - s.deloadPct), c.stepKg);
    const bar = p.lift ? barKg(c.stepKg) : 0;
    const next = Math.max(bar, raw);
    c.state.weights[p.stateKey] = next;
    c.state.misses[p.stateKey] = 0;
    const why = misses === 1 ? missText(r) : `You missed reps ${countWord(misses)} sessions in a row.`;
    if (raw >= bar) c.reasons.push(`Next ${name} ${c.fmt(next)}, ${Math.round(s.deloadPct * 100)}% lighter. ${why}`);
    else if (prev !== undefined && sameKg(prev, next)) c.reasons.push(`${p.name} stays at ${c.fmt(next)}, the empty bar. ${why}`);
    else c.reasons.push(`Next ${name} ${c.fmt(next)}, the empty bar. ${why}`);
  } else {
    c.state.weights[p.stateKey] = used;
    c.state.misses[p.stateKey] = misses;
    if (prev !== undefined && sameKg(prev, used)) c.reasons.push(`${p.name} stays at ${c.fmt(used)}. ${missText(r)} Try it again next time.`);
    else c.reasons.push(`Next ${name} ${c.fmt(used)}, the weight you used. ${missText(r)}`);
  }
}

function linear(c: Ctx, s: LinearSettings): void {
  for (const r of c.result.exercises) linearExercise(c, r, s);
}
```

5. Replace:

```ts
}

function fixedBlock(c: Ctx): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
```

with:

```ts
}

/** The ticked set with the highest estimated max (sets of 1 to 10 reps). */
function bestTestSet(r: ExerciseResult): { e1: number; kg: number; reps: number } | null {
  let best: { e1: number; kg: number; reps: number } | null = null;
  for (const d of r.sets) {
    if (!d.done || d.kg === null || d.reps === null) continue;
    const e1 = maxFromSet(d.kg, d.reps);
    if (e1 !== null && (!best || e1 > best.e1)) best = { e1, kg: d.kg, reps: d.reps };
  }
  return best;
}

function fixedBlock(c: Ctx): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
```

6. Replace:

```ts
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
```

with:

```ts
      const lift = r.planned.lift;
      if (!lift) continue;
      const best = bestTestSet(r);
      const label = LIFT_LABEL[lift].toLowerCase();
      if (best) {
```

7. Replace:

```ts
}

function doubleProgression(c: Ctx): void {
  let firsts = 0;
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses || p.sets.length === 0) continue;
    const used = workingKg(r);
    if (used === null) continue;
    const prev: number | undefined = c.state.weights[p.stateKey];
    if (hitTop(r)) {
      const next = roundToStep(used + c.stepKg, c.stepKg);
      c.state.weights[p.stateKey] = next;
      const first = p.sets[0];
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}, back to ${first.reps} reps. You hit ${first.repsMax ?? first.reps} on every set.`);
    } else {
      c.state.weights[p.stateKey] = used;
      if (prev === undefined) firsts++;
      else if (!sameKg(prev, used)) c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used.`);
    }
  }
  if (firsts > 0) c.reasons.push("Weights saved from today. Each one goes up when you reach the top of its rep range on every set.");
}
```

with:

```ts
}

const FIRST_RANGE_WEIGHTS = "Weights saved from today. Each one goes up when you reach the top of its rep range on every set.";

/** One exercise under double progression: up by `inc` and back to the bottom of the range once every set reaches the top. True when this is its first saved weight. */
function rangeExercise(c: Ctx, r: ExerciseResult, inc: number): boolean {
  const p = r.planned;
  if (!p.progresses || p.sets.length === 0) return false;
  const used = workingKg(r);
  if (used === null) return false;
  const prev: number | undefined = c.state.weights[p.stateKey];
  if (hitTop(r)) {
    const next = roundToStep(used + inc, c.stepKg);
    c.state.weights[p.stateKey] = next;
    const first = p.sets[0];
    c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}, back to ${first.reps} reps. You hit ${first.repsMax ?? first.reps} on every set.`);
    return false;
  }
  c.state.weights[p.stateKey] = used;
  if (prev === undefined) return true;
  if (!sameKg(prev, used)) c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used.`);
  return false;
}

function doubleProgression(c: Ctx): void {
  let firsts = 0;
  for (const r of c.result.exercises) if (rangeExercise(c, r, c.stepKg)) firsts++;
  if (firsts > 0) c.reasons.push(FIRST_RANGE_WEIGHTS);
}

/** Manual: nothing goes up or down; the weight used is kept for next time. */
function manualExercise(c: Ctx, r: ExerciseResult): void {
  const p = r.planned;
  if (!p.progresses) return;
  const used = workingKg(r);
  if (used === null) return;
  const prev: number | undefined = c.state.weights[p.stateKey];
  c.state.weights[p.stateKey] = used;
  if (prev === undefined || !sameKg(prev, used)) c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used.`);
}

/** A test day in a member-built program: each lift's max moves to the best set, and its percentages use it from the next session. */
function ownTestMaxes(c: Ctx): void {
  for (const r of c.result.exercises) {
    const lift = r.planned.lift;
    if (!lift || !c.template.lifts.includes(lift)) continue;
    const label = LIFT_LABEL[lift].toLowerCase();
    const best = bestTestSet(r);
    if (!best) {
      const cur = c.state.maxes[lift];
      c.reasons.push(cur !== undefined ? `No ${label} max from today. It stays at ${c.fmt(cur)}.` : `No ${label} max from today.`);
      continue;
    }
    const e1 = Math.round(best.e1 * 100) / 100;
    c.state.maxes[lift] = e1;
    c.state.tms[lift] = trainingMax(e1, c.template.tmPct);
    c.reasons.push(`Your new ${label} max is about ${c.fmt(roundToStep(e1, c.stepKg))}, from ${c.fmt(best.kg)} x ${best.reps}. Its percentages use it from the next session.`);
  }
}

/**
 * A member-built program: each exercise moves by its own rule, with the same
 * per-exercise logic the library engines use. An exercise no longer in the
 * program (an open session finished after an edit) changes nothing.
 */
function ownRules(c: Ctx): void {
  const live = new Set(c.template.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((ex) => stateKey(ex)))));
  let firsts = 0;
  for (const r of c.result.exercises) {
    const rule = r.planned.rule;
    if (!rule || !live.has(r.planned.stateKey)) continue;
    switch (rule.kind) {
      case "linear":
        linearExercise(c, r, { increment: rule.incKg, deloadAfter: rule.deloadAfter, deloadPct: OWN_DELOAD_PCT });
        break;
      case "range":
        if (rangeExercise(c, r, rule.incKg ?? c.stepKg)) firsts++;
        break;
      case "manual":
        manualExercise(c, r);
        break;
      case "percent":
      case "rpe":
        break;
      default: {
        const never: never = rule;
        return never;
      }
    }
  }
  if (firsts > 0) c.reasons.push(FIRST_RANGE_WEIGHTS);
  if (c.template.weeks[c.state.week]?.days[c.state.day]?.test) ownTestMaxes(c);
}
```

8. Replace:

```ts
      fixedVolume(c, e);
      break;
  }
  if (c.atCycleEnd) c.reasons.push(...endOfCycle(t, c.state, c.fmt));
```

with:

```ts
      fixedVolume(c, e);
      break;
    case "own_rules":
      ownRules(c);
      break;
  }
  if (c.atCycleEnd) c.reasons.push(...endOfCycle(t, c.state, c.fmt));
```


- [ ] **Step 4: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/ownRulesEngine.test.ts
cd app && npm test -- src/lib/programs/engines.test.ts
cd app && npm test -- src/lib/programs/templates/beginner.test.ts
cd app && npm test -- src/lib/programs/templates/strength.test.ts
cd app && npm test -- src/lib/programs/templates/peaking.test.ts
cd app && npm test -- src/lib/programs/templates/size.test.ts
cd app && npm test -- src/lib/programs/registry.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`ownRulesEngine.test.ts` prints `programs/ownRulesEngine: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/ownRulesEngine.test.ts app/src/lib/programs/engines.ts
git commit -m "feat(programs): own_rules engine on the library engines' per-exercise logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Member program shape: limits, fixed fields and the plain-words check

One place decides what a member program is: the fields the member never picks are filled in here, and the builder's limits and each rule's set shape are checked here.

**Files:**
- Test (create): `app/src/lib/programs/memberTemplate.test.ts`
- Create: `app/src/lib/programs/memberTemplate.ts`

**Interfaces:**
- Consumes: Task 1 (`OwnRule`, own_rules in `parseTemplate`/`templateErrors`). Existing `editing.ts` `mostDays`.
- Produces:
  - `MEMBER_LIMITS = { weeks: 12, days: 7, exercises: 15, sets: 10, name: 80, notes: 300 }`, `MEMBER_AUTHOR = "Built by the member"`, `MEMBER_PREFIX = "member:"`.
  - `memberKey(id: number): string` ("member:7"); `parseMemberKey(key: string): number | null`.
  - `memberLength(weeks: number): number`: about 12 weeks in whole blocks (1, 2, 4 weeks give 12; 5 gives 15; 7 gives 14), so a one-week program reads "Week 3 of 12".
  - `memberLine(t): string`: "3 days a week, 2 weeks that repeat".
  - `percentLifts(t): LiftKey[]`: the lifts its percent exercises use, in `LIFT_KEYS` order.
  - `finishMemberTemplate(t: ProgramTemplate, key: string): ProgramTemplate`: key, author, `engine: { key: "own_rules" }`, `tmPct: 1`, `lifts = percentLifts`, `daysPerWeek = mostDays`, `lengthWeeks = memberLength`, `who`; only a percent exercise keeps `lift`; the first exercise of a day is never `joined`; `stages`, `startPct`, `progress` and `warning` are dropped.
  - `blankMemberTemplate(): ProgramTemplate`: key "member:new", name "My program", one week, one day "Day 1", no exercises.
  - `memberTemplateErrors(t): string[]` and `validateMemberTemplate(raw: unknown, key: string): TemplateCheck` (from `validate.ts`: `{ ok: true; template } | { ok: false; errors: string[] }`). Errors read "Week 2, Push A, exercise 3: add reps."

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/memberTemplate.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/memberTemplate.test.ts
//
// Builder validation: the fields a member never picks are filled in, errors
// read in plain words with the week, day and exercise, and the limits hold.
import assert from "node:assert/strict";

import { blankMemberTemplate, finishMemberTemplate, memberKey, memberLength, memberLine, parseMemberKey, percentLifts, validateMemberTemplate } from "./memberTemplate";
import type { ExerciseRx, ProgramTemplate } from "./types";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }], rule: { kind: "percent" } };

function program(mutate: (t: ProgramTemplate) => void = () => {}): ProgramTemplate {
  const t = blankMemberTemplate();
  t.name = "Strength block";
  t.weeks = [{ days: [{ name: "Push A", exercises: [structuredClone(squat), structuredClone(bench)] }] }];
  mutate(t);
  return t;
}

function errorsOf(t: ProgramTemplate): string[] {
  const r = validateMemberTemplate(t, memberKey(7));
  assert.equal(r.ok, false, "expected errors");
  return r.ok ? [] : r.errors;
}

// ── keys ──
assert.equal(memberKey(7), "member:7");
assert.equal(parseMemberKey("member:7"), 7);
assert.equal(parseMemberKey("member:x"), null);
assert.equal(parseMemberKey("copy-7"), null);

// ── lengths: about 12 weeks in whole blocks ──
assert.deepEqual([1, 2, 4, 5, 7, 12].map(memberLength), [12, 12, 12, 15, 14, 12]);

// ── the line on the member's list ──
assert.equal(memberLine(program()), "1 day a week, one week that repeats");
assert.equal(memberLine(program((p) => void (p.weeks = [{ days: [p.weeks[0].days[0], p.weeks[0].days[0], p.weeks[0].days[0]] }, p.weeks[0]]))), "3 days a week, 2 weeks that repeat");

// ── what the member never picks ──
const ok = validateMemberTemplate(
  program((t) => {
    t.key = "anything";
    t.author = "Someone else";
    t.tmPct = 0.9;
    t.lifts = ["bench", "deadlift"];
    t.weeks[0].days[0].exercises[0].joined = true;
    t.weeks[0].days[0].exercises[1].lift = "bench";
  }),
  memberKey(7),
);
assert.ok(ok.ok, JSON.stringify(ok));
const t = ok.template;
assert.equal(t.key, "member:7");
assert.equal(t.author, "Built by the member");
assert.deepEqual(t.engine, { key: "own_rules" });
assert.equal(t.tmPct, 1);
assert.deepEqual(t.lifts, ["squat"], "a max only for lifts a percent exercise uses");
assert.equal(t.weeks[0].days[0].exercises[0].joined, undefined, "the first exercise joins nothing");
assert.equal(t.weeks[0].days[0].exercises[1].lift, undefined, "only a percent exercise keeps a lift");
assert.equal(t.daysPerWeek, 1);
assert.equal(t.lengthWeeks, 12);
assert.deepEqual(percentLifts(t), ["squat"]);
assert.deepEqual(finishMemberTemplate(t, "member:7"), t, "finishing is stable");

// ── a blank program needs an exercise ──
assert.deepEqual(errorsOf(blankMemberTemplate()), ["Week 1, Day 1: add at least one exercise."]);

// ── plain words with the week, day and exercise ──
assert.deepEqual(
  errorsOf(
    program((p) => {
      p.weeks.push(structuredClone(p.weeks[0]));
      p.weeks[1].days[0].exercises[1].sets[0] = { kind: "fixed", reps: 0, rest: 120 };
    }),
  ),
  ["Week 2, Push A, exercise 2, set 1: add reps."],
);
assert.deepEqual(errorsOf(program((p) => void delete p.weeks[0].days[0].exercises[1].rule)), ["Week 1, Push A, exercise 2: pick a rule."]);
assert.deepEqual(errorsOf(program((p) => void delete p.weeks[0].days[0].exercises[0].lift)), ["Week 1, Push A, exercise 1: pick the max it uses."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[0].sets = [{ kind: "pct", pct: 1.5, reps: 1, rest: 60 }]))),
  ["Week 1, Push A, exercise 1: 150% is outside 30% to 110%."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].rule = { kind: "range" }))),
  ["Week 1, Push A, exercise 2: every set needs a rep range."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].rule = { kind: "rpe" }))),
  ["Week 1, Push A, exercise 2: every set needs an RPE."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].sets = [{ kind: "fixed", reps: { min: 5, max: 8 }, rest: 60 }]))),
  ["Week 1, Push A, exercise 2: every set needs a rep count."],
);
assert.deepEqual(errorsOf(program((p) => void (p.name = ""))), ["Add a name."]);

// ── limits: 12 weeks, 7 days, 15 exercises, 10 sets, 80-character names, 300-character notes ──
assert.deepEqual(errorsOf(program((p) => void (p.weeks = Array.from({ length: 13 }, () => structuredClone(p.weeks[0]))))), ["No more than 12 weeks."]);
assert.ok(validateMemberTemplate(program((p) => void (p.weeks = Array.from({ length: 12 }, () => structuredClone(p.weeks[0])))), "member:7").ok);
assert.deepEqual(errorsOf(program((p) => void (p.weeks[0].days = Array.from({ length: 8 }, (_, i) => ({ name: `Day ${i + 1}`, exercises: [structuredClone(bench)] }))))), ["Week 1: no more than 7 days."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises = Array.from({ length: 16 }, () => structuredClone(bench))))),
  ["Week 1, Push A: no more than 15 exercises in a day."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].sets = Array.from({ length: 11 }, () => ({ kind: "fixed" as const, reps: 5, rest: 60 }))))),
  ["Week 1, Push A, exercise 2: no more than 10 sets in an exercise."],
);
assert.deepEqual(errorsOf(program((p) => void (p.name = "x".repeat(81)))), ["The name is too long (80 characters at most)."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].notes = "x".repeat(301)))),
  ["Week 1, Push A, exercise 2: the notes are too long (300 characters at most)."],
);
assert.ok(validateMemberTemplate(program((p) => void (p.weeks[0].days[0].exercises[1].name = "Cable crossover, low to high")), "member:7").ok, "any exercise name");

console.log("programs/memberTemplate: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/memberTemplate.test.ts`
Expected: FAIL with `Cannot find module './memberTemplate'`.

- [ ] **Step 3: Create `app/src/lib/programs/memberTemplate.ts`**

Create `app/src/lib/programs/memberTemplate.ts` with exactly this content:

```ts
// app/src/lib/programs/memberTemplate.ts
/**
 * Member-built programs (docs/superpowers/specs/2026-11-12-member-built-programs-design.md):
 * the fields a member never picks, the builder's limits, and the check a
 * member program must pass before it is saved. Pure.
 */
import { mostDays } from "./editing";
import { LIFT_KEYS, type ExerciseRx, type LiftKey, type ProgramTemplate } from "./types";
import { parseTemplate, templateErrors, type TemplateCheck } from "./validate";

export const MEMBER_LIMITS = { weeks: 12, days: 7, exercises: 15, sets: 10, name: 80, notes: 300 } as const;
export const MEMBER_AUTHOR = "Built by the member";
export const MEMBER_PREFIX = "member:";

export function memberKey(id: number): string {
  return `${MEMBER_PREFIX}${id}`;
}

export function parseMemberKey(key: string): number | null {
  if (!key.startsWith(MEMBER_PREFIX)) return null;
  const n = Number(key.slice(MEMBER_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A member program repeats; its weeks are shown as a round of about 12 weeks, in whole blocks. */
export function memberLength(weeks: number): number {
  const n = Math.max(1, weeks);
  return n * Math.max(1, Math.ceil(12 / n));
}

/** "3 days a week, one week that repeats", "4 days a week, 6 weeks that repeat". */
export function memberLine(t: Pick<ProgramTemplate, "weeks">): string {
  const days = mostDays(t);
  const weeks = t.weeks.length;
  return `${days} ${days === 1 ? "day" : "days"} a week, ${weeks === 1 ? "one week that repeats" : `${weeks} weeks that repeat`}`;
}

/** The lifts a member program asks a max for: the ones its percent exercises use. */
export function percentLifts(t: Pick<ProgramTemplate, "weeks">): LiftKey[] {
  const used = new Set<LiftKey>();
  for (const w of t.weeks) for (const d of w.days) for (const e of d.exercises) if (e.rule?.kind === "percent" && e.lift) used.add(e.lift);
  return LIFT_KEYS.filter((l) => used.has(l));
}

function cleanExercise(e: ExerciseRx, first: boolean): ExerciseRx {
  const out: ExerciseRx = { name: e.name.trim(), sets: e.sets };
  if (e.rule?.kind === "percent" && e.lift) out.lift = e.lift;
  if (e.tier) out.tier = e.tier;
  if (e.bodyweight) out.bodyweight = true;
  if (e.joined && !first) out.joined = true;
  if (e.notes && e.notes.trim()) out.notes = e.notes.trim();
  if (e.rule) out.rule = e.rule;
  return out;
}

/**
 * Everything a member does not choose: the key, the own-rules engine, a max
 * for each percent lift (training max = max), days a week and the length.
 * Only a percent exercise keeps a lift, and the first exercise of a day joins nothing.
 */
export function finishMemberTemplate(t: ProgramTemplate, key: string): ProgramTemplate {
  const weeks = t.weeks.map((w) => ({
    ...(w.label && w.label.trim() ? { label: w.label.trim() } : {}),
    days: w.days.map((d) => ({ name: d.name.trim(), exercises: d.exercises.map((e, i) => cleanExercise(e, i === 0)), ...(d.test ? { test: true } : {}) })),
  }));
  return {
    key,
    name: t.name.trim(),
    author: MEMBER_AUTHOR,
    family: t.family,
    level: t.level,
    daysPerWeek: mostDays({ weeks }),
    lengthWeeks: memberLength(weeks.length),
    lifts: percentLifts({ weeks }),
    tmPct: 1,
    who: "Built by the member.",
    description: t.description,
    engine: { key: "own_rules" },
    weeks,
  };
}

/** One week, one day, no exercises. */
export function blankMemberTemplate(): ProgramTemplate {
  return {
    key: "member:new",
    name: "My program",
    author: MEMBER_AUTHOR,
    family: "strength",
    level: "intermediate",
    daysPerWeek: 1,
    lengthWeeks: memberLength(1),
    lifts: [],
    tmPct: 1,
    who: "Built by the member.",
    description: "A program the member built in the app.",
    engine: { key: "own_rules" },
    weeks: [{ days: [{ name: "Day 1", exercises: [] }] }],
  };
}

const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;

/** The builder's limits and each rule's set shape, in the words the builder uses. */
export function memberTemplateErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  if (t.weeks.length > MEMBER_LIMITS.weeks) errors.push(`No more than ${MEMBER_LIMITS.weeks} weeks.`);
  t.weeks.forEach((w, wi) => {
    if (w.days.length > MEMBER_LIMITS.days) errors.push(`Week ${wi + 1}: no more than ${MEMBER_LIMITS.days} days.`);
    w.days.forEach((d) => {
      const day = `Week ${wi + 1}, ${d.name}`;
      if (d.exercises.length > MEMBER_LIMITS.exercises) errors.push(`${day}: no more than ${MEMBER_LIMITS.exercises} exercises in a day.`);
      d.exercises.forEach((e, xi) => {
        const where = `${day}, exercise ${xi + 1}`;
        if (e.sets.length > MEMBER_LIMITS.sets) errors.push(`${where}: no more than ${MEMBER_LIMITS.sets} sets in an exercise.`);
        const r = e.rule;
        if (!r) return void errors.push(`${where}: pick a rule.`);
        switch (r.kind) {
          case "linear":
            if (!e.sets.every((s) => s.kind === "fixed" && typeof s.reps === "number")) errors.push(`${where}: every set needs a rep count.`);
            break;
          case "range":
            if (!e.sets.every((s) => s.kind === "fixed" && typeof s.reps !== "number")) errors.push(`${where}: every set needs a rep range.`);
            break;
          case "percent":
            if (!e.lift) errors.push(`${where}: pick the max it uses.`);
            for (const s of e.sets) {
              if (s.kind !== "pct" && s.kind !== "amrap") errors.push(`${where}: every set needs a percentage.`);
              else if (s.pct < 0.3 || s.pct > 1.1) errors.push(`${where}: ${pctText(s.pct)} is outside 30% to 110%.`);
            }
            break;
          case "rpe":
            if (!e.sets.every((s) => s.kind === "rpe")) errors.push(`${where}: every set needs an RPE.`);
            break;
          case "manual":
            if (!e.sets.every((s) => s.kind === "fixed")) errors.push(`${where}: every set needs reps.`);
            break;
          default: {
            const never: never = r;
            return never;
          }
        }
      });
    });
  });
  return [...new Set(errors)].slice(0, 20);
}

/** The whole check for a member program: shape in plain words, the builder's rules, then the library's template rules. */
export function validateMemberTemplate(raw: unknown, key: string): TemplateCheck {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return parsed;
  const t = finishMemberTemplate(parsed.template, key);
  const mine = memberTemplateErrors(t);
  if (mine.length) return { ok: false, errors: mine };
  const rest = templateErrors(t);
  return rest.length ? { ok: false, errors: rest } : { ok: true, template: t };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/memberTemplate.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`memberTemplate.test.ts` prints `programs/memberTemplate: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/memberTemplate.test.ts app/src/lib/programs/memberTemplate.ts
git commit -m "feat(programs): member program shape, limits and plain-words check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Converting a library program (or the current one) to own rules

A pure function, tested against every platform program: each converts, passes the member check, and plans week 1 with a weight wherever the original planned one.

**Files:**
- Test (create): `app/src/lib/programs/convert.test.ts`
- Create: `app/src/lib/programs/convert.ts`

**Interfaces:**
- Consumes: Task 1 (`OwnRule`, rule-aware `stateKey`), Task 2 (`initState` start weights, used by the test), Task 3 (`percentLifts`, `validateMemberTemplate`, `memberKey`). Existing `weightForRpe`.
- Produces:
  - `interface Carry { weights?: Record<string, number>; tms?: Partial<Record<LiftKey, number>> }` (the original's engine weights by its own state keys, and its training maxes).
  - `toOwnRules(t: ProgramTemplate, carry?: Carry): { template: ProgramTemplate; maxes: Partial<Record<LiftKey, number>> }`. The template's name is "My <name>" (a member program keeps its name), `engine` own_rules, `tmPct` 1, `lifts` = its percent lifts. `maxes[lift] = tm / original tmPct`, so planned weights are the same.
  - Nearest rules: every set a percentage (RPE sets inside it become the share of the max they plan, so RPE 10 x 1 is 100%) with a lift: `percent`, each percentage multiplied by the original `tmPct`. Every set RPE: `rpe` (no lift; the weight comes from the member's logs). Fixed sets: bodyweight or `progress: false` give `manual`; rep ranges give `range`; a linear engine gives `linear` with its increment (per lift) and `deloadAfter`; GZCLP T1 and T2 give `linear` (`deloadAfter` = its number of rep schemes), T3 `manual`; fixed volume gives `linear` with `deloadAfter: 10`; anything else `manual`. Mixed sets become `manual` with fixed sets. Carried weights become `startKg`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/convert.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/convert.test.ts
//
// Every platform program converts to own rules, passes the member check, and
// plans week 1 with a weight wherever the original planned one: percentages
// from the carried training maxes, linear and range weights from the carried
// working weights. Plus each engine family's nearest rule.
import assert from "node:assert/strict";

import { toOwnRules } from "./convert";
import { initState } from "./engines";
import { memberKey, validateMemberTemplate } from "./memberTemplate";
import { planSession } from "./planner";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import type { LiftKey, ProgramTemplate, RuleKind } from "./types";

const STEP = 2.5;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

for (const original of PLATFORM_PROGRAMS) {
  const maxes = Object.fromEntries(original.lifts.map((l, i) => [l, 100 + i * 20])) as Partial<Record<LiftKey, number>>;
  const s = initState(original, maxes, STEP);
  const conv = toOwnRules(original, { weights: s.weights, tms: s.tms });
  const checked = validateMemberTemplate(conv.template, memberKey(1));
  assert.ok(checked.ok, `${original.key} passes the member check: ${checked.ok ? "" : checked.errors.join(" | ")}`);
  const t = checked.template;
  assert.equal(t.name, `My ${original.name}`);
  for (const lift of t.lifts) assert.ok(conv.maxes[lift] !== undefined, `${original.key}: a max for ${lift}`);
  const s2 = initState(t, conv.maxes, STEP);
  original.weeks[0].days.forEach((_, di) => {
    const a = planSession(original, { ...s, week: 0, day: di }, { stepKg: STEP })!;
    const b = planSession(t, { ...s2, week: 0, day: di }, { stepKg: STEP })!;
    assert.equal(b.exercises.length, a.exercises.length, `${original.key} day ${di + 1}: same exercises`);
    a.exercises.forEach((ea, xi) => {
      const eb = b.exercises[xi];
      assert.equal(eb.name, ea.name);
      ea.sets.forEach((sa, si) => {
        if (sa.kg === null) return;
        const kb = eb.sets[si]?.kg;
        assert.ok(kb !== null && kb !== undefined && near(kb, sa.kg), `${original.key} day ${di + 1} ${ea.name} set ${si + 1}: ${sa.kg} became ${kb}`);
      });
    });
  });
}

// ── the nearest rule for each engine family ──
const rules = (key: string): RuleKind[] => {
  const t = toOwnRules(platformProgram(key)!).template;
  return [...new Set(t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.rule!.kind))))].sort();
};
assert.deepEqual(rules("stronglifts-5x5"), ["linear"], "linear engine");
assert.deepEqual(rules("phul"), ["range"], "double progression");
assert.deepEqual(rules("smolov-base"), ["percent"], "fixed block");
assert.deepEqual(rules("531-bbb"), ["manual", "percent"], "training-max cycle: percentages, and the accessories by hand");
assert.deepEqual(rules("gzclp"), ["linear", "manual"], "GZCLP: T1 and T2 add weight, T3 by hand");
assert.deepEqual(rules("german-volume-training"), ["linear", "manual"], "fixed volume");
assert.deepEqual(rules("phat"), ["manual", "range"], "PHAT keeps its fixed accessories by hand");

// ── percentages become percentages of the max; RPE sets on a percent exercise plan the same share ──
const bbb = toOwnRules(platformProgram("531-bbb")!).template;
const firstPct = bbb.weeks[0].days[0].exercises[0].sets[0];
assert.ok(firstPct.kind === "pct" && near(firstPct.pct, 0.65 * 0.9), "5/3/1's 65% of a 90% training max is 58.5% of the max");
const smolovTest = toOwnRules(platformProgram("smolov-base")!).template.weeks.at(-1)!.days.find((d) => d.test)!;
const lastSet = smolovTest.exercises[0].sets.at(-1)!;
assert.ok(lastSet.kind === "pct" && near(lastSet.pct, 1), "the max attempt is 100% of the max");
assert.equal(smolovTest.test, true, "a test day stays a test day");

// ── RPE-only exercises become rpe; mixed ones become manual ──
const mix: ProgramTemplate = {
  ...platformProgram("phul")!,
  weeks: [
    {
      days: [
        {
          name: "Day",
          exercises: [
            { name: "Bench press", lift: "bench", sets: [{ kind: "rpe", rpe: 8, reps: 3, rest: 180 }] },
            { name: "Barbell row", lift: "row", sets: [{ kind: "pct", pct: 0.7, reps: 5, rest: 120 }, { kind: "fixed", reps: 8, rest: 90 }] },
          ],
        },
      ],
    },
  ],
};
const mixed = toOwnRules(mix).template.weeks[0].days[0].exercises;
assert.equal(mixed[0].rule!.kind, "rpe");
assert.equal(mixed[0].lift, undefined, "an rpe exercise takes its weight from the member's logs");
assert.equal(mixed[1].rule!.kind, "manual");
assert.ok(mixed[1].sets.every((x) => x.kind === "fixed"));

// ── the member's current program: its weights and maxes come along ──
const sl = platformProgram("stronglifts-5x5")!;
const live = initState(sl, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, STEP);
live.weights["back squat"] = 87.5;
const fromCurrent = toOwnRules(sl, { weights: live.weights, tms: live.tms }).template;
const sq = fromCurrent.weeks[0].days[0].exercises[0];
assert.deepEqual(sq.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 87.5 });
const dl = fromCurrent.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises)).find((e) => e.name === "Deadlift")!;
assert.equal(dl.rule?.kind === "linear" ? dl.rule.incKg : null, 5, "deadlift goes up 5 kg");

const w531 = platformProgram("531-fsl")!;
const s531 = initState(w531, { squat: 150, bench: 100, deadlift: 180, press: 60 }, STEP);
s531.tms.squat = 145;
const c531 = toOwnRules(w531, { weights: s531.weights, tms: s531.tms });
assert.ok(near(c531.maxes.squat!, 145 / 0.9), "the max that keeps the same weights: training max / 90%");

// ── a member program converts to itself, with its weights as start weights ──
const again = toOwnRules({ ...fromCurrent, key: "member:3" }, { weights: { "linear:back squat": 92.5 } }).template;
assert.equal(again.name, fromCurrent.name);
const sq2 = again.weeks[0].days[0].exercises[0];
assert.deepEqual(sq2.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 92.5 });

console.log("programs/convert: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/convert.test.ts`
Expected: FAIL with `Cannot find module './convert'`.

- [ ] **Step 3: Create `app/src/lib/programs/convert.ts`**

Create `app/src/lib/programs/convert.ts` with exactly this content:

```ts
// app/src/lib/programs/convert.ts
/**
 * A library program (or the member's current one) as a member-built program:
 * each exercise gets the nearest own rule. Linear engines become `linear`,
 * double progression `range`, percentages of a max `percent` (scaled so the
 * percentage is of the max, not the training max), RPE-only exercises `rpe`,
 * and anything else `manual`. Carried weights become start weights and carried
 * training maxes become maxes, so the converted program plans the same
 * weights. Pure.
 */
import { stateKey } from "./planner";
import { percentLifts } from "./memberTemplate";
import type { ExerciseRx, LiftKey, OwnRule, ProgramTemplate, SetRx } from "./types";
import { weightForRpe } from "./units";

export interface Carry {
  /** Working weight per state key of the original (its engine state). */
  weights?: Record<string, number>;
  /** Training max per lift of the original. */
  tms?: Partial<Record<LiftKey, number>>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function asFixed(s: SetRx): SetRx {
  return s.kind === "fixed" ? s : { kind: "fixed", reps: s.reps, rest: s.rest };
}

/** A percentage of the max: a training-max percentage scaled by tmPct, an RPE set as the share of the max it plans. */
function asPctOfMax(s: SetRx, tmPct: number): SetRx {
  if (s.kind === "pct" || s.kind === "amrap") return { kind: s.kind, pct: s.pct * tmPct, reps: s.reps, rest: s.rest, ...(s.addKg ? { addKg: s.addKg } : {}) };
  if (s.kind === "rpe") return { kind: "pct", pct: weightForRpe(1, s.reps, s.rpe), reps: s.reps, rest: s.rest };
  return s;
}

function fixedRule(t: ProgramTemplate, ex: ExerciseRx, sets: SetRx[]): OwnRule {
  const e = t.engine;
  if (ex.bodyweight || ex.progress === false) return { kind: "manual" };
  if (sets.some((s) => s.kind === "fixed" && typeof s.reps !== "number")) return { kind: "range" };
  const inc = (incs: Partial<Record<LiftKey, number>> | undefined, base: number) => (ex.lift ? incs?.[ex.lift] : undefined) ?? base;
  if (e.key === "linear") return { kind: "linear", incKg: inc(e.increments, e.increment), deloadAfter: e.deloadAfter };
  if (e.key === "tm_cycle" && e.rule === "gzclp" && ex.tier !== "t3") return { kind: "linear", incKg: inc(e.increments, e.increment), deloadAfter: Math.max(1, ex.stages?.length ?? 3) };
  if (e.key === "fixed_volume") return { kind: "linear", incKg: e.increment, deloadAfter: 10 };
  return { kind: "manual" };
}

function withStart(rule: OwnRule, startKg: number | undefined): OwnRule {
  if (startKg === undefined || !(startKg > 0)) return rule;
  if (rule.kind === "linear" || rule.kind === "range" || rule.kind === "manual") return { ...rule, startKg };
  return rule;
}

function convertExercise(t: ProgramTemplate, ex: ExerciseRx, carry: Carry): ExerciseRx {
  const startKg = carry.weights?.[stateKey(ex)];
  const base: ExerciseRx = { name: ex.name, sets: ex.sets };
  if (ex.tier) base.tier = ex.tier;
  if (ex.bodyweight) base.bodyweight = true;
  if (ex.joined) base.joined = true;
  if (ex.notes) base.notes = ex.notes;
  if (ex.rule) return { ...base, ...(ex.lift ? { lift: ex.lift } : {}), rule: withStart(ex.rule, startKg) };
  const sets = ex.sets;
  const pctLike = sets.every((s) => s.kind === "pct" || s.kind === "amrap" || s.kind === "rpe");
  if (pctLike && ex.lift && sets.some((s) => s.kind === "pct" || s.kind === "amrap")) {
    return { ...base, lift: ex.lift, sets: sets.map((s) => asPctOfMax(s, t.tmPct)), rule: { kind: "percent" } };
  }
  if (sets.every((s) => s.kind === "rpe")) return { ...base, rule: { kind: "rpe" } };
  const fixed = sets.map(asFixed);
  const mixed = !sets.every((s) => s.kind === "fixed" || s.kind === "same_as_last");
  const rule = mixed ? ({ kind: "manual" } as const) : fixedRule(t, ex, fixed);
  return { ...base, sets: fixed, rule: withStart(rule, startKg) };
}

/** The member-built version of a program, and the maxes that plan the same weights. */
export function toOwnRules(t: ProgramTemplate, carry: Carry = {}): { template: ProgramTemplate; maxes: Partial<Record<LiftKey, number>> } {
  const weeks = t.weeks.map((w) => ({
    ...(w.label ? { label: w.label } : {}),
    days: w.days.map((d) => ({ name: d.name, exercises: d.exercises.map((ex) => convertExercise(t, ex, carry)), ...(d.test ? { test: true } : {}) })),
  }));
  const own = t.engine.key === "own_rules";
  const template: ProgramTemplate = {
    ...t,
    name: (own ? t.name : `My ${t.name}`).slice(0, 80),
    who: "Built by the member.",
    description: own ? t.description : `Based on ${t.name}.`,
    engine: { key: "own_rules" },
    tmPct: 1,
    weeks,
  };
  delete template.warning;
  template.lifts = percentLifts(template);
  const maxes: Partial<Record<LiftKey, number>> = {};
  for (const lift of template.lifts) {
    const tm = carry.tms?.[lift];
    if (tm !== undefined && tm > 0) maxes[lift] = round2(tm / t.tmPct);
  }
  return { template, maxes };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/convert.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`convert.test.ts` prints `programs/convert: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/convert.test.ts app/src/lib/programs/convert.ts
git commit -m "feat(programs): convert library programs to own rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Edit while running: carrying the state onto the new version

Pure, so every carry-over rule is pinned by a test: weights, misses and maxes by state key, the member's week and day, and the change-log lines.

**Files:**
- Test (create): `app/src/lib/programs/memberEdit.test.ts`
- Create: `app/src/lib/programs/memberEdit.ts`

**Interfaces:**
- Consumes: Task 1 (`stateKey`, `RULE_LABEL`), Task 2 (`initState` start weights).
- Produces:
  - `interface EditInput { before: ProgramTemplate; after: ProgramTemplate; state: EngineState; weekOrigins: (number | null)[]; stepKg: number; unit: WeightUnit }`; `interface EditOutput { state: EngineState; lines: string[] }`.
  - `normaliseOrigins(raw: unknown, beforeWeeks: number, afterWeeks: number): (number | null)[]`: the builder's list (one entry per new week: the saved week it came from, or null), or the identity when it does not fit.
  - `rebaseEdit(input: EditInput): EditOutput`. By state key (rule + tier + name + range): kept keeps its weight and misses; new starts from its rule (`startKg`) or none; removed drops from weights, misses and stages; a name whose key changed is a changed rule ("Bench press now uses rep range. It starts again from the new rule.") or a new range ("Cable row has a new rep range. It starts again from there."). A kept exercise whose `startKg` the member changed in this edit moves to it ("Bench press: 75 kg from the next session."). Maxes stay; `tms` follow them; a new percent lift with no max adds "Add your squat max on My program to get its weights." Position: the week follows its origin, the day by name, else clamped; a removed current week moves to the nearest earlier week, day 0 ("Week 3 was removed, so you're on week 2 now."). `finished` is false. Lines also list weeks ("Weeks: 4 to 3."), added and removed days and exercises; with nothing else: "Sets, reps or notes changed."
  - `editReason(lines: string[]): string`: "You edited the program.\n" plus the lines.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/memberEdit.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/memberEdit.test.ts
//
// Edit-while-running: kept, new, removed and changed-rule exercises; a start
// weight changed in the builder; a new percent lift; the current week removed
// or moved; and the change-log lines.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import type { EngineState, ExerciseRx, ProgramTemplate } from "./types";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 60 } };
const row: ExerciseRx = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range", startKg: 50 } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual", startKg: 15 } };
const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }], rule: { kind: "percent" } };

function program(weeks: ExerciseRx[][][]): ProgramTemplate {
  return {
    key: "member:1",
    name: "Mine",
    author: "Built by the member",
    family: "strength",
    level: "intermediate",
    daysPerWeek: 2,
    lengthWeeks: 12,
    lifts: weeks.flat(2).some((e) => e.rule?.kind === "percent") ? ["squat"] : [],
    tmPct: 1,
    who: "Built by the member.",
    description: "Mine.",
    engine: { key: "own_rules" },
    weeks: weeks.map((days) => ({ days: days.map((exercises, i) => ({ name: ["Push", "Pull", "Legs"][i], exercises })) })),
  };
}
const edit = (before: ProgramTemplate, after: ProgramTemplate, state: EngineState, weekOrigins?: (number | null)[]) =>
  rebaseEdit({ before, after, state, weekOrigins: weekOrigins ?? after.weeks.map((_, i) => (i < before.weeks.length ? i : null)), stepKg: 2.5, unit: "kg" });

const before = program([[[bench, curl], [row]]]);
const running: EngineState = { ...initState(before, {}, 2.5), day: 1, cycle: 2, weights: { "linear:bench press": 72.5, "range:cable row@8-12": 55, "manual:hammer curl": 15 }, misses: { "linear:bench press": 2 } };

// ── kept exercises keep their weight and misses; a new one starts from its rule; a removed one drops out ──
const face: ExerciseRx = { name: "Face pull", sets: [{ kind: "fixed", reps: 15, rest: 60 }], rule: { kind: "manual", startKg: 20 } };
const a = edit(before, program([[[bench, face], [row]]]), running);
assert.deepEqual(a.state.weights, { "linear:bench press": 72.5, "range:cable row@8-12": 55, "manual:face pull": 20 });
assert.deepEqual(a.state.misses, { "linear:bench press": 2 });
assert.deepEqual([a.state.week, a.state.day, a.state.cycle], [0, 1, 2]);
assert.deepEqual(a.lines, ["Added exercises: Face pull.", "Removed exercises: Hammer curl."]);
assert.equal(editReason(a.lines), "You edited the program.\nAdded exercises: Face pull.\nRemoved exercises: Hammer curl.");

// ── a changed rule starts the exercise again, with a reason ──
const benchRange: ExerciseRx = { ...bench, sets: [{ kind: "fixed", reps: { min: 6, max: 10 }, rest: 120 }], rule: { kind: "range" } };
const b = edit(before, program([[[benchRange, curl], [row]]]), running);
assert.equal(b.state.weights["linear:bench press"], undefined);
assert.equal(b.state.weights["range:bench press@6-10"], undefined, "no start weight: last session's weight is planned");
assert.equal(b.state.misses["linear:bench press"], undefined);
assert.deepEqual(b.lines, ["Bench press now uses rep range. It starts again from the new rule."]);
const rowNarrow: ExerciseRx = { ...row, sets: [{ kind: "fixed", reps: { min: 6, max: 10 }, rest: 90 }] };
assert.deepEqual(edit(before, program([[[bench, curl], [rowNarrow]]]), running).lines, ["Cable row has a new rep range. It starts again from there."]);

// ── a start weight changed in the builder applies from the next session; an unchanged one changes nothing ──
const benchAt75: ExerciseRx = { ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 75 } };
const c = edit(before, program([[[benchAt75, curl], [row]]]), running);
assert.equal(c.state.weights["linear:bench press"], 75);
assert.equal(c.state.misses["linear:bench press"], 0);
assert.deepEqual(c.lines, ["Bench press: 75 kg from the next session."]);
const benchNotes: ExerciseRx = { ...bench, notes: "Pause on the chest." };
const same = edit(before, program([[[benchNotes, curl], [row]]]), running);
assert.equal(same.state.weights["linear:bench press"], 72.5, "an unchanged start weight leaves the working weight alone");
assert.deepEqual(same.lines, ["Sets, reps or notes changed."]);

// ── a new percent lift: its max comes later; days added and removed ──
const d = edit(before, program([[[bench, curl], [row], [squat]]]), running);
assert.deepEqual(d.lines, ["Added days: Legs.", "Added exercises: Back squat.", "Add your squat max on My program to get its weights."]);
const withMax = edit(before, program([[[bench, curl], [row], [squat]]]), { ...running, maxes: { squat: 150 } });
assert.equal(withMax.state.tms.squat, 150);
assert.deepEqual(edit(before, program([[[bench, curl, row]]]), running).lines, ["Removed days: Pull."]);
assert.equal(edit(before, program([[[bench, curl, row]]]), running).state.day, 0, "the day clamps into the shorter week");
const swapped: ProgramTemplate = { ...before, weeks: [{ days: [before.weeks[0].days[1], before.weeks[0].days[0]] }] };
assert.equal(edit(before, swapped, running).state.day, 0, "Pull moved to the front, and the member stays on Pull");

// ── weeks: the member follows their week when weeks move; a removed week sends them to the nearest earlier one ──
const four = program([[[bench]], [[bench]], [[bench]], [[bench]]]);
const onWeek3: EngineState = { ...initState(four, {}, 2.5), week: 2, day: 0 };
const moved = edit(four, four, onWeek3, [2, 0, 1, 3]);
assert.equal(moved.state.week, 0, "week 3 moved to the front");
const three = program([[[bench]], [[bench]], [[bench]]]);
const removed = edit(four, three, onWeek3, [0, 1, 3]);
assert.deepEqual([removed.state.week, removed.state.day], [1, 0]);
assert.deepEqual(removed.lines, ["Weeks: 4 to 3.", "Week 3 was removed, so you're on week 2 now."]);
const firstGone = edit(four, three, { ...onWeek3, week: 0 }, [1, 2, 3]);
assert.equal(firstGone.state.week, 0, "no earlier week: the first one");

// ── week origins that do not fit fall back to the same positions ──
assert.deepEqual(normaliseOrigins([0, 0], 2, 2), [0, 1]);
assert.deepEqual(normaliseOrigins("x", 2, 3), [0, 1, null]);
assert.deepEqual(normaliseOrigins([1, null, 0], 2, 3), [1, null, 0]);
assert.deepEqual(normaliseOrigins([5], 2, 1), [0]);

console.log("programs/memberEdit: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/memberEdit.test.ts`
Expected: FAIL with `Cannot find module './memberEdit'`.

- [ ] **Step 3: Create `app/src/lib/programs/memberEdit.ts`**

Create `app/src/lib/programs/memberEdit.ts` with exactly this content:

```ts
// app/src/lib/programs/memberEdit.ts
/**
 * Editing a member program while it runs: the running state carried onto the
 * new version, and the change-log lines saying what changed. Exercises match
 * old to new by state key (rule + name + rep range). A kept exercise keeps its
 * weight and misses, a new one starts from its rule, a removed one drops out,
 * and a changed rule starts the exercise again. A start weight the member
 * changes sets the working weight from the next session. The member stays on
 * the same day (by name) where it moved; if the current week is removed, they
 * move to the nearest earlier week. Pure.
 */
import { initState } from "./engines";
import { stateKey } from "./planner";
import { LIFT_LABEL, RULE_LABEL, type EngineState, type ExerciseRx, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, roundToStep, trainingMax } from "./units";

export interface EditInput {
  before: ProgramTemplate;
  after: ProgramTemplate;
  state: EngineState;
  /** For each week of `after`, the index of the week of `before` it came from; null for an added week. */
  weekOrigins: (number | null)[];
  stepKg: number;
  unit: WeightUnit;
}

export interface EditOutput {
  state: EngineState;
  /** What changed, one sentence each, for the change log. */
  lines: string[];
}

const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;
const sameKg = (a: number, b: number) => Math.abs(a - b) < 0.005;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The week origins the builder sent, or the identity when they do not fit:
 * one entry per new week, each an old week index or null, no old week twice.
 */
export function normaliseOrigins(raw: unknown, beforeWeeks: number, afterWeeks: number): (number | null)[] {
  const identity = Array.from({ length: afterWeeks }, (_, i) => (i < beforeWeeks ? i : null));
  if (!Array.isArray(raw) || raw.length !== afterWeeks) return identity;
  const seen = new Set<number>();
  for (const o of raw) {
    if (o === null) continue;
    if (!Number.isInteger(o) || o < 0 || o >= beforeWeeks || seen.has(o)) return identity;
    seen.add(o);
  }
  return raw as (number | null)[];
}

function exercises(t: ProgramTemplate): ExerciseRx[] {
  return t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
}

function byKey(t: ProgramTemplate): Map<string, ExerciseRx> {
  const m = new Map<string, ExerciseRx>();
  for (const ex of exercises(t)) {
    const k = stateKey(ex);
    if (!m.has(k)) m.set(k, ex);
  }
  return m;
}

function startOf(ex: ExerciseRx | undefined): number | undefined {
  const r = ex?.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return undefined;
  return r.startKg !== undefined && r.startKg > 0 ? r.startKg : undefined;
}

/** Names in `a` that are not in `b`, first spelling kept, in order. */
function missingFrom(a: string[], b: string[]): string[] {
  const inB = new Set(b.map(norm));
  const out = new Map<string, string>();
  for (const n of a) if (!inB.has(norm(n)) && !out.has(norm(n))) out.set(norm(n), n.trim());
  return [...out.values()];
}

const list = (xs: string[]) => xs.join(", ");

export function rebaseEdit(input: EditInput): EditOutput {
  const { before, after, state, stepKg } = input;
  const fmt = (kg: number) => formatWeight(kg, input.unit);
  const lines: string[] = [];
  const next = clone(state);
  const oldKeys = byKey(before);
  const newKeys = byKey(after);
  const fresh = initState(after, state.maxes, stepKg);

  // ── what changed: weeks, days, exercises, rules ──
  if (before.weeks.length !== after.weeks.length) lines.push(`Weeks: ${before.weeks.length} to ${after.weeks.length}.`);
  const dayNames = (t: ProgramTemplate) => t.weeks.flatMap((w) => w.days.map((d) => d.name));
  const addedDays = missingFrom(dayNames(after), dayNames(before));
  const removedDays = missingFrom(dayNames(before), dayNames(after));
  if (addedDays.length) lines.push(`Added days: ${list(addedDays)}.`);
  if (removedDays.length) lines.push(`Removed days: ${list(removedDays)}.`);
  const exNames = (t: ProgramTemplate) => exercises(t).map((e) => e.name);
  const addedEx = missingFrom(exNames(after), exNames(before));
  const removedEx = missingFrom(exNames(before), exNames(after));
  if (addedEx.length) lines.push(`Added exercises: ${list(addedEx)}.`);
  if (removedEx.length) lines.push(`Removed exercises: ${list(removedEx)}.`);
  const keptNames = new Set(exNames(after).map(norm).filter((n) => exNames(before).some((b) => norm(b) === n)));
  for (const name of keptNames) {
    const oldK = [...oldKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const newK = [...newKeys.entries()].filter(([, e]) => norm(e.name) === name);
    const gone = oldK.filter(([k]) => !newKeys.has(k));
    const came = newK.filter(([k]) => !oldKeys.has(k));
    if (gone.length === 0 || came.length === 0) continue;
    const oldKinds = new Set(gone.map(([, e]) => e.rule?.kind));
    const newKind = came.map(([, e]) => e.rule?.kind).find((k) => k && !oldKinds.has(k));
    const label = came[0][1].name.trim();
    lines.push(newKind ? `${label} now uses ${RULE_LABEL[newKind].toLowerCase()}. It starts again from the new rule.` : `${label} has a new rep range. It starts again from there.`);
  }

  // ── weights and misses, by state key ──
  for (const k of Object.keys(next.weights)) if (!newKeys.has(k)) delete next.weights[k];
  for (const k of Object.keys(next.misses)) if (!newKeys.has(k)) delete next.misses[k];
  for (const k of Object.keys(next.stages)) if (!newKeys.has(k)) delete next.stages[k];
  for (const [k, ex] of newKeys) {
    if (!oldKeys.has(k)) {
      delete next.misses[k];
      if (fresh.weights[k] !== undefined) next.weights[k] = fresh.weights[k];
      else delete next.weights[k];
      continue;
    }
    const start = startOf(ex);
    if (start === undefined) continue;
    // Only a start weight the member changed in this edit moves the working weight.
    const was = startOf(oldKeys.get(k));
    const want = roundToStep(start, stepKg);
    if (was !== undefined && sameKg(roundToStep(was, stepKg), want)) continue;
    next.weights[k] = want;
    next.misses[k] = 0;
    lines.push(`${ex.name.trim()}: ${fmt(want)} from the next session.`);
  }

  // ── maxes: training max = max; a new percent lift needs a max ──
  for (const lift of after.lifts) {
    const max = next.maxes[lift];
    if (max !== undefined) next.tms[lift] = trainingMax(max, after.tmPct);
    else lines.push(`Add your ${LIFT_LABEL[lift].toLowerCase()} max on My program to get its weights.`);
  }

  // ── position: the same week where it moved to, else the nearest earlier one ──
  const origins = normaliseOrigins(input.weekOrigins, before.weeks.length, after.weeks.length);
  const at = origins.indexOf(state.week);
  if (at >= 0) {
    // The same day by name if it is still in the week, else the same place, clamped.
    const name = before.weeks[state.week]?.days[state.day]?.name;
    const byName = name === undefined ? -1 : after.weeks[at].days.findIndex((d) => norm(d.name) === norm(name));
    next.week = at;
    next.day = byName >= 0 ? byName : Math.min(state.day, after.weeks[at].days.length - 1);
  } else {
    let best = -1;
    let to = 0;
    origins.forEach((o, i) => {
      if (o !== null && o < state.week && o > best) {
        best = o;
        to = i;
      }
    });
    next.week = to;
    next.day = 0;
    lines.push(`Week ${state.week + 1} was removed, so you're on week ${to + 1} now.`);
  }
  next.finished = false;

  if (lines.length === 0) lines.push("Sets, reps or notes changed.");
  return { state: next, lines };
}

/** The change-log entry for an edit. */
export function editReason(lines: string[]): string {
  return ["You edited the program.", ...lines].join("\n");
}
```

- [ ] **Step 4: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/memberEdit.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`memberEdit.test.ts` prints `programs/memberEdit: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/memberEdit.test.ts app/src/lib/programs/memberEdit.ts
git commit -m "feat(programs): carry a running member program onto an edited version

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The member_programs table, the store, and starting a member program

Ownership lives in the store: every function takes the member's clientId and filters by it, so another member's id finds nothing. An edit to the running program writes the program row, the enrolment template, its state and the change-log event in one transaction.

**Files:**
- Modify: `app/src/lib/db/tenant.ts`
- Modify: `app/src/lib/db/schema.ts`
- Modify: `app/src/lib/programs/enrolments.ts`
- Test (create): `app/src/lib/programs/memberPrograms.test.ts`
- Create: `app/src/lib/programs/memberPrograms.ts`

**Interfaces:**
- Consumes: Tasks 3 to 5 (`validateMemberTemplate`, `memberKey`, `parseMemberKey`, `blankMemberTemplate`, `toOwnRules`, `rebaseEdit`, `editReason`), Task 2 (`initState`). Existing `enrolments.ts`, `library.ts` (`programByKey`, `copyKey`), `workoutLog.ts`.
- Produces:
  - Tenant table `member_programs` (id, client_id FK clients ON DELETE CASCADE, name, template_json, maxes_json DEFAULT '{}', based_on, created_at, updated_at) plus `idx_member_programs_client`, in the existing DIY block of `ensureTenantTables` (it throws on failure; not `TENANT_MIGRATIONS`). Drizzle `memberBuiltPrograms` (named so it does not clash with `library.ts`'s `memberPrograms()`).
  - `enrolments.ts`: `export type Tx`; `interface EnrolSource { template: ProgramTemplate; programKey: string | null; copyId: number | null }`; `enrolTemplate(clientId: number, input: Omit<EnrolInput, "key">, src: EnrolSource): { ok: true; id: number } | { ok: false; error: string }` (`enrol()` now calls it); `writeTemplateEdit(tx: Tx, view: EnrolmentView, template: ProgramTemplate, state: EngineState, reason: string): boolean` (false when the enrolment moved; also moves an open session of the old position to the new one); `memberSetMax(clientId: number, lift: LiftKey, kg: number): { ok: true } | { ok: false; error: string }` (own-rules programs only, logged "You set the squat max to 160 kg."); `planFor` passes `lastKg` (heaviest ticked set with a typed weight, last time) for own-rules programs.
  - `memberPrograms.ts`: `interface MemberProgram { id; clientId; name; template: ProgramTemplate; maxes: Partial<Record<LiftKey, number>>; basedOn: string | null; updatedAt: number }`; `listMemberPrograms(clientId): MemberProgram[]`; `getMemberProgram(clientId, id): MemberProgram | null`; `runningMemberProgramId(clientId): number | null`; `type StartFrom = { kind: "blank" } | { kind: "library"; key: string } | { kind: "current" }`; `parseStartFrom(raw: string | null | undefined): StartFrom | null`; `interface Draft { template; maxes; basedOn }`; `startingDraft(clientId, from: StartFrom): Draft | null`; `createMemberProgram(clientId, draft: { template: unknown; maxes; basedOn }): { ok: true; id: number } | { ok: false; errors: string[] }`; `saveMemberProgram(clientId, id, raw: unknown, weekOrigins: unknown): { ok: true; edited: boolean } | { ok: false; errors: string[] }`; `deleteMemberProgram(clientId, id): { ok: true } | { ok: false; error: string }` (refused while it runs); `enrolMemberProgram(clientId, id, input: Omit<EnrolInput, "key">)`. The enrolment's `program_key` is "member:<id>", `copy_id` null.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/memberPrograms.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/memberPrograms.test.ts
//
// Member-built programs against a scratch tenant: create and list, ownership
// (another member cannot read, start, edit or delete), start with maxes only
// for percent lifts, run a session through the own-rules engine, edit while
// running (one transaction, kept/new/removed weights, the change log), an
// open session finishing on the old version, the current week removed, the
// three starting points, last session's weight, a member's own max, and
// delete refused while running. Each case runs on its own member.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/memberPrograms.test.ts");
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
  const { clients, memberBuiltPrograms, workoutSessions } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const log = requireLocal("../workoutLog") as typeof import("../workoutLog");
  const en = requireLocal("./enrolments") as typeof import("./enrolments");
  const mp = requireLocal("./memberPrograms") as typeof import("./memberPrograms");
  const { blankMemberTemplate } = requireLocal("./memberTemplate") as typeof import("./memberTemplate");

  const slug = "programs-member-built-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Member Built Test", dbFile) as {
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

  type Template = import("./types").ProgramTemplate;
  type Exercise = import("./types").ExerciseRx;
  const staff = { kind: "staff" as const, userId: 1, name: "Coach Ann" };
  const start = { unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 4] };

  const squat: Exercise = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }, { kind: "amrap", pct: 0.85, reps: 3, rest: 180 }], rule: { kind: "percent" } };
  const bench: Exercise = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 60 } };
  const curl: Exercise = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual" } };
  const row: Exercise = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range", startKg: 50 } };

  const program = (days: { name: string; exercises: Exercise[] }[][], name = "Strength block"): Template => ({ ...blankMemberTemplate(), name, weeks: days.map((d) => ({ days: d })) });
  const twoDay = () => program([[{ name: "Upper", exercises: [bench, curl] }, { name: "Lower", exercises: [squat, row] }]]);

  const failures: string[] = [];
  const cases: [string, () => void][] = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);

  const newMember = (diy = true): number => {
    const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Builder", phone: "0" }).returning({ id: clients.id }).all();
    if (diy) assert.ok(en.setTrainingMode(c.id, "diy", staff));
    return c.id;
  };
  const create = (clientId: number, t: Template = twoDay()): number => {
    const r = mp.createMemberProgram(clientId, { template: t, maxes: {}, basedOn: null });
    assert.ok(r.ok, `created: ${JSON.stringify(r)}`);
    return r.id;
  };
  const startIt = (clientId: number, id: number, maxesKg: Record<string, number> = { squat: 150 }) => {
    const r = mp.enrolMemberProgram(clientId, id, { ...start, maxesKg });
    assert.ok(r.ok, `started: ${JSON.stringify(r)}`);
    return r.id;
  };
  /** Start the next session, tick every planned set at its planned weight (or `kg` where none is planned), finish it. */
  const logNext = (clientId: number, kg = 20): number => {
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok, `started a session: ${JSON.stringify(s)}`);
    const v = log.getSession(clientId, s.sessionId)!;
    log.saveSessionSets(
      clientId,
      v.id,
      v.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p) => ({ weightKg: p.kg ?? kg, reps: p.repsMax ?? p.reps, done: true })) })),
    );
    assert.equal(log.finishSession(clientId, v.id), true);
    return v.id;
  };
  const block = (kind: string) =>
    db.run(sql.raw(`CREATE TRIGGER block_${kind} BEFORE INSERT ON program_enrolment_events WHEN NEW.kind = '${kind}' BEGIN SELECT RAISE(ABORT, 'event write failed'); END`));
  const unblock = (kind: string) => db.run(sql.raw(`DROP TRIGGER IF EXISTS block_${kind}`));

  test("create, list and check", () => {
    const clientId = newMember();
    const blank = mp.createMemberProgram(clientId, { template: blankMemberTemplate(), maxes: {}, basedOn: null });
    assert.deepEqual(blank, { ok: false, errors: ["Week 1, Day 1: add at least one exercise."] });
    const id = create(clientId);
    const list = mp.listMemberPrograms(clientId);
    assert.equal(list.length, 1);
    assert.equal(list[0].template.key, `member:${id}`);
    assert.deepEqual(list[0].template.lifts, ["squat"]);
    assert.equal(list[0].name, "Strength block");
    const coach = newMember(false);
    assert.deepEqual(mp.createMemberProgram(coach, { template: twoDay(), maxes: {}, basedOn: null }), { ok: false, errors: ["Programs are for DIY members."] });
  });

  test("another member cannot read, start, edit or delete it", () => {
    const owner = newMember();
    const other = newMember();
    const id = create(owner);
    assert.equal(mp.getMemberProgram(other, id), null);
    assert.equal(mp.listMemberPrograms(other).length, 0);
    assert.deepEqual(mp.enrolMemberProgram(other, id, { ...start, maxesKg: { squat: 150 } }), { ok: false, error: "That program isn't available." });
    assert.deepEqual(mp.saveMemberProgram(other, id, twoDay(), null), { ok: false, errors: ["That program no longer exists."] });
    assert.deepEqual(mp.deleteMemberProgram(other, id), { ok: false, error: "That program no longer exists." });
    assert.equal(mp.getMemberProgram(owner, id)!.name, "Strength block", "the owner's program is untouched");
    assert.equal(en.liveEnrolment(other), null);
  });

  test("start asks only for percent maxes, and a session runs the rules", () => {
    const clientId = newMember();
    const id = create(clientId);
    assert.deepEqual(mp.enrolMemberProgram(clientId, id, { ...start, maxesKg: {} }), { ok: false, error: "Add your squat max." });
    const eid = startIt(clientId, id);
    const view = en.liveEnrolment(clientId)!;
    assert.equal(view.id, eid);
    assert.equal(view.programKey, `member:${id}`);
    assert.equal(view.copyId, null);
    assert.deepEqual(view.state.weights, { "linear:bench press": 60, "range:cable row@8-12": 50 });
    const plan = en.planFor(view)!;
    assert.equal(plan.dayName, "Upper");
    assert.deepEqual(plan.exercises.map((e) => e.sets.map((s) => s.kg)), [[60, 60], [null]]);
    const sid = logNext(clientId, 14);
    const out = en.finishEnrolmentSession(clientId, sid)!;
    assert.deepEqual(out.reasons, ["Next bench press 62.5 kg. You did all 2 sets of 5.", "Next hammer curl 14 kg, the weight you used."]);
    const lower = en.planFor(en.liveEnrolment(clientId)!)!;
    assert.deepEqual(lower.exercises.map((e) => e.sets.map((s) => s.kg)), [[120, 127.5], [50]]);
  });

  test("an edit while running: one transaction, weights carried, change logged", () => {
    const clientId = newMember();
    const id = create(clientId);
    startIt(clientId, id);
    en.finishEnrolmentSession(clientId, logNext(clientId, 14));
    const before = en.liveEnrolment(clientId)!;
    assert.equal(before.state.day, 1);
    const face: Exercise = { name: "Face pull", sets: [{ kind: "fixed", reps: 15, rest: 60 }], rule: { kind: "manual", startKg: 20 } };
    const edited = program([[{ name: "Upper", exercises: [bench, face] }, { name: "Lower", exercises: [squat, row] }]]);

    block("edit");
    assert.throws(() => mp.saveMemberProgram(clientId, id, edited, [0]), /event write failed/);
    unblock("edit");
    assert.equal(mp.getMemberProgram(clientId, id)!.template.weeks[0].days[0].exercises[1].name, "Hammer curl", "the program row rolled back");
    assert.deepEqual(en.liveEnrolment(clientId)!.template, before.template, "the enrolment rolled back");

    assert.deepEqual(mp.saveMemberProgram(clientId, id, edited, [0]), { ok: true, edited: true });
    const after = en.liveEnrolment(clientId)!;
    assert.equal(after.template.weeks[0].days[0].exercises[1].name, "Face pull");
    assert.deepEqual(after.state.weights, { "linear:bench press": 62.5, "range:cable row@8-12": 50, "manual:face pull": 20 });
    assert.deepEqual([after.state.week, after.state.day], [0, 1]);
    const ev = en.enrolmentEvents(after.id, 5)[0];
    assert.equal(ev.kind, "edit");
    assert.equal(ev.actor, "member");
    assert.equal(ev.reason, "You edited the program.\nAdded exercises: Face pull.\nRemoved exercises: Hammer curl.");
    assert.equal(mp.getMemberProgram(clientId, id)!.template.weeks[0].days[0].exercises[1].name, "Face pull");
  });

  test("an open session finishes on the old version", () => {
    const clientId = newMember();
    const id = create(clientId);
    startIt(clientId, id);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    // Upper loses the curl and gets a day in front of it: the member stays on Upper, and the open session's position moves with it.
    const edited = program([[{ name: "Arms", exercises: [{ ...curl, name: "Barbell curl" }] }, { name: "Upper", exercises: [bench] }, { name: "Lower", exercises: [squat, row] }]]);
    assert.ok(mp.saveMemberProgram(clientId, id, edited, [0]).ok);
    const moved = en.liveEnrolment(clientId)!;
    assert.deepEqual([moved.state.week, moved.state.day], [0, 1], "still on Upper");
    const v = log.getSession(clientId, s.sessionId)!;
    assert.deepEqual(v.exercises.map((e) => e.name), ["Bench press", "Hammer curl"], "the open session keeps the sets it started with");
    assert.equal(db.select().from(workoutSessions).where(eq(workoutSessions.id, s.sessionId)).get()!.dayPosition, 1);
    const resumed = en.startEnrolmentSession(clientId);
    assert.ok(resumed.ok && resumed.sessionId === s.sessionId, "starting again resumes the open session");
    log.saveSessionSets(clientId, v.id, v.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p) => ({ weightKg: p.kg ?? 14, reps: p.reps, done: true })) })));
    assert.equal(log.finishSession(clientId, v.id), true);
    const out = en.finishEnrolmentSession(clientId, v.id)!;
    assert.deepEqual(out.reasons, ["Next bench press 62.5 kg. You did all 2 sets of 5."], "the removed curl changes nothing");
    const after = en.liveEnrolment(clientId)!;
    assert.equal(after.state.weights["manual:hammer curl"], undefined);
    assert.deepEqual([after.state.week, after.state.day], [0, 2], "on to Lower");
  });

  test("removing the current week moves the member to the nearest earlier week", () => {
    const clientId = newMember();
    const three = program([[{ name: "A", exercises: [bench] }], [{ name: "B", exercises: [bench] }], [{ name: "C", exercises: [bench] }]]);
    const id = create(clientId, three);
    startIt(clientId, id, {});
    en.finishEnrolmentSession(clientId, logNext(clientId));
    en.finishEnrolmentSession(clientId, logNext(clientId));
    assert.equal(en.liveEnrolment(clientId)!.state.week, 2);
    const two = program([[{ name: "A", exercises: [bench] }], [{ name: "B", exercises: [bench] }]]);
    assert.ok(mp.saveMemberProgram(clientId, id, two, [0, 1]).ok);
    const v = en.liveEnrolment(clientId)!;
    assert.deepEqual([v.state.week, v.state.day], [1, 0]);
    assert.ok(en.enrolmentEvents(v.id, 1)[0].reason.includes("Week 3 was removed, so you're on week 2 now."));
  });

  test("the three starting points", () => {
    const clientId = newMember();
    const blank = mp.startingDraft(clientId, { kind: "blank" })!;
    assert.equal(blank.template.weeks[0].days[0].exercises.length, 0);
    assert.equal(blank.basedOn, null);
    const lib = mp.startingDraft(clientId, { kind: "library", key: "stronglifts-5x5" })!;
    assert.equal(lib.basedOn, "stronglifts-5x5");
    assert.equal(lib.template.name, "My StrongLifts 5x5");
    assert.equal(mp.startingDraft(clientId, { kind: "library", key: "no-such-program" }), null);
    assert.equal(mp.startingDraft(clientId, { kind: "current" }), null, "no program running");
    assert.ok(en.enrol(clientId, { ...start, key: "stronglifts-5x5", maxesKg: { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 } }).ok);
    const cur = mp.startingDraft(clientId, { kind: "current" })!;
    assert.equal(cur.basedOn, "stronglifts-5x5");
    const sq = cur.template.weeks[0].days[0].exercises[0];
    assert.deepEqual(sq.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 50 });
    const created = mp.createMemberProgram(clientId, cur);
    assert.ok(created.ok);
  });

  test("a 5/3/1 member keeps their maxes when they copy their current program", () => {
    const clientId = newMember();
    assert.ok(en.enrol(clientId, { ...start, key: "531-bbb", maxesKg: { squat: 150, bench: 100, deadlift: 180, press: 60 } }).ok);
    const cur = mp.startingDraft(clientId, { kind: "current" })!;
    assert.deepEqual(cur.maxes, { squat: 150, bench: 100, deadlift: 180, press: 60 });
    const created = mp.createMemberProgram(clientId, cur);
    assert.ok(created.ok);
    assert.deepEqual(mp.getMemberProgram(clientId, created.id)!.maxes, cur.maxes);
  });

  test("a manual exercise with no weight plans last time's", () => {
    const clientId = newMember();
    const free = log.startFreeSession(clientId);
    assert.ok(free.ok);
    const added = log.addSessionExercise(clientId, free.sessionId, { exerciseId: null, name: "Hammer curl", sets: 1 })!;
    log.saveSessionSets(clientId, free.sessionId, [{ id: added.id, sets: [{ weightKg: 16, reps: 10, done: true }] }]);
    assert.equal(log.finishSession(clientId, free.sessionId), true);
    const id = create(clientId);
    startIt(clientId, id);
    const plan = en.planFor(en.liveEnrolment(clientId)!)!;
    assert.deepEqual(plan.exercises[1].sets.map((s) => s.kg), [16]);
  });

  test("a member sets their own max", () => {
    const clientId = newMember();
    const id = create(clientId);
    startIt(clientId, id);
    assert.deepEqual(en.memberSetMax(clientId, "bench", 100), { ok: false, error: "This program doesn't use that lift." });
    assert.deepEqual(en.memberSetMax(clientId, "squat", 0), { ok: false, error: "Enter a max between 1 and 600 kg." });
    assert.deepEqual(en.memberSetMax(clientId, "squat", 160), { ok: true });
    const v = en.liveEnrolment(clientId)!;
    assert.equal(v.state.maxes.squat, 160);
    assert.equal(v.state.tms.squat, 160);
    assert.equal(en.enrolmentEvents(v.id, 1)[0].reason, "You set the squat max to 160 kg.");
    const lib = newMember();
    assert.ok(en.enrol(lib, { ...start, key: "smolov-base", maxesKg: { squat: 150 } }).ok);
    assert.deepEqual(en.memberSetMax(lib, "squat", 160), { ok: false, error: "You don't have a program of your own running." });
  });

  test("delete is refused while the program runs", () => {
    const clientId = newMember();
    const id = create(clientId);
    startIt(clientId, id);
    assert.equal(mp.runningMemberProgramId(clientId), id);
    assert.deepEqual(mp.deleteMemberProgram(clientId, id), { ok: false, error: "End this program on My program before you delete it." });
    assert.ok(en.endEnrolment(clientId, { kind: "member" }));
    assert.deepEqual(mp.deleteMemberProgram(clientId, id), { ok: true });
    assert.equal(db.select().from(memberBuiltPrograms).where(eq(memberBuiltPrograms.id, id)).get(), undefined);
    assert.equal(en.listEnrolments(clientId)[0].template.key, `member:${id}`, "the ended enrolment keeps its snapshot");
  });

  try {
    runWithTenant(tid, () => {
      for (const [name, fn] of cases) {
        try {
          fn();
          console.log(`  pass  ${name}`);
        } catch (err) {
          failures.push(name);
          console.log(`  FAIL  ${name}\n        ${String((err as Error).message ?? err).split("\n")[0]}`);
        }
      }
    });
    if (failures.length) throw new Error(`${failures.length} of ${cases.length} cases failed: ${failures.join("; ")}`);
    console.log("programs/memberPrograms: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/memberPrograms.test.ts`
Expected: FAIL with `Cannot find module './memberPrograms'`.

- [ ] **Step 3: Change `app/src/lib/db/tenant.ts`**

In `app/src/lib/db/tenant.ts`, make these 2 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
  // DIY training and the program library (lib/programs). Gym copies of
  // platform programs, platform programs a gym hid, member enrolments (each
  // with a snapshot of the template it started from) and their change log.
  // Additive; idempotent.
  //
  // Deliberately NOT wrapped in a swallowing try/catch. The ALTERs below add
```

with:

```ts
  // DIY training and the program library (lib/programs). Gym copies of
  // platform programs, platform programs a gym hid, member enrolments (each
  // with a snapshot of the template it started from), their change log, and
  // the programs members build for themselves. Additive; idempotent.
  //
  // Deliberately NOT wrapped in a swallowing try/catch. The ALTERs below add
```

2. Replace:

```ts
    );
    CREATE INDEX IF NOT EXISTS idx_program_events_enrolment ON program_enrolment_events(enrolment_id, at);
  `);
  {
```

with:

```ts
    );
    CREATE INDEX IF NOT EXISTS idx_program_events_enrolment ON program_enrolment_events(enrolment_id, at);
    CREATE TABLE IF NOT EXISTS member_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      template_json TEXT NOT NULL,
      maxes_json TEXT NOT NULL DEFAULT '{}',
      based_on TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_member_programs_client ON member_programs(client_id, updated_at);
  `);
  {
```


- [ ] **Step 4: Change `app/src/lib/db/schema.ts`**

In `app/src/lib/db/schema.ts`, make this replacement. Each "replace" text appears exactly once in the file.

Replace:

```ts
});

/** Every change to an enrolment, with who made it and why. */
export const programEnrolmentEvents = sqliteTable("program_enrolment_events", {
```

with:

```ts
});

/** A program a DIY member built for themselves (lib/programs/memberPrograms.ts). Private to the member; staff read it. */
export const memberBuiltPrograms = sqliteTable("member_programs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  templateJson: text("template_json").notNull(),
  /** Maxes carried from the member's current program, offered when they start it. */
  maxesJson: text("maxes_json").notNull().default("{}"),
  /** The platform key or "copy-<id>" it was built from; null when built from blank. */
  basedOn: text("based_on"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Every change to an enrolment, with who made it and why. */
export const programEnrolmentEvents = sqliteTable("program_enrolment_events", {
```


- [ ] **Step 5: Change `app/src/lib/programs/enrolments.ts`**

In `app/src/lib/programs/enrolments.ts`, make these 7 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
import { dateKey, mondayOf, parseWeekdays, planWeek, type PlanDay } from "@/lib/trainingProgress";
import { exerciseHistory, getSession, listSessions, startPlannedSession, type StartResult } from "@/lib/workoutLog";
import { exerciseKey } from "@/lib/workoutLogModel";
import { initState, progress, skipSession } from "./engines";
import { matchLibraryId, namesFor } from "./exercises";
```

with:

```ts
import { dateKey, mondayOf, parseWeekdays, planWeek, type PlanDay } from "@/lib/trainingProgress";
import { exerciseHistory, getSession, listSessions, startPlannedSession, type StartResult } from "@/lib/workoutLog";
import { exerciseKey, type LoggedSet } from "@/lib/workoutLogModel";
import { initState, progress, skipSession } from "./engines";
import { matchLibraryId, namesFor } from "./exercises";
```

2. Replace:

```ts
type Row = typeof programEnrolments.$inferSelect;
/** A write transaction: every change and its change-log event go in one. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Result = { ok: true } | { ok: false; error: string };
```

with:

```ts
type Row = typeof programEnrolments.$inferSelect;
/** A write transaction: every change and its change-log event go in one. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Result = { ok: true } | { ok: false; error: string };
```

3. Replace:

```ts
}

/** Start a program. One at a time: a live one must be ended first. */
export function enrol(clientId: number, input: EnrolInput): { ok: true; id: number } | { ok: false; error: string } {
  const busy = { ok: false as const, error: "End your current program before you start another." };
  const notDiy = { ok: false as const, error: "Programs are for DIY members. Switch this member to DIY first." };
  const member = db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get();
  if (member?.mode !== "diy") return notDiy;
  if (liveEnrolment(clientId)) return busy;
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  const t = entry.template;
  const problem = maxesProblem(t, input.maxesKg);
  if (problem) return { ok: false, error: problem };
```

with:

```ts
}

type EnrolResult = { ok: true; id: number } | { ok: false; error: string };
const BUSY = { ok: false as const, error: "End your current program before you start another." };

function enrolBlocked(clientId: number): EnrolResult | null {
  const member = db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get();
  if (member?.mode !== "diy") return { ok: false, error: "Programs are for DIY members. Switch this member to DIY first." };
  if (liveEnrolment(clientId)) return BUSY;
  return null;
}

/** Start a library program (a platform key or "copy-<id>"). One at a time: a live one must be ended first. */
export function enrol(clientId: number, input: EnrolInput): EnrolResult {
  const blocked = enrolBlocked(clientId);
  if (blocked) return blocked;
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  return enrolTemplate(clientId, input, { template: entry.template, programKey: entry.copyId ? null : entry.template.key, copyId: entry.copyId });
}

/** Where an enrolment's template came from: a platform key, a gym copy, or "member:<id>". */
export interface EnrolSource {
  template: ProgramTemplate;
  programKey: string | null;
  copyId: number | null;
}

/** Start a program from a template the caller has already found (and checked the member may run). */
export function enrolTemplate(clientId: number, input: Omit<EnrolInput, "key">, src: EnrolSource): EnrolResult {
  const blocked = enrolBlocked(clientId);
  if (blocked) return blocked;
  const t = src.template;
  const problem = maxesProblem(t, input.maxesKg);
  if (problem) return { ok: false, error: problem };
```

4. Replace:

```ts
        .values({
          clientId,
          programKey: entry.copyId ? null : t.key,
          copyId: entry.copyId,
          templateJson: JSON.stringify(t),
          ...stateColumns(state),
```

with:

```ts
        .values({
          clientId,
          programKey: src.programKey,
          copyId: src.copyId,
          templateJson: JSON.stringify(t),
          ...stateColumns(state),
```

5. Replace:

```ts
  } catch (err) {
    // The partial unique index allows one live enrolment per member.
    if (String(err).includes("UNIQUE")) return busy;
    throw err;
  }
  return { ok: true, id };
}
```

with:

```ts
  } catch (err) {
    // The partial unique index allows one live enrolment per member.
    if (String(err).includes("UNIQUE")) return BUSY;
    throw err;
  }
  return { ok: true, id };
}

/** The heaviest ticked set with a weight typed in, from a logged exercise. */
function lastWeight(sets: LoggedSet[] | undefined): number | null {
  const ks = (sets ?? []).filter((s) => s.done && s.weightKg !== null && s.weightKg > 0).map((s) => s.weightKg as number);
  return ks.length ? Math.max(...ks) : null;
}
```

6. Replace:

```ts
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
```

with:

```ts
  const lib = libraryIndex();
  const keys = d.exercises.map((ex) => exerciseKey(matchLibraryId(ex.name, lib), ex.name));
  const { best, previous } = exerciseHistory(view.clientId, keys);
  const own = view.template.engine.key === "own_rules";
  const e1rm: Record<string, number> = {};
  // A member-built exercise with no weight yet plans last time's weight.
  const lastKg: Record<string, number> = {};
  d.exercises.forEach((ex, i) => {
    const b = best[keys[i]];
    if (b && !ex.lift) e1rm[stateKey(ex)] = b;
    const w = own ? lastWeight(previous[keys[i]]) : null;
    if (w !== null) lastKg[stateKey(ex)] = w;
  });
  return planSession(view.template, view.state, { stepKg: view.stepKg, e1rm, lastKg });
}
```

7. Replace:

```ts
}

/** A coach moves a member to the start of another week of their program (0-based week). */
export function coachMoveToWeek(clientId: number, enrolmentId: number, weekIndex: number, actor: StaffActor): Result {
```

with:

```ts
}

/**
 * A member edited the program they are running: the new template and the
 * carried state, an open session of the current position moved to the new
 * position (it still finishes with the sets it started with), and the change
 * log, in the caller's transaction. False when the enrolment moved since
 * `view` was read; nothing is written then.
 */
export function writeTemplateEdit(tx: Tx, view: EnrolmentView, template: ProgramTemplate, state: EngineState, reason: string): boolean {
  if (!unchanged(tx, view, ["active", "paused"])) return false;
  const oldPos = positionOf(view.template, view.state.week, view.state.day);
  const newPos = positionOf(template, state.week, state.day);
  tx.update(programEnrolments).set({ templateJson: JSON.stringify(template), ...stateColumns(state) }).where(eq(programEnrolments.id, view.id)).run();
  tx.update(workoutSessions)
    .set({ dayPosition: newPos })
    .where(and(eq(workoutSessions.enrolmentId, view.id), isNull(workoutSessions.finishedAt), eq(workoutSessions.dayPosition, oldPos)))
    .run();
  logEvent(tx, view.id, { kind: "member" }, "edit", reason, view.state, state);
  return true;
}

/** A member sets a max on a program they built (a percent lift, or a new max after a test). */
export function memberSetMax(clientId: number, lift: LiftKey, kg: number): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.template.engine.key !== "own_rules") return { ok: false, error: "You don't have a program of your own running." };
  if (!view.template.lifts.includes(lift)) return { ok: false, error: "This program doesn't use that lift." };
  if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_KG) return { ok: false, error: "Enter a max between 1 and 600 kg." };
  const next = clone(view.state);
  next.maxes[lift] = round2(kg);
  next.tms[lift] = trainingMax(kg, view.template.tmPct);
  const done = db.transaction((tx) => {
    if (!unchanged(tx, view, ["active", "paused"])) return false;
    saveState(tx, view.id, next);
    logEvent(tx, view.id, { kind: "member" }, "max", `You set the ${LIFT_LABEL[lift].toLowerCase()} max to ${formatWeight(next.maxes[lift]!, view.unit)}.`, view.state, next);
    return true;
  });
  return done ? { ok: true } : { ok: false, error: "Your program changed. Try again." };
}

/** A coach moves a member to the start of another week of their program (0-based week). */
export function coachMoveToWeek(clientId: number, enrolmentId: number, weekIndex: number, actor: StaffActor): Result {
```


- [ ] **Step 6: Create `app/src/lib/programs/memberPrograms.ts`**

Create `app/src/lib/programs/memberPrograms.ts` with exactly this content:

```ts
// app/src/lib/programs/memberPrograms.ts
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, memberBuiltPrograms, programEnrolments } from "@/lib/db/schema";
import { toOwnRules } from "./convert";
import { initState } from "./engines";
import { bestLoggedSet, enrolTemplate, liveEnrolment, writeTemplateEdit, type EnrolInput } from "./enrolments";
import { copyKey, programByKey } from "./library";
import { editReason, rebaseEdit } from "./memberEdit";
import { blankMemberTemplate, memberKey, parseMemberKey, validateMemberTemplate } from "./memberTemplate";
import type { LiftKey, ProgramTemplate } from "./types";

/**
 * Programs a DIY member builds for themselves, for the CURRENT tenant
 * (ambient `db`). Every function takes the member's clientId and only reads
 * or writes that member's rows: another member's program id finds nothing.
 */

export interface MemberProgram {
  id: number;
  clientId: number;
  name: string;
  /** Checked on read; key "member:<id>". */
  template: ProgramTemplate;
  /** Maxes carried from the member's current program, offered at start. */
  maxes: Partial<Record<LiftKey, number>>;
  basedOn: string | null;
  updatedAt: number;
}

type Row = typeof memberBuiltPrograms.$inferSelect;
type Errors = { ok: false; errors: string[] };

const GONE: Errors = { ok: false, errors: ["That program no longer exists."] };
const NOT_DIY: Errors = { ok: false, errors: ["Programs are for DIY members."] };
const STALE: Errors = { ok: false, errors: ["Your program moved on while you were editing. Open it again and make the change once more."] };

function toProgram(r: Row): MemberProgram | null {
  let raw: unknown;
  let maxes: Partial<Record<LiftKey, number>> = {};
  try {
    raw = JSON.parse(r.templateJson);
    maxes = JSON.parse(r.maxesJson) as Partial<Record<LiftKey, number>>;
  } catch (err) {
    console.error("[programs] unreadable member program", r.id, err);
    return null;
  }
  // A row that no longer passes the check is skipped, so one bad row never takes the list down.
  const checked = validateMemberTemplate(raw, memberKey(r.id));
  if (!checked.ok) {
    console.error("[programs] member program fails the check", r.id, checked.errors.join(" | "));
    return null;
  }
  return { id: r.id, clientId: r.clientId, name: r.name, template: checked.template, maxes, basedOn: r.basedOn, updatedAt: r.updatedAt };
}

/** The member's own programs, most recently changed first. */
export function listMemberPrograms(clientId: number): MemberProgram[] {
  return db
    .select()
    .from(memberBuiltPrograms)
    .where(eq(memberBuiltPrograms.clientId, clientId))
    .orderBy(desc(memberBuiltPrograms.updatedAt), desc(memberBuiltPrograms.id))
    .all()
    .map(toProgram)
    .filter((p): p is MemberProgram => p !== null);
}

/** One of the member's own programs; null for another member's. */
export function getMemberProgram(clientId: number, id: number): MemberProgram | null {
  const r = db.select().from(memberBuiltPrograms).where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId))).get();
  return r ? toProgram(r) : null;
}

/** The id of the member program the member is running (active or paused), if any. */
export function runningMemberProgramId(clientId: number): number | null {
  const live = liveEnrolment(clientId);
  return live?.programKey ? parseMemberKey(live.programKey) : null;
}

export type StartFrom = { kind: "blank" } | { kind: "library"; key: string } | { kind: "current" };

/** The builder's ?from=: "blank", "current", or a library program key. */
export function parseStartFrom(raw: string | null | undefined): StartFrom | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 80) return null;
  if (v === "blank") return { kind: "blank" };
  if (v === "current") return { kind: "current" };
  return { kind: "library", key: v };
}

export interface Draft {
  template: ProgramTemplate;
  maxes: Partial<Record<LiftKey, number>>;
  basedOn: string | null;
}

/**
 * What the builder opens with. A library program comes with start weights
 * from the member's best logged sets where they have them; the current
 * program brings its maxes and its working weights. Null when the source is
 * not available to this member.
 */
export function startingDraft(clientId: number, from: StartFrom): Draft | null {
  if (from.kind === "blank") return { template: blankMemberTemplate(), maxes: {}, basedOn: null };
  if (from.kind === "library") {
    const entry = programByKey(from.key);
    if (!entry) return null;
    const t = entry.template;
    const step = db.select({ step: clients.plateStepKg }).from(clients).where(eq(clients.id, clientId)).get()?.step ?? 2.5;
    const logged: Partial<Record<LiftKey, number>> = {};
    for (const lift of t.lifts) {
      const best = bestLoggedSet(clientId, lift);
      if (best) logged[lift] = best.e1rm;
    }
    const s = initState(t, logged, step > 0 ? step : 2.5);
    return { template: toOwnRules(t, { weights: s.weights }).template, maxes: {}, basedOn: entry.copyId ? copyKey(entry.copyId) : t.key };
  }
  const live = liveEnrolment(clientId);
  if (!live) return null;
  const conv = toOwnRules(live.template, { weights: live.state.weights, tms: live.state.tms });
  const ownId = live.programKey ? parseMemberKey(live.programKey) : null;
  const basedOn = ownId ? (getMemberProgram(clientId, ownId)?.basedOn ?? null) : (live.programKey ?? (live.copyId ? copyKey(live.copyId) : null));
  return { template: conv.template, maxes: conv.maxes, basedOn };
}

function isDiy(clientId: number): boolean {
  return db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get()?.mode === "diy";
}

/** Save a new program. Nothing is written unless it passes the check. */
export function createMemberProgram(clientId: number, draft: { template: unknown; maxes: Partial<Record<LiftKey, number>>; basedOn: string | null }): { ok: true; id: number } | Errors {
  if (!isDiy(clientId)) return NOT_DIY;
  const checked = validateMemberTemplate(draft.template, "member:new");
  if (!checked.ok) return checked;
  const now = Date.now();
  const [row] = db
    .insert(memberBuiltPrograms)
    .values({
      clientId,
      name: checked.template.name,
      templateJson: JSON.stringify(checked.template),
      maxesJson: JSON.stringify(draft.maxes),
      basedOn: draft.basedOn,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: memberBuiltPrograms.id })
    .all();
  return { ok: true, id: row.id };
}

/**
 * Save an edit. When the member is running this program, the new version
 * applies from the next session: the program row, the enrolment's template,
 * its state and a change-log entry are written in one transaction, or none
 * of them.
 */
export function saveMemberProgram(clientId: number, id: number, raw: unknown, weekOrigins: unknown): { ok: true; edited: boolean } | Errors {
  const row = getMemberProgram(clientId, id);
  if (!row) return GONE;
  const key = memberKey(id);
  const checked = validateMemberTemplate(raw, key);
  if (!checked.ok) return checked;
  const t = checked.template;
  const live = liveEnrolment(clientId);
  const running = !!live && live.programKey === key;
  const out = running ? rebaseEdit({ before: live.template, after: t, state: live.state, weekOrigins: weekOrigins as (number | null)[], stepKg: live.stepKg, unit: live.unit }) : null;
  const done = db.transaction((tx) => {
    const now = tx
      .select({ key: programEnrolments.programKey })
      .from(programEnrolments)
      .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"])))
      .get();
    if ((now?.key === key) !== running) return false;
    if (running && out && !writeTemplateEdit(tx, live, t, out.state, editReason(out.lines))) return false;
    tx.update(memberBuiltPrograms)
      .set({ name: t.name, templateJson: JSON.stringify(t), updatedAt: Date.now() })
      .where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId)))
      .run();
    return true;
  });
  return done ? { ok: true, edited: running } : STALE;
}

/** Delete one of the member's programs. Refused while it is running. */
export function deleteMemberProgram(clientId: number, id: number): { ok: true } | { ok: false; error: string } {
  if (!getMemberProgram(clientId, id)) return { ok: false, error: GONE.errors[0] };
  if (runningMemberProgramId(clientId) === id) return { ok: false, error: "End this program on My program before you delete it." };
  const r = db.delete(memberBuiltPrograms).where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId))).run();
  return r.changes > 0 ? { ok: true } : { ok: false, error: GONE.errors[0] };
}

/** Start one of the member's own programs. */
export function enrolMemberProgram(clientId: number, id: number, input: Omit<EnrolInput, "key">): { ok: true; id: number } | { ok: false; error: string } {
  const p = getMemberProgram(clientId, id);
  if (!p) return { ok: false, error: "That program isn't available." };
  return enrolTemplate(clientId, input, { template: p.template, programKey: memberKey(id), copyId: null });
}
```

- [ ] **Step 7: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/memberPrograms.test.ts
cd app && npm test -- src/lib/programs/enrolments.test.ts
cd app && npm test -- src/lib/programs/library.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`memberPrograms.test.ts` prints `programs/memberPrograms: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/db/tenant.ts app/src/lib/db/schema.ts app/src/lib/programs/enrolments.ts app/src/lib/programs/memberPrograms.test.ts app/src/lib/programs/memberPrograms.ts
git commit -m "feat(programs): member_programs table, store, starting and editing a running member program

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Builder helpers: switching rules, weeks, days and exercises

The builder edits a copy of its draft and hands it to these, the gym-copy editor's style. Pure, so the rules switch and the week bookkeeping are tested without a browser.

**Files:**
- Test (create): `app/src/lib/programs/memberEditing.test.ts`
- Create: `app/src/lib/programs/memberEditing.ts`

**Interfaces:**
- Consumes: Task 1 (`OwnRule`, `RuleKind`), Task 3 (`blankMemberTemplate`, `validateMemberTemplate`, used by the test). Existing `exercises.ts` `canonicalFor`.
- Produces:
  - `interface BuilderDraft { template: ProgramTemplate; origins: (number | null)[] }`; `draftFrom(template, saved: boolean): BuilderDraft`.
  - `defaultIncKg(name): number` (5 for a deadlift, else 2.5); `guessLift(name): LiftKey`; `newExercise(name): ExerciseRx` (3 x 5, linear, 120 s rest).
  - `applyRule(ex: ExerciseRx, kind: RuleKind): ExerciseRx` (keeps sets, reps, rest, notes, superset and the start weight where they make sense; the same rule returns `ex`).
  - `addSet(ex)`, `setRest(ex, seconds)` (0 to 900), `addWeek(d, w): number` (copy of week w after it, origin null; returns its index), `removeWeek(d, w)` (the last week stays), `moveWeek(d, w, dir: -1 | 1): boolean`, `addDay(t, w)`, `removeDay(t, w, di)` (the last day stays), `moveDay(t, w, di, dir): boolean`, `moveExercise(t, w, di, xi, dir): boolean`, `removeExercise(t, w, di, xi)`. The last four never leave the first exercise `joined`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/memberEditing.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/memberEditing.test.ts
//
// The builder's helpers: switching rules keeps what still makes sense, week
// changes keep their origins in step, days and exercises move and go.
import assert from "node:assert/strict";

import { addDay, addSet, addWeek, applyRule, defaultIncKg, draftFrom, guessLift, moveDay, moveExercise, moveWeek, newExercise, removeDay, removeExercise, removeWeek, setRest } from "./memberEditing";
import { blankMemberTemplate, validateMemberTemplate } from "./memberTemplate";
import type { ExerciseRx } from "./types";

// ── defaults ──
assert.equal(defaultIncKg("Deadlift"), 5);
assert.equal(defaultIncKg("Romanian deadlift"), 5);
assert.equal(defaultIncKg("Bench press"), 2.5);
assert.equal(guessLift("Squat"), "squat", "an alias of Back squat");
assert.equal(guessLift("Bench press"), "bench");
assert.equal(guessLift("Pause deadlift"), "deadlift");
assert.equal(guessLift("Push press"), "press");
assert.equal(guessLift("Leg extension"), "squat");
const fresh = newExercise("Deadlift");
assert.deepEqual(fresh.rule, { kind: "linear", incKg: 5, deloadAfter: 3 });
assert.equal(fresh.sets.length, 3);

// ── every rule from every rule passes the member check ──
const kinds = ["linear", "range", "percent", "rpe", "manual"] as const;
for (const from of kinds) {
  for (const to of kinds) {
    const ex = applyRule(applyRule(newExercise("Bench press"), from), to);
    assert.equal(ex.rule!.kind, to);
    const t = blankMemberTemplate();
    t.weeks[0].days[0].exercises.push(ex);
    const r = validateMemberTemplate(t, "member:1");
    assert.ok(r.ok, `${from} to ${to}: ${r.ok ? "" : r.errors.join(" | ")}`);
  }
}

// ── what a switch keeps ──
const linear: ExerciseRx = { name: "Bench press", notes: "Pause.", joined: true, sets: [{ kind: "fixed", reps: 5, rest: 150 }, { kind: "fixed", reps: 3, rest: 150 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 80 } };
const range = applyRule(linear, "range");
assert.deepEqual(range.sets, [{ kind: "fixed", reps: { min: 5, max: 9 }, rest: 150 }, { kind: "fixed", reps: { min: 3, max: 7 }, rest: 150 }]);
assert.deepEqual(range.rule, { kind: "range", startKg: 80 }, "the start weight comes along");
assert.equal(range.notes, "Pause.");
assert.equal(range.joined, true);
const pct = applyRule(linear, "percent");
assert.equal(pct.lift, "bench");
assert.deepEqual(pct.sets.map((s) => s.kind === "pct" && [s.pct, s.reps]), [[0.75, 5], [0.75, 3]]);
assert.deepEqual(applyRule(pct, "manual").rule, { kind: "manual" }, "percent has no start weight to carry");
const rpe = applyRule(range, "rpe");
assert.deepEqual(rpe.sets.map((s) => s.kind === "rpe" && [s.rpe, s.reps]), [[8, 5], [8, 3]]);
assert.equal(applyRule(linear, "linear"), linear, "the same rule changes nothing");
const manualRange = applyRule(range, "manual");
assert.deepEqual(manualRange.sets[0], { kind: "fixed", reps: { min: 5, max: 9 }, rest: 150 }, "manual keeps a rep range");

// ── sets ──
const ex = newExercise("Back squat");
addSet(ex);
assert.equal(ex.sets.length, 4);
setRest(ex, 2000);
assert.ok(ex.sets.every((s) => s.rest === 900));

// ── weeks keep their origins ──
const t = blankMemberTemplate();
t.weeks[0].days[0].exercises.push(newExercise("Bench press"));
t.weeks.push(structuredClone(t.weeks[0]));
const d = draftFrom(t, true);
assert.deepEqual(d.origins, [0, 1]);
assert.deepEqual(draftFrom(t, false).origins, [null, null]);
assert.equal(addWeek(d, 0), 1);
assert.deepEqual(d.origins, [0, null, 1]);
assert.equal(d.template.weeks.length, 3);
d.template.weeks[1].days[0].name = "Deload";
assert.equal(d.template.weeks[0].days[0].name, "Day 1", "the copy is its own");
assert.ok(moveWeek(d, 2, -1));
assert.deepEqual(d.origins, [0, 1, null]);
assert.equal(d.template.weeks[2].days[0].name, "Deload");
assert.equal(moveWeek(d, 0, -1), false);
removeWeek(d, 0);
assert.deepEqual(d.origins, [1, null]);
removeWeek(d, 0);
removeWeek(d, 0);
assert.equal(d.template.weeks.length, 1, "the last week stays");

// ── days and exercises ──
const p = blankMemberTemplate();
addDay(p, 0);
assert.deepEqual(p.weeks[0].days.map((x) => x.name), ["Day 1", "Day 2"]);
p.weeks[0].days[0].exercises.push(newExercise("Bench press"), { ...newExercise("Dumbbell row"), joined: true });
assert.ok(moveDay(p, 0, 0, 1));
assert.deepEqual(p.weeks[0].days.map((x) => x.name), ["Day 2", "Day 1"]);
assert.ok(moveExercise(p, 0, 1, 1, -1));
assert.equal(p.weeks[0].days[1].exercises[0].name, "Dumbbell row");
assert.equal(p.weeks[0].days[1].exercises[0].joined, undefined, "the first exercise joins nothing");
removeExercise(p, 0, 1, 0);
assert.deepEqual(p.weeks[0].days[1].exercises.map((x) => x.name), ["Bench press"]);
removeDay(p, 0, 0);
removeDay(p, 0, 0);
assert.equal(p.weeks[0].days.length, 1, "the last day stays");

console.log("programs/memberEditing: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/memberEditing.test.ts`
Expected: FAIL with `Cannot find module './memberEditing'`.

- [ ] **Step 3: Create `app/src/lib/programs/memberEditing.ts`**

Create `app/src/lib/programs/memberEditing.ts` with exactly this content:

```ts
// app/src/lib/programs/memberEditing.ts
/**
 * Helpers for the member's program builder. The builder edits a copy of its
 * draft and hands it to these (the same style as the gym-copy editor). Week
 * changes keep `origins` in step: for each week, the saved week it came from,
 * so an edit while running can follow the member's week. Pure.
 */
import { canonicalFor } from "./exercises";
import { LIFT_EXERCISE, LIFT_KEYS, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type SetRx } from "./types";

export interface BuilderDraft {
  template: ProgramTemplate;
  /** For each week of the template, the saved week it came from; null for a week added since. */
  origins: (number | null)[];
}

export function draftFrom(template: ProgramTemplate, saved: boolean): BuilderDraft {
  return { template, origins: template.weeks.map((_, i) => (saved ? i : null)) };
}

/** 5 kg for a deadlift, 2.5 kg for everything else. */
export function defaultIncKg(name: string): number {
  return /deadlift/i.test(name) ? 5 : 2.5;
}

/** The max an exercise most likely takes its percentages from. */
export function guessLift(name: string): LiftKey {
  const canonical = canonicalFor(name)?.name ?? name;
  const exact = LIFT_KEYS.find((l) => LIFT_EXERCISE[l] === canonical);
  if (exact) return exact;
  const n = name.toLowerCase();
  if (n.includes("deadlift")) return "deadlift";
  if (n.includes("bench")) return "bench";
  if (n.includes("press")) return "press";
  if (n.includes("row")) return "row";
  return "squat";
}

const repsOf = (s: SetRx): number => (typeof s.reps === "number" ? s.reps : s.reps.min);

/** A new exercise: 3 sets of 5, adding weight each session. */
export function newExercise(name: string): ExerciseRx {
  return { name, sets: [0, 1, 2].map(() => ({ kind: "fixed" as const, reps: 5, rest: 120 })), rule: { kind: "linear", incKg: defaultIncKg(name), deloadAfter: 3 } };
}

function startKgOf(ex: ExerciseRx): number | undefined {
  const r = ex.rule;
  return r && (r.kind === "linear" || r.kind === "range" || r.kind === "manual") ? r.startKg : undefined;
}

/** The exercise under another rule, keeping its sets, reps, rest, notes and start weight where they still make sense. */
export function applyRule(ex: ExerciseRx, kind: RuleKind): ExerciseRx {
  if (ex.rule?.kind === kind) return ex;
  const start = startKgOf(ex);
  const withStart = start !== undefined ? { startKg: start } : {};
  const base: ExerciseRx = { name: ex.name, sets: [] };
  if (ex.tier) base.tier = ex.tier;
  if (ex.bodyweight) base.bodyweight = true;
  if (ex.joined) base.joined = true;
  if (ex.notes) base.notes = ex.notes;
  const sets = ex.sets.length ? ex.sets : [{ kind: "fixed" as const, reps: 5, rest: 120 }];
  switch (kind) {
    case "linear":
      return { ...base, sets: sets.map((s) => ({ kind: "fixed", reps: repsOf(s), rest: s.rest })), rule: { kind: "linear", incKg: defaultIncKg(ex.name), deloadAfter: 3, ...withStart } };
    case "range":
      return {
        ...base,
        sets: sets.map((s) => ({ kind: "fixed", reps: typeof s.reps !== "number" ? s.reps : { min: s.reps, max: s.reps + 4 }, rest: s.rest })),
        rule: { kind: "range", ...withStart },
      };
    case "percent":
      return {
        ...base,
        lift: ex.lift ?? guessLift(ex.name),
        sets: sets.map((s) => (s.kind === "pct" || s.kind === "amrap" ? s : { kind: "pct", pct: 0.75, reps: repsOf(s), rest: s.rest })),
        rule: { kind: "percent" },
      };
    case "rpe":
      return { ...base, sets: sets.map((s) => (s.kind === "rpe" ? s : { kind: "rpe", rpe: 8, reps: repsOf(s), rest: s.rest })), rule: { kind: "rpe" } };
    case "manual":
      return { ...base, sets: sets.map((s) => ({ kind: "fixed", reps: s.kind === "fixed" ? s.reps : repsOf(s), rest: s.rest })), rule: { kind: "manual", ...withStart } };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** One more set, the same as the last. */
export function addSet(ex: ExerciseRx): void {
  const last = ex.sets[ex.sets.length - 1];
  if (last) ex.sets.push(structuredClone(last));
}

/** Every set's rest, in seconds (0 to 900). */
export function setRest(ex: ExerciseRx, seconds: number): void {
  const rest = Math.max(0, Math.min(900, Math.round(seconds)));
  for (const s of ex.sets) s.rest = rest;
}

function swap<T>(xs: T[], i: number, j: number): boolean {
  if (i < 0 || j < 0 || i >= xs.length || j >= xs.length) return false;
  [xs[i], xs[j]] = [xs[j], xs[i]];
  return true;
}

/** "Add a week": a copy of week w right after it. Returns the new week's index. */
export function addWeek(d: BuilderDraft, w: number): number {
  d.template.weeks.splice(w + 1, 0, structuredClone(d.template.weeks[w]));
  d.origins.splice(w + 1, 0, null);
  return w + 1;
}

/** Remove week w; the last week stays. */
export function removeWeek(d: BuilderDraft, w: number): void {
  if (d.template.weeks.length <= 1) return;
  d.template.weeks.splice(w, 1);
  d.origins.splice(w, 1);
}

/** Move week w one place earlier (-1) or later (1). */
export function moveWeek(d: BuilderDraft, w: number, dir: -1 | 1): boolean {
  return swap(d.template.weeks, w, w + dir) && swap(d.origins, w, w + dir);
}

export function addDay(t: ProgramTemplate, w: number): void {
  const days = t.weeks[w].days;
  days.push({ name: `Day ${days.length + 1}`, exercises: [] });
}

export function removeDay(t: ProgramTemplate, w: number, di: number): void {
  if (t.weeks[w].days.length > 1) t.weeks[w].days.splice(di, 1);
}

export function moveDay(t: ProgramTemplate, w: number, di: number, dir: -1 | 1): boolean {
  return swap(t.weeks[w].days, di, di + dir);
}

export function moveExercise(t: ProgramTemplate, w: number, di: number, xi: number, dir: -1 | 1): boolean {
  const list = t.weeks[w].days[di].exercises;
  const moved = swap(list, xi, xi + dir);
  if (moved && list[0]?.joined) delete list[0].joined;
  return moved;
}

export function removeExercise(t: ProgramTemplate, w: number, di: number, xi: number): void {
  const list = t.weeks[w].days[di].exercises;
  list.splice(xi, 1);
  if (list[0]?.joined) delete list[0].joined;
}
```

- [ ] **Step 4: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/memberEditing.test.ts
cd app && npx tsc --noEmit -p .
```

Expected: each test file passes (`memberEditing.test.ts` prints `programs/memberEditing: ok`; the others print their own `ok` line); `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/memberEditing.test.ts app/src/lib/programs/memberEditing.ts
git commit -m "feat(programs): builder helpers for rules, weeks, days and exercises

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The phone builder: save action, builder component, new and edit pages

Phone-first: 44px targets, the member app's brand CSS variables, one exercise open at a time, a sticky Save above the tab bar, and set rows that fit 320px. Nothing is stored until Save; the server checks everything and the builder lists the errors at the top.

**Files:**
- Test (create): `app/src/app/app/programs/gating.test.ts`
- Create: `app/src/app/app/programs/built/actions.ts`
- Create: `app/src/components/clientapp/MemberProgramBuilder.tsx`
- Create: `app/src/app/app/programs/built/new/page.tsx`
- Create: `app/src/app/app/programs/built/[id]/page.tsx`
- Modify: `app/src/app/globals.css`

**Interfaces:**
- Consumes: Task 6 (`parseStartFrom`, `startingDraft`, `createMemberProgram`, `saveMemberProgram`, `deleteMemberProgram`, `getMemberProgram`), Task 7 (all helpers), Task 3 (`MEMBER_LIMITS`, `memberKey`), Task 1 (`RULE_KINDS`, `RULE_LABEL`, `stateKey`). Existing `ExercisePicker` (`components/clientapp/ExercisePicker.tsx`, searches the gym library through `searchExercisesAction`), `requireProgramsPage`, `requireClient`, `memberSeesPrograms`.
- Produces:
  - `app/src/app/app/programs/built/actions.ts`: `saveBuiltProgramAction(raw: { id: number | null; from: string | null; template: unknown; weekOrigins: unknown }): Promise<{ ok: true; id: number; edited: boolean } | { ok: false; errors: string[] }>` (a new program's maxes and based-on are worked out again on the server from `from`); `deleteBuiltProgramAction(id: number): Promise<{ ok: true } | { ok: false; error: string }>`.
  - `MemberProgramBuilder({ id: number | null; from: string | null; initial: ProgramTemplate; initialUnit: WeightUnit; running: boolean; current: Record<string, number> })` (`current`: working weights by state key, shown as "Now 72.5 kg" beside Start at while running).
  - Routes: `/app/programs/built/new` (starting points; `?from=blank`, `?from=current`, `?from=<library key>` opens the builder) and `/app/programs/built/[id]` (edit; Start this program when nothing is running).
  - CSS in `globals.css`: `.mb`, `.mb-field`, `.mb-fields`, `.mb-hint`, `.mb-errors`, `.mb-weeks`, `.mb-tab`, `.mb-tools`, `.mb-icon`, `.mb-day-head`, `.mb-ex*`, `.mb-sets`, `.mb-set`, `.mb-setno`, `.mb-num`, `.mb-plus`, `.mb-link`, `.mb-notes`, `.mb-save`, `.mb-row`, `.mb-chip-link` (Task 9 uses the last three).
  - `app/src/app/app/programs/gating.test.ts`: every page under `/app/programs` calls `requireProgramsPage()`, every exported action checks `member()` first.

- [ ] **Step 1: Write the failing test**

Create `app/src/app/app/programs/gating.test.ts` with exactly this content:

```ts
// Run: npm test -- src/app/app/programs/gating.test.ts
//
// Every member Programs page calls requireProgramsPage(), and every exported
// server action under /app/programs checks the member (requireClient plus
// memberSeesPrograms, through member()) before it does anything. A new page or
// action that skips the gate fails here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src", "app", "app", "programs");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const files = walk(root);
const pages = files.filter((f) => f.endsWith("page.tsx"));
const actions = files.filter((f) => f.endsWith("actions.ts"));
const rel = (f: string) => path.relative(root, f);
for (const want of ["page.tsx", "[key]/page.tsx", "[key]/start/page.tsx", "mine/page.tsx", "built/new/page.tsx", "built/[id]/page.tsx"]) {
  assert.ok(pages.some((f) => rel(f) === want), `has ${want}`);
}
for (const want of ["actions.ts", "built/actions.ts"]) assert.ok(actions.some((f) => rel(f) === want), `has ${want}`);

for (const f of pages) {
  const src = fs.readFileSync(f, "utf8");
  assert.ok(/requireProgramsPage\(\)/.test(src), `${rel(f)} calls requireProgramsPage()`);
}

for (const f of actions) {
  const src = fs.readFileSync(f, "utf8");
  assert.ok(/^(\/\/[^\n]*\n)*"use server";/.test(src), `${rel(f)} is a server actions file`);
  assert.ok(/function member\(\) \{\s+const c = requireClient\(\);\s+return memberSeesPrograms\(c\) \? c : null;\s+\}/.test(src), `${rel(f)} gates with requireClient and memberSeesPrograms`);
  const bodies = src.split(/\nexport async function /).slice(1);
  assert.ok(bodies.length > 0, `${rel(f)} exports actions`);
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf("("));
    const firstLines = body.split("\n").slice(1, 3).join("\n");
    assert.ok(/const c = member\(\);\s+if \(!c\) return/.test(firstLines), `${rel(f)}: ${name} checks the member first`);
  }
}

console.log("app/programs gating: ok");
```

- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/app/app/programs/gating.test.ts`
Expected: FAIL with an `AssertionError`: `has built/new/page.tsx`.

- [ ] **Step 3: Create `app/src/app/app/programs/built/actions.ts`**

Create `app/src/app/app/programs/built/actions.ts` with exactly this content:

```ts
// app/src/app/app/programs/built/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import { createMemberProgram, deleteMemberProgram, parseStartFrom, saveMemberProgram, startingDraft } from "@/lib/programs/memberPrograms";

// The member's own programs. Every action takes the member from their client
// session; lib/programs/memberPrograms only ever touches that member's rows.

type SaveResult = { ok: true; id: number; edited: boolean } | { ok: false; errors: string[] };
const OFF = "Programs aren't switched on for you.";

function member() {
  const c = requireClient();
  return memberSeesPrograms(c) ? c : null;
}

function refresh(id?: number) {
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
  if (id) revalidatePath(`/app/programs/built/${id}`);
}

const saveZ = z.object({
  id: z.number().int().positive().nullable(),
  /** Where a new program started from (the builder's ?from=); its maxes and based-on come from the server, never the request. */
  from: z.string().max(80).nullable(),
  template: z.unknown(),
  weekOrigins: z.unknown(),
});

/** Save a new program, or an edit to one. An edit to the running program applies from the next session. */
export async function saveBuiltProgramAction(raw: unknown): Promise<SaveResult> {
  const c = member();
  if (!c) return { ok: false, errors: [OFF] };
  const p = saveZ.safeParse(raw);
  if (!p.success) return { ok: false, errors: ["Couldn't read the program. Reload the page and try again."] };
  const v = p.data;
  if (v.id === null) {
    const from = parseStartFrom(v.from);
    const draft = from ? startingDraft(c.clientId, from) : null;
    const r = createMemberProgram(c.clientId, { template: v.template, maxes: draft?.maxes ?? {}, basedOn: draft?.basedOn ?? null });
    if (!r.ok) return r;
    refresh(r.id);
    return { ok: true, id: r.id, edited: false };
  }
  const r = saveMemberProgram(c.clientId, v.id, v.template, v.weekOrigins);
  if (!r.ok) return r;
  refresh(v.id);
  return { ok: true, id: v.id, edited: r.edited };
}

export async function deleteBuiltProgramAction(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = member();
  if (!c) return { ok: false, error: OFF };
  const p = z.number().int().positive().safeParse(id);
  if (!p.success) return { ok: false, error: "That program no longer exists." };
  const r = deleteMemberProgram(c.clientId, p.data);
  if (r.ok) refresh();
  return r;
}
```

- [ ] **Step 4: Create `app/src/components/clientapp/MemberProgramBuilder.tsx`**

Create `app/src/components/clientapp/MemberProgramBuilder.tsx` with exactly this content:

```tsx
// app/src/components/clientapp/MemberProgramBuilder.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/clientapp/ui";
import { ExercisePicker } from "@/components/clientapp/ExercisePicker";
import { saveBuiltProgramAction } from "@/app/app/programs/built/actions";
import {
  addDay,
  addSet,
  addWeek,
  applyRule,
  draftFrom,
  moveDay,
  moveExercise,
  moveWeek,
  newExercise,
  removeDay,
  removeExercise,
  removeWeek,
  setRest,
  type BuilderDraft,
} from "@/lib/programs/memberEditing";
import { MEMBER_LIMITS } from "@/lib/programs/memberTemplate";
import { stateKey, summariseRx } from "@/lib/programs/planner";
import { LIFT_KEYS, LIFT_LABEL, RULE_KINDS, RULE_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type WeightUnit } from "@/lib/programs/types";
import { formatWeight, kgToUnit, unitToKg } from "@/lib/programs/units";

const RULE_HELP: Record<RuleKind, string> = {
  linear: "Adds weight after a session with every rep. Gets 10% lighter after the misses in a row you set.",
  range: "Adds weight when every set reaches the top of its range, then starts again at the bottom.",
  percent: "Each set is a percentage of your max.",
  rpe: "Each set has a target effort. The weight comes from your best logged set.",
  manual: "You choose the weight. It starts from last time.",
};

/** A number box that can be emptied while typing: an empty box is null, a usable number is passed on as typed. */
function NumberBox({ value, onValue, label, decimal, placeholder }: { value: number | null; onValue: (n: number | null) => void; label: string; decimal?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="pg-input mb-num"
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        const v = e.target.value.replace(",", ".");
        setDraft(v);
        if (v.trim() === "") return onValue(null);
        const n = Number(v);
        if (Number.isFinite(n)) onValue(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

type Edit = (fn: (ex: ExerciseRx) => void) => void;

function RuleFields({ ex, unit, running, nowKg, onChange }: { ex: ExerciseRx; unit: WeightUnit; running: boolean; nowKg: number | null; onChange: Edit }) {
  const r = ex.rule;
  if (!r) return null;
  const inUnit = (kg: number | undefined) => (kg === undefined ? null : kgToUnit(kg, unit));
  const start =
    r.kind === "linear" || r.kind === "range" || r.kind === "manual" ? (
      <label className="mb-field">
        <span className="td-label">Start at ({unit})</span>
        <NumberBox
          decimal
          label={`Start weight in ${unit}`}
          placeholder="Optional"
          value={inUnit(r.startKg)}
          onValue={(n) =>
            onChange((x) => {
              const cur = x.rule;
              if (cur && (cur.kind === "linear" || cur.kind === "range" || cur.kind === "manual")) {
                if (n === null || n <= 0) delete cur.startKg;
                else cur.startKg = unitToKg(n, unit);
              }
            })
          }
        />
        {running && nowKg !== null && <span className="mb-hint">Now {formatWeight(nowKg, unit)}. Change this to set a new weight from your next session.</span>}
      </label>
    ) : null;
  if (r.kind === "linear") {
    return (
      <div className="mb-fields">
        <label className="mb-field">
          <span className="td-label">Add each time ({unit})</span>
          <NumberBox
            decimal
            label={`Weight to add in ${unit}`}
            value={inUnit(r.incKg)}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind === "linear") x.rule.incKg = n === null ? 0 : unitToKg(n, unit);
              })
            }
          />
        </label>
        <label className="mb-field">
          <span className="td-label">Lighter after misses</span>
          <NumberBox
            label="Misses in a row before it gets lighter"
            value={r.deloadAfter}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind === "linear") x.rule.deloadAfter = n === null ? 0 : Math.round(n);
              })
            }
          />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "range") {
    return (
      <div className="mb-fields">
        <label className="mb-field">
          <span className="td-label">Add at the top ({unit})</span>
          <NumberBox
            decimal
            label={`Weight to add in ${unit}`}
            placeholder="Smallest jump"
            value={inUnit(r.incKg)}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind !== "range") return;
                if (n === null || n <= 0) delete x.rule.incKg;
                else x.rule.incKg = unitToKg(n, unit);
              })
            }
          />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "percent") {
    return (
      <div className="mb-fields">
        <label className="mb-field">
          <span className="td-label">Percent of your</span>
          <select
            className="pg-input"
            value={ex.lift ?? ""}
            onChange={(e) => {
              const lift = e.target.value as LiftKey;
              onChange((x) => void (x.lift = lift));
            }}
          >
            {LIFT_KEYS.map((l) => (
              <option key={l} value={l}>
                {LIFT_LABEL[l]} max
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (r.kind === "manual") return <div className="mb-fields">{start}</div>;
  return null;
}

function SetRows({ ex, onChange }: { ex: ExerciseRx; onChange: Edit }) {
  const kind = ex.rule?.kind ?? "manual";
  const heads: Record<RuleKind, [string, string]> = {
    linear: ["Reps", ""],
    range: ["From", "To"],
    percent: ["%", "Reps"],
    rpe: ["RPE", "Reps"],
    manual: ["Reps", "Up to"],
  };
  const plus = kind === "linear" || kind === "percent";
  return (
    <div className="mb-sets">
      <div className="mb-set mb-set--head" aria-hidden>
        <span>Set</span>
        <span>{heads[kind][0]}</span>
        <span>{heads[kind][1]}</span>
        <span>{plus ? "Max reps" : ""}</span>
        <span />
      </div>
      {ex.sets.map((s, si) => {
        const n = si + 1;
        const fixedMin = s.kind === "fixed" ? (typeof s.reps === "number" ? s.reps : s.reps.min) : null;
        const fixedMax = s.kind === "fixed" && typeof s.reps !== "number" ? s.reps.max : null;
        const setCount = (v: number | null) =>
          onChange((x) => {
            const cur = x.sets[si];
            if (cur.kind === "pct" || cur.kind === "amrap" || cur.kind === "rpe") cur.reps = v === null ? 0 : Math.round(v);
          });
        const setReps = (min: number | null, max: number | null, keepRange: boolean) =>
          onChange((x) => {
            const cur = x.sets[si];
            if (cur.kind !== "fixed") return;
            const lo = min === null ? 0 : Math.round(min);
            if (keepRange) cur.reps = { min: lo, max: max === null ? 0 : Math.round(max) };
            else cur.reps = max !== null && max > lo ? { min: lo, max: Math.round(max) } : lo;
          });
        return (
          <div key={si} className="mb-set">
            <span className="mb-setno">{n}</span>
            {kind === "linear" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => setReps(v, null, false)} />
                <span />
              </>
            )}
            {kind === "range" && (
              <>
                <NumberBox label={`Set ${n} bottom of the rep range`} value={fixedMin} onValue={(v) => setReps(v, fixedMax, true)} />
                <NumberBox label={`Set ${n} top of the rep range`} value={fixedMax} onValue={(v) => setReps(fixedMin, v, true)} />
              </>
            )}
            {kind === "manual" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => setReps(v, fixedMax, false)} />
                <NumberBox label={`Set ${n} top of the rep range`} placeholder="-" value={fixedMax} onValue={(v) => setReps(fixedMin, v, false)} />
              </>
            )}
            {kind === "percent" && (s.kind === "pct" || s.kind === "amrap") && (
              <>
                <NumberBox
                  decimal
                  label={`Set ${n} percentage of your max`}
                  value={Math.round(s.pct * 1000) / 10}
                  onValue={(v) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "pct" || cur.kind === "amrap") cur.pct = v === null ? 0 : v / 100;
                    })
                  }
                />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={setCount} />
              </>
            )}
            {kind === "rpe" && s.kind === "rpe" && (
              <>
                <NumberBox
                  decimal
                  label={`Set ${n} RPE`}
                  value={s.rpe}
                  onValue={(v) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "rpe") cur.rpe = v === null ? 0 : v;
                    })
                  }
                />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={setCount} />
              </>
            )}
            {plus ? (
              <button
                type="button"
                className="mb-plus"
                aria-pressed={s.kind === "amrap" || (s.kind === "fixed" && s.amrap === true)}
                aria-label={`Set ${n}: as many reps as you can`}
                onClick={() =>
                  onChange((x) => {
                    const cur = x.sets[si];
                    if (cur.kind === "fixed") {
                      if (cur.amrap) delete cur.amrap;
                      else cur.amrap = true;
                    } else if (cur.kind === "pct" || cur.kind === "amrap") x.sets[si] = { ...cur, kind: cur.kind === "pct" ? "amrap" : "pct" };
                  })
                }
              >
                +
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="mb-icon" aria-label={`Remove set ${n}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => void x.sets.splice(si, 1))}>
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {ex.sets.length < MEMBER_LIMITS.sets && (
        <button type="button" className="mb-link" onClick={() => onChange((x) => addSet(x))}>
          <Plus size={16} /> Add set
        </button>
      )}
    </div>
  );
}

function ExerciseCard({
  ex,
  index,
  count,
  open,
  unit,
  running,
  nowKg,
  onToggle,
  onChange,
  onRule,
  onRename,
  onMove,
  onRemove,
}: {
  ex: ExerciseRx;
  index: number;
  count: number;
  open: boolean;
  unit: WeightUnit;
  running: boolean;
  nowKg: number | null;
  onToggle: () => void;
  onChange: Edit;
  onRule: (kind: RuleKind) => void;
  onRename: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const rule = ex.rule?.kind ?? "manual";
  return (
    <div className="mb-ex" data-joined={ex.joined ? "true" : undefined}>
      <button type="button" className="mb-ex-head" aria-expanded={open} onClick={onToggle}>
        <span className="mb-ex-title">
          <span className="mb-ex-name">{ex.name}</span>
          <span className="mb-ex-sub">
            {RULE_LABEL[rule]}. {summariseRx(ex.sets)}
            {ex.joined ? ". Joined to the one above" : ""}
          </span>
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="mb-ex-body">
          <button type="button" className="mb-link" onClick={onRename}>
            <Pencil size={16} /> Change exercise
          </button>
          <div className="pg-chips" role="group" aria-label="How the weight moves">
            {RULE_KINDS.map((k) => (
              <button key={k} type="button" className="pg-chip" aria-pressed={rule === k} onClick={() => onRule(k)}>
                {RULE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="mb-hint">{RULE_HELP[rule]}</div>
          <RuleFields ex={ex} unit={unit} running={running} nowKg={nowKg} onChange={onChange} />
          <SetRows ex={ex} onChange={onChange} />
          <label className="mb-field">
            <span className="td-label">Rest between sets (seconds)</span>
            <NumberBox label="Rest in seconds" value={ex.sets[0]?.rest ?? 0} onValue={(n) => onChange((x) => setRest(x, n ?? 0))} />
          </label>
          <label className="mb-field">
            <span className="td-label">Notes</span>
            <textarea
              className="pg-input mb-notes"
              rows={2}
              maxLength={MEMBER_LIMITS.notes}
              placeholder="Optional"
              value={ex.notes ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange((x) => {
                  if (v) x.notes = v;
                  else delete x.notes;
                });
              }}
            />
          </label>
          {index > 0 && (
            <button
              type="button"
              className="pg-chip"
              aria-pressed={ex.joined === true}
              onClick={() =>
                onChange((x) => {
                  if (x.joined) delete x.joined;
                  else x.joined = true;
                })
              }
            >
              Superset with the exercise above
            </button>
          )}
          <div className="mb-tools">
            <button type="button" className="mb-icon" aria-label={`Move ${ex.name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="mb-icon" aria-label={`Move ${ex.name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="mb-icon" aria-label={`Remove ${ex.name}`} onClick={onRemove}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Picking = { w: number; di: number; xi: number | null } | null;

/**
 * The member's program builder: name and units, week tabs, days, and each
 * exercise with its rule, sets, rest and notes. Phone-first. Save checks
 * everything on the server and lists what needs fixing.
 * `from` is set for a new program (the builder's ?from=); `running` when the
 * member is running this program, with its working weights by state key.
 */
export function MemberProgramBuilder({
  id,
  from,
  initial,
  initialUnit,
  running,
  current,
}: {
  id: number | null;
  from: string | null;
  initial: ProgramTemplate;
  initialUnit: WeightUnit;
  running: boolean;
  current: Record<string, number>;
}) {
  const router = useRouter();
  const [d, setD] = useState<BuilderDraft>(() => draftFrom(initial, id !== null));
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [wi, setWi] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const t = d.template;
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];

  function edit(fn: (draft: BuilderDraft) => void) {
    setD((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  function save() {
    start(async () => {
      const r = await saveBuiltProgramAction({ id, from, template: d.template, weekOrigins: d.origins });
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Not saved. See what needs fixing at the top.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setErrors([]);
      // Saved: every week is now a saved week.
      setD((prev) => ({ ...prev, origins: prev.template.weeks.map((_, i) => i) }));
      toast.success(r.edited ? "Saved. Your program uses it from your next session." : "Saved");
      if (id === null) router.replace(`/app/programs/built/${r.id}`);
      router.refresh();
    });
  }

  function pick(name: string) {
    const p = picking;
    setPicking(null);
    if (!p) return;
    edit((x) => {
      const list = x.template.weeks[p.w].days[p.di].exercises;
      if (p.xi === null) list.push(newExercise(name));
      else list[p.xi].name = name;
    });
    if (p.xi === null) setOpen(`${p.w}-${p.di}-${t.weeks[p.w].days[p.di].exercises.length}`);
  }

  return (
    <div className="mb">
      {errors.length > 0 && (
        <div className="mb-errors" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Card style={{ display: "grid", gap: 12 }}>
        <label className="mb-field">
          <span className="td-label">Name</span>
          <input
            className="pg-input"
            maxLength={MEMBER_LIMITS.name}
            value={t.name}
            onChange={(e) => {
              const v = e.target.value;
              edit((x) => void (x.template.name = v));
            }}
          />
        </label>
        <div className="mb-field">
          <span className="td-label">Weights in</span>
          <div className="pg-chips" role="group" aria-label="Units">
            {(["kg", "lb"] as const).map((u) => (
              <button key={u} type="button" className="pg-chip" aria-pressed={unit === u} onClick={() => setUnit(u)}>
                {u === "kg" ? "Kilograms" : "Pounds"}
              </button>
            ))}
          </div>
        </div>
        {running && <div className="mb-hint">You&rsquo;re running this program. Changes apply from your next session. Nothing you have logged changes.</div>}
      </Card>

      <div className="mb-weeks" role="tablist" aria-label="Weeks">
        {t.weeks.map((wk, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === w} className="mb-tab" onClick={() => setWi(i)}>
            Week {i + 1}
            {wk.label ? `: ${wk.label}` : ""}
          </button>
        ))}
        {t.weeks.length < MEMBER_LIMITS.weeks && (
          <button
            type="button"
            className="mb-tab"
            onClick={() => {
              edit((x) => void addWeek(x, w));
              setWi(w + 1);
            }}
          >
            <Copy size={16} aria-hidden /> Add a week
          </button>
        )}
      </div>
      <div className="mb-hint">{t.weeks.length === 1 ? "Week 1 repeats. Add a week to copy it and change the copy, for a block or a deload." : `The ${t.weeks.length} weeks run in order, then start again.`}</div>
      {t.weeks.length > 1 && (
        <div className="mb-tools">
          <button
            type="button"
            className="mb-icon"
            aria-label="Move this week earlier"
            disabled={w === 0}
            onClick={() => {
              edit((x) => void moveWeek(x, w, -1));
              setWi(w - 1);
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="mb-icon"
            aria-label="Move this week later"
            disabled={w === t.weeks.length - 1}
            onClick={() => {
              edit((x) => void moveWeek(x, w, 1));
              setWi(w + 1);
            }}
          >
            <ArrowRight size={16} />
          </button>
          <input
            className="pg-input"
            aria-label={`Week ${w + 1} label`}
            placeholder="Label, e.g. Deload"
            maxLength={60}
            value={week.label ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              edit((x) => {
                if (v) x.template.weeks[w].label = v;
                else delete x.template.weeks[w].label;
              });
            }}
          />
          <button
            type="button"
            className="mb-icon"
            aria-label={`Remove week ${w + 1}`}
            onClick={() => {
              edit((x) => removeWeek(x, w));
              setWi(Math.max(0, w - 1));
            }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}

      {week.days.map((day, di) => (
        <Card key={`${w}-${di}`} style={{ display: "grid", gap: 10 }}>
          <div className="mb-day-head">
            <input
              className="pg-input"
              aria-label={`Day ${di + 1} name`}
              maxLength={MEMBER_LIMITS.name}
              value={day.name}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => void (x.template.weeks[w].days[di].name = v));
              }}
            />
            <button type="button" className="mb-icon" aria-label={`Move ${day.name} up`} disabled={di === 0} onClick={() => edit((x) => void moveDay(x.template, w, di, -1))}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="mb-icon" aria-label={`Move ${day.name} down`} disabled={di === week.days.length - 1} onClick={() => edit((x) => void moveDay(x.template, w, di, 1))}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="mb-icon" aria-label={`Remove ${day.name}`} disabled={week.days.length === 1} onClick={() => edit((x) => removeDay(x.template, w, di))}>
              <Trash2 size={16} />
            </button>
          </div>
          {day.exercises.length === 0 && <div className="mb-hint">No exercises yet.</div>}
          {day.exercises.map((ex, xi) => {
            const key = `${w}-${di}-${xi}`;
            return (
              <ExerciseCard
                key={key}
                ex={ex}
                index={xi}
                count={day.exercises.length}
                open={open === key}
                unit={unit}
                running={running}
                nowKg={current[stateKey(ex)] ?? null}
                onToggle={() => setOpen(open === key ? null : key)}
                onChange={(fn) => edit((x) => fn(x.template.weeks[w].days[di].exercises[xi]))}
                onRule={(k) =>
                  edit((x) => {
                    const list = x.template.weeks[w].days[di].exercises;
                    list[xi] = applyRule(list[xi], k);
                  })
                }
                onRename={() => setPicking({ w, di, xi })}
                onMove={(dir) => {
                  edit((x) => void moveExercise(x.template, w, di, xi, dir));
                  setOpen(`${w}-${di}-${xi + dir}`);
                }}
                onRemove={() => {
                  edit((x) => removeExercise(x.template, w, di, xi));
                  setOpen(null);
                }}
              />
            );
          })}
          {day.exercises.length < MEMBER_LIMITS.exercises && (
            <Button variant="secondary" onClick={() => setPicking({ w, di, xi: null })} style={{ minHeight: 44 }}>
              <Plus size={16} /> Add exercise
            </Button>
          )}
        </Card>
      ))}

      {week.days.length < MEMBER_LIMITS.days && (
        <Button variant="secondary" onClick={() => edit((x) => addDay(x.template, w))} style={{ minHeight: 44 }}>
          <Plus size={16} /> Add a day
        </Button>
      )}

      <div className="mb-save">
        <Button onClick={save} loading={pending} style={{ width: "100%", minHeight: 46 }}>
          Save program
        </Button>
      </div>

      {picking && <ExercisePicker onClose={() => setPicking(null)} onPick={(hit) => pick(hit.name)} />}
    </div>
  );
}
```

- [ ] **Step 5: Create `app/src/app/app/programs/built/new/page.tsx`**

Create `app/src/app/app/programs/built/new/page.tsx` with exactly this content:

```tsx
// app/src/app/app/programs/built/new/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { parseStartFrom, startingDraft } from "@/lib/programs/memberPrograms";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

function Choice({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href}>
      <Card style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>{sub}</div>
        </div>
        <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      </Card>
    </Link>
  );
}

/** Pick a starting point, then build. Nothing is saved until the member presses Save. */
export default async function NewBuiltProgramPage(props: { searchParams: Promise<{ from?: string | string[] }> }) {
  const sp = await props.searchParams;
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const { clientId, client } = requireProgramsPage();
  const unit = client.weightUnit === "lb" ? "lb" : "kg";

  if (from) {
    const parsed = parseStartFrom(from);
    const draft = parsed ? startingDraft(clientId, parsed) : null;
    if (!draft) notFound();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub="Nothing is kept until you save">Build your own</PageTitle>
        <MemberProgramBuilder id={null} from={from} initial={draft.template} initialUnit={unit} running={false} current={{}} />
      </div>
    );
  }

  const live = liveEnrolment(clientId);
  const library = memberPrograms();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Start blank or from a program you know">Build your own</PageTitle>
      <Choice href="/app/programs/built/new?from=blank" title="Start blank" sub="One week, one day. Add your own exercises." />
      {live && <Choice href="/app/programs/built/new?from=current" title="Start from my current program" sub={`${live.template.name}, with your weights and maxes.`} />}
      <SectionTitle>Or copy a library program</SectionTitle>
      {library.map((e) => (
        <Choice key={e.template.key} href={`/app/programs/built/new?from=${encodeURIComponent(e.template.key)}`} title={e.template.name} sub={byline(toCard(e.template, e.basedOnName))} />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create `app/src/app/app/programs/built/[id]/page.tsx`**

Create `app/src/app/app/programs/built/[id]/page.tsx` with exactly this content:

```tsx
// app/src/app/app/programs/built/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey } from "@/lib/programs/memberTemplate";
import { PageTitle } from "@/components/clientapp/ui";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

export default async function EditBuiltProgramPage(props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const p = getMemberProgram(clientId, id);
  if (!p) notFound();
  const live = liveEnrolment(clientId);
  const running = !!live && live.programKey === memberKey(id);
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={running ? "You're running this program" : "Your own program"}>{p.name}</PageTitle>
      {!live && (
        <Link href={`/app/programs/built/${id}/start`} className="pg-cta">
          Start this program
        </Link>
      )}
      <MemberProgramBuilder id={id} from={null} initial={p.template} initialUnit={unit} running={running} current={running && live ? live.state.weights : {}} />
    </div>
  );
}
```

- [ ] **Step 7: Change `app/src/app/globals.css`**

In `app/src/app/globals.css`, make this replacement. Each "replace" text appears exactly once in the file.

Replace:

```css
.pg-cta { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 18px; border-radius: var(--radius); background: var(--accent); color: var(--accent-contrast); font-size: 15px; font-weight: 600; text-decoration: none; }

/* Staff: a member's DIY program on the client page (Workout log tab). */
.dp { display: grid; gap: 14px; margin-bottom: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--hairline); }
```

with:

```css
.pg-cta { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 18px; border-radius: var(--radius); background: var(--accent); color: var(--accent-contrast); font-size: 15px; font-weight: 600; text-decoration: none; }

/* Member app: the program builder and the member's own programs. Tenant brand tokens; 44px targets; fits a 320px phone. */
.mb { display: grid; gap: 14px; }
.mb-field { display: grid; gap: 6px; min-width: 0; }
.mb-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
.mb-hint { font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); }
.mb-errors { padding: 12px 14px; border: 1px solid var(--danger); border-radius: var(--radius); background: var(--surface-1); color: var(--text-primary); font-size: 13.5px; line-height: 1.45; }
.mb-errors ul { margin: 6px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.mb-weeks { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; -webkit-overflow-scrolling: touch; }
.mb-tab { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.mb-tab[aria-selected="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.mb-tools { display: flex; gap: 6px; align-items: center; }
.mb-tools .pg-input { flex: 1; min-width: 0; }
.mb-icon { flex-shrink: 0; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--text-secondary); cursor: pointer; }
.mb-icon:disabled { opacity: 0.4; cursor: default; }
.mb-icon:focus-visible, .mb-tab:focus-visible, .mb-plus:focus-visible, .mb-link:focus-visible, .mb-ex-head:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.mb-day-head { display: flex; gap: 6px; align-items: center; }
.mb-day-head .pg-input { flex: 1; min-width: 0; font-weight: 600; }
.mb-ex { border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-2); }
.mb-ex[data-joined="true"] { border-left: 3px solid var(--accent); }
.mb-ex-head { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 0; background: transparent; color: var(--text-secondary); font: inherit; text-align: left; cursor: pointer; }
.mb-ex-title { flex: 1; min-width: 0; display: grid; gap: 2px; }
.mb-ex-name { font-size: 14.5px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.mb-ex-sub { font-size: 12.5px; color: var(--text-tertiary); overflow-wrap: anywhere; }
.mb-ex-body { display: grid; gap: 12px; padding: 4px 12px 12px; }
.mb-sets { display: grid; gap: 6px; }
.mb-set { display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) 44px 44px; gap: 6px; align-items: center; }
.mb-set--head { font-size: 11.5px; color: var(--text-tertiary); }
.mb-setno { font-size: 13px; color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
.mb-num { padding: 0 6px; text-align: center; font-variant-numeric: tabular-nums; }
.mb-plus { width: 44px; height: 44px; border-radius: 10px; border: 1px solid var(--hairline); background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 18px; font-weight: 600; cursor: pointer; }
.mb-plus[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
.mb-link { justify-self: start; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 4px; border: 0; background: transparent; color: var(--accent-ink); font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; text-decoration: none; }
.mb-notes { height: auto; min-height: 64px; padding: 10px 12px; resize: vertical; }
/* Above the member app's bottom tabs. */
.mb-save { position: sticky; bottom: 72px; z-index: 5; }
.mb-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mb-row > .mb-grow { flex: 1; min-width: 0; }
.mb-chip-link { display: inline-flex; align-items: center; text-decoration: none; }

/* Staff: a member's DIY program on the client page (Workout log tab). */
.dp { display: grid; gap: 14px; margin-bottom: 22px; padding-bottom: 22px; border-bottom: 1px solid var(--hairline); }
```


- [ ] **Step 8: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/app/app/programs/gating.test.ts
cd app && npx tsc --noEmit -p .
cd app && npx eslint src/components/clientapp/MemberProgramBuilder.tsx src/app/app/programs/built
cd app && rm -rf .next && npx next build
```

Expected: each test file passes (`gating.test.ts` prints `app/programs gating: ok`; the others print their own `ok` line); `tsc` prints nothing; `eslint` prints nothing; the build succeeds and its route list includes `/app/programs/built/new` and `/app/programs/built/[id]`.

- [ ] **Step 9: Commit**

```bash
git add app/src/app/app/programs/gating.test.ts app/src/app/app/programs/built/actions.ts app/src/components/clientapp/MemberProgramBuilder.tsx app/src/app/app/programs/built/new/page.tsx 'app/src/app/app/programs/built/[id]/page.tsx' app/src/app/globals.css
git commit -m "feat(programs): the member's phone program builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Programs tab: Build your own, My programs, start, edit link and the member's own max

The Programs tab gets Build your own and the member's list at the top. Start reuses the library start form (a max only for percent lifts, prefilled from a copied current program). My program links to the builder and takes a new max for a member program.

**Files:**
- Test (modify): `app/src/app/app/programs/gating.test.ts`
- Modify: `app/src/app/app/programs/actions.ts`
- Modify: `app/src/components/clientapp/StartProgramForm.tsx`
- Create: `app/src/app/app/programs/built/[id]/start/page.tsx`
- Create: `app/src/components/clientapp/BuiltProgramList.tsx`
- Create: `app/src/components/clientapp/OwnMaxForm.tsx`
- Replace: `app/src/app/app/programs/page.tsx`
- Modify: `app/src/app/app/programs/mine/page.tsx`

**Interfaces:**
- Consumes: Task 6 (`listMemberPrograms`, `getMemberProgram`, `enrolMemberProgram`, `memberSetMax`), Task 8 (`deleteBuiltProgramAction`, `.mb-row`, `.mb-chip-link`, `.mb-link`, `.mb-hint`), Task 3 (`memberKey`, `parseMemberKey`, `memberLine`).
- Produces:
  - `startProgramAction` accepts `key: "member:<id>"` and starts it through `enrolMemberProgram` (the store checks the program is the member's).
  - `setOwnMaxAction(raw: { max: MaxEntry }): Promise<{ ok: true } | { ok: false; error: string }>` in `app/src/app/app/programs/actions.ts`.
  - `StartProgramForm`'s lift rows take `keptKg?: number | null` (filled in as the 1-rep max, with "Filled in from your last program.").
  - `BuiltProgramList({ programs: BuiltProgramItem[]; anyLive: boolean })`, `interface BuiltProgramItem { id: number; name: string; line: string; running: boolean }`; `OwnMaxForm({ unit: WeightUnit; lifts: LiftKey[] })`.
  - Route `/app/programs/built/[id]/start`.

- [ ] **Step 1: Add the failing check to `gating.test.ts`**

In `app/src/app/app/programs/gating.test.ts`, make this replacement. Each "replace" text appears exactly once in the file.

Replace:

```ts
const actions = files.filter((f) => f.endsWith("actions.ts"));
const rel = (f: string) => path.relative(root, f);
for (const want of ["page.tsx", "[key]/page.tsx", "[key]/start/page.tsx", "mine/page.tsx", "built/new/page.tsx", "built/[id]/page.tsx"]) {
  assert.ok(pages.some((f) => rel(f) === want), `has ${want}`);
}
```

with:

```ts
const actions = files.filter((f) => f.endsWith("actions.ts"));
const rel = (f: string) => path.relative(root, f);
for (const want of ["page.tsx", "[key]/page.tsx", "[key]/start/page.tsx", "mine/page.tsx", "built/new/page.tsx", "built/[id]/page.tsx", "built/[id]/start/page.tsx"]) {
  assert.ok(pages.some((f) => rel(f) === want), `has ${want}`);
}
```


- [ ] **Step 2: Run the test to see it fail**

Run: `cd app && npm test -- src/app/app/programs/gating.test.ts`
Expected: FAIL with an `AssertionError`: `has built/[id]/start/page.tsx`.

- [ ] **Step 3: Change `app/src/app/app/programs/actions.ts`**

In `app/src/app/app/programs/actions.ts`, make these 3 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import { bestLoggedSet, endEnrolment, enrol, liveEnrolment, restartFromTest, setEnrolmentDays, skipEnrolmentSession, startEnrolmentSession } from "@/lib/programs/enrolments";
import type { StartResult } from "@/lib/workoutLog";
import { programByKey } from "@/lib/programs/library";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";
import { maxFromSet, stepFromKey, unitToKg } from "@/lib/programs/units";
```

with:

```ts
import { requireClient } from "@/lib/clientAuth";
import { memberSeesPrograms } from "@/lib/programs/access";
import {
  bestLoggedSet,
  endEnrolment,
  enrol,
  liveEnrolment,
  memberSetMax,
  restartFromTest,
  setEnrolmentDays,
  skipEnrolmentSession,
  startEnrolmentSession,
} from "@/lib/programs/enrolments";
import type { StartResult } from "@/lib/workoutLog";
import { programByKey } from "@/lib/programs/library";
import { enrolMemberProgram } from "@/lib/programs/memberPrograms";
import { parseMemberKey } from "@/lib/programs/memberTemplate";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";
import { maxFromSet, stepFromKey, unitToKg } from "@/lib/programs/units";
```

2. Replace:

```ts
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false, error: "Pick a smallest jump in the same unit." };
  if (!programByKey(v.key)) return { ok: false, error: "That program isn't available." };
  const maxes = resolveMaxes(c.clientId, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const r = enrol(c.clientId, { key: v.key, maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays });
  if (!r.ok) return r;
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
```

with:

```ts
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false, error: "Pick a smallest jump in the same unit." };
  // "member:<id>" is one of the member's own programs; the store checks it is theirs.
  const ownId = parseMemberKey(v.key);
  if (ownId === null && !programByKey(v.key)) return { ok: false, error: "That program isn't available." };
  const maxes = resolveMaxes(c.clientId, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const input = { maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays };
  const r = ownId !== null ? enrolMemberProgram(c.clientId, ownId, input) : enrol(c.clientId, { key: v.key, ...input });
  if (!r.ok) return r;
  for (const path of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(path);
```

3. Replace:

```ts
  const r = restartFromTest(c.clientId, maxes.kg);
  refresh();
  return r;
}
```

with:

```ts
  const r = restartFromTest(c.clientId, maxes.kg);
  refresh();
  return r;
}

/** A max on the member's own running program (in their unit). */
export async function setOwnMaxAction(raw: unknown): Promise<Result> {
  const c = member();
  if (!c) return OFF;
  const p = z.object({ max: maxEntryZ }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Check your entry and try again." };
  const view = liveEnrolment(c.clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  const maxes = resolveMaxes(c.clientId, view.unit, [p.data.max]);
  if (!maxes.ok) return maxes;
  const kg = maxes.kg[p.data.max.lift];
  if (kg === undefined) return { ok: false, error: "Check your entry and try again." };
  const r = memberSetMax(c.clientId, p.data.max.lift, kg);
  refresh();
  return r;
}
```


- [ ] **Step 4: Change `app/src/components/clientapp/StartProgramForm.tsx`**

In `app/src/components/clientapp/StartProgramForm.tsx`, make these 4 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```tsx
import { startProgramAction, type MaxEntry } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, maxFromSet, parseWeightIn, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";
```

with:

```tsx
import { startProgramAction, type MaxEntry } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, kgToUnit, maxFromSet, parseWeightIn, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";
```

2. Replace:

```tsx
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
}
interface RowState {
```

with:

```tsx
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
  /** A max carried from the member's last program, filled in as their 1-rep max. */
  keptKg?: number | null;
}
interface RowState {
```

3. Replace:

```tsx
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [step, setStep] = useState<StepKey>(initialUnit === "lb" ? "5lb" : initialStep === "5lb" ? "2.5kg" : initialStep);
  const [rows, setRows] = useState<RowState[]>(lifts.map((l) => ({ mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })));
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState<number[]>(defaultWeekdays);
```

with:

```tsx
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [step, setStep] = useState<StepKey>(initialUnit === "lb" ? "5lb" : initialStep === "5lb" ? "2.5kg" : initialStep);
  const [rows, setRows] = useState<RowState[]>(
    lifts.map((l) => (l.keptKg ? { mode: "one_rm", weight: String(kgToUnit(l.keptKg, initialUnit)), reps: "" } : { mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })),
  );
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState<number[]>(defaultWeekdays);
```

4. Replace:

```tsx
          <Card key={l.lift} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</div>
            <div className="pg-chips" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
              {l.logged && (
```

with:

```tsx
          <Card key={l.lift} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</div>
            {l.keptKg ? <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Filled in from your last program.</div> : null}
            <div className="pg-chips" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
              {l.logged && (
```


- [ ] **Step 5: Create `app/src/app/app/programs/built/[id]/start/page.tsx`**

Create `app/src/app/app/programs/built/[id]/start/page.tsx` with exactly this content:

```tsx
// app/src/app/app/programs/built/[id]/start/page.tsx
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey } from "@/lib/programs/memberTemplate";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { PageTitle } from "@/components/clientapp/ui";
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";

export const dynamic = "force-dynamic";

/** Start one of the member's own programs: a max only for the lifts its percent exercises use. */
export default async function StartBuiltProgramPage(props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const p = getMemberProgram(clientId, id);
  if (!p) notFound();
  if (liveEnrolment(clientId)) redirect("/app/programs/mine");
  const t = p.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null, keptKg: p.maxes[lift] ?? null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={t.name}>Start program</PageTitle>
      <StartProgramForm
        programKey={memberKey(id)}
        tmPct={1}
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

- [ ] **Step 6: Create `app/src/components/clientapp/BuiltProgramList.tsx`**

Create `app/src/components/clientapp/BuiltProgramList.tsx` with exactly this content:

```tsx
// app/src/components/clientapp/BuiltProgramList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, SectionTitle } from "@/components/clientapp/ui";
import { deleteBuiltProgramAction } from "@/app/app/programs/built/actions";

export interface BuiltProgramItem {
  id: number;
  name: string;
  line: string;
  running: boolean;
}

/** "Build your own", then the member's own programs with Edit, Start and Delete. */
export function BuiltProgramList({ programs, anyLive }: { programs: BuiltProgramItem[]; anyLive: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();

  async function remove(p: BuiltProgramItem) {
    if (busy !== null) return;
    setBusy(p.id);
    try {
      const ok = await confirm({ title: `Delete ${p.name}?`, body: "The program goes. Workouts you logged with it are kept.", confirmLabel: "Delete", destructive: true });
      if (!ok) return;
      const r = await deleteBuiltProgramAction(p.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Program deleted");
      start(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Link href="/app/programs/built/new" className="pg-cta">
        <Plus size={18} aria-hidden /> Build your own
      </Link>
      {programs.length > 0 && <SectionTitle>My programs</SectionTitle>}
      {programs.map((p) => (
        <Card key={p.id} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{p.name}</span>
            {p.running && <span className="pg-tag">Running</span>}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{p.line}</div>
          <div className="mb-row">
            <Link href={`/app/programs/built/${p.id}`} className="pg-chip mb-chip-link">
              Edit
            </Link>
            {!anyLive && (
              <Link href={`/app/programs/built/${p.id}/start`} className="pg-chip mb-chip-link">
                Start
              </Link>
            )}
            {!p.running && (
              <button type="button" className="pg-chip" disabled={busy !== null} onClick={() => void remove(p)}>
                Delete
              </button>
            )}
          </div>
        </Card>
      ))}
      {programs.length > 0 && anyLive && <div className="mb-hint">End your current program on My program to start another.</div>}
    </div>
  );
}
```

- [ ] **Step 7: Create `app/src/components/clientapp/OwnMaxForm.tsx`**

Create `app/src/components/clientapp/OwnMaxForm.tsx` with exactly this content:

```tsx
// app/src/components/clientapp/OwnMaxForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { setOwnMaxAction } from "@/app/app/programs/actions";
import { LIFT_LABEL, type LiftKey, type WeightUnit } from "@/lib/programs/types";

/** Set a max on the member's own program: its percentages use it from the next session. */
export function OwnMaxForm({ unit, lifts }: { unit: WeightUnit; lifts: LiftKey[] }) {
  const router = useRouter();
  const [lift, setLift] = useState<LiftKey>(lifts[0]);
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  if (lifts.length === 0) return null;

  function save() {
    start(async () => {
      const weight = Number(value.replace(",", ".")) || null;
      const r = await setOwnMaxAction({ max: { lift, kind: "one_rm", weight, reps: null } });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Max saved. Your percentages use it from your next session.");
      setValue("");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="td-label">Change a max</div>
      <div className="pg-row">
        {lifts.length > 1 ? (
          <select className="pg-input" aria-label="Lift" value={lift} onChange={(e) => setLift(e.target.value as LiftKey)}>
            {lifts.map((l) => (
              <option key={l} value={l}>
                {LIFT_LABEL[l]}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ alignSelf: "center", fontSize: 13.5, color: "var(--text-secondary)" }}>{LIFT_LABEL[lift]}</span>
        )}
        <input className="pg-input" inputMode="decimal" aria-label={`New ${LIFT_LABEL[lift].toLowerCase()} max in ${unit}`} placeholder={`Max in ${unit}`} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button variant="secondary" onClick={save} loading={pending} disabled={!value.trim()} style={{ minHeight: 44 }}>
        Save max
      </Button>
    </div>
  );
}
```

- [ ] **Step 8: Replace `app/src/app/app/programs/page.tsx`**

Replace the whole of `app/src/app/app/programs/page.tsx` with:

```tsx
// app/src/app/app/programs/page.tsx
import { requireProgramsPage } from "@/lib/programs/access";
import { toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { listMemberPrograms } from "@/lib/programs/memberPrograms";
import { memberKey, memberLine } from "@/lib/programs/memberTemplate";
import { PageTitle } from "@/components/clientapp/ui";
import { BuiltProgramList } from "@/components/clientapp/BuiltProgramList";
import { ProgramBrowser } from "@/components/clientapp/ProgramBrowser";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const { clientId } = requireProgramsPage();
  const cards = memberPrograms().map((e) => toCard(e.template, e.basedOnName));
  const live = liveEnrolment(clientId);
  const built = listMemberPrograms(clientId).map((p) => ({ id: p.id, name: p.name, line: memberLine(p.template), running: live?.programKey === memberKey(p.id) }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Well-known programs, with your weights worked out">Programs</PageTitle>
      <BuiltProgramList programs={built} anyLive={!!live} />
      <ProgramBrowser cards={cards} current={live ? { name: live.template.name, paused: live.status === "paused" } : null} />
    </div>
  );
}
```

- [ ] **Step 9: Change `app/src/app/app/programs/mine/page.tsx`**

In `app/src/app/app/programs/mine/page.tsx`, make these 5 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```tsx
// app/src/app/app/programs/mine/page.tsx
import { redirect } from "next/navigation";
import { AlertTriangle, Pause } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { summarisePlanned, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
```

with:

```tsx
// app/src/app/app/programs/mine/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Pause, Pencil } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { parseMemberKey } from "@/lib/programs/memberTemplate";
import { summarisePlanned, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
```

2. Replace:

```tsx
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";

export const dynamic = "force-dynamic";
```

with:

```tsx
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";
import { OwnMaxForm } from "@/components/clientapp/OwnMaxForm";

export const dynamic = "force-dynamic";
```

3. Replace:

```tsx
  const today = dateKey(Date.now());
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  const startsLater = view.startDate > today ? `. Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";
```

with:

```tsx
  const today = dateKey(Date.now());
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  // One of the member's own programs: they can edit it and set its maxes.
  const ownId = view.programKey ? parseMemberKey(view.programKey) : null;
  const startsLater = view.startDate > today ? `. Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";
```

4. Replace:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`${weekLabel(t, view.state)}${startsLater}`}>{t.name}</PageTitle>

      {view.status === "paused" && (
```

with:

```tsx
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`${weekLabel(t, view.state)}${startsLater}`}>{t.name}</PageTitle>

      {ownId !== null && (
        <Link href={`/app/programs/built/${ownId}`} className="mb-link">
          <Pencil size={16} aria-hidden /> Edit program
        </Link>
      )}

      {view.status === "paused" && (
```

5. Replace:

```tsx
            </div>
          ))}
        </Card>
      )}
```

with:

```tsx
            </div>
          ))}
          {ownId !== null && <OwnMaxForm unit={view.unit} lifts={t.lifts} />}
        </Card>
      )}
```


- [ ] **Step 10: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/app/app/programs/gating.test.ts
cd app && npx tsc --noEmit -p .
cd app && npx eslint src/components/clientapp/BuiltProgramList.tsx src/components/clientapp/OwnMaxForm.tsx src/components/clientapp/StartProgramForm.tsx src/app/app/programs
cd app && rm -rf .next && npx next build
```

Expected: each test file passes (`gating.test.ts` prints `app/programs gating: ok`; the others print their own `ok` line); `tsc` prints nothing; `eslint` prints nothing; the build succeeds and its route list includes `/app/programs/built/[id]/start`.

- [ ] **Step 11: Commit**

```bash
git add app/src/app/app/programs/gating.test.ts app/src/app/app/programs/actions.ts app/src/components/clientapp/StartProgramForm.tsx 'app/src/app/app/programs/built/[id]/start/page.tsx' app/src/components/clientapp/BuiltProgramList.tsx app/src/components/clientapp/OwnMaxForm.tsx app/src/app/app/programs/page.tsx app/src/app/app/programs/mine/page.tsx
git commit -m "feat(programs): Build your own on the Programs tab, start, edit link and own maxes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Staff panel: a member-built program, read-only

Staff see "Built by the member" and the whole program (week, day, exercise and rule) beside the progress, maxes and change log already there. Coach max corrections and week moves work as now; there is no coach editing. A coach max on a member program must never reset its rule weights, which `initState` would do.

**Files:**
- Test (create): `app/src/lib/programs/memberPanel.test.ts`
- Modify: `app/src/lib/programs/panel.ts`
- Modify: `app/src/lib/programs/staffView.ts`
- Modify: `app/src/components/clients/ClientProgramPanel.tsx`
- Modify: `app/src/lib/programs/enrolments.ts`
- Test (modify): `app/src/lib/programs/memberPrograms.test.ts`

**Interfaces:**
- Consumes: Task 3 (`MEMBER_AUTHOR`, `parseMemberKey`), Task 1 (`RULE_LABEL`), Task 6 (store and its DB test).
- Produces:
  - `panel.ts`: `describeRule(ex: ExerciseRx, unit: WeightUnit): string` ("Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row."); `PanelInput.enrolment.memberBuilt?: boolean`; `ProgramPanelData.live.program: { title: string; days: { name: string; lines: string[] }[] }[] | null`; the byline is "Built by the member".
  - `staffView.ts` sets `memberBuilt` from the enrolment's "member:<id>" key. `ClientProgramPanel` shows a "Their program" card.
  - `coachSetMax` leaves an own-rules program's working weights alone (only percentages follow a max).

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/memberPanel.test.ts` with exactly this content:

```ts
// Run: npm test -- src/lib/programs/memberPanel.test.ts
//
// The client page shows a member-built program read-only: "Built by the
// member", and every week, day and exercise with its rule in plain words.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { blankMemberTemplate } from "./memberTemplate";
import { describeRule, panelFrom } from "./panel";
import { planSession } from "./planner";
import type { ExerciseRx, ProgramTemplate } from "./types";

const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }, { kind: "amrap", pct: 0.85, reps: 3, rest: 180 }], rule: { kind: "percent" } };
const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const row: ExerciseRx = { name: "Cable row", joined: true, sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range" } };
const press: ExerciseRx = { name: "Incline dumbbell press", sets: [{ kind: "rpe", rpe: 8, reps: 8, rest: 120 }], rule: { kind: "rpe" } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual" } };

// ── each rule in a line ──
assert.equal(describeRule(bench, "kg"), "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row.");
assert.equal(describeRule({ ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 1 } }, "kg"), "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after a miss.");
assert.equal(describeRule(row, "kg"), "Rep range. 1 x 8-12. Adds the smallest jump when every set reaches the top.");
assert.equal(describeRule({ ...row, rule: { kind: "range", incKg: 5 } }, "lb"), "Rep range. 1 x 8-12. Adds 11 lb when every set reaches the top.");
assert.equal(describeRule(squat, "kg"), "Percent of max. 1 x 3 at 80%, then 1 x 3+ at 85% of the squat max.");
assert.equal(describeRule(press, "kg"), "RPE. 1 x 8 at RPE 8. Weight from the best logged set.");
assert.equal(describeRule(curl, "kg"), "Manual. 1 x 10. The member picks the weight.");

// ── the panel ──
const t: ProgramTemplate = {
  ...blankMemberTemplate(),
  key: "member:4",
  name: "Strength block",
  lifts: ["squat"],
  weeks: [
    { days: [{ name: "Upper", exercises: [bench, row] }, { name: "Lower", exercises: [squat, press, curl] }] },
    { label: "Deload", days: [{ name: "Test", exercises: [squat], test: true }] },
  ],
};
const state = initState(t, { squat: 150 }, 2.5);
const data = panelFrom({ enrolment: { id: 1, status: "active", template: t, state, unit: "kg", basedOnName: null, memberBuilt: true }, plan: planSession(t, state, { stepKg: 2.5 }), events: [], past: [] });
const live = data.live!;
assert.equal(live.byline, "Built by the member");
assert.deepEqual(
  live.program!.map((w) => w.title),
  ["Week 1", "Week 2: Deload"],
);
assert.deepEqual(live.program![0].days[0], {
  name: "Upper",
  lines: [
    "Bench press: Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row.",
    "Cable row, superset with the one above: Rep range. 1 x 8-12. Adds the smallest jump when every set reaches the top.",
  ],
});
assert.equal(live.program![1].days[0].name, "Test (test day)");
assert.equal(live.weeks.length, 2, "the coach can still move the member to a week");
assert.equal(live.lifts[0].max, "150 kg");

// ── a library program has no read-only program block ──
const lib = panelFrom({ enrolment: { id: 2, status: "active", template: t, state, unit: "kg", basedOnName: null }, plan: null, events: [], past: [] });
assert.equal(lib.live!.program, null);
assert.equal(lib.live!.byline, "Built by the member", "the author line of a member template");

console.log("programs/memberPanel: ok");
```

- [ ] **Step 2: Add the failing check to `memberPrograms.test.ts`**

In `app/src/lib/programs/memberPrograms.test.ts`, make these 3 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
// running (one transaction, kept/new/removed weights, the change log), an
// open session finishing on the old version, the current week removed, the
// three starting points, last session's weight, a member's own max, and
// delete refused while running. Each case runs on its own member.
import assert from "node:assert/strict";
import Module from "node:module";
```

with:

```ts
// running (one transaction, kept/new/removed weights, the change log), an
// open session finishing on the old version, the current week removed, the
// three starting points, last session's weight, a member's own max, the
// staff view and a coach max, and delete refused while running. Each case
// runs on its own member.
import assert from "node:assert/strict";
import Module from "node:module";
```

2. Replace:

```ts
  const mp = requireLocal("./memberPrograms") as typeof import("./memberPrograms");
  const { blankMemberTemplate } = requireLocal("./memberTemplate") as typeof import("./memberTemplate");

  const slug = "programs-member-built-test";
```

with:

```ts
  const mp = requireLocal("./memberPrograms") as typeof import("./memberPrograms");
  const { blankMemberTemplate } = requireLocal("./memberTemplate") as typeof import("./memberTemplate");
  const { programPanelData } = requireLocal("./staffView") as typeof import("./staffView");

  const slug = "programs-member-built-test";
```

3. Replace:

```ts
  });

  test("delete is refused while the program runs", () => {
    const clientId = newMember();
```

with:

```ts
  });

  test("staff see it read-only, and a coach max keeps the working weights", () => {
    const clientId = newMember();
    const id = create(clientId);
    const eid = startIt(clientId, id);
    en.finishEnrolmentSession(clientId, logNext(clientId, 14));
    const panel = programPanelData(clientId)!.live!;
    assert.equal(panel.byline, "Built by the member");
    assert.equal(panel.program![0].days[0].name, "Upper");
    assert.equal(panel.program![0].days[1].lines[0], "Back squat: Percent of max. 1 x 3 at 80%, then 1 x 3+ at 85% of the squat max.");
    assert.deepEqual(en.coachSetMax(clientId, eid, "squat", 160, staff), { ok: true });
    const v = en.liveEnrolment(clientId)!;
    assert.equal(v.state.tms.squat, 160);
    assert.deepEqual(v.state.weights, { "linear:bench press": 62.5, "range:cable row@8-12": 50, "manual:hammer curl": 14 }, "the max never resets rule weights");
  });

  test("delete is refused while the program runs", () => {
    const clientId = newMember();
```


- [ ] **Step 3: Run the test to see it fail**

Run: `cd app && npm test -- src/lib/programs/memberPanel.test.ts`
Expected: FAIL with `TypeError: describeRule is not a function` (or `(0 , import_panel.describeRule) is not a function`).

- [ ] **Step 4: Change `app/src/lib/programs/panel.ts`**

In `app/src/lib/programs/panel.ts`, make these 4 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { dayTitle, summarisePlanned, weekInRound, weekLabel } from "./planner";
import { LIFT_LABEL, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: { id: number; status: "active" | "paused" | "ended"; template: ProgramTemplate; state: EngineState; unit: WeightUnit; basedOnName: string | null } | null;
  plan: PlannedSession | null;
  events: { id: number; at: number; actor: string; actorName: string | null; kind: string; reason: string }[];
```

with:

```ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { MEMBER_AUTHOR } from "./memberTemplate";
import { dayTitle, summarisePlanned, summariseRx, weekInRound, weekLabel } from "./planner";
import { LIFT_LABEL, RULE_LABEL, type EngineState, type ExerciseRx, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: {
    id: number;
    status: "active" | "paused" | "ended";
    template: ProgramTemplate;
    state: EngineState;
    unit: WeightUnit;
    basedOnName: string | null;
    /** A program the member built for themselves: staff see it read-only. */
    memberBuilt?: boolean;
  } | null;
  plan: PlannedSession | null;
  events: { id: number; at: number; actor: string; actorName: string | null; kind: string; reason: string }[];
```

2. Replace:

```ts
    /** Skips among those events only. */
    skipped: { when: string; text: string }[];
  };
  past: { name: string; ended: string }[];
}
```

with:

```ts
    /** Skips among those events only. */
    skipped: { when: string; text: string }[];
    /** A member-built program, read-only: each week, day and exercise with its rule. Null for a library program. */
    program: { title: string; days: { name: string; lines: string[] }[] }[] | null;
  };
  past: { name: string; ended: string }[];
}

/** A member-built exercise's rule in a line: "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row." */
export function describeRule(ex: ExerciseRx, unit: WeightUnit): string {
  const sets = summariseRx(ex.sets);
  const r = ex.rule;
  const fmt = (kg: number) => formatWeight(kg, unit);
  if (!r) return sets;
  switch (r.kind) {
    case "linear":
      return `${RULE_LABEL.linear}. ${sets}. Adds ${fmt(r.incKg)} after a full session, 10% lighter after ${r.deloadAfter === 1 ? "a miss" : `${r.deloadAfter} misses in a row`}.`;
    case "range":
      return `${RULE_LABEL.range}. ${sets}. Adds ${r.incKg ? fmt(r.incKg) : "the smallest jump"} when every set reaches the top.`;
    case "percent":
      return `${RULE_LABEL.percent}. ${sets} of the ${ex.lift ? LIFT_LABEL[ex.lift].toLowerCase() : "lift"} max.`;
    case "rpe":
      return `${RULE_LABEL.rpe}. ${sets}. Weight from the best logged set.`;
    case "manual":
      return `${RULE_LABEL.manual}. ${sets}. The member picks the weight.`;
    default: {
      const never: never = r;
      return never;
    }
  }
}

function programLines(t: ProgramTemplate, unit: WeightUnit): NonNullable<ProgramPanelData["live"]>["program"] {
  return t.weeks.map((w, i) => ({
    title: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}`,
    days: w.days.map((d) => ({ name: d.test ? `${d.name} (test day)` : d.name, lines: d.exercises.map((ex) => `${ex.name}${ex.joined ? ", superset with the one above" : ""}: ${describeRule(ex, unit)}`) })),
  }));
}
```

3. Replace:

```ts
      enrolmentId: e.id,
      name: t.name,
      byline: e.basedOnName ? `Our version, based on ${e.basedOnName}` : t.author,
      status: e.status,
      finished: e.state.finished,
```

with:

```ts
      enrolmentId: e.id,
      name: t.name,
      byline: e.memberBuilt ? MEMBER_AUTHOR : e.basedOnName ? `Our version, based on ${e.basedOnName}` : t.author,
      status: e.status,
      finished: e.state.finished,
```

4. Replace:

```ts
      eventsCapped: input.events.length >= PANEL_EVENT_LIMIT,
      skipped: input.events.filter((ev) => ev.kind === "skip").map((ev) => ({ when: dayText(ev.at), text: ev.reason })),
    },
    past,
```

with:

```ts
      eventsCapped: input.events.length >= PANEL_EVENT_LIMIT,
      skipped: input.events.filter((ev) => ev.kind === "skip").map((ev) => ({ when: dayText(ev.at), text: ev.reason })),
      program: e.memberBuilt ? programLines(t, e.unit) : null,
    },
    past,
```


- [ ] **Step 5: Change `app/src/lib/programs/staffView.ts`**

In `app/src/lib/programs/staffView.ts`, make these 2 replacements, in order. Each "replace" text appears exactly once in the file.

1. Replace:

```ts
import { enrolmentEvents, listEnrolments, liveEnrolment, planFor } from "./enrolments";
import { getCopy } from "./library";
import { PANEL_EVENT_LIMIT, panelFrom, type ProgramPanelData } from "./panel";
```

with:

```ts
import { enrolmentEvents, listEnrolments, liveEnrolment, planFor } from "./enrolments";
import { getCopy } from "./library";
import { parseMemberKey } from "./memberTemplate";
import { PANEL_EVENT_LIMIT, panelFrom, type ProgramPanelData } from "./panel";
```

2. Replace:

```ts
  return panelFrom({
    enrolment: live
      ? { id: live.id, status: live.status, template: live.template, state: live.state, unit: live.unit, basedOnName: live.copyId ? (getCopy(live.copyId)?.basedOnName ?? null) : null }
      : null,
    plan: live && live.status === "active" ? planFor(live) : null,
```

with:

```ts
  return panelFrom({
    enrolment: live
      ? {
          id: live.id,
          status: live.status,
          template: live.template,
          state: live.state,
          unit: live.unit,
          basedOnName: live.copyId ? (getCopy(live.copyId)?.basedOnName ?? null) : null,
          memberBuilt: !!live.programKey && parseMemberKey(live.programKey) !== null,
        }
      : null,
    plan: live && live.status === "active" ? planFor(live) : null,
```


- [ ] **Step 6: Change `app/src/components/clients/ClientProgramPanel.tsx`**

In `app/src/components/clients/ClientProgramPanel.tsx`, make this replacement. Each "replace" text appears exactly once in the file.

Replace:

```tsx
          )}

          {(live.lifts.length > 0 || live.weeks.length > 1) && (
            <div className="dp-forms">
```

with:

```tsx
          )}

          {live.program && (
            <div className="dp-card">
              <div className="dp-card-title">Their program</div>
              <div className="dp-note">The member built this program. Staff can correct a max or move the week; only the member edits the program.</div>
              {live.program.map((w) => (
                <div key={w.title} className="dp-event">
                  <span className="dp-event-meta">{w.title}</span>
                  {w.days.map((d, di) => (
                    <div key={di} style={{ display: "grid", gap: 2 }}>
                      <span className="dp-line" style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        {d.name}
                      </span>
                      {d.lines.map((line, li) => (
                        <span key={li} className="dp-line">
                          {line}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {(live.lifts.length > 0 || live.weeks.length > 1) && (
            <div className="dp-forms">
```


- [ ] **Step 7: Change `app/src/lib/programs/enrolments.ts`**

In `app/src/lib/programs/enrolments.ts`, make this replacement. Each "replace" text appears exactly once in the file.

Replace:

```ts
  next.maxes[lift] = round2(kg);
  next.tms[lift] = trainingMax(kg, view.template.tmPct);
  const fresh = initState(view.template, { [lift]: kg }, view.stepKg);
  for (const [k, w] of Object.entries(fresh.weights)) next.weights[k] = w;
  for (const [k, w] of Object.entries(fresh.t2Base)) next.t2Base[k] = w;
```

with:

```ts
  next.maxes[lift] = round2(kg);
  next.tms[lift] = trainingMax(kg, view.template.tmPct);
  // A member-built program's weights come from its rules, never from a max: only percentages follow it.
  const fresh = view.template.engine.key === "own_rules" ? emptyState() : initState(view.template, { [lift]: kg }, view.stepKg);
  for (const [k, w] of Object.entries(fresh.weights)) next.weights[k] = w;
  for (const [k, w] of Object.entries(fresh.t2Base)) next.t2Base[k] = w;
```


- [ ] **Step 8: Run the tests and the type check**

Run, one at a time:

```bash
cd app && npm test -- src/lib/programs/memberPanel.test.ts
cd app && npm test -- src/lib/programs/panel.test.ts
cd app && npm test -- src/lib/programs/memberPrograms.test.ts
cd app && npx tsc --noEmit -p .
cd app && npx eslint src/lib/programs/panel.ts src/lib/programs/staffView.ts src/components/clients/ClientProgramPanel.tsx
```

Expected: each test file passes (`memberPanel.test.ts` prints `programs/memberPanel: ok`; the others print their own `ok` line); `tsc` prints nothing; `eslint` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/programs/memberPanel.test.ts app/src/lib/programs/panel.ts app/src/lib/programs/staffView.ts app/src/components/clients/ClientProgramPanel.tsx app/src/lib/programs/enrolments.ts app/src/lib/programs/memberPrograms.test.ts
git commit -m "feat(programs): staff see a member-built program read-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full checks, browser check at 320 and 390 px, whole-branch review, deploy

**Files:**
- None new. Fixes found here go in the files they belong to, each committed with its exact paths.

**Interfaces:**
- Consumes: everything above.
- Produces: `main` with member-built programs, checked in a browser at 320 and 390 px, reviewed as a whole, and (when the controller says so) deployed.

- [ ] **Step 1: Full checks**

Run: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`
Expected: no type errors; every test file passes (the summary reads `369/369` or more); the build succeeds and lists `/app/programs/built/new`, `/app/programs/built/[id]` and `/app/programs/built/[id]/start`.

- [ ] **Step 2: No emojis in anything new or changed**

Run:

```bash
cd app && node -e "
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk('src/lib/programs'), ...walk('src/app/app/programs'),
  'src/components/clientapp/MemberProgramBuilder.tsx', 'src/components/clientapp/BuiltProgramList.tsx', 'src/components/clientapp/OwnMaxForm.tsx',
  'src/components/clientapp/StartProgramForm.tsx', 'src/components/clients/ClientProgramPanel.tsx'];
const bad = files.filter((f) => /\p{Extended_Pictographic}/u.test(fs.readFileSync(f, 'utf8')));
console.log(bad.length ? bad.join('\n') : 'no emojis');
process.exit(bad.length ? 1 : 0);
"
```

Expected: `no emojis`.

- [ ] **Step 3: Switch Programs on in the local dev control DB only**

Run: `cd app && sqlite3 data/control.db "INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES ('programs', 'all', 100, '[]', strftime('%s','now') * 1000) ON CONFLICT(key) DO UPDATE SET mode = 'all', percent = 100, allow = '[]'"`
Expected: no output. This never touches production.

- [ ] **Step 4: Browser check, member side, at 320 px**

Run `cd app && npm run dev` (Node at `/usr/local/bin`). As a staff admin, open the test member (`aoife.brennan@example.com`) under Clients and switch her to DIY. Then open http://localhost:3000/app/login in a private window, sign in as `aoife.brennan@example.com` / `password123`, and set the browser's device toolbar to 320 x 640.

Check each, and fix anything wrong before moving on:
1. Programs tab: "Build your own" sits at the top, above the library filters. No sideways scroll on the page.
2. Build your own, Start blank. Press Save program straight away: the top of the page lists "Week 1, Day 1: add at least one exercise."
3. Add exercise: the picker sheet opens; search "bench" and pick Bench press. Its card opens with Add weight chosen and 3 sets of 5. Type Start at 60. Rename the day "Upper". Save: a "Saved" toast and the address becomes `/app/programs/built/<id>`.
4. Add a day, name it "Lower", add Back squat, choose Percent of max, Squat max, set 1 to 80% x 3 and set 2 to 85% x 3 with the + pressed. Add a week (it copies week 1), give it the label "Deload", and change its squat sets to 60%.
5. Empty one reps box and Save: "Week 1, Upper, exercise 1, set 2: add reps." Fill it and Save again.
6. At 320 px: every set row fits on one line; every button and box is at least 44px tall (inspect a few); the Save bar sits above the tab bar; the week tabs scroll sideways inside their row only.
7. Start this program: only the squat max is asked. Start it. My program shows Upper with "Bench press 3 x 5 at 60 kg", an Edit program link, and a Change a max form under Your maxes.
8. Start session, tick every set, finish: the program card says "Next bench press 62.5 kg. You did all 3 sets of 5."
9. Edit program: the bench card shows "Now 62.5 kg". Remove nothing, add Face pull (Manual) to Upper, and Save: "Saved. Your program uses it from your next session." My program's changes list "You edited the program." and "Added exercises: Face pull."
10. Change a max: squat 150. The next Lower session's squat weights follow it.
11. Programs tab: My programs shows the program with Running, Edit, and no Delete. Build your own again, Start from my current program, Save: it appears in the list with Edit, Start and Delete (Start shows only when nothing is running). Delete it (confirm).

- [ ] **Step 5: The same screens at 390 px**

Set the device toolbar to 390 x 844 and repeat items 1, 3, 4, 6, 7 and 11. Nothing overlaps; the set rows keep their columns.

- [ ] **Step 6: Browser check, staff side**

In the staff window, open Aoife's client page, Workout log tab. The DIY program panel says "Built by the member" and shows a "Their program" card with Week 1 and Week 2: Deload, each day and each exercise with its rule. Correct her squat max to 155: the toast says "Max saved." and her bench weight on My program is unchanged. Move her to week 2: her next session is the Deload week.

Then put the local flag back: `cd app && sqlite3 data/control.db "DELETE FROM platform_flags WHERE key = 'programs'"`, and switch Aoife back to coach guided if she was before.

- [ ] **Step 7: Whole-branch review**

Review the whole branch as one change, not task by task (the last feature's cross-task bugs were only caught this way): `git diff 3bf1a74..HEAD -- app/src`. Check in particular:
- Every function in `memberPrograms.ts` filters by `clientId`, and nothing else reads `member_programs`.
- `startProgramAction` never starts a "member:<id>" key except through `enrolMemberProgram`.
- `saveMemberProgram` writes nothing when `writeTemplateEdit` returns false, and the program row and the enrolment cannot disagree after a failed event write (the DB test blocks the event and checks both).
- An exercise without a rule plans and progresses exactly as before (the library tests are untouched and green).
- No emojis, plain copy, 44px member targets, and no select with less than 36px right padding.

Fix what it finds, run Step 1 again, and commit each fix with its exact paths.

- [ ] **Step 8: Land on main and deploy (only when the controller says so)**

Run: `git status --short` and confirm nothing from this plan is left uncommitted (the unrelated files that were there before are fine; do not add them).
Run: `git push origin main`
Run: `cd app && railway up --detach`
Expected: the upload starts and returns a build URL. The main app deploy causes a few minutes of 502s while the volume swaps; that is expected. Once it settles, `curl -s -o /dev/null -w "%{http_code}" https://www.adonisagent.ie/api/health` returns `200`.

Every tenant DB gains `member_programs` the first time it opens after the deploy (`ensureTenantTables`). Members see Build your own only where the Programs module is on and they are in DIY mode.

---

## Self-review

Spec coverage, section by section:

| Spec | Where |
|---|---|
| 1. Table `member_programs` (id, client_id cascade, name, template_json, based_on, timestamps); member-only, staff read-only | Task 6 (plus `maxes_json`, decision 6); Task 10 (staff view) |
| 1. A `ProgramTemplate` with `engine: { key: "own_rules" }`, a `rule` per exercise | Tasks 1, 3 |
| 1. `linear` (incKg default 2.5, 5 for deadlift; deloadAfter default 3; deload 10%) | Task 1 (shape), Task 2 (engine), Task 7 (`defaultIncKg`, `newExercise`) |
| 1. `range` (min and max per set; incKg default the smallest jump) | Tasks 1, 2 (`rule.incKg ?? stepKg`) |
| 1. `percent` (lift; a percentage per set per week; max moves on a re-test or a member edit) | Tasks 1, 2 (test day), 6 (`memberSetMax`), 9 (Change a max) |
| 1. `rpe` (reps and RPE per set; weight from the best estimated max for the exercise) | Tasks 1, 2; `planFor` already passes `e1rm` for exercises without a lift |
| 1. `manual` (planned weight is last time's) | Task 2 (engine keeps it), Task 6 (`lastKg` from the logs) |
| 1. Own rules dispatch to the existing per-exercise logic; every change has a reason | Task 2 |
| 1. Running reuses enrolments, My program, logger, skip, end, change log; `program_key = "member:<id>"` | Tasks 6, 9 |
| 1. Maxes asked at start only for percent lifts | Task 3 (`percentLifts`), Tasks 6 and 9 (start) |
| 2. Build your own at the top; My programs with Edit, Start, Delete; delete refused while running | Tasks 6, 9 |
| 2. Starting points: blank; a library program converted to the nearest rule; the current program with its maxes and weights | Tasks 3, 4, 6, 8 |
| 2. Screens: name and units; week tabs (repeat, add by copy, remove, reorder); days; exercises from `listExercises()` or typed; rule fields; superset | Tasks 7, 8 (the picker is the existing `ExercisePicker`) |
| 2. Save validates on the server with plain errors; the limits | Tasks 1, 3, 8 |
| 2. Phone-first: 44px, brand variables, 320px | Task 8 (CSS), Task 11 (browser check) |
| 3. An edit applies from the next session; nothing logged changes | Tasks 5, 6 |
| 3. Kept, new, removed and changed-rule exercises by state key; reason in the change log | Task 5, tested in Tasks 5 and 6 |
| 3. Current week removed: nearest earlier week | Task 5, tested in Tasks 5 and 6 |
| 3. An open session finishes on the old version | Tasks 2 (removed exercises ignored), 6 (`writeTemplateEdit` moves its position), tested in Task 6 |
| 3. "You edited the program" listing days, exercises and rules; all in one transaction | Tasks 5, 6 (the DB test blocks the event write and checks nothing changed) |
| 4. Staff panel: "Built by the member", program read-only; coach max and week move work; no coach editing | Task 10 |
| 4. Gating on every page and action; ownership in the store | Tasks 6 (store), 8 and 9 (`gating.test.ts`) |
| 4. Tests: rule mix, starting points, edit while running, validation and limits, ownership, browser | Tasks 2, 4 and 6, 5 and 6, 1 and 3, 6, 11 |

Out of scope, as the spec says: sharing programs with other members, coaches editing a member's own program, spreadsheet import, progress charts beyond what exists.
