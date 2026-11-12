# Programs UI Redesign and Program Explanations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every member Programs screen one stronger, consistent look (a `.pk-` kit in the gym's brand colours) and give every program a full explanation: a summary, its phases, why it works, generated "how your weights move", a session length and every session in full.

**Architecture:** Three optional fields (`summary`, `phases` with `phasesRepeat`, `whyItWorks`) go on `ProgramTemplate` and its zod schema, so stored copies and enrolment snapshots still parse; the 19 platform templates get the text, checked by a content test. Pure modules build everything else: `content.ts` (summary, phases and byline for platform programs, gym copies and member-built programs), `progressionText.ts` ("how your weights move" from the engine settings and exercise rules) and `outline.ts` (session length, typical week, whole program, first week with real weights). A small kit (`components/clientapp/programs/kit.tsx`, `Sheet.tsx` and one `.pk-` CSS block) then rebuilds the five screens from the approved mockups, keeping every gate, server action and the builder's save logic exactly as they are.

**Tech Stack:** Next.js 15 App Router, TypeScript, zod 4, lucide-react, drizzle-orm over better-sqlite3 (tenant DB per business), plain `node:assert/strict` test scripts run with tsx.

Spec (source of truth): `docs/superpowers/specs/2026-11-12-programs-ui-redesign-design.md`. Approved mockups (HTML fragments; the gold in them is Inspire's brand colour, and the code uses brand variables only): `.superpowers/brainstorm/58454-1794515947/content/` — `program-page-direction.html` (option B), `programs-list-direction.html` (A), `my-program-direction.html` (A), `start-flow-direction.html` (A, with C's review of the first week), `builder-direction.html` (A). It builds on the DIY program library and member-built programs (plans `docs/superpowers/plans/2026-11-12-diy-program-library.md` and `docs/superpowers/plans/2026-11-12-member-built-programs.md`), both shipped behind the Programs module.

## Global Constraints

- NO EMOJIS anywhere: UI, code, comments, log lines, commit messages, docs. Where a glyph is needed, use a `lucide-react` icon.
- Copy is plain sentence case and short factual sentences, in our own words. No "X rather than Y", no "not just X", no filler. Nothing claims an outcome ("you will add 20 kg"). "-style" programs keep saying the numbers are ours.
- The member app (`/app`) uses the gym's brand CSS variables only: `--accent`, `--accent-soft`, `--accent-ink`, `--accent-contrast`, `--text-*`, `--hairline`, `--hairline-strong`, `--surface-*`, `--bg`, plus the shared `--danger` and `--danger-soft`. No hex, `rgb()` or `hsl()` colour in the kit. Optimal Health and Inspire must each look like themselves.
- The kit's CSS is ONE block in `app/src/app/globals.css`, from `/* ── Programs kit (.pk-)` to `/* ── end Programs kit ── */`, and uses only the `.pk-` prefix, which nothing else uses (the `.mb-` clash with the meal breakdown is the lesson). Every `pk-` class a component uses must have a rule in that block (`kit.test.ts` checks it).
- Member controls are at least 44px tall; every Programs screen works at 320px wide with no sideways page scroll; lucide icons only.
- One primary action per screen (`.pk-cta`), sticky at the bottom (`StickyBar`, 72px above the bottom tabs) where the screen scrolls.
- `<select>` elements keep the global select style in `globals.css` (36px right padding, chevron 12px in). Never set a smaller right padding on a select.
- Platform programs live in code (`app/src/lib/programs/templates/*.ts`, read from `app/src/lib/programs/registry.ts`, 19 programs; `nsunsStyle` is deliberately not registered and gets no content). Gym copies, hide switches and member-built programs live in the tenant DB.
- `summary`, `phases`, `phasesRepeat` and `whyItWorks` are OPTIONAL on `ProgramTemplate`, so stored enrolment snapshots, gym copies and member programs still parse. Without `phasesRepeat` the phases run from week 1 to `lengthWeeks`; with it they describe one pass through `weeks`, which repeats. Every platform program has all three, checked by `app/src/lib/programs/templates/content.test.ts`.
- "How your weights move" and the session length are generated, never hand-written. Session length is sets x (40 s + rest) per day at each exercise's first rep scheme, averaged over every day of the program, rounded to the nearest 5 minutes (at least 5), shown as "About 50 min".
- Everything is stored in kg; the member chooses kg or lb for display. Weights round to the member's smallest jump: 2.5 kg by default, 1.25 kg for small plates, 5 lb (2.26796 kg) for pounds.
- Library programs behave exactly as before: no change to the engines, the planner, progression, the logger or any existing template's sets. Every existing engine, planner, template, enrolment and library test stays green.
- Every gate stays as it is: every member Programs page calls `requireProgramsPage()`; every member action checks `requireClient()` and `memberSeesPrograms()` through the file's `member()` helper before anything else (`app/src/app/app/programs/gating.test.ts` checks both). A member program is private to its member: every store read takes the member's `clientId`.
- The start flow submits through the same `startProgramAction` with the same payload, and the server's validation and error text are unchanged.
- The My program controls (training days, skip, end, change a max, edit for member programs) keep their behaviour. `MyProgramControls`, `StartProgramSessionButton`, `WeekStrip`, `MyProgramCard` and `ExercisePicker` are not changed.
- The builder keeps its save logic exactly: the `<fieldset disabled={pending}>` lock, the `createdId` ref (a new program is created once), and `weekOrigins` handling (`draftFrom`, `addWeek`/`removeWeek`/`moveWeek` keep origins in step, and a successful save marks every week saved only if the draft did not move on).
- Workouts, Nutrition and every other member-app screen are not restyled. The old `.pg-` and `.bld-` rules are removed only in the final task, after a grep proves nothing references them.
- Out of scope: program images, charts beyond the phase bar, the logging screen, the progression logic.
- Never diagnose tenant state from the local `app/data/` files; they are stale dev copies.
- Tests are plain `node:assert/strict` scripts with no framework. Run one with `cd app && npm test -- src/path/file.test.ts`. DB tests make a scratch tenant (control row plus a real tenant DB file) and clean it up.
- Commit after every task with `git add <exact paths>` (never `git add -A` or `git add .`; unrelated untracked files exist). Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Full checks: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`. Deploy is `cd app && railway up --detach`, from `main`, only in the final task and only when the controller says so.

## Controller decisions (override the plan text where they differ)

- Commit trailer is exactly: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- No `railway up` and no `git push` in any task except Task 12, and only when the controller says so.
- Unrelated modified and untracked files exist (`.claude/settings.local.json`, `app/next-env.d.ts`, `design-preview/`, `docs/lead-engine/`, and others). Never stage them.
- Existing DIY library behaviour (platform programs, gym copies, enrolments, logger) must not change unless the task says so. Run the existing programs tests.

## Decisions this plan settles (spec gaps)

- **Phase coverage.** Phases are contiguous from week 1. A repeating program (`phasesRepeat: true`: 5/3/1 and the Texas Method) describes one pass through its weeks. A short cycle run for longer (StrongLifts' two weeks for 12, the one-week size programs) describes its first round over `lengthWeeks`; after that round `currentPhase` returns null, so the bar shows no current phase rather than a wrong one. A full block (weeks = length) has its phases again after a restart.
- **Gym copies.** `fitPhases` drops a phase that starts after the copy's last week, clips one that runs past it, and covers weeks a gym added past the original's phases with one "Added weeks" phase ("Weeks added in our version."), so the bar never has a gap. A copy saved before this change has no content fields: `toCopy` in `library.ts` fills them from the original (`withContentFrom`). The byline is the existing "Our version, based on X".
- **Member-built programs** open on the same program page at `/app/programs/member%3A<id>` (only the member's own; another member's id is a 404). Unlabelled weeks merge into phases named by their numbers ("Weeks 3 to 4"); each phase's note lists its first week's day names. No level pill and no "Why it works".
- **The old description and "who" lines** are no longer shown on the member program page (the new sections replace them); staff screens keep them. "You need a max for: ..." stays above the Start button.
- **Start flow without maxes.** A program that takes no max (PHUL, PHAT, a member program with no percent exercise) has three screens: weights, days, review.
- **My program** keeps the "This week" strip (it is not a control, and members use it) and shows the 10 most recent changes. The session count comes from a new `enrolmentCounts` (finished = `progress` events, skipped = `skip` events). "See the whole program" links to the program page only when that page exists for the member (not for a hidden platform program or a deleted copy).
- **Filters** are kept in the URL (`?goal=&days=&length=`), so they are still set when the member comes back from a program.
- **Programs tab copy.** The mockup's "Proven programs" claims a result; the line stays "Well-known programs, with your weights worked out."
- **nSuns** is not registered, so it gets no content; its generated weight text is still tested.

## File structure

New, pure (`app/src/lib/programs/`):
- `content.ts`: `ProgramContent`, `programContent`, `fitPhases`, `memberPhases`, `withContentFrom`, `currentPhase`, `contentErrors`, `phaseSpan`, `weeksText`, `listText`.
- `progressionText.ts`: `howWeightsMove`, `ruleSentence`.
- `outline.ts`: `sessionMinutes`, `daySeconds`, `typicalWeek`, `wholeProgram`, `firstWeek`, `firstSets`, `trainingDates`, `shortDate`, `weightWhy`, `focusTag`, `lengthTag`.
- `startFlow.ts`: the start flow's state, reducer, max helpers and `stepForError`.
- Tests beside each, plus `templates/content.test.ts`.

New UI (`app/src/components/clientapp/programs/`):
- `kit.tsx`: `PkHeader`, `PkSection`, `PkCard`, `Pill`, `Pills`, `PhaseBar`, `StatTiles`, `Timeline`, `StickyBar`, `Warn`, `StepBar` (no hooks; server and client use them).
- `Sheet.tsx`: the bottom sheet (client).
- `ProgramDetail.tsx`: the program page body (server).
- `kit.test.ts`: the CSS block check.

Changed: `types.ts`, `validate.ts`, `library.ts`, `enrolments.ts`, `cards.ts`, `memberEditing.ts`, the 16 template files, `globals.css`, the seven member Programs pages, and `ProgramBrowser.tsx`, `BuiltProgramList.tsx`, `StartProgramForm.tsx`, `MemberProgramBuilder.tsx`, `OwnMaxForm.tsx`, `RestartProgramForm.tsx` in `app/src/components/clientapp/`.

---

### Task 1: Program content fields and the content model

**Files:**
- Modify: `app/src/lib/programs/types.ts` (add `Phase`; four optional fields on `ProgramTemplate`)
- Modify: `app/src/lib/programs/validate.ts` (the zod schema keeps the new fields)
- Create: `app/src/lib/programs/content.ts`
- Test: `app/src/lib/programs/content.test.ts`
- Modify: `app/src/lib/programs/library.ts` (an old gym copy takes its content from the original)
- Modify: `app/src/lib/programs/library.test.ts`

**Interfaces:**
- Consumes: `memberLine`, `MEMBER_AUTHOR` (`memberTemplate.ts`), `weekInRound` (`planner.ts`), `isFullBlock` (`editing.ts`).
- Produces (later tasks rely on these exact names):
  - `types.ts`: `interface Phase { name: string; fromWeek: number; toWeek: number; note: string }`; on `ProgramTemplate`: `summary?: string; phases?: Phase[]; phasesRepeat?: boolean; whyItWorks?: string`.
  - `content.ts`: `interface ProgramContent { summary: string; phases: Phase[]; repeats: boolean; whyItWorks: string | null; byline: string }`; `type ContentSource = { kind: "platform" } | { kind: "copy"; basedOnName: string } | { kind: "member" }`; `programContent(t: ProgramTemplate, src: ContentSource): ProgramContent`; `fitPhases(phases: Phase[], span: number): Phase[]`; `memberPhases(t): Phase[]`; `phaseSpan(t, repeats: boolean): number`; `withContentFrom(t: ProgramTemplate, original: ProgramTemplate | null): ProgramTemplate`; `currentPhase(content, t, state: { week; cycle }): number | null` (an index into `content.phases`); `contentErrors(t: ProgramTemplate): string[]`; `weeksText(from, to): string` ("Week 3", "Weeks 1 to 4"); `listText(items: string[]): string` ("A, B and C"); `ADDED_WEEKS_PHASE = "Added weeks"`.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/content.test.ts`:

```ts
// app/src/lib/programs/content.test.ts
// Run: npm test -- src/lib/programs/content.test.ts
//
// Program content: fitting phases to a copy's weeks, phases from a member's
// week labels, the byline per source, filling an old copy from its original,
// the current phase, and the content check.
import assert from "node:assert/strict";

import { ADDED_WEEKS_PHASE, contentErrors, currentPhase, fitPhases, listText, memberPhases, phaseSpan, programContent, weeksText, withContentFrom } from "./content";
import { blankMemberTemplate } from "./memberTemplate";
import type { Phase, ProgramTemplate } from "./types";
import { parseTemplate } from "./validate";

const P = (name: string, fromWeek: number, toWeek: number, note = `${name} note.`): Phase => ({ name, fromWeek, toWeek, note });

assert.equal(weeksText(3, 3), "Week 3");
assert.equal(weeksText(1, 4), "Weeks 1 to 4");
assert.equal(listText(["A"]), "A");
assert.equal(listText(["A", "B"]), "A and B");
assert.equal(listText(["A", "B", "C"]), "A, B and C");

// A block of 4 weeks, as a test fixture.
const day = { name: "Day 1", exercises: [{ name: "Back squat", lift: "squat" as const, sets: [{ kind: "pct" as const, pct: 0.7, reps: 5, rest: 180 }] }] };
const block: ProgramTemplate = {
  key: "fixture-block",
  name: "Fixture block",
  author: "By a tester",
  family: "peaking",
  level: "advanced",
  daysPerWeek: 1,
  lengthWeeks: 4,
  lifts: ["squat"],
  tmPct: 1,
  who: "Testers.",
  description: "A fixture.",
  summary: "Three heavy weeks, then a test.",
  phases: [P("Base", 1, 3), P("Test", 4, 4)],
  whyItWorks: "It is a fixture.",
  engine: { key: "fixed_block" },
  weeks: [{ days: [day] }, { days: [day] }, { days: [day] }, { label: "Test", days: [{ ...day, test: true }] }],
};

// ── fitting phases to a copy's weeks ──
assert.deepEqual(fitPhases(block.phases!, 4), block.phases, "phases that fit are kept");
assert.deepEqual(fitPhases(block.phases!, 2), [P("Base", 1, 2)], "a phase past the end is dropped, a partial one clipped");
assert.deepEqual(fitPhases(block.phases!, 6), [...block.phases!, { name: ADDED_WEEKS_PHASE, fromWeek: 5, toWeek: 6, note: "Weeks added in our version." }], "added weeks get their own phase");
assert.deepEqual(fitPhases([], 3), [{ name: "Weeks 1 to 3", fromWeek: 1, toWeek: 3, note: "" }], "no phases at all is one phase over every week");
assert.equal(phaseSpan(block, false), 4);
assert.equal(phaseSpan({ weeks: block.weeks.slice(0, 1), lengthWeeks: 12 }, true), 1);

// ── programContent by source ──
const plat = programContent(block, { kind: "platform" });
assert.equal(plat.summary, "Three heavy weeks, then a test.");
assert.equal(plat.byline, "By a tester");
assert.equal(plat.whyItWorks, "It is a fixture.");
assert.equal(plat.repeats, false);
const shortCopy: ProgramTemplate = { ...block, lengthWeeks: 3, weeks: block.weeks.slice(0, 3) };
const copy = programContent(shortCopy, { kind: "copy", basedOnName: "Fixture block" });
assert.equal(copy.byline, "Our version, based on Fixture block");
assert.deepEqual(copy.phases, [P("Base", 1, 3)], "a 3-week copy drops the test phase");
assert.equal(copy.whyItWorks, "It is a fixture.", "a copy keeps why it works");
const noContent: ProgramTemplate = { ...block, summary: undefined, phases: undefined, whyItWorks: undefined };
const bare = programContent(noContent, { kind: "platform" });
assert.equal(bare.summary, "Testers.", "no summary falls back to who it is for");
assert.equal(bare.whyItWorks, null);
assert.equal(bare.phases.length, 1);

// ── member programs ──
const member = blankMemberTemplate();
member.weeks = [
  { label: "Build", days: [{ name: "Push", exercises: [] }, { name: "Pull", exercises: [] }] },
  { label: "Build", days: [{ name: "Push", exercises: [] }, { name: "Pull", exercises: [] }] },
  { days: [{ name: "Legs", exercises: [] }] },
  { days: [{ name: "Legs", exercises: [] }] },
  { label: "Deload", days: [{ name: "Easy", exercises: [] }] },
];
assert.deepEqual(memberPhases(member), [
  { name: "Build", fromWeek: 1, toWeek: 2, note: "Push and Pull." },
  { name: "Weeks 3 to 4", fromWeek: 3, toWeek: 4, note: "Legs." },
  { name: "Deload", fromWeek: 5, toWeek: 5, note: "Easy." },
]);
const one = blankMemberTemplate();
assert.deepEqual(memberPhases(one), [{ name: "Week 1", fromWeek: 1, toWeek: 1, note: "Day 1." }], "no labels is one phase");
const mc = programContent(member, { kind: "member" });
assert.equal(mc.summary, "2 days a week, 5 weeks that repeat");
assert.equal(mc.whyItWorks, null, "no why it works for a member program");
assert.equal(mc.repeats, true);
assert.equal(mc.byline, "Built by the member");
assert.equal(programContent(one, { kind: "member" }).summary, "1 day a week, one week that repeats");

// ── an old copy takes its content from the original ──
const filled = withContentFrom(noContent, block);
assert.equal(filled.summary, block.summary);
assert.deepEqual(filled.phases, block.phases);
assert.equal(filled.whyItWorks, block.whyItWorks);
assert.notEqual(filled.phases, block.phases, "the phases are copied, not shared");
assert.equal(withContentFrom({ ...block, summary: "Ours." }, block).summary, "Ours.", "a copy's own summary is kept");
assert.equal(withContentFrom(noContent, null), noContent);

// ── the zod check keeps the new fields on a stored copy ──
const parsed = parseTemplate(JSON.parse(JSON.stringify(block)));
assert.ok(parsed.ok);
assert.equal(parsed.template.summary, block.summary);
assert.deepEqual(parsed.template.phases, block.phases);
assert.equal(parsed.template.whyItWorks, block.whyItWorks);
const longSummary = parseTemplate({ ...block, summary: "x".repeat(201) });
assert.ok(!longSummary.ok && longSummary.errors.some((e) => e.includes("summary is too long")));

// ── the current phase ──
assert.equal(currentPhase(plat, block, { week: 0, cycle: 0 }), 0);
assert.equal(currentPhase(plat, block, { week: 3, cycle: 0 }), 1);
assert.equal(currentPhase(plat, block, { week: 1, cycle: 1 }), 0, "a restarted block has its phases again");
const cycle = { ...block, lengthWeeks: 12, weeks: block.weeks.slice(0, 2), phasesRepeat: true, phases: [P("A", 1, 1), P("B", 2, 2)] };
const cc = programContent(cycle, { kind: "platform" });
assert.equal(currentPhase(cc, cycle, { week: 1, cycle: 4 }), 1, "a repeating cycle follows its week");
const stretched = { ...block, lengthWeeks: 12, weeks: block.weeks.slice(0, 2), phases: [P("Start", 1, 2), P("Climb", 3, 12)] };
const sc = programContent(stretched, { kind: "platform" });
assert.equal(currentPhase(sc, stretched, { week: 1, cycle: 2 }), 1, "week 6 is in the climb");
assert.equal(currentPhase(sc, stretched, { week: 0, cycle: 6 }), null, "round 2 of a stretched cycle has no phase");

// ── the content check ──
assert.deepEqual(contentErrors(block), []);
assert.deepEqual(contentErrors(noContent), ["fixture-block: needs a summary.", "fixture-block: needs a line on why it works.", "fixture-block: needs phases."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 2), P("Test", 4, 4)] }), ["fixture-block: Test should start at week 3."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 3)] }), ["fixture-block: the phases end at week 3, not week 4."]);
assert.deepEqual(contentErrors({ ...block, phases: [P("Base", 1, 3), P("Test", 4, 4, " ")] }), ["fixture-block: Test needs a note."]);

console.log("programs/content: ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/content.test.ts`
Expected: FAIL with `Cannot find module './content'`.

- [ ] **Step 3: Add the fields to the template type**

In `app/src/lib/programs/types.ts`, replace

```ts
export interface ProgramTemplate {
  key: string;
```

with

```ts
/** One stretch of a program, in the program's own week numbers (1-based, inclusive). */
export interface Phase {
  name: string;
  fromWeek: number;
  toWeek: number;
  /** What the phase is like, in a sentence or two. */
  note: string;
}

export interface ProgramTemplate {
  key: string;
```

and in the same interface replace

```ts
  /** For demanding programs. */
  warning?: string;
  engine: EngineSettings;
```

with

```ts
  /** For demanding programs. */
  warning?: string;
  /** One plain line for the card and the top of the program page. Platform programs always have one. */
  summary?: string;
  /**
   * The program's shape, in order, with no gaps. Without phasesRepeat they run
   * from week 1 to lengthWeeks; with it they describe one pass through `weeks`,
   * which then repeats.
   */
  phases?: Phase[];
  phasesRepeat?: boolean;
  /** Two or three short sentences on the method. No claims of results. */
  whyItWorks?: string;
  engine: EngineSettings;
```

- [ ] **Step 4: Keep the fields through the template check**

`parseTemplate` drops unknown keys, so without this a gym copy would lose its content on save. In `app/src/lib/programs/validate.ts`, replace

```ts
const templateZ = z.object({
```

with

```ts
const phaseZ = z.object({
  name: z.string().trim().min(1).max(40),
  fromWeek: z.number().int().min(1).max(52),
  toWeek: z.number().int().min(1).max(52),
  note: z.string().trim().max(300),
});

const templateZ = z.object({
```

then replace

```ts
  warning: z.string().trim().max(200).optional(),
  engine: engineZ,
```

with

```ts
  warning: z.string().trim().max(200).optional(),
  summary: z.string().trim().min(1).max(200).optional(),
  phases: z.array(phaseZ).min(1).max(12).optional(),
  phasesRepeat: z.boolean().optional(),
  whyItWorks: z.string().trim().min(1).max(600).optional(),
  engine: engineZ,
```

then in `FIELD_LABEL` replace

```ts
  warning: "warning line",
  label: "week label",
```

with

```ts
  warning: "warning line",
  summary: "summary",
  whyItWorks: "line on why it works",
  label: "week label",
```

and in `plainMessage` replace

```ts
    case "warning":
    case "label":
```

with

```ts
    case "warning":
    case "summary":
    case "whyItWorks":
    case "label":
```

- [ ] **Step 5: Write the content model**

Create `app/src/lib/programs/content.ts`:

```ts
// app/src/lib/programs/content.ts
/**
 * What a program page says about a program: its summary, its phases, why it
 * works and its byline. Platform programs carry these in their template files;
 * a gym copy keeps the original's, fitted to its own weeks; a member-built
 * program gets them from its days and week labels. Pure.
 */
import { isFullBlock } from "./editing";
import { MEMBER_AUTHOR, memberLine } from "./memberTemplate";
import { weekInRound } from "./planner";
import type { EngineState, Phase, ProgramTemplate } from "./types";

export interface ProgramContent {
  summary: string;
  /** Run from week 1 to phaseSpan with no gaps. */
  phases: Phase[];
  /** The phases describe one pass through the template's weeks, which repeats. */
  repeats: boolean;
  /** Null for a member-built program. */
  whyItWorks: string | null;
  /** The author, "Our version, based on X" for a gym copy, or "Built by the member". */
  byline: string;
}

export type ContentSource = { kind: "platform" } | { kind: "copy"; basedOnName: string } | { kind: "member" };

/** The phase used for weeks a gym added past the original's phases. */
export const ADDED_WEEKS_PHASE = "Added weeks";

/** "Week 3", "Weeks 1 to 4". */
export function weeksText(from: number, to: number): string {
  return from === to ? `Week ${from}` : `Weeks ${from} to ${to}`;
}

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How many weeks the phases cover: one pass through the weeks when they repeat, else the program's length. */
export function phaseSpan(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, repeats: boolean): number {
  return Math.max(1, repeats ? t.weeks.length : t.lengthWeeks);
}

/**
 * Phases fitted to `span` weeks: a phase that starts after the last week is
 * dropped, one that runs past it is clipped, and weeks past the last phase
 * become one "Added weeks" phase. Never returns an empty list.
 */
export function fitPhases(phases: Phase[], span: number): Phase[] {
  const out: Phase[] = [];
  for (const p of phases) {
    if (p.fromWeek > span) continue;
    out.push({ ...p, toWeek: Math.min(p.toWeek, span) });
  }
  const last = out[out.length - 1]?.toWeek ?? 0;
  if (last < span) out.push({ name: out.length ? ADDED_WEEKS_PHASE : weeksText(1, span), fromWeek: last + 1, toWeek: span, note: out.length ? "Weeks added in our version." : "" });
  return out;
}

/** A member program's phases: consecutive weeks that share a label merge; unlabelled weeks are named by their numbers. */
export function memberPhases(t: Pick<ProgramTemplate, "weeks">): Phase[] {
  const out: Phase[] = [];
  t.weeks.forEach((w, i) => {
    const label = w.label?.trim() ?? "";
    const prev = out[out.length - 1];
    const prevLabel = prev && t.weeks[prev.fromWeek - 1].label?.trim();
    if (prev && (prevLabel ?? "") === label) {
      prev.toWeek = i + 1;
      return;
    }
    out.push({ name: label, fromWeek: i + 1, toWeek: i + 1, note: `${listText(w.days.map((d) => d.name))}.` });
  });
  for (const p of out) if (!p.name) p.name = weeksText(p.fromWeek, p.toWeek);
  return out;
}

/** Everything the program page and cards say about a program. */
export function programContent(t: ProgramTemplate, src: ContentSource): ProgramContent {
  if (src.kind === "member") {
    return { summary: memberLine(t), phases: memberPhases(t), repeats: true, whyItWorks: null, byline: MEMBER_AUTHOR };
  }
  const repeats = t.phasesRepeat === true;
  return {
    summary: t.summary ?? t.who,
    phases: fitPhases(t.phases ?? [], phaseSpan(t, repeats)),
    repeats,
    whyItWorks: t.whyItWorks ?? null,
    byline: src.kind === "copy" ? `Our version, based on ${src.basedOnName}` : t.author,
  };
}

/**
 * A gym copy or an enrolment snapshot saved before programs had content
 * takes it from the program it came from. Fields it has are kept.
 */
export function withContentFrom(t: ProgramTemplate, original: ProgramTemplate | null): ProgramTemplate {
  if (!original) return t;
  const out: ProgramTemplate = { ...t };
  if (out.summary === undefined && original.summary !== undefined) out.summary = original.summary;
  if (out.whyItWorks === undefined && original.whyItWorks !== undefined) out.whyItWorks = original.whyItWorks;
  if (out.phases === undefined && original.phases !== undefined) {
    out.phases = original.phases.map((p) => ({ ...p }));
    if (original.phasesRepeat) out.phasesRepeat = true;
  }
  return out;
}

/**
 * The phase the member is in. Repeating phases follow the week of the cycle.
 * Otherwise they follow the week of the round; a short cycle run for longer
 * (StrongLifts' two weeks for 12) has no phase after its first round.
 */
export function currentPhase(content: Pick<ProgramContent, "phases" | "repeats">, t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, s: Pick<EngineState, "week" | "cycle">): number | null {
  let wk: number;
  if (content.repeats) wk = s.week + 1;
  else {
    const r = weekInRound(t, s);
    if (r.round > 1 && !isFullBlock(t)) return null;
    wk = r.week;
  }
  const i = content.phases.findIndex((p) => wk >= p.fromWeek && wk <= p.toWeek);
  return i === -1 ? null : i;
}

/** The content check every platform program must pass. */
export function contentErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  if (!t.summary?.trim()) errors.push(`${t.key}: needs a summary.`);
  if (!t.whyItWorks?.trim()) errors.push(`${t.key}: needs a line on why it works.`);
  const phases = t.phases ?? [];
  if (phases.length === 0) return [...errors, `${t.key}: needs phases.`];
  const span = phaseSpan(t, t.phasesRepeat === true);
  let next = 1;
  for (const p of phases) {
    if (!p.name.trim()) errors.push(`${t.key}: a phase needs a name.`);
    if (!p.note.trim()) errors.push(`${t.key}: ${p.name} needs a note.`);
    if (p.fromWeek !== next || p.toWeek < p.fromWeek) errors.push(`${t.key}: ${p.name} should start at week ${next}.`);
    next = p.toWeek + 1;
  }
  if (next - 1 !== span) errors.push(`${t.key}: the phases end at week ${next - 1}, not week ${span}.`);
  return errors;
}
```

- [ ] **Step 6: Run the test to make sure it passes**

Run: `cd app && npm test -- src/lib/programs/content.test.ts`
Expected: PASS, printing `programs/content: ok`.

- [ ] **Step 7: Fill an old gym copy from its original, and test that a copy keeps its own**

In `app/src/lib/programs/library.ts`, replace

```ts
import type { ProgramTemplate } from "./types";
import { isFullBlock, mostDays } from "./editing";
```

with

```ts
import type { ProgramTemplate } from "./types";
import { withContentFrom } from "./content";
import { isFullBlock, mostDays } from "./editing";
```

and in `toCopy` replace

```ts
  const template = parsed.template;
  return {
```

with

```ts
  // A copy made before programs had a summary, phases and why it works takes them from its original.
  const template = withContentFrom(parsed.template, platformProgram(r.basedOn));
  return {
```

In `app/src/lib/programs/library.test.ts`, insert directly above the line `      // ── unhide, delete ──`:

```ts
      // ── a copy's own summary, phases and why it works survive a save ──
      const withContent = structuredClone(lib.getCopy(id)!.template);
      withContent.summary = "Our three-day Smolov.";
      withContent.phases = [{ name: "Base", fromWeek: 1, toWeek: 5, note: "Our base weeks." }];
      withContent.whyItWorks = "Our reasons.";
      assert.deepEqual(lib.saveCopy(id, withContent), { ok: true });
      const kept = lib.getCopy(id)!.template;
      assert.equal(kept.summary, "Our three-day Smolov.");
      assert.deepEqual(kept.phases, [{ name: "Base", fromWeek: 1, toWeek: 5, note: "Our base weeks." }]);
      assert.equal(kept.whyItWorks, "Our reasons.");

```

Run: `cd app && npm test -- src/lib/programs/library.test.ts && npm test -- src/lib/programs/validate.test.ts && npm test -- src/lib/programs/registry.test.ts && npx tsc --noEmit -p .`
Expected: `programs/library: ok`, the validate and registry tests pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/programs/types.ts app/src/lib/programs/validate.ts app/src/lib/programs/content.ts app/src/lib/programs/content.test.ts app/src/lib/programs/library.ts app/src/lib/programs/library.test.ts
git commit -m "$(cat <<'MSG'
feat(programs): summary, phases and why it works on templates, and the content model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: Generated text: how your weights move, session length and the outline

**Files:**
- Create: `app/src/lib/programs/progressionText.ts`
- Test: `app/src/lib/programs/progressionText.test.ts`
- Create: `app/src/lib/programs/outline.ts`
- Test: `app/src/lib/programs/outline.test.ts`

**Interfaces:**
- Consumes: `listText` (Task 1, `content.ts`); `barKg`, `initState` (`engines.ts`); `progresses`, `schemeLabel`, `planExercise`, `setsFor`, `summarisePlanned`, `summariseRx` (`planner.ts`); `formatWeight`, `roundToStep` (`units.ts`); `WEEKDAY_SHORT`, `addDays`, `isoWeekday` (`@/lib/trainingProgress`, pure).
- Produces:
  - `progressionText.ts`: `howWeightsMove(t: ProgramTemplate, unit: WeightUnit, stepKg: number): string[]` (covers `linear`, `tm_cycle` with each rule `cycle`/`amrap_table`/`drive_set`/`gzclp`, `fixed_block`, `double_progression`, `fixed_volume`, and `own_rules` as one line per distinct rule); `ruleSentence(ex: ExerciseRx, unit: WeightUnit, stepKg: number): string` (every own rule kind).
  - `outline.ts`: `SECONDS_PER_SET = 40`; `daySeconds(d: DayRx): number`; `sessionMinutes(t: Pick<ProgramTemplate, "weeks">): number`; `interface OutlineLine { name: string; rx: string; joined: boolean; notes: string | null }`; `interface OutlineDay { name: string; test: boolean; lines: OutlineLine[] }`; `interface OutlineWeek { title: string; days: OutlineDay[] }`; `wholeProgram(t): OutlineWeek[]`; `typicalWeek(t): OutlineDay[]`; `focusTag(t: Pick<ProgramTemplate, "lifts">): string`; `lengthTag(t, repeats: boolean): string`; `interface PreviewDay { name: string; test: boolean; lines: string[] }`; `firstWeek(t, maxesKg, stepKg, unit): PreviewDay[]`; `firstSets(t, lift, maxKg, stepKg, unit): string | null`; `trainingDates(startDate: string, weekdays: number[], n: number): string[]`; `shortDate(key: string): string` ("Mon 16 Nov"); `weightWhy(ex: PlannedExercise, rx: Pick<ExerciseRx, "sets"> | undefined, tmPct: number, unit: WeightUnit): string | null`.

Every number in the generated sentences comes from the template's engine settings and exercise rules: increments (rounded to the member's smallest jump where the engine rounds, raw where a training max moves by the raw amount), deload counts and percentages, the AMRAP table, GZCLP's rep schemes, block add-ons, and the member's unit.

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/programs/progressionText.test.ts`:

```ts
// app/src/lib/programs/progressionText.test.ts
// Run: npm test -- src/lib/programs/progressionText.test.ts
//
// "How your weights move" for every platform program (kg and lb) and for
// every own rule: plain sentences with the real numbers and nothing undefined.
import assert from "node:assert/strict";

import { applyRule, newExercise } from "./memberEditing";
import { blankMemberTemplate } from "./memberTemplate";
import { howWeightsMove, ruleSentence } from "./progressionText";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { nsunsStyle } from "./templates/nsuns";
import type { ExerciseRx } from "./types";
import { STEP_5LB_KG } from "./units";

const get = (key: string) => platformProgram(key)!;

assert.deepEqual(howWeightsMove(get("stronglifts-5x5"), "kg", 2.5), [
  "Each lift starts at 50% of your max.",
  "Get every rep on every set and the weight goes up next time: 2.5 kg, or 5 kg on the deadlift.",
  "Miss reps three sessions in a row and that lift drops 10%.",
  "A lift never drops below the empty bar (20 kg).",
]);

// Greyskull's 1.25 kg upper-body jump rounds to the member's smallest jump.
const grey = howWeightsMove(get("greyskull-lp"), "kg", 2.5);
assert.ok(grey.includes("Get every rep on every set and the weight goes up next time: 2.5 kg."), grey.join(" | "));
assert.ok(grey.includes("Ten or more reps on the last set doubles the jump."));
assert.ok(grey.includes("Fall short on any set and that lift drops 10% next time."));
assert.ok(grey.includes("Chin-up is bodyweight. Add reps when you can."));
assert.ok(howWeightsMove(get("greyskull-lp"), "kg", 1.25).includes("Get every rep on every set and the weight goes up next time: 1.25 kg, or 2.5 kg on the squat and deadlift."));
const greyLb = howWeightsMove(get("greyskull-lp"), "lb", STEP_5LB_KG);
assert.ok(greyLb.includes("Get every rep on every set and the weight goes up next time: 5 lb."), greyLb.join(" | "));
assert.ok(greyLb.includes("A lift never drops below the empty bar (45 lb)."));

assert.deepEqual(howWeightsMove(get("531-bbb"), "kg", 2.5), [
  "Your training max is 90% of your max. Every percentage is taken from it.",
  "The last set of each main lift is as many reps as you can.",
  "After each four-week cycle, your training max goes up 2.5 kg, or 5 kg on the deadlift and squat.",
  "If a lift's last set falls short of its reps, is lighter than planned or is not logged, that lift's training max stays the same for the next cycle.",
  "You pick the weight for dumbbell row and lying leg curl. The program does not change it.",
  "Chin-up and hanging leg raise are bodyweight. Add reps when you can.",
]);
// A training max moves by the raw amount, shown in pounds.
assert.ok(howWeightsMove(get("531-bbb"), "lb", STEP_5LB_KG).includes("After each four-week cycle, your training max goes up 5.5 lb, or 11 lb on the deadlift and squat."));

const texas = howWeightsMove(get("texas-method"), "kg", 2.5);
assert.equal(texas[0], "Your training max is your 5-rep max, about 86% of your max. Every percentage is taken from it.");
assert.equal(texas[1], "Get all 5 reps on a top set and that lift's training max goes up 2.5 kg, or 5 kg on the deadlift.");

assert.deepEqual(howWeightsMove(get("gzclp"), "kg", 2.5), [
  "Main lifts (T1) start at 73% of your max and second lifts (T2) at 55%.",
  "Hit every rep and the lift goes up next time: 2.5 kg, or 5 kg on the squat and deadlift.",
  "Miss on a main lift and it moves on to 6 x 2+, then 10 x 1+ at the same weight. Miss on 10 x 1+ and it goes back to 5 x 3+ at 85% of that weight.",
  "Miss on a second lift and it moves on to 3 x 8, then 3 x 6. After 3 x 6 it goes back to 3 x 10, 5 kg heavier than it last started.",
  "Accessories (T3) go up 2.5 kg once the last set reaches 25 reps.",
]);

assert.deepEqual(howWeightsMove(get("smolov-base"), "kg", 2.5), [
  "Every weight is a percentage of the max you enter.",
  "Week 2 adds 10 kg and week 3 adds 15 kg to every set.",
  "The weights are set from the start. They do not change with how a session goes.",
  "The test day reads your new max from your best set. Start the block again from it.",
]);

assert.deepEqual(howWeightsMove(get("phul"), "kg", 1.25), [
  "You pick each starting weight.",
  "When every set reaches the top of its rep range, the weight goes up 1.25 kg and the reps go back to the bottom.",
]);
// PHAT's speed sets share names with lifts that progress on the power days: no line says the program leaves them alone.
assert.ok(!howWeightsMove(get("phat"), "kg", 2.5).some((l) => l.includes("pendlay row")));

const gvt = howWeightsMove(get("german-volume-training"), "kg", 2.5);
assert.equal(gvt[0], "Each lift starts at 60% of your max.");
assert.ok(gvt.includes("Get every rep on every set and the weight goes up 2.5 kg next time. Until then it stays the same."));
assert.ok(gvt.includes("You pick the starting weight for lying leg curl and hammer curl."));

assert.ok(
  howWeightsMove(nsunsStyle, "kg", 2.5).includes("The reps on the heavy + set move your training max: 0 to 1 reps changes nothing, 2 to 3 reps adds 2.5 kg, 4 to 5 reps adds 5 kg and 6 or more reps adds 7.5 kg."),
);

// Every platform program, in kg and in pounds: sentences, no gaps.
for (const t of [...PLATFORM_PROGRAMS, nsunsStyle]) {
  for (const [unit, step] of [["kg", 2.5], ["kg", 1.25], ["lb", STEP_5LB_KG]] as const) {
    const lines = howWeightsMove(t, unit, step);
    assert.ok(lines.length >= 2, `${t.key}: at least two lines`);
    for (const l of lines) {
      assert.ok(!/undefined|NaN|null|\[object/.test(l), `${t.key}: ${l}`);
      assert.ok(/^[A-Z0-9]/.test(l) && l.endsWith("."), `${t.key}: a sentence: ${l}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(l), `${t.key}: no emojis`);
      if (unit === "lb") assert.ok(!/\bkg\b/.test(l), `${t.key}: pounds only: ${l}`);
    }
  }
}

// ── every own rule ──
const bench = (kind: Parameters<typeof applyRule>[1]): ExerciseRx => applyRule(newExercise("Bench press"), kind);
assert.equal(ruleSentence(newExercise("Back squat"), "kg", 2.5), "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.");
assert.equal(ruleSentence(newExercise("Deadlift"), "lb", STEP_5LB_KG), "Deadlift goes up 10 lb after a session with every rep, and drops 10% after three misses in a row.");
const oneMiss = newExercise("Bench press");
if (oneMiss.rule?.kind === "linear") oneMiss.rule.deloadAfter = 1;
assert.equal(ruleSentence(oneMiss, "kg", 2.5), "Bench press goes up 2.5 kg after a session with every rep, and drops 10% after a miss.");
const tiny = newExercise("Curl");
if (tiny.rule?.kind === "linear") tiny.rule.incKg = 0.5;
assert.equal(ruleSentence(tiny, "kg", 2.5), "Curl adds 0.5 kg, less than your smallest jump, so its weight stays the same.");
const range = bench("range");
range.sets = range.sets.concat([structuredClone(range.sets[0])]).map((s) => ({ ...s, reps: { min: 3, max: 5 } }) as typeof s);
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 2.5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");
assert.equal(ruleSentence({ ...range, sets: range.sets.slice(0, 1) }, "kg", 2.5), "Bench press goes up 2.5 kg once your set reaches 5 reps, then the reps go back to 3.");
const mixed = structuredClone(range);
mixed.sets[0] = { kind: "fixed", reps: { min: 6, max: 10 }, rest: 120 };
assert.equal(ruleSentence(mixed, "kg", 2.5), "Bench press goes up 2.5 kg once every set reaches the top of its range, then the reps go back to the bottom.");
if (range.rule?.kind === "range") range.rule.incKg = 5;
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");
const pct = bench("percent");
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% of your bench press max. It moves when you change the max.");
pct.sets[2] = { kind: "pct", pct: 0.85, reps: 3, rest: 120 };
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% to 85% of your bench press max. It moves when you change the max.");
assert.equal(ruleSentence(bench("rpe"), "kg", 2.5), "Bench press is worked out for RPE 8 from your best logged set.");
assert.equal(ruleSentence(bench("manual"), "kg", 2.5), "Bench press stays at the weight you choose.");

// A member program gives one line per distinct rule.
const mine = blankMemberTemplate();
mine.engine = { key: "own_rules" };
mine.weeks = [
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("percent")] }] },
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("manual")] }] },
];
assert.deepEqual(howWeightsMove(mine, "kg", 2.5), [
  "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.",
  "Bench press is 75% of your bench press max. It moves when you change the max.",
  "Bench press stays at the weight you choose.",
]);

console.log("programs/progressionText: ok");
```

Create `app/src/lib/programs/outline.test.ts`:

```ts
// app/src/lib/programs/outline.test.ts
// Run: npm test -- src/lib/programs/outline.test.ts
//
// Session length against hand-worked programs, the typical week and whole
// program outlines, the first week with real weights, training dates, the
// card tags and the line on why a weight is what it is.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { daySeconds, firstSets, firstWeek, focusTag, lengthTag, sessionMinutes, shortDate, trainingDates, typicalWeek, weightWhy, wholeProgram } from "./outline";
import { planExercise } from "./planner";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { STEP_5LB_KG } from "./units";

const get = (key: string) => platformProgram(key)!;

// ── session length: sets x (40 s + rest), averaged over every day, to the nearest 5 minutes ──
// StrongLifts: A is 15 sets at 180 s rest (55 min), B is 11 sets (40.3 min). Three of each: 47.7, so 50.
assert.equal(daySeconds(get("stronglifts-5x5").weeks[0].days[0]), 15 * 220);
assert.equal(daySeconds(get("stronglifts-5x5").weeks[0].days[1]), 11 * 220);
assert.equal(sessionMinutes(get("stronglifts-5x5")), 50);
// Smolov base: weeks 1 to 3 are 26 sets at 180 s (5720 s a week), the test day is 5 sets with 990 s of rest. 13 days: 23.5, so 25.
assert.equal(sessionMinutes(get("smolov-base")), 25);
// GVT: every day is 20 sets at 90 s and 6 at 60 s, 3200 s: 53.3, so 55.
assert.equal(sessionMinutes(get("german-volume-training")), 55);
assert.equal(sessionMinutes({ weeks: [{ days: [{ name: "Short", exercises: [{ name: "Plank", sets: [{ kind: "fixed", reps: 1, rest: 0 }] }] }] }] }), 5, "never under 5 minutes");
assert.equal(sessionMinutes({ weeks: [] }), 5);
for (const t of PLATFORM_PROGRAMS) {
  const m = sessionMinutes(t);
  assert.ok(m >= 5 && m <= 180 && m % 5 === 0, `${t.key}: ${m} min`);
}

// ── outlines ──
const smolov = wholeProgram(get("smolov-base"));
assert.equal(smolov.length, 4);
assert.equal(smolov[1].title, "Week 2: Base, plus 10 kg");
assert.deepEqual(smolov[1].days[0], { name: "Day 1", test: false, lines: [{ name: "Back squat", rx: "4 x 9 at 70% + 10 kg", joined: false, notes: null }] });
assert.equal(smolov[3].days[0].test, true);
assert.equal(wholeProgram(get("gzclp"))[0].title, "Week 1");
const tw = typicalWeek(get("smolov-base"));
assert.deepEqual(tw.map((d) => d.lines[0].rx), ["4 x 9 at 70%", "5 x 7 at 75%", "7 x 5 at 80%", "10 x 3 at 85%"]);
assert.equal(typicalWeek(get("gzclp"))[0].lines[0].rx, "4 x 3, then 1 x 3+", "GZCLP shows the first rep scheme");
const gvt = typicalWeek(get("german-volume-training"))[0];
assert.equal(gvt.lines[1].joined, true, "a superset is marked");
assert.ok(gvt.lines[0].notes?.startsWith("Lower for four seconds"));

// ── card tags ──
assert.equal(focusTag(get("smolov-base")), "Squat");
assert.equal(focusTag(get("smolov-jr-bench")), "Bench press");
assert.equal(focusTag(get("stronglifts-5x5")), "5 lifts");
assert.equal(focusTag(get("phul")), "Rep ranges");
assert.equal(lengthTag(get("smolov-base"), false), "4 weeks");
assert.equal(lengthTag(get("531-bbb"), true), "Repeats every 4 weeks");
assert.equal(lengthTag(get("phul"), true), "Repeats weekly");

// ── the first week with real weights ──
const fw = firstWeek(get("smolov-base"), { squat: 140 }, 2.5, "kg");
assert.deepEqual(fw.map((d) => d.lines[0]), ["Back squat 4 x 9 at 97.5 kg", "Back squat 5 x 7 at 105 kg", "Back squat 7 x 5 at 112.5 kg", "Back squat 10 x 3 at 120 kg"]);
assert.deepEqual(firstWeek(get("stronglifts-5x5"), { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5, "kg")[0].lines, [
  "Back squat 5 x 5 at 50 kg",
  "Bench press 5 x 5 at 40 kg",
  "Barbell row 5 x 5 at 35 kg",
]);
assert.equal(firstWeek(get("phul"), {}, 2.5, "kg")[0].lines[0], "Bench press 4 x 3-5, you pick the weight");
assert.equal(firstWeek(get("greyskull-lp"), { bench: 80, row: 70, squat: 100, press: 50, deadlift: 120 }, 2.5, "kg")[1].lines[1], "Chin-up 2 x 5, then 1 x 5+, bodyweight");
assert.equal(firstSets(get("smolov-base"), "squat", 140, 2.5, "kg"), "4 x 9 at 97.5 kg");
assert.equal(firstSets(get("smolov-base"), "squat", 140, STEP_5LB_KG, "lb"), "4 x 9 at 215 lb");
assert.equal(firstSets(get("531-bbb"), "squat", 100, 2.5, "kg"), "1 x 5 at 57.5 kg, then 1 x 5 at 67.5 kg, then 1 x 5+ at 77.5 kg", "5/3/1 uses the training max");
assert.equal(firstSets(get("smolov-base"), "bench", 100, 2.5, "kg"), null, "no exercise uses that lift");
for (const t of PLATFORM_PROGRAMS) {
  const maxes = Object.fromEntries(t.lifts.map((l) => [l, 100]));
  for (const d of firstWeek(t, maxes, 2.5, "kg")) for (const l of d.lines) assert.ok(!/undefined|NaN|null/.test(l), `${t.key}: ${l}`);
}

// ── training dates ──
assert.deepEqual(trainingDates("2026-11-16", [1, 3, 5, 6], 4), ["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-21"]);
assert.deepEqual(trainingDates("2026-11-18", [1, 3, 5, 6], 4), ["2026-11-18", "2026-11-20", "2026-11-21", "2026-11-23"]);
assert.deepEqual(trainingDates("2026-11-16", [], 3), []);
assert.equal(shortDate("2026-11-16"), "Mon 16 Nov");

// ── why a planned weight is what it is ──
const sm = get("smolov-base");
const st = initState(sm, { squat: 140 }, 2.5);
const wk2 = planExercise(sm.weeks[1].days[0].exercises[0], 0, { ...st, week: 1, day: 0 }, { stepKg: 2.5 });
assert.equal(weightWhy(wk2, sm.weeks[1].days[0].exercises[0], sm.tmPct, "kg"), "70% of your max, plus 10 kg this week.");
const bbb = get("531-bbb");
const bst = initState(bbb, { press: 60, deadlift: 160, bench: 100, squat: 140 }, 2.5);
const main = planExercise(bbb.weeks[0].days[0].exercises[0], 0, bst, { stepKg: 2.5 });
assert.equal(weightWhy(main, bbb.weeks[0].days[0].exercises[0], bbb.tmPct, "kg"), "65% to 85% of your training max.");
const sl = get("stronglifts-5x5");
const slPlan = planExercise(sl.weeks[0].days[0].exercises[0], 0, initState(sl, { squat: 100 }, 2.5), { stepKg: 2.5 });
assert.equal(weightWhy(slPlan, sl.weeks[0].days[0].exercises[0], sl.tmPct, "kg"), null, "a working weight needs no line");
const chin = planExercise(bbb.weeks[0].days[0].exercises[2], 2, bst, { stepKg: 2.5 });
assert.equal(weightWhy(chin, bbb.weeks[0].days[0].exercises[2], bbb.tmPct, "kg"), "Bodyweight.");

console.log("programs/outline: ok");
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd app && npm test -- src/lib/programs/progressionText.test.ts && npm test -- src/lib/programs/outline.test.ts`
Expected: FAIL with `Cannot find module './progressionText'` (and `'./outline'`).

- [ ] **Step 3: Write how your weights move**

Create `app/src/lib/programs/progressionText.ts`:

```ts
// app/src/lib/programs/progressionText.ts
/**
 * "How your weights move", built from the engine settings and the exercise
 * rules, so it always says what the app does. Weights are in the member's
 * unit; a jump the engine rounds to the member's smallest jump is shown
 * rounded. Pure.
 */
import { listText } from "./content";
import { barKg } from "./engines";
import { progresses, schemeLabel } from "./planner";
import { LIFT_LABEL, OWN_DELOAD_PCT, type ExerciseRx, type LiftKey, type ProgramTemplate, type SetRx, type WeightUnit } from "./types";
import { formatWeight, roundToStep } from "./units";

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;
const allSets = (ex: ExerciseRx): SetRx[] => [...ex.sets, ...(ex.stages ?? []).flat()];
const exercises = (t: Pick<ProgramTemplate, "weeks">): ExerciseRx[] => t.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises));
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/** A weight jump after rounding to the member's smallest jump; null when it rounds to nothing. */
function stepJump(incKg: number, unit: WeightUnit, stepKg: number): string | null {
  const j = roundToStep(incKg, stepKg);
  return j > 0 ? formatWeight(j, unit) : null;
}

/** "2.5 kg", or "2.5 kg, or 5 kg on the deadlift": one jump per group of lifts, the default first. */
function jumpsByLift(lifts: LiftKey[], base: number, per: Partial<Record<LiftKey, number>> | undefined, show: (kg: number) => string | null): string | null {
  const groups = new Map<string, LiftKey[]>();
  const baseText = show(base);
  for (const lift of lifts) {
    const text = show(per?.[lift] ?? base);
    if (text === null) continue;
    groups.set(text, [...(groups.get(text) ?? []), lift]);
  }
  if (groups.size === 0) return null;
  const first = baseText !== null && groups.has(baseText) ? baseText : [...groups.keys()][0];
  const rest = [...groups.entries()].filter(([text]) => text !== first);
  if (rest.length === 0) return first;
  return `${first}, or ${rest.map(([text, ls]) => `${text} on the ${listText(ls.map((l) => LIFT_LABEL[l].toLowerCase()))}`).join(", or ")}`;
}

/** The lifts whose weights the engine moves, in the program's order. */
function movingLifts(t: ProgramTemplate): LiftKey[] {
  const used = new Set(exercises(t).filter((ex) => ex.lift && (progresses(ex) || allSets(ex).some((s) => s.kind === "pct" || s.kind === "amrap"))).map((ex) => ex.lift as LiftKey));
  return t.lifts.filter((l) => used.has(l));
}

/** Lines for exercises the program does not move: bodyweight ones, and fixed-weight ones it leaves alone. */
function leftAlone(t: ProgramTemplate): string[] {
  const all = exercises(t);
  const bw = unique(all.filter((ex) => ex.bodyweight).map((ex) => ex.name.toLowerCase()));
  const block = t.engine.key === "fixed_block";
  // A name that progresses somewhere else (PHAT's speed sets) is left out, so the line never contradicts the rest.
  const moving = new Set(block ? [] : all.filter((ex) => progresses(ex)).map((ex) => ex.name.toLowerCase()));
  const picked = unique(
    all
      .filter((ex) => !ex.bodyweight && ex.sets.every((s) => s.kind === "fixed" || s.kind === "same_as_last") && (block || !progresses(ex)))
      .map((ex) => ex.name.toLowerCase())
      .filter((n) => !moving.has(n)),
  );
  const out: string[] = [];
  if (picked.length) out.push(`You pick the weight for ${listText(picked)}. The program does not change it.`);
  if (bw.length) out.push(`${cap(listText(bw))} ${bw.length === 1 ? "is" : "are"} bodyweight. Add reps when you can.`);
  return out;
}

/** "Miss reps three sessions in a row and that lift drops 10%." */
function deloadLine(after: number, pct: number): string {
  const p = Math.round(pct * 100);
  return after <= 1 ? `Fall short on any set and that lift drops ${p}% next time.` : `Miss reps ${word(after)} sessions in a row and that lift drops ${p}%.`;
}

function startLine(t: ProgramTemplate, startPct: number): string {
  return `Each lift starts at ${pctText(startPct)} of your ${t.tmPct === 1 ? "max" : "training max"}.`;
}

/** One sentence on how a member-built exercise moves, for the builder sheet and the program page. */
export function ruleSentence(ex: ExerciseRx, unit: WeightUnit, stepKg: number): string {
  const r = ex.rule;
  const name = ex.name.trim() || "This exercise";
  const n = ex.sets.length;
  if (!r) return `${name} follows the program.`;
  switch (r.kind) {
    case "linear": {
      const jump = stepJump(r.incKg, unit, stepKg);
      const misses = r.deloadAfter <= 1 ? "a miss" : `${word(r.deloadAfter)} misses in a row`;
      if (jump === null) return `${name} adds ${formatWeight(r.incKg, unit)}, less than your smallest jump, so its weight stays the same.`;
      return `${name} goes up ${jump} after a session with every rep, and drops ${Math.round(OWN_DELOAD_PCT * 100)}% after ${misses}.`;
    }
    case "range": {
      const jump = stepJump(r.incKg ?? stepKg, unit, stepKg) ?? formatWeight(stepKg, unit);
      const tops = unique(ex.sets.map((s) => (s.kind === "fixed" && typeof s.reps !== "number" ? s.reps.max : null)));
      const bottoms = unique(ex.sets.map((s) => (s.kind === "fixed" ? (typeof s.reps === "number" ? s.reps : s.reps.min) : null)));
      const when = tops.length === 1 && tops[0] !== null ? (n === 1 ? `your set reaches ${tops[0]} reps` : `all ${n} sets reach ${tops[0]} reps`) : "every set reaches the top of its range";
      const back = bottoms.length === 1 && bottoms[0] !== null ? `the reps go back to ${bottoms[0]}` : "the reps go back to the bottom";
      return `${name} goes up ${jump} once ${when}, then ${back}.`;
    }
    case "percent": {
      const pcts = unique(ex.sets.flatMap((s) => (s.kind === "pct" || s.kind === "amrap" ? [s.pct] : []))).sort((a, b) => a - b);
      const range = pcts.length === 0 ? "a percentage" : pcts.length === 1 ? pctText(pcts[0]) : `${pctText(pcts[0])} to ${pctText(pcts[pcts.length - 1])}`;
      const lift = ex.lift ? LIFT_LABEL[ex.lift].toLowerCase() : "lift";
      return `${name} is ${range} of your ${lift} max. It moves when you change the max.`;
    }
    case "rpe": {
      const rpes = unique(ex.sets.flatMap((s) => (s.kind === "rpe" ? [s.rpe] : []))).sort((a, b) => a - b);
      const at = rpes.length <= 1 ? `RPE ${rpes[0] ?? 8}` : `RPE ${rpes[0]} to ${rpes[rpes.length - 1]}`;
      return `${name} is worked out for ${at} from your best logged set.`;
    }
    case "manual":
      return `${name} stays at the weight you choose.`;
    default: {
      const never: never = r;
      return never;
    }
  }
}

function linearLines(t: ProgramTemplate, e: Extract<ProgramTemplate["engine"], { key: "linear" }>, unit: WeightUnit, stepKg: number): string[] {
  const lines = [startLine(t, e.startPct)];
  const jumps = jumpsByLift(movingLifts(t), e.increment, e.increments, (kg) => stepJump(kg, unit, stepKg));
  if (jumps) lines.push(`Get every rep on every set and the weight goes up next time: ${jumps}.`);
  if (e.doubleAt !== undefined) lines.push(`${cap(word(e.doubleAt))} or more reps on the last set doubles the jump.`);
  lines.push(deloadLine(e.deloadAfter, e.deloadPct));
  lines.push(`A lift never drops below the empty bar (${formatWeight(barKg(stepKg), unit)}).`);
  return lines;
}

function tmLines(t: ProgramTemplate, e: Extract<ProgramTemplate["engine"], { key: "tm_cycle" }>, unit: WeightUnit, stepKg: number): string[] {
  const lines: string[] = [];
  const raw = (kg: number) => (kg > 0 ? formatWeight(kg, unit) : null);
  const driveReps = unique(exercises(t).flatMap((ex) => ex.sets.flatMap((s) => ((s.kind === "pct" || s.kind === "amrap") && s.drives ? [s.reps] : []))));
  // Texas Method: a training max of 6/7 of the max is the Epley 5-rep max.
  const repMax = e.rule === "drive_set" && driveReps.length === 1 && Math.abs(t.tmPct - 30 / (30 + driveReps[0])) < 0.005 ? driveReps[0] : null;
  if (repMax !== null) lines.push(`Your training max is your ${repMax}-rep max, about ${Math.round(t.tmPct * 100)}% of your max. Every percentage is taken from it.`);
  else if (t.tmPct !== 1) lines.push(`Your training max is ${Math.round(t.tmPct * 100)}% of your max. Every percentage is taken from it.`);
  switch (e.rule) {
    case "cycle": {
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, raw);
      if (exercises(t).some((ex) => ex.sets.some((s) => s.kind === "amrap"))) lines.push("The last set of each main lift is as many reps as you can.");
      if (jumps) lines.push(`After each ${word(t.weeks.length)}-week cycle, your training max goes up ${jumps}.`);
      lines.push("If a lift's last set falls short of its reps, is lighter than planned or is not logged, that lift's training max stays the same for the next cycle.");
      break;
    }
    case "amrap_table": {
      const rows = [...(e.amrapTable ?? [])].sort((a, b) => a.minReps - b.minReps);
      const parts = rows.map((row, i) => {
        const next = rows[i + 1];
        const reps = next ? (next.minReps - 1 === row.minReps ? `${row.minReps}` : `${row.minReps} to ${next.minReps - 1}`) : `${row.minReps} or more`;
        return row.kg > 0 ? `${reps} reps adds ${formatWeight(row.kg, unit)}` : `${reps} reps changes nothing`;
      });
      if (parts.length) lines.push(`The reps on the heavy + set move your training max: ${listText(parts)}.`);
      break;
    }
    case "drive_set": {
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, raw);
      const top = driveReps.length === 1 ? `all ${driveReps[0]} reps` : "every rep";
      if (jumps) lines.push(`Get ${top} on a top set and that lift's training max goes up ${jumps}.`);
      lines.push("Miss a rep on the top set and it stays the same.");
      break;
    }
    case "gzclp": {
      const all = exercises(t);
      const tier = (k: "t1" | "t2" | "t3") => all.find((ex) => ex.tier === k);
      const t1 = tier("t1");
      const t2 = tier("t2");
      const t3 = tier("t3");
      const schemes = (ex: ExerciseRx | undefined) => (ex?.stages ?? []).map(schemeLabel);
      const jumps = jumpsByLift(t.lifts, e.increment, e.increments, (kg) => stepJump(kg, unit, stepKg));
      if (t1?.startPct && t2?.startPct) lines.push(`Main lifts (T1) start at ${pctText(t1.startPct)} of your max and second lifts (T2) at ${pctText(t2.startPct)}.`);
      if (jumps) lines.push(`Hit every rep and the lift goes up next time: ${jumps}.`);
      const s1 = schemes(t1);
      if (s1.length >= 2) lines.push(`Miss on a main lift and it moves on to ${s1.slice(1).join(", then ")} at the same weight. Miss on ${s1[s1.length - 1]} and it goes back to ${s1[0]} at 85% of that weight.`);
      const s2 = schemes(t2);
      const reset = stepJump(e.t2ResetKg ?? 5, unit, stepKg);
      if (s2.length >= 2 && reset) lines.push(`Miss on a second lift and it moves on to ${s2.slice(1).join(", then ")}. After ${s2[s2.length - 1]} it goes back to ${s2[0]}, ${reset} heavier than it last started.`);
      if (t3) lines.push(`Accessories (T3) go up ${formatWeight(stepKg, unit)} once the last set reaches ${e.t3AmrapTarget ?? 25} reps.`);
      break;
    }
  }
  return lines;
}

function blockLines(t: ProgramTemplate, unit: WeightUnit): string[] {
  const lines = [`Every weight is a percentage of the ${t.tmPct === 1 ? "max" : "training max"} you enter.`];
  const addOf = (s: SetRx) => (s.kind === "pct" || s.kind === "amrap" ? (s.addKg ?? 0) : 0);
  const adds = t.weeks
    .map((w, i) => ({ week: i + 1, kg: Math.max(0, ...w.days.flatMap((d) => d.exercises.flatMap((ex) => ex.sets.map(addOf)))) }))
    .filter((a) => a.kg > 0);
  if (adds.length) lines.push(`${cap(listText(adds.map((a) => `week ${a.week} adds ${formatWeight(a.kg, unit)}`)))} to every set.`);
  lines.push("The weights are set from the start. They do not change with how a session goes.");
  if (t.weeks.some((w) => w.days.some((d) => d.test))) lines.push("The test day reads your new max from your best set. Start the block again from it.");
  return lines;
}

/** "How your weights move": plain sentences for the program page. */
export function howWeightsMove(t: ProgramTemplate, unit: WeightUnit, stepKg: number): string[] {
  const e = t.engine;
  switch (e.key) {
    case "linear":
      return [...linearLines(t, e, unit, stepKg), ...leftAlone(t)];
    case "tm_cycle":
      return [...tmLines(t, e, unit, stepKg), ...leftAlone(t)];
    case "fixed_block":
      return [...blockLines(t, unit), ...leftAlone(t)];
    case "double_progression":
      return [
        "You pick each starting weight.",
        `When every set reaches the top of its rep range, the weight goes up ${formatWeight(stepKg, unit)} and the reps go back to the bottom.`,
        ...leftAlone(t),
      ];
    case "fixed_volume": {
      const jump = stepJump(e.increment, unit, stepKg);
      const lines = [startLine(t, e.startPct)];
      const own = unique(exercises(t).filter((ex) => !ex.lift && progresses(ex)).map((ex) => ex.name.toLowerCase()));
      if (own.length) lines.push(`You pick the starting weight for ${listText(own)}.`);
      if (jump) lines.push(`Get every rep on every set and the weight goes up ${jump} next time. Until then it stays the same.`);
      return [...lines, ...leftAlone(t)];
    }
    case "own_rules":
      return unique(exercises(t).map((ex) => ruleSentence(ex, unit, stepKg)));
    default: {
      const never: never = e;
      return never;
    }
  }
}
```

- [ ] **Step 4: Write the outline**

Create `app/src/lib/programs/outline.ts`:

```ts
// app/src/lib/programs/outline.ts
/**
 * The program page's outline: session length, a typical week, every week as
 * prescribed, the first week with a member's real weights, and the line on
 * why a planned weight is what it is. Pure: safe in client components.
 */
import { initState } from "./engines";
import { planExercise, setsFor, summarisePlanned, summariseRx } from "./planner";
import { LIFT_LABEL, type DayRx, type ExerciseRx, type LiftKey, type PlannedExercise, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight } from "./units";
import { WEEKDAY_SHORT, addDays, isoWeekday } from "@/lib/trainingProgress";

/** The time a set takes, before its rest. */
export const SECONDS_PER_SET = 40;

/** One day's estimated seconds: every set's 40 s plus its rest, at each exercise's first rep scheme. */
export function daySeconds(d: DayRx): number {
  return d.exercises.reduce((n, ex) => n + setsFor(ex, {}).reduce((m, s) => m + SECONDS_PER_SET + s.rest, 0), 0);
}

/** The average session across every day of the program, to the nearest 5 minutes (at least 5). */
export function sessionMinutes(t: Pick<ProgramTemplate, "weeks">): number {
  const days = t.weeks.flatMap((w) => w.days);
  if (days.length === 0) return 5;
  const avg = days.reduce((n, d) => n + daySeconds(d), 0) / days.length / 60;
  return Math.max(5, Math.round(avg / 5) * 5);
}

export interface OutlineLine {
  name: string;
  rx: string;
  joined: boolean;
  notes: string | null;
}

export interface OutlineDay {
  name: string;
  test: boolean;
  lines: OutlineLine[];
}

export interface OutlineWeek {
  title: string;
  days: OutlineDay[];
}

function outlineDay(d: DayRx): OutlineDay {
  return {
    name: d.name,
    test: d.test === true,
    lines: d.exercises.map((ex) => ({ name: ex.name, rx: summariseRx(setsFor(ex, {})), joined: ex.joined === true, notes: ex.notes ?? null })),
  };
}

/** Every week as prescribed: "Week 2: Base, plus 10 kg", its days, and each exercise's sets. */
export function wholeProgram(t: Pick<ProgramTemplate, "weeks">): OutlineWeek[] {
  return t.weeks.map((w, i) => ({ title: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}`, days: w.days.map(outlineDay) }));
}

/** The first week of the cycle, day by day. */
export function typicalWeek(t: Pick<ProgramTemplate, "weeks">): OutlineDay[] {
  return (t.weeks[0]?.days ?? []).map(outlineDay);
}

/** The pill on a card: the one lift a program is about, how many lifts it takes a max for, or rep ranges. */
export function focusTag(t: Pick<ProgramTemplate, "lifts">): string {
  if (t.lifts.length === 1) return LIFT_LABEL[t.lifts[0]];
  if (t.lifts.length > 1) return `${t.lifts.length} lifts`;
  return "Rep ranges";
}

/** "12 weeks", "Repeats weekly", "Repeats every 4 weeks". */
export function lengthTag(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, repeats: boolean): string {
  if (!repeats) return `${t.lengthWeeks} ${t.lengthWeeks === 1 ? "week" : "weeks"}`;
  return t.weeks.length === 1 ? "Repeats weekly" : `Repeats every ${t.weeks.length} weeks`;
}

export interface PreviewDay {
  name: string;
  test: boolean;
  lines: string[];
}

/** Week 1 with the member's weights: "Back squat 4 x 9 at 97.5 kg". Unweighted exercises say why. */
export function firstWeek(t: ProgramTemplate, maxesKg: Partial<Record<LiftKey, number>>, stepKg: number, unit: WeightUnit): PreviewDay[] {
  const state = initState(t, maxesKg, stepKg);
  return (t.weeks[0]?.days ?? []).map((d, di) => ({
    name: d.name,
    test: d.test === true,
    lines: d.exercises.map((ex, xi) => {
      const p = planExercise(ex, xi, { ...state, week: 0, day: di }, { stepKg });
      if (p.bodyweight) return `${ex.name} ${summarisePlanned(p.sets, unit)}, bodyweight`;
      if (p.sets.every((s) => s.kg === null)) return `${ex.name} ${summarisePlanned(p.sets, unit)}, you pick the weight`;
      return `${ex.name} ${summarisePlanned(p.sets, unit)}`;
    }),
  }));
}

/** The first sets of a lift from one max: "4 x 9 at 97.5 kg". Null when no weighted exercise in week 1 uses it. */
export function firstSets(t: ProgramTemplate, lift: LiftKey, maxKg: number, stepKg: number, unit: WeightUnit): string | null {
  const state = initState(t, { [lift]: maxKg }, stepKg);
  const days = t.weeks[0]?.days ?? [];
  for (let di = 0; di < days.length; di++) {
    const xi = days[di].exercises.findIndex((ex) => ex.lift === lift && !ex.bodyweight);
    if (xi === -1) continue;
    const p = planExercise(days[di].exercises[xi], xi, { ...state, week: 0, day: di }, { stepKg });
    if (p.sets.every((s) => s.kg === null)) continue;
    return summarisePlanned(p.sets, unit);
  }
  return null;
}

/** The next n training dates on or after the start date, on the member's weekdays (1 = Monday). Empty with no weekdays. */
export function trainingDates(startDate: string, weekdays: number[], n: number): string[] {
  if (weekdays.length === 0 || n <= 0) return [];
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 7 * (n + 1); i++) {
    const d = addDays(startDate, i);
    if (weekdays.includes(isoWeekday(d))) out.push(d);
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 16 Nov" for a date key, the same on the server and the phone. */
export function shortDate(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${WEEKDAY_SHORT[isoWeekday(key) - 1]} ${d} ${MONTHS[m - 1]}`;
}

const pctText = (p: number) => `${Math.round(p * 1000) / 10}%`;

/**
 * Why a planned weight is what it is: "75% of your max, plus 10 kg this week",
 * from the planned sets and the template exercise they came from. Null for a
 * weight the engine keeps from session to session.
 */
export function weightWhy(ex: PlannedExercise, rx: Pick<ExerciseRx, "sets"> | undefined, tmPct: number, unit: WeightUnit): string | null {
  if (ex.bodyweight) return "Bodyweight.";
  const pcts = [...new Set(ex.sets.flatMap((s) => (s.pct !== null ? [s.pct] : [])))].sort((a, b) => a - b);
  if (pcts.length) {
    const of = tmPct === 1 ? "your max" : "your training max";
    const range = pcts.length === 1 ? pctText(pcts[0]) : `${pctText(pcts[0])} to ${pctText(pcts[pcts.length - 1])}`;
    const add = Math.max(0, ...(rx?.sets ?? []).map((s) => (s.kind === "pct" || s.kind === "amrap" ? (s.addKg ?? 0) : 0)));
    return `${range} of ${of}${add > 0 ? `, plus ${formatWeight(add, unit)} this week` : ""}.`;
  }
  const rpes = [...new Set(ex.sets.flatMap((s) => (s.rpe !== null ? [s.rpe] : [])))].sort((a, b) => a - b);
  if (rpes.length) return `Worked out for RPE ${rpes.join(" and ")} from your best logged set.`;
  return null;
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/lib/programs/progressionText.test.ts && npm test -- src/lib/programs/outline.test.ts && npx tsc --noEmit -p .`
Expected: `programs/progressionText: ok`, `programs/outline: ok`, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/programs/progressionText.ts app/src/lib/programs/progressionText.test.ts app/src/lib/programs/outline.ts app/src/lib/programs/outline.test.ts
git commit -m "$(cat <<'MSG'
feat(programs): generated weight rules, session length and program outline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: Content for the beginner and strength programs (7)

**Files:**
- Test: `app/src/lib/programs/templates/content.test.ts` (create)
- Modify: `app/src/lib/programs/templates/stronglifts.ts`, `startingStrength.ts`, `greyskull.ts`, `wendler.ts` (both programs), `texas.ts`, `gzclp.ts`

**Interfaces:**
- Consumes: `contentErrors` (Task 1), the `summary`, `phases`, `phasesRepeat`, `whyItWorks` fields (Task 1).
- Produces: content on `stronglifts-5x5`, `starting-strength`, `greyskull-lp`, `531-bbb`, `531-fsl`, `texas-method`, `gzclp`. `531-bbb`, `531-fsl` and `texas-method` repeat (`phasesRepeat: true`, phases over their 4 and 2 template weeks); the other four describe their 12-week length.

The text below was written against each template's data (sets, percentages, weeks, engine settings) and the house rules: plain, short, factual sentences in our own words, no claimed results, and "-style" programs say the numbers are ours. Paste it exactly; if a number in it does not match the template file in front of you, stop and report it rather than changing either.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/templates/content.test.ts`:

```ts
// app/src/lib/programs/templates/content.test.ts
// Run: npm test -- src/lib/programs/templates/content.test.ts
//
// Every platform program explains itself: a summary, phases from week 1 to
// its length (or one cycle when it repeats) with a note each, and why it
// works. The words follow the house rules.
import assert from "node:assert/strict";

import { contentErrors } from "../content";
import { PLATFORM_PROGRAMS } from "../registry";

// The programs written so far; Task 5 checks every platform program.
const WRITTEN = new Set(["stronglifts-5x5", "starting-strength", "greyskull-lp", "531-bbb", "531-fsl", "texas-method", "gzclp"]);
const programs = PLATFORM_PROGRAMS.filter((t) => WRITTEN.has(t.key));
assert.equal(programs.length, WRITTEN.size);

const CLAIMS = /\byou will\b|\bguarantee|\bproven\b|\bfastest\b|\bnot just\b|\brather than\b/i;
for (const t of programs) {
  assert.deepEqual(contentErrors(t), [], t.key);
  const words = [t.summary!, t.whyItWorks!, ...t.phases!.flatMap((p) => [p.name, p.note])];
  for (const w of words) {
    assert.ok(!CLAIMS.test(w), `${t.key}: no claims or filler: ${w}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(w), `${t.key}: no emojis`);
    assert.ok(w === w.trim() && !/\s{2,}/.test(w), `${t.key}: tidy spacing: ${w}`);
  }
  assert.ok(t.summary!.length <= 200, `${t.key}: summary fits the card`);
  // "-style" and "After ..." programs say the numbers or workouts are ours.
  if (/-style/i.test(t.name)) assert.ok(/\bours\b/.test(t.whyItWorks!), `${t.key}: says the numbers are ours`);
}

console.log(`programs/templates content: ${programs.length} programs ok`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts`
Expected: FAIL, the message naming `stronglifts-5x5` (it has no summary, why it works or phases yet).

- [ ] **Step 3: Write the content into the templates**

In `app/src/lib/programs/templates/stronglifts.ts`, insert these lines inside `export const strongLifts`, directly above its line `  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },`:

```ts
  summary: "Three full-body sessions a week, five sets of five on most lifts, a little heavier every session.",
  phases: [
    { name: "Light start", fromWeek: 1, toWeek: 2, note: "The weights start at half your max. Use these sessions to practise each lift." },
    { name: "Steady climb", fromWeek: 3, toWeek: 12, note: "Each lift goes up every session you get all your reps. The sessions get harder as the weights near your max." },
  ],
  whyItWorks:
    "You do the same five lifts often, and each one gets a little heavier every time. You squat every session, so the squat gets the most practice. When a lift stalls, the 10% drop gives you a few lighter sessions before you try the weight again.",
```

In `app/src/lib/programs/templates/startingStrength.ts`, insert these lines inside `export const startingStrength`, directly above its line `  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },`:

```ts
  summary: "Three short sessions a week on the squat, press, bench and deadlift, a little heavier every session.",
  phases: [
    { name: "Light start", fromWeek: 1, toWeek: 2, note: "The weights start at half your max. Use these sessions to settle your technique." },
    { name: "Steady climb", fromWeek: 3, toWeek: 12, note: "Each lift goes up every session you get all your reps. You squat every session; the press and bench take turns." },
  ],
  whyItWorks:
    "Three sets of five is enough work to earn the next jump without long sessions. The press and bench take turns, so each gets a rest between sessions. One set of deadlifts keeps the sessions short.",
```

In `app/src/lib/programs/templates/greyskull.ts`, insert these lines inside `export const greyskullLp`, directly above its line `  engine: { key: "linear", increment: 1.25, increments: { squat: 2.5, deadlift: 2.5 }, deloadAfter: 1, deloadPct: 0.1, startPct: 0.5, doubleAt: 10 },`:

```ts
  summary: "Three full-body sessions a week. Two sets of five, then a last set for as many reps as you can.",
  phases: [
    { name: "Light start", fromWeek: 1, toWeek: 2, note: "The weights start at half your max, so expect big last sets." },
    { name: "Steady climb", fromWeek: 3, toWeek: 12, note: "Each lift goes up every session you get five on every set. Fall short and it drops 10% straight away." },
  ],
  whyItWorks:
    "The last set tells the program how much you have left. Ten or more reps on it means a bigger jump next time. A short set drops the weight at once, so you do not keep grinding at a weight you cannot finish.",
```

In `app/src/lib/programs/templates/texas.ts`, insert these lines inside `export const texasMethod`, directly above its line `  engine: { key: "tm_cycle", rule: "drive_set", increment: 2.5, increments: { deadlift: 5 } },`:

```ts
  summary: "Three days a week: a volume day, a light day, and an intensity day with a top set of five.",
  phases: [
    { name: "Bench week", fromWeek: 1, toWeek: 1, note: "Squat and bench on the volume and intensity days, press on the light day. Deadlift on the volume day." },
    { name: "Press week", fromWeek: 2, toWeek: 2, note: "Squat and press on the volume and intensity days, bench on the light day. Deadlift on the volume day." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "The volume day does the hard work, the light day keeps you moving while you recover, and the intensity day shows where you are. The volume sets are 90% of your 5-rep max. Each top set of five you finish raises that lift for the next week.",
```

In `app/src/lib/programs/templates/gzclp.ts`, insert these lines inside `export const gzclp`, directly above its line `  engine: { key: "tm_cycle", rule: "gzclp", increment: 2.5, increments: { squat: 5, deadlift: 5 }, t2ResetKg: 5, t3AmrapTarget: 25 },`:

```ts
  summary: "Four workouts in rotation, each with a heavy main lift, a lighter second lift and an accessory.",
  phases: [
    { name: "Settle in", fromWeek: 1, toWeek: 2, note: "Main lifts start at 73% of your max and second lifts at 55%. Pick light weights for the accessories." },
    { name: "Build", fromWeek: 3, toWeek: 12, note: "Each lift moves on its own: up when you hit your reps, on to its next rep scheme when you miss." },
  ],
  whyItWorks:
    "Each lift has a plan for when it stalls: the same weight with fewer reps per set, before any weight comes off. The three tiers split each session into heavy, medium and light work. Each main lift is trained heavy once every four sessions.",
```

In `app/src/lib/programs/templates/wendler.ts`, insert these lines inside `export const wendlerBbb`, directly above its line `  weeks: wendler(`:

```ts
  summary: "Four days a week, one main lift a day, then five sets of ten. The training max goes up each cycle.",
  phases: [
    { name: "5s week", fromWeek: 1, toWeek: 1, note: "Sets of five at 65%, 75% and 85% of your training max, the last one for as many reps as you can. Then 5 x 10 at 50%." },
    { name: "3s week", fromWeek: 2, toWeek: 2, note: "Sets of three at 70%, 80% and 90%, the last one for as many reps as you can. Then 5 x 10 at 50%." },
    { name: "5/3/1 week", fromWeek: 3, toWeek: 3, note: "Five at 75%, three at 85%, then as many as you can at 95%. Then 5 x 10 at 50%. The heaviest week." },
    { name: "Deload", fromWeek: 4, toWeek: 4, note: "Light sets of five at 40%, 50% and 60%, and no 5 x 10. The next cycle starts after it." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "Your training max is 90% of your max, so the main sets start lighter than you can lift. That leaves room to beat the reps on the last set. The training max rises a little each cycle, which keeps the climb slow and steady. The 5 x 10 adds volume for size.",
```

In `app/src/lib/programs/templates/wendler.ts`, insert these lines inside `export const wendlerFsl`, directly above its line `  weeks: wendler(`:

```ts
  summary: "Four days a week, one main lift a day, then five sets of five at your first set's weight.",
  phases: [
    { name: "5s week", fromWeek: 1, toWeek: 1, note: "Sets of five at 65%, 75% and 85% of your training max, the last one for as many reps as you can. Then 5 x 5 at 65%." },
    { name: "3s week", fromWeek: 2, toWeek: 2, note: "Sets of three at 70%, 80% and 90%, the last one for as many reps as you can. Then 5 x 5 at 70%." },
    { name: "5/3/1 week", fromWeek: 3, toWeek: 3, note: "Five at 75%, three at 85%, then as many as you can at 95%. Then 5 x 5 at 75%. The heaviest week." },
    { name: "Deload", fromWeek: 4, toWeek: 4, note: "Light sets of five at 40%, 50% and 60%, and no 5 x 5. The next cycle starts after it." },
  ],
  phasesRepeat: true,
  whyItWorks:
    "The extra sets use the lightest weight of the day, so you get more practice at the main lift without much extra strain. The sessions stay shorter than Boring But Big. The training max starts at 90% of your max and rises a little each cycle.",
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts && npm test -- src/lib/programs/registry.test.ts && npm test -- src/lib/programs/preview.test.ts && npm test -- src/lib/programs/content.test.ts && npx tsc --noEmit -p .`
Expected: `programs/templates content: 7 programs ok`; the registry, preview and content tests pass; no type errors. Also run `cd app && npm test -- src/lib/programs/templates/beginner.test.ts && npm test -- src/lib/programs/templates/strength.test.ts`: both still pass (no sets changed).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/templates/content.test.ts app/src/lib/programs/templates/stronglifts.ts app/src/lib/programs/templates/startingStrength.ts app/src/lib/programs/templates/greyskull.ts app/src/lib/programs/templates/wendler.ts app/src/lib/programs/templates/texas.ts app/src/lib/programs/templates/gzclp.ts
git commit -m "$(cat <<'MSG'
feat(programs): summary, phases and why it works for the beginner and strength programs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: Content for the powerlifting peaking programs (6)

**Files:**
- Modify: `app/src/lib/programs/templates/content.test.ts`
- Modify: `app/src/lib/programs/templates/smolov.ts` (base and the Smolov Jr builder), `rsr.ts`, `candito.ts`, `sheiko.ts`
- Modify: `app/src/lib/programs/library.test.ts` (an old copy of Smolov takes the original's content)

**Interfaces:**
- Consumes: Task 1's fields, `withContentFrom` in `library.ts` (Task 1), the content test (Task 3).
- Produces: content on `smolov-base`, `smolov-jr-squat`, `smolov-jr-bench`, `russian-squat-routine`, `candito-style-6-week`, `sheiko-style`. All are full blocks (weeks = length), so none repeats. Smolov Jr's text is built from the lift name and the two weekly add-ons that `smolovJr(...)` is called with, so the squat and bench versions each say their own numbers (5 and 10 kg, 2.5 and 5 kg).

The text below was written against each template's data (sets, percentages, weeks, engine settings) and the house rules: plain, short, factual sentences in our own words, no claimed results, and "-style" programs say the numbers are ours. Paste it exactly; if a number in it does not match the template file in front of you, stop and report it rather than changing either.

- [ ] **Step 1: Write the failing tests**

In `app/src/lib/programs/templates/content.test.ts`, replace the line

```ts
const WRITTEN = new Set(["stronglifts-5x5", "starting-strength", "greyskull-lp", "531-bbb", "531-fsl", "texas-method", "gzclp"]);
```

with

```ts
const WRITTEN = new Set(["stronglifts-5x5", "starting-strength", "greyskull-lp", "531-bbb", "531-fsl", "texas-method", "gzclp", "smolov-base", "smolov-jr-squat", "smolov-jr-bench", "russian-squat-routine", "candito-style-6-week", "sheiko-style"]);
```

In `app/src/lib/programs/library.test.ts`, insert directly above the line `      // ── a copy's own summary, phases and why it works survive a save ──`:

```ts
      // ── a copy saved before programs had content takes the original's ──
      {
        const { db: odb } = requireLocal("../db") as typeof import("../db");
        const { programTemplates: pt } = requireLocal("../db/schema") as typeof import("../db/schema");
        const { platformProgram } = requireLocal("./registry") as typeof import("./registry");
        const original = platformProgram("smolov-base")!;
        const { summary: _s, phases: _p, phasesRepeat: _r, whyItWorks: _w, ...old } = original;
        const at = Date.now();
        const [row] = odb
          .insert(pt)
          .values({ basedOn: "smolov-base", engine: "fixed_block", name: "Old copy", templateJson: JSON.stringify(old), createdBy: 7, createdAt: at, updatedAt: at })
          .returning({ id: pt.id })
          .all();
        const oldCopy = lib.getCopy(row.id)!;
        assert.equal(oldCopy.template.summary, original.summary);
        assert.deepEqual(oldCopy.template.phases, original.phases);
        assert.equal(oldCopy.template.whyItWorks, original.whyItWorks);
        assert.equal(lib.deleteCopy(row.id), true);
      }

```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts`
Expected: FAIL, the message naming `smolov-base`.

- [ ] **Step 3: Write the content into the templates**

In `app/src/lib/programs/templates/smolov.ts`, insert these lines inside `export const smolovBase`, directly above its line `  engine: { key: "fixed_block" },` (two spaces of indent):

```ts
  summary: "Four squat sessions a week for three weeks, each week heavier than the last, then a test of your new max.",
  phases: [
    { name: "Base", fromWeek: 1, toWeek: 1, note: "4 x 9, 5 x 7, 7 x 5 and 10 x 3 at 70% to 85% of your max. Hard, with a lot of reps." },
    { name: "Plus 10 kg", fromWeek: 2, toWeek: 2, note: "The same four sessions with 10 kg more on every set. Sleep and eat well." },
    { name: "Plus 15 kg", fromWeek: 3, toWeek: 3, note: "The same sessions with 15 kg more than week 1. The hardest week." },
    { name: "Test", fromWeek: 4, toWeek: 4, note: "One session: work up to a new 1-rep max with a spotter or safety bars." },
  ],
  whyItWorks:
    "The same four sessions repeat for three weeks while the weight climbs, so you squat a lot of reps at 70% to 85% of your max. Fixed jumps of 10 kg and 15 kg make each week harder than the last. The test week reads your new max from your best set.",
```

In the same file, insert these lines inside `function smolovJr(...)`, in the returned object, directly above its line `    engine: { key: "fixed_block" },` (four spaces of indent). They use the function's own `name` and `adds` parameters:

```ts
    summary: `Four ${name.toLowerCase()} sessions a week for three weeks, heavier each week, then a test of your new max.`,
    phases: [
      { name: "Week 1", fromWeek: 1, toWeek: 1, note: "6 x 6, 7 x 5, 8 x 4 and 10 x 3 at 70% to 85% of your max." },
      { name: `Plus ${adds[0]} kg`, fromWeek: 2, toWeek: 2, note: `The same four sessions with ${adds[0]} kg more on every set.` },
      { name: `Plus ${adds[1]} kg`, fromWeek: 3, toWeek: 3, note: `The same sessions with ${adds[1]} kg more than week 1. The hardest week.` },
      { name: "Test", fromWeek: 4, toWeek: 4, note: "One session: work up to a new 1-rep max with a spotter or safety bars." },
    ],
    whyItWorks:
      "A short block on one lift: the same four sessions each week, with a fixed jump in weight. The sets get shorter as the percentage rises, so each day has a similar number of reps. The test week reads your new max from your best set.",
```

In `app/src/lib/programs/templates/rsr.ts`, insert these lines inside `export const russianSquatRoutine`, directly above its line `  engine: { key: "fixed_block" },`:

```ts
  summary: "Squats three times a week for six weeks: three weeks of growing sets at 80%, then three of heavier, shorter sets ending in a new max.",
  phases: [
    { name: "Volume", fromWeek: 1, toWeek: 3, note: "Every set is at 80% of your max. Every other session is 6 x 2; the sessions between grow from 6 x 3 to 6 x 6." },
    { name: "Intensity", fromWeek: 4, toWeek: 5, note: "The weight climbs to 85%, 90% and 95% while the sets and reps drop. The 6 x 2 sessions stay at 80%." },
    { name: "Test", fromWeek: 6, toWeek: 6, note: "2 x 2 at 100%, a light 6 x 2, then a single at 105% of your old max." },
  ],
  whyItWorks:
    "Most of the work sits at one weight, 80% of your max, while the reps climb. The second half raises the weight and cuts the reps, so you finish on heavy doubles and singles. The light 6 x 2 sessions keep you practising between the hard ones.",
```

In `app/src/lib/programs/templates/candito.ts`, insert these lines inside `export const canditoStyle`, directly above its line `  engine: { key: "fixed_block" },`:

```ts
  summary: "Six weeks on an upper and lower split, from sets of six and eight down to singles, ending in a test of all three lifts.",
  phases: [
    { name: "Conditioning", fromWeek: 1, toWeek: 2, note: "Sets of six and eight at 60% to 72.5% of your max." },
    { name: "Strength", fromWeek: 3, toWeek: 3, note: "Sets of four and five at 75% to 80%." },
    { name: "Heavy", fromWeek: 4, toWeek: 4, note: "Sets of two and three at 82.5% to 87.5%." },
    { name: "Peak", fromWeek: 5, toWeek: 5, note: "Doubles and singles at 90% to 95%." },
    { name: "Test", fromWeek: 6, toWeek: 6, note: "A max test of squat and bench on one day, then deadlift on another." },
  ],
  whyItWorks:
    "The reps come down each phase as the weight goes up, so you move from building work to heavy singles in six weeks. Squat, bench and deadlift each get two sessions a week. The percentages are ours, in the shape of Candito's program.",
```

In `app/src/lib/programs/templates/sheiko.ts`, insert these lines inside `export const sheikoStyle`, directly above its line `  engine: { key: "fixed_block" },`:

```ts
  summary: "Squat, bench and deadlift practised often at moderate weights, three days a week, ending in a test week.",
  phases: [
    { name: "Build", fromWeek: 1, toWeek: 3, note: "Each lift climbs through lighter sets to work sets of twos, threes and fours at 70% to 85%. You bench every session." },
    { name: "Lighter week", fromWeek: 4, toWeek: 4, note: "Fewer sets, topping out at 70%, with no accessories." },
    { name: "Test", fromWeek: 5, toWeek: 5, note: "A max test of squat and bench on one day, then deadlift on another." },
  ],
  whyItWorks:
    "You do many sets well short of failure, so each lift gets a lot of practice without grinding. A lighter week before the test lets you recover. The numbers are ours, in Sheiko's style. This is not one of his numbered programs.",
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts && npm test -- src/lib/programs/registry.test.ts && npm test -- src/lib/programs/preview.test.ts && npm test -- src/lib/programs/content.test.ts && npx tsc --noEmit -p .`
Expected: `programs/templates content: 13 programs ok`; the others pass; no type errors. Also run `cd app && npm test -- src/lib/programs/templates/peaking.test.ts && npm test -- src/lib/programs/library.test.ts`: both pass, and the library test now proves an old copy shows Smolov's summary, phases and why it works.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/templates/content.test.ts app/src/lib/programs/templates/smolov.ts app/src/lib/programs/templates/rsr.ts app/src/lib/programs/templates/candito.ts app/src/lib/programs/templates/sheiko.ts app/src/lib/programs/library.test.ts
git commit -m "$(cat <<'MSG'
feat(programs): summary, phases and why it works for the peaking programs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 5: Content for the size programs (6), and the check over all 19

**Files:**
- Modify (rewrite): `app/src/lib/programs/templates/content.test.ts`
- Modify: `app/src/lib/programs/templates/gvt.ts`, `phul.ts`, `phat.ts`, `arnold.ts`, `ppl.ts`, `hit.ts`

**Interfaces:**
- Consumes: Task 1's fields, the content test (Tasks 3 and 4).
- Produces: content on `german-volume-training`, `phul`, `phat`, `arnold-style-split`, `push-pull-legs`, `hit-style-full-body`, and the content check over every platform program (19). These run a short cycle for 12 weeks (GVT for 6), so their phases describe the first round over `lengthWeeks` and do not repeat. nSuns is not registered and gets none.

The text below was written against each template's data (sets, percentages, weeks, engine settings) and the house rules: plain, short, factual sentences in our own words, no claimed results, and "-style" programs say the numbers are ours. Paste it exactly; if a number in it does not match the template file in front of you, stop and report it rather than changing either.

- [ ] **Step 1: Write the failing test**

Replace the whole of `app/src/lib/programs/templates/content.test.ts` with:

```ts
// app/src/lib/programs/templates/content.test.ts
// Run: npm test -- src/lib/programs/templates/content.test.ts
//
// Every platform program explains itself: a summary, phases from week 1 to
// its length (or one cycle when it repeats) with a note each, and why it
// works. The words follow the house rules.
import assert from "node:assert/strict";

import { contentErrors } from "../content";
import { PLATFORM_PROGRAMS } from "../registry";

const programs = PLATFORM_PROGRAMS;
assert.equal(programs.length, 19);

const CLAIMS = /\byou will\b|\bguarantee|\bproven\b|\bfastest\b|\bnot just\b|\brather than\b/i;
for (const t of programs) {
  assert.deepEqual(contentErrors(t), [], t.key);
  const words = [t.summary!, t.whyItWorks!, ...t.phases!.flatMap((p) => [p.name, p.note])];
  for (const w of words) {
    assert.ok(!CLAIMS.test(w), `${t.key}: no claims or filler: ${w}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(w), `${t.key}: no emojis`);
    assert.ok(w === w.trim() && !/\s{2,}/.test(w), `${t.key}: tidy spacing: ${w}`);
  }
  assert.ok(t.summary!.length <= 200, `${t.key}: summary fits the card`);
  // "-style" and "After ..." programs say the numbers or workouts are ours.
  if (/-style/i.test(t.name)) assert.ok(/\bours\b/.test(t.whyItWorks!), `${t.key}: says the numbers are ours`);
}

console.log(`programs/templates content: ${programs.length} programs ok`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts`
Expected: FAIL, the message naming `german-volume-training`.

- [ ] **Step 3: Write the content into the templates**

In `app/src/lib/programs/templates/gvt.ts`, insert these lines inside `export const germanVolumeTraining`, directly above its line `  engine: { key: "fixed_volume", increment: 2.5, startPct: 0.6 },`:

```ts
  summary: "Three sessions a week of ten sets of ten on one big lift, paired with a second exercise.",
  phases: [
    { name: "First week", fromWeek: 1, toWeek: 1, note: "Ten sets of ten at 60% of your max, with 90 seconds of rest. Pick light weights for the paired exercises." },
    { name: "Build", fromWeek: 2, toWeek: 6, note: "Once you finish all 100 reps of a lift, it goes up 2.5 kg next time. Until then it stays the same." },
  ],
  whyItWorks:
    "Many sets at a moderate weight with short rest give each muscle a lot of work in one session. Pairing two exercises keeps the session moving while each one rests. The weight only goes up once every set is done, so the volume never drops.",
```

In `app/src/lib/programs/templates/phul.ts`, insert these lines inside `export const phul`, directly above its line `  engine: { key: "double_progression" },`:

```ts
  summary: "Four days a week: upper and lower power days with heavy sets, and upper and lower days with higher reps.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick a weight for each exercise that lets you reach the bottom of its rep range on every set." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "The power days use heavy sets of three to five; the hypertrophy days use sets of eight to fifteen. Each muscle gets one heavy and one higher-rep session a week. Adding reps before weight keeps every jump small.",
```

In `app/src/lib/programs/templates/phat.ts`, insert these lines inside `export const phat`, directly above its line `  engine: { key: "double_progression" },`:

```ts
  summary: "Five days a week: heavy upper and lower power days, then three higher-rep days that open with speed sets.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick a weight for each exercise that lets you reach the bottom of its rep range. Speed sets use about 65 to 70% of your power-day weight." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "The power days train strength with heavy sets of three to five. The other three days add volume in higher rep ranges, and the speed sets practise moving a lighter weight fast. Each muscle is trained twice a week.",
```

In `app/src/lib/programs/templates/arnold.ts`, insert these lines inside `export const arnoldStyle`, directly above its line `  engine: { key: "double_progression" },`:

```ts
  summary: "Six days a week: chest and back, shoulders and arms, then legs, each twice.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick a weight for each exercise that lets you reach the bottom of its rep range on every set." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "Each muscle group gets two sessions a week with plenty of sets of eight to fifteen. Pairing chest with back and shoulders with arms keeps each session to two areas. The split is his; the exercise choice and set counts are ours.",
```

In `app/src/lib/programs/templates/ppl.ts`, insert these lines inside `export const pushPullLegs`, directly above its line `  engine: { key: "double_progression" },`:

```ts
  summary: "Six days a week: push, pull and legs, each twice, with a heavier lift to open each day.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Pick a weight for each exercise that lets you reach the bottom of its rep range on every set." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "Add reps each session. When every set reaches the top of the range, the weight goes up by your smallest jump." },
  ],
  whyItWorks:
    "Each day trains muscles that work together, so the others rest while you train. Every muscle gets two sessions a week. The heavier lift comes first, while you are fresh, then the accessories in higher reps.",
```

In `app/src/lib/programs/templates/hit.ts`, insert these lines inside `export const hitStyle`, directly above its line `  engine: { key: "double_progression" },`:

```ts
  summary: "Three short full-body sessions a week. One hard set per exercise, taken to failure.",
  phases: [
    { name: "Find your weights", fromWeek: 1, toWeek: 1, note: "Warm up, then pick a weight for each exercise that lets you reach the bottom of its rep range on your one work set." },
    { name: "Build", fromWeek: 2, toWeek: 12, note: "When your work set reaches the top of the range, the weight goes up by your smallest jump next time." },
  ],
  whyItWorks:
    "One all-out set per exercise keeps the sessions short. Every session covers the whole body, with two workouts taking turns. The workouts are ours, in the high-intensity style.",
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd app && npm test -- src/lib/programs/templates/content.test.ts && npm test -- src/lib/programs/registry.test.ts && npm test -- src/lib/programs/preview.test.ts && npm test -- src/lib/programs/content.test.ts && npx tsc --noEmit -p .`
Expected: `programs/templates content: 19 programs ok`; the others pass; no type errors. Also run `cd app && npm test -- src/lib/programs/templates/size.test.ts`: it still passes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/programs/templates/content.test.ts app/src/lib/programs/templates/gvt.ts app/src/lib/programs/templates/phul.ts app/src/lib/programs/templates/phat.ts app/src/lib/programs/templates/arnold.ts app/src/lib/programs/templates/ppl.ts app/src/lib/programs/templates/hit.ts
git commit -m "$(cat <<'MSG'
feat(programs): summary, phases and why it works for the size programs, checked over all 19

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 6: The Programs kit: components, bottom sheet and the .pk- CSS

**Files:**
- Create: `app/src/components/clientapp/programs/kit.tsx`
- Create: `app/src/components/clientapp/programs/Sheet.tsx`
- Modify: `app/src/app/globals.css` (one new block, nothing else changes)
- Test: `app/src/components/clientapp/programs/kit.test.ts`

**Interfaces:**
- Consumes: `weeksText` (Task 1), `Phase` (Task 1).
- Produces (later tasks use exactly these):
  - `PkHeader({ crumb?, title, lead?, byline?, children? })`: the page head (`.pk-head`, `.pk-title` uppercase, `.pk-lead`).
  - `PkSection({ label, children })`: an `<h2 class="pk-label">` section label and its content.
  - `PkCard({ href?, accent?, children, className? })`: a soft gradient card; a `next/link` when `href` is set; `accent` for the card a screen leads with.
  - `Pill({ children, accent? })`, `Pills({ items: string[] })`.
  - `PhaseBar({ phases: Phase[]; current?: number | null; named?: boolean })`: segments sized by weeks, `data-state="past" | "current"`, `role="img"` with every phase named in its `aria-label`.
  - `StatTiles({ tiles: { label; value; sub? }[] })`, `Timeline({ items: { id; when; lines: string[] }[] })`, `StickyBar({ children })`, `Warn({ children })`, `StepBar({ at, of, label })`.
  - `Sheet({ title, onClose, children, footer? })` (client): `role="dialog"`, `aria-modal`, labelled by its title; traps Tab and Shift+Tab inside, closes on Escape and on a backdrop tap, locks page scroll, and gives focus back to the element that opened it.
  - CSS classes (all in the kit block): `pk`, `pk-head`, `pk-crumb`, `pk-title`, `pk-lead`, `pk-muted`, `pk-small`, `pk-section`, `pk-label`, `pk-card`, `pk-card--accent`, `pk-card-title`, `pk-row`, `pk-pills`, `pk-pill`, `pk-pill--accent`, `pk-phases`, `pk-phases--named`, `pk-phase`, `pk-phase-name`, `pk-day`, `pk-day-name`, `pk-line`, `pk-note`, `pk-list`, `pk-fold`, `pk-fold-body`, `pk-stats`, `pk-stat`, `pk-stat-value`, `pk-timeline`, `pk-event`, `pk-warn`, `pk-error`, `pk-sticky`, `pk-cta`, `pk-btn`, `pk-btn--danger`, `pk-ghost`, `pk-dashed`, `pk-icon`, `pk-actions`, `pk-linkrow`, `pk-chev`, `pk-filters`, `pk-select`, `pk-input`, `pk-big`, `pk-pair`, `pk-field`, `pk-seg`, `pk-steps`, `pk-step`, `pk-question`, `pk-sum`, `pk-tabs`, `pk-tab`, `pk-ex`, `pk-ex-name`, `pk-badge`, `pk-tiles`, `pk-tile`, `pk-sets`, `pk-set`, `pk-set--head`, `pk-setno`, `pk-num`, `pk-plus`, `pk-notes`, `pk-lock`, `pk-sheet-backdrop`, `pk-sheet`, `pk-grip`, `pk-sheet-head`, `pk-sheet-title`, `pk-sheet-body`, `pk-sheet-foot`.

First confirm the prefix is free: `cd app && grep -rn "pk-" src --include='*.tsx' --include='*.ts' --include='*.css'` must print nothing. If it prints anything, stop and report it.

- [ ] **Step 1: Write the failing test**

Create `app/src/components/clientapp/programs/kit.test.ts`:

```ts
// app/src/components/clientapp/programs/kit.test.ts
// Run: npm test -- src/components/clientapp/programs/kit.test.ts
//
// The Programs kit's CSS: one block with its own .pk- prefix that nothing
// else in globals.css uses, brand variables only (no fixed colours), and a
// rule for every pk- class the Programs screens use.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "src");
const css = fs.readFileSync(path.join(src, "app", "globals.css"), "utf8");
const START = "/* ── Programs kit (.pk-)";
const END = "/* ── end Programs kit ── */";
const a = css.indexOf(START);
const b = css.indexOf(END);
assert.ok(a !== -1 && b > a, "globals.css has one Programs kit block");
assert.equal(css.indexOf(START, a + 1), -1, "only one kit block");
const block = css.slice(a, b);
const outside = css.slice(0, a) + css.slice(b);

assert.ok(!/\.pk-/.test(outside), "no .pk- rule outside the kit block");
const noComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(noComments), "no hex colours in the kit");
assert.ok(!/\b(rgba?|hsla?)\(/i.test(noComments), "no fixed rgb or hsl colours in the kit");

// Every class a selector names is a pk- class.
const selectors = noComments.match(/(^|})\s*([^{}@]+)\{/g) ?? [];
for (const sel of selectors) {
  for (const cls of sel.match(/\.[a-zA-Z][\w-]*/g) ?? []) assert.ok(cls === ".pk" || cls.startsWith(".pk-"), `kit selector uses only pk classes: ${sel.trim()}`);
}
const defined = new Set((noComments.match(/\.pk(-[\w-]+)?/g) ?? []).map((c) => c.slice(1)));

// Every pk- class used in the member Programs code has a rule.
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = [...walk(path.join(src, "components", "clientapp")), ...walk(path.join(src, "app", "app", "programs"))].filter((f) => f.endsWith(".tsx"));
const used = new Set<string>();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const c of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (c === "pk" || c.startsWith("pk-")) used.add(c);
  }
  // Class names built in strings and template literals: "pk-card", `pk-card${...}`, " pk-card--accent".
  for (const m of text.matchAll(/[`"'\s](pk-[\w-]+)/g)) used.add(m[1]);
}
for (const c of used) assert.ok(defined.has(c), `${c} is used but has no rule in the kit`);
assert.ok(used.has("pk-card") && used.has("pk-phases"), "the kit components use the kit");

console.log(`programs kit css: ${defined.size} classes, ${used.size} used, ok`);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/components/clientapp/programs/kit.test.ts`
Expected: FAIL with `globals.css has one Programs kit block`.

- [ ] **Step 3: Add the kit's CSS block**

In `app/src/app/globals.css`, insert one blank line and then this block directly below the line `.bld-chip-link { display: inline-flex; align-items: center; text-decoration: none; }` (the last line of the member builder block), so it sits above the blank line before `/* Staff: a member's DIY program on the client page (Workout log tab). */`. Change nothing else in the file.

```css
/* ── Programs kit (.pk-) ── every Programs screen in the member app. Brand variables only, no fixed colours; 44px targets; fits a 320px phone. */
.pk { display: grid; gap: 18px; min-width: 0; }
.pk-head { display: grid; gap: 4px; min-width: 0; }
.pk-crumb { font-size: 12.5px; color: var(--text-tertiary); }
.pk-title { margin: 0; font-family: var(--font-heading), sans-serif; font-size: 26px; line-height: 1.1; letter-spacing: 0.01em; text-transform: uppercase; color: var(--text-primary); overflow-wrap: anywhere; }
.pk-lead { margin: 4px 0 0; font-size: 15px; line-height: 1.5; color: var(--text-primary); }
.pk-muted { display: block; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); overflow-wrap: anywhere; }
.pk-small { display: block; font-size: 12.5px; line-height: 1.45; color: var(--text-tertiary); overflow-wrap: anywhere; }
.pk-section { display: grid; gap: 8px; min-width: 0; }
.pk-label { margin: 0 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-tertiary); }
.pk-card { display: grid; gap: 8px; min-width: 0; padding: 14px; border: 1px solid var(--hairline); border-radius: 18px; background: linear-gradient(160deg, var(--surface-2), var(--surface-1)); color: var(--text-primary); text-decoration: none; }
.pk-card--accent { border-color: color-mix(in srgb, var(--accent) 45%, var(--hairline)); background: linear-gradient(160deg, var(--accent-soft), var(--surface-1)); }
.pk-card-title { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.25; color: var(--text-primary); overflow-wrap: anywhere; }
.pk-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.pk-row > :first-child { min-width: 0; }
.pk-row > .pk-input { flex: 1; }
.pk-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.pk-pill { display: inline-flex; align-items: center; min-height: 24px; padding: 2px 9px; border: 1px solid var(--hairline-strong); border-radius: 999px; font-size: 11.5px; color: var(--text-secondary); white-space: nowrap; }
.pk-pill--accent { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
.pk-phases { display: flex; gap: 3px; min-width: 0; }
.pk-phase { flex-basis: 0; min-width: 0; height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 28%, transparent); }
.pk-phase[data-state="past"] { background: color-mix(in srgb, var(--accent) 60%, transparent); }
.pk-phase[data-state="current"] { background: var(--accent); }
.pk-phases--named .pk-phase { height: auto; min-height: 36px; display: flex; align-items: center; justify-content: center; padding: 4px 6px; border-radius: 9px; background: var(--accent-soft); color: var(--accent-ink); }
.pk-phases--named .pk-phase[data-state="past"] { background: color-mix(in srgb, var(--accent) 40%, transparent); color: var(--text-primary); }
.pk-phases--named .pk-phase[data-state="current"] { background: var(--accent); color: var(--accent-contrast); }
.pk-phase-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 600; }
.pk-day { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
.pk-day-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
.pk-line { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; line-height: 1.45; color: var(--text-secondary); }
.pk-line > :first-child { min-width: 0; color: var(--text-primary); overflow-wrap: anywhere; }
.pk-line > :last-child { flex-shrink: 0; max-width: 60%; text-align: right; font-variant-numeric: tabular-nums; }
.pk-note { display: grid; gap: 2px; padding-left: 10px; border-left: 2px solid var(--accent); }
.pk-note b { font-size: 13px; color: var(--text-primary); }
.pk-list { display: grid; gap: 6px; margin: 0; padding: 0 0 0 18px; font-size: 13.5px; line-height: 1.5; color: var(--text-secondary); }
.pk-fold { border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface-1); }
.pk-fold > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 48px; padding: 0 14px; font-size: 14px; font-weight: 600; color: var(--text-primary); cursor: pointer; list-style: none; }
.pk-fold > summary::-webkit-details-marker { display: none; }
.pk-fold > summary svg { flex-shrink: 0; color: var(--text-tertiary); transition: transform 0.15s ease; }
.pk-fold[open] > summary svg { transform: rotate(180deg); }
.pk-fold > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 14px; }
.pk-fold-body { display: grid; gap: 8px; padding: 0 12px 12px; }
.pk-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pk-stat { display: grid; gap: 2px; min-width: 0; padding: 10px 12px; border: 1px solid var(--hairline); border-radius: 14px; background: var(--surface-1); }
.pk-stat-value { font-size: 17px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pk-timeline { position: relative; display: grid; gap: 12px; margin: 0; padding: 0 0 0 20px; list-style: none; }
.pk-timeline::before { content: ""; position: absolute; left: 5px; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: var(--hairline-strong); }
.pk-event { position: relative; display: grid; gap: 2px; min-width: 0; }
.pk-event::before { content: ""; position: absolute; left: -19px; top: 5px; width: 10px; height: 10px; border-radius: 999px; background: var(--accent); }
.pk-warn { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent); border-radius: 12px; background: var(--danger-soft); font-size: 13px; line-height: 1.45; color: var(--text-primary); }
.pk-warn svg { flex-shrink: 0; margin-top: 2px; color: var(--danger); }
.pk-error { padding: 10px 12px; border: 1px solid var(--danger); border-radius: 12px; background: var(--surface-1); font-size: 13.5px; line-height: 1.45; color: var(--text-primary); }
.pk-error ul { display: grid; gap: 4px; margin: 6px 0 0; padding-left: 18px; }
/* Above the member app's bottom tabs. */
.pk-sticky { position: sticky; bottom: 72px; z-index: 5; padding-bottom: env(safe-area-inset-bottom); }
.pk-cta { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; padding: 0 18px; border: 0; border-radius: 14px; background: var(--accent); color: var(--accent-contrast); font: inherit; font-size: 15px; font-weight: 700; text-decoration: none; cursor: pointer; box-shadow: 0 10px 24px -14px var(--accent); }
.pk-cta:disabled { opacity: 0.6; cursor: default; }
.pk-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--hairline-strong); border-radius: 12px; background: var(--surface-1); color: var(--text-primary); font: inherit; font-size: 13.5px; font-weight: 600; text-decoration: none; cursor: pointer; }
.pk-btn:disabled { opacity: 0.5; cursor: default; }
.pk-btn--danger { color: var(--danger); }
.pk-dashed.pk-btn--danger { border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
.pk-ghost { justify-self: start; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 8px; border: 0; background: transparent; color: var(--accent-ink); font: inherit; font-size: 13.5px; font-weight: 600; text-decoration: none; cursor: pointer; }
.pk-dashed { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; padding: 0 14px; border: 1px dashed color-mix(in srgb, var(--accent) 55%, transparent); border-radius: 14px; background: transparent; color: var(--accent-ink); font: inherit; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; }
.pk-dashed:disabled { opacity: 0.5; cursor: default; }
.pk-icon { flex-shrink: 0; width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); color: var(--text-secondary); cursor: pointer; }
.pk-icon:disabled { opacity: 0.4; cursor: default; }
.pk-cta:focus-visible, .pk-btn:focus-visible, .pk-ghost:focus-visible, .pk-dashed:focus-visible, .pk-icon:focus-visible, .pk-tab:focus-visible, .pk-seg button:focus-visible, .pk-tile:focus-visible, .pk-ex:focus-visible, a.pk-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pk-linkrow { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; color: inherit; text-decoration: none; }
.pk-linkrow > :first-child { min-width: 0; }
.pk-linkrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 12px; }
.pk-chev { flex-shrink: 0; color: var(--text-tertiary); }
.pk-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
@media (max-width: 360px) {
  .pk-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pk-filters > :first-child { grid-column: 1 / -1; }
}
.pk-select { width: 100%; min-width: 0; height: 44px; padding-left: 10px; border: 1px solid var(--hairline); border-radius: 12px; background-color: var(--surface-1); color: var(--text-primary); font: inherit; font-size: 13px; }
.pk-input { width: 100%; min-width: 0; height: 44px; padding: 0 12px; border: 1px solid var(--hairline); border-radius: 12px; background-color: var(--surface-2); color: var(--text-primary); font: inherit; font-size: 15px; }
.pk-input:focus, .pk-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pk-big { height: 72px; font-size: 34px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; border-radius: 16px; }
.pk-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.pk-field { display: grid; gap: 6px; min-width: 0; }
.pk-field > span:first-child { font-size: 12.5px; color: var(--text-tertiary); }
.pk-seg { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--surface-2); }
.pk-seg button { flex: 1; min-width: 0; min-height: 44px; padding: 0 6px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary); font: inherit; font-size: 12.5px; cursor: pointer; }
.pk-seg button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.pk-steps { display: flex; gap: 4px; }
.pk-step { flex: 1; height: 4px; border-radius: 2px; background: var(--hairline-strong); }
.pk-step[data-on="true"] { background: var(--accent); }
.pk-question { margin: 0; font-size: 20px; font-weight: 700; line-height: 1.25; color: var(--text-primary); }
.pk-sum { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--hairline); font-size: 13.5px; color: var(--text-secondary); }
.pk-sum > :last-child { min-width: 0; color: var(--text-primary); font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.pk-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; -webkit-overflow-scrolling: touch; }
.pk-tab { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid var(--hairline); border-radius: 999px; background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.pk-tab[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.pk-ex { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 52px; padding: 8px 10px; border: 1px solid transparent; border-radius: 12px; background: var(--surface-2); color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
.pk-ex[data-joined="true"] { border-left: 3px solid var(--accent); }
.pk-ex-name { display: grid; gap: 2px; min-width: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.pk-ex-name span { font-size: 12.5px; font-weight: 400; color: var(--text-tertiary); }
.pk-badge { flex-shrink: 0; padding: 2px 8px; border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); font-size: 11px; white-space: nowrap; }
.pk-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.pk-tile { min-height: 48px; padding: 8px 10px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 12.5px; line-height: 1.3; text-align: left; cursor: pointer; }
.pk-tile[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.pk-sets { display: grid; gap: 6px; }
.pk-set { display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) 44px 44px; gap: 6px; align-items: center; }
.pk-set--head { font-size: 11.5px; color: var(--text-tertiary); }
.pk-setno { font-size: 13px; color: var(--text-tertiary); text-align: center; font-variant-numeric: tabular-nums; }
.pk-num { padding: 0 6px; text-align: center; font-variant-numeric: tabular-nums; }
.pk-plus { width: 44px; height: 44px; border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); color: var(--text-secondary); font: inherit; font-size: 18px; font-weight: 600; cursor: pointer; }
.pk-plus[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); }
.pk-plus:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pk-notes { height: auto; min-height: 64px; padding: 10px 12px; resize: vertical; }
.pk-lock { display: grid; gap: 14px; min-width: 0; margin: 0; padding: 0; border: 0; }
.pk-sheet-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; background: color-mix(in srgb, var(--bg) 72%, transparent); }
.pk-sheet { display: grid; gap: 14px; width: 100%; max-width: 460px; max-height: 88vh; overflow-y: auto; padding: 10px 16px calc(16px + env(safe-area-inset-bottom)); border: 1px solid var(--hairline-strong); border-bottom: 0; border-radius: 20px 20px 0 0; background: var(--surface-1); outline: none; }
.pk-grip { justify-self: center; width: 36px; height: 4px; border-radius: 2px; background: var(--hairline-strong); }
.pk-sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.pk-sheet-title { margin: 0; min-width: 0; font-size: 17px; font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
.pk-sheet-body { display: grid; gap: 14px; min-width: 0; }
.pk-sheet-foot { position: sticky; bottom: 0; display: grid; gap: 8px; padding-top: 8px; background: var(--surface-1); }
@media (prefers-reduced-motion: reduce) { .pk-fold > summary svg { transition: none; } }
/* ── end Programs kit ── */
```

- [ ] **Step 4: Write the kit components**

Create `app/src/components/clientapp/programs/kit.tsx`:

```tsx
// app/src/components/clientapp/programs/kit.tsx
/**
 * The Programs kit: the shared pieces every Programs screen is built from.
 * Plain markup with no hooks, so server and client components can both use
 * it. Styles are the .pk- block in globals.css; colours come from the gym's
 * brand variables only.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { weeksText } from "@/lib/programs/content";
import type { Phase } from "@/lib/programs/types";

/** The page head: a small line above, the big uppercase title, a lead line and a byline. */
export function PkHeader({ crumb, title, lead, byline, children }: { crumb?: string; title: string; lead?: string; byline?: string; children?: ReactNode }) {
  return (
    <header className="pk-head">
      {crumb && <div className="pk-crumb">{crumb}</div>}
      <h1 className="pk-title">{title}</h1>
      {lead && <p className="pk-lead">{lead}</p>}
      {byline && <div className="pk-small">{byline}</div>}
      {children}
    </header>
  );
}

/** A small letter-spaced section label and what goes under it. */
export function PkSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pk-section">
      <h2 className="pk-label">{label}</h2>
      {children}
    </section>
  );
}

/** A soft card; a link when it has an href. `accent` for the one card a screen leads with. */
export function PkCard({ href, accent, children, className }: { href?: string; accent?: boolean; children: ReactNode; className?: string }) {
  const cls = `pk-card${accent ? " pk-card--accent" : ""}${className ? ` ${className}` : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** A pill tag: days, weeks, level, length. */
export function Pill({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={`pk-pill${accent ? " pk-pill--accent" : ""}`}>{children}</span>;
}

export function Pills({ items }: { items: string[] }) {
  return (
    <div className="pk-pills">
      {items.map((p) => (
        <Pill key={p}>{p}</Pill>
      ))}
    </div>
  );
}

/**
 * The phase bar: one segment per phase, sized by its weeks. The current phase
 * is the brightest and the ones before it are a step dimmer. `named` writes
 * each phase's name in its segment.
 */
export function PhaseBar({ phases, current = null, named = false }: { phases: Phase[]; current?: number | null; named?: boolean }) {
  const label = `Phases: ${phases.map((p) => `${p.name}, ${weeksText(p.fromWeek, p.toWeek).toLowerCase()}`).join("; ")}${current !== null && phases[current] ? `. Now: ${phases[current].name}` : ""}`;
  return (
    <div className={`pk-phases${named ? " pk-phases--named" : ""}`} role="img" aria-label={label}>
      {phases.map((p, i) => (
        <div
          key={`${p.fromWeek}-${p.name}`}
          className="pk-phase"
          data-state={current === null ? undefined : i < current ? "past" : i === current ? "current" : undefined}
          style={{ flexGrow: p.toWeek - p.fromWeek + 1 }}
          title={named ? p.name : undefined}
        >
          {named && <span className="pk-phase-name">{p.name}</span>}
        </div>
      ))}
    </div>
  );
}

/** Key numbers in tiles of two. */
export function StatTiles({ tiles }: { tiles: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="pk-stats">
      {tiles.map((t) => (
        <div key={t.label} className="pk-stat">
          <span className="pk-small">{t.label}</span>
          <b className="pk-stat-value">{t.value}</b>
          {t.sub && <span className="pk-small">{t.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Changes in order, newest first, as a line of dots. */
export function Timeline({ items }: { items: { id: number; when: string; lines: string[] }[] }) {
  return (
    <ol className="pk-timeline">
      {items.map((e) => (
        <li key={e.id} className="pk-event">
          <span className="pk-small">{e.when}</span>
          {e.lines.map((line, i) => (
            <span key={i} className="pk-muted">
              {line}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** The one primary action, kept in view at the bottom while the screen scrolls. */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="pk-sticky">{children}</div>;
}

/** A warning line, for demanding programs and test days. */
export function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="pk-warn">
      <AlertTriangle size={15} aria-hidden />
      <span>{children}</span>
    </div>
  );
}

/** How far through a multi-step screen the member is. */
export function StepBar({ at, of, label }: { at: number; of: number; label: string }) {
  return (
    <div className="pk-steps" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={of} aria-valuenow={at + 1}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="pk-step" data-on={i <= at ? "true" : undefined} />
      ))}
    </div>
  );
}
```

Create `app/src/components/clientapp/programs/Sheet.tsx`:

```tsx
// app/src/components/clientapp/programs/Sheet.tsx
"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside a node, in tab order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

/**
 * A bottom sheet for the Programs screens. It traps focus while open, closes
 * on Escape or a tap on the backdrop, stops the page behind it scrolling,
 * and gives focus back to whatever opened it.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root) (focusables(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = focusables(ref.current);
      if (items.length === 0) return void e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <div className="pk-sheet-backdrop" onClick={() => close.current()}>
      <div ref={ref} className="pk-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="pk-grip" aria-hidden />
        <div className="pk-sheet-head">
          <h2 id={titleId} className="pk-sheet-title">
            {title}
          </h2>
          <button type="button" className="pk-icon" aria-label="Close" onClick={() => close.current()}>
            <X size={18} />
          </button>
        </div>
        <div className="pk-sheet-body">{children}</div>
        {footer && <div className="pk-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the test and the type check**

Run: `cd app && npm test -- src/components/clientapp/programs/kit.test.ts && npx tsc --noEmit -p .`
Expected: `programs kit css: ... classes, ... used, ok` and no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/clientapp/programs/kit.tsx app/src/components/clientapp/programs/Sheet.tsx app/src/components/clientapp/programs/kit.test.ts app/src/app/globals.css
git commit -m "$(cat <<'MSG'
feat(programs): the Programs kit, its bottom sheet and the pk- styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 7: The Programs tab (direction A: big story cards grouped by goal)

**Files:**
- Modify: `app/src/lib/programs/cards.ts` (URL filters, story cards, goal groups)
- Modify: `app/src/lib/programs/cards.test.ts`
- Modify (rewrite): `app/src/components/clientapp/ProgramBrowser.tsx`
- Modify (rewrite): `app/src/components/clientapp/BuiltProgramList.tsx`
- Modify (rewrite): `app/src/app/app/programs/page.tsx`

**Interfaces:**
- Consumes: `programContent`, `ProgramContent` (Task 1); `focusTag`, `lengthTag` (Task 2); `PkHeader`, `PkSection`, `PkCard`, `Pill`, `Pills`, `PhaseBar` (Task 6); `memberKey`, `memberLine`, `parseMemberKey` (`memberTemplate.ts`); `deleteBuiltProgramAction` (unchanged).
- Produces:
  - `cards.ts`: `parseFilter(sp: { goal?; days?; length? }): CardFilter`; `filterQuery(f: CardFilter): string` ("" or "?goal=peaking&days=5%2B"); `GOAL_ORDER: Family[]`; `GOAL_LABEL: Record<Family, string>` (strength "Get strong", peaking "Peak your total", beginner "Start lifting", size "Build size"); `interface StoryCard extends ProgramCard { summary: string; phases: Phase[]; tags: string[] }`; `toStoryCard(t, content: ProgramContent, basedOn?: string | null): StoryCard`; `groupByGoal<T extends ProgramCard>(cards: T[]): { family; label; cards: T[] }[]`; `filterCards` becomes generic (`<T extends ProgramCard>(cards: T[], f) => T[]`), same behaviour.
  - `ProgramBrowser({ cards: StoryCard[]; initial: CardFilter; children: ReactNode })`.
  - `BuiltProgramList({ current: { name: string; line: string } | null; programs: BuiltProgramItem[]; anyLive: boolean })`.

The screen, top to bottom (mockup `programs-list-direction.html`, option A): the title "Programs" and one line; a compact row of three selects (goal, days, length; on phones 360px or narrower the goal select takes its own row) whose values live in the URL; the dashed "Build your own" card; "My programs": the running program first as an accent card with "Continue" (links to My program), then each saved member program (its name links to its program page) with Edit, Start (only when nothing is running) and Delete; then a section per goal heading with big story cards (level pill, name, summary, mini phase bar, pills for days, length and focus). A gym copy also shows "Our version, based on X".

- [ ] **Step 1: Write the failing test**

In `app/src/lib/programs/cards.test.ts`, replace

```ts
import { NO_FILTER, actorLabel, byline, cardLine, defaultWeekdays, filterCards, toCard } from "./cards";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
```

with

```ts
import { GOAL_LABEL, NO_FILTER, actorLabel, byline, cardLine, defaultWeekdays, filterCards, filterQuery, groupByGoal, parseFilter, toCard, toStoryCard } from "./cards";
import { programContent } from "./content";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
```

and replace the last line `console.log("programs/cards: ok");` with

```ts
// ── the Programs tab: filters in the URL, story cards, goal groups ──
assert.deepEqual(parseFilter({}), NO_FILTER);
assert.deepEqual(parseFilter({ goal: "peaking", days: "4", length: "short" }), { family: "peaking", days: "4", length: "short" });
assert.deepEqual(parseFilter({ goal: ["size", "strength"], days: "9", length: "forever" }), { family: "size", days: "any", length: "any" }, "unknown values fall back to any");
assert.equal(filterQuery(NO_FILTER), "");
assert.equal(filterQuery({ family: "peaking", days: "5+", length: "any" }), "?goal=peaking&days=5%2B");
assert.deepEqual(parseFilter(Object.fromEntries(new URLSearchParams(filterQuery({ family: "beginner", days: "5+", length: "long" }).slice(1)))), { family: "beginner", days: "5+", length: "long" }, "a filter survives the round trip");

const sm = platformProgram("smolov-base")!;
const story = toStoryCard(sm, programContent(sm, { kind: "platform" }));
assert.equal(story.summary, sm.summary);
assert.deepEqual(story.tags, ["4 days", "4 weeks", "Squat"]);
assert.equal(story.phases.length, sm.phases!.length);
const bbbT = platformProgram("531-bbb")!;
assert.deepEqual(toStoryCard(bbbT, programContent(bbbT, { kind: "platform" })).tags, ["4 days", "Repeats every 4 weeks", "4 lifts"]);
const groups = groupByGoal(PLATFORM_PROGRAMS.map((t) => toStoryCard(t, programContent(t, { kind: "platform" }))));
assert.deepEqual(groups.map((g) => g.label), ["Get strong", "Peak your total", "Start lifting", "Build size"]);
assert.equal(groups.reduce((n, g) => n + g.cards.length, 0), PLATFORM_PROGRAMS.length);
assert.equal(GOAL_LABEL.size, "Build size");
assert.deepEqual(groupByGoal(filterCards(groups.flatMap((g) => g.cards), { ...NO_FILTER, family: "size" })).map((g) => g.family), ["size"], "a filter leaves out empty groups");

console.log("programs/cards: ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/cards.test.ts`
Expected: FAIL (`parseFilter` and the rest are not exported).

- [ ] **Step 3: Add the Programs tab helpers to cards.ts**

In `app/src/lib/programs/cards.ts`, replace

```ts
/** Library cards, filters and small display helpers for the member app and staff screens. Pure. */
import { FAMILY_LABEL, LEVEL_LABEL, type Family, type LiftKey, type ProgramTemplate } from "./types";
```

with

```ts
/** Library cards, filters and small display helpers for the member app and staff screens. Pure. */
import type { ProgramContent } from "./content";
import { focusTag, lengthTag } from "./outline";
import { FAMILY_LABEL, LEVEL_LABEL, type Family, type LiftKey, type Phase, type ProgramTemplate } from "./types";
```

replace

```ts
export function filterCards(cards: ProgramCard[], f: CardFilter): ProgramCard[] {
```

with

```ts
export function filterCards<T extends ProgramCard>(cards: T[], f: CardFilter): T[] {
```

and insert directly above the line `const DEFAULT_DAYS: Record<number, number[]> = {`:

```ts
const FAMILIES: CardFilter["family"][] = ["all", "strength", "peaking", "beginner", "size"];
const DAY_FILTERS: CardFilter["days"][] = ["any", "3", "4", "5+"];
const LENGTH_FILTERS: CardFilter["length"][] = ["any", "short", "medium", "long"];
const pick = <T extends string>(options: T[], raw: string | string[] | undefined, fallback: T): T => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return options.includes(v as T) ? (v as T) : fallback;
};

/** The Programs tab's filters from its URL (?goal=&days=&length=). Anything unknown is "any". */
export function parseFilter(sp: { goal?: string | string[]; days?: string | string[]; length?: string | string[] }): CardFilter {
  return { family: pick(FAMILIES, sp.goal, "all"), days: pick(DAY_FILTERS, sp.days, "any"), length: pick(LENGTH_FILTERS, sp.length, "any") };
}

/** The query string that keeps the filters in the URL: "" when none are set. */
export function filterQuery(f: CardFilter): string {
  const q = new URLSearchParams();
  if (f.family !== "all") q.set("goal", f.family);
  if (f.days !== "any") q.set("days", f.days);
  if (f.length !== "any") q.set("length", f.length);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The Programs tab's goal headings, in the order they are shown. */
export const GOAL_ORDER: Family[] = ["strength", "peaking", "beginner", "size"];
export const GOAL_LABEL: Record<Family, string> = {
  strength: "Get strong",
  peaking: "Peak your total",
  beginner: "Start lifting",
  size: "Build size",
};

/** A big card on the Programs tab: the library card plus the story the program tells. */
export interface StoryCard extends ProgramCard {
  summary: string;
  phases: Phase[];
  /** Days, length and focus pills. */
  tags: string[];
}

export function toStoryCard(t: ProgramTemplate, content: ProgramContent, basedOn: string | null = null): StoryCard {
  return {
    ...toCard(t, basedOn),
    summary: content.summary,
    phases: content.phases,
    tags: [`${t.daysPerWeek} ${t.daysPerWeek === 1 ? "day" : "days"}`, lengthTag(t, content.repeats), focusTag(t)],
  };
}

/** Cards under their goal headings, in GOAL_ORDER; empty groups are left out. */
export function groupByGoal<T extends ProgramCard>(cards: T[]): { family: Family; label: string; cards: T[] }[] {
  return GOAL_ORDER.map((family) => ({ family, label: GOAL_LABEL[family], cards: cards.filter((c) => c.family === family) })).filter((g) => g.cards.length > 0);
}

```

Run: `cd app && npm test -- src/lib/programs/cards.test.ts`
Expected: PASS, `programs/cards: ok`.

- [ ] **Step 4: Rewrite the browser**

Replace the whole of `app/src/components/clientapp/ProgramBrowser.tsx` with:

```tsx
// app/src/components/clientapp/ProgramBrowser.tsx
"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { PhaseBar, Pill, Pills, PkCard, PkSection } from "@/components/clientapp/programs/kit";
import { byline, filterCards, filterQuery, groupByGoal, type CardFilter, type StoryCard } from "@/lib/programs/cards";

const GOALS: [CardFilter["family"], string][] = [
  ["all", "Any goal"],
  ["strength", "Strength"],
  ["peaking", "Powerlifting peak"],
  ["beginner", "Beginner"],
  ["size", "Size"],
];
const DAYS: [CardFilter["days"], string][] = [
  ["any", "Any days"],
  ["3", "3 or fewer"],
  ["4", "4 days"],
  ["5+", "5 or more"],
];
const LENGTHS: [CardFilter["length"], string][] = [
  ["any", "Any length"],
  ["short", "Up to 6 weeks"],
  ["medium", "7 to 12 weeks"],
  ["long", "Longer"],
];

function Filter<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <select className="pk-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, text]) => (
        <option key={v} value={v}>
          {text}
        </option>
      ))}
    </select>
  );
}

function ProgramStoryCard({ c }: { c: StoryCard }) {
  return (
    <PkCard href={`/app/programs/${encodeURIComponent(c.key)}`}>
      <div className="pk-row">
        <Pill>{c.levelLabel}</Pill>
      </div>
      <h3 className="pk-card-title">{c.name}</h3>
      {c.basedOn && <span className="pk-small">{byline(c)}</span>}
      <span className="pk-muted">{c.summary}</span>
      <PhaseBar phases={c.phases} />
      <Pills items={c.tags} />
    </PkCard>
  );
}

/**
 * The Programs tab: a compact filter row kept in the URL (so it is still set
 * when the member comes back), the member's own programs (children), then big
 * story cards under goal headings.
 */
export function ProgramBrowser({ cards, initial, children }: { cards: StoryCard[]; initial: CardFilter; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [f, setF] = useState<CardFilter>(initial);
  const groups = groupByGoal(filterCards(cards, f));

  function change(next: CardFilter) {
    setF(next);
    router.replace(`${pathname}${filterQuery(next)}`, { scroll: false });
  }

  return (
    <>
      <div className="pk-filters" role="group" aria-label="Filter programs">
        <Filter label="Goal" options={GOALS} value={f.family} onChange={(family) => change({ ...f, family })} />
        <Filter label="Days a week" options={DAYS} value={f.days} onChange={(days) => change({ ...f, days })} />
        <Filter label="Length" options={LENGTHS} value={f.length} onChange={(length) => change({ ...f, length })} />
      </div>
      {children}
      {groups.length === 0 ? (
        <PkCard>
          <span className="pk-muted">No programs match. Try fewer filters.</span>
        </PkCard>
      ) : (
        groups.map((g) => (
          <PkSection key={g.family} label={g.label}>
            {g.cards.map((c) => (
              <ProgramStoryCard key={c.key} c={c} />
            ))}
          </PkSection>
        ))
      )}
    </>
  );
}
```

- [ ] **Step 5: Rewrite My programs**

Replace the whole of `app/src/components/clientapp/BuiltProgramList.tsx` with:

```tsx
// app/src/components/clientapp/BuiltProgramList.tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { PkCard, PkSection } from "@/components/clientapp/programs/kit";
import { deleteBuiltProgramAction } from "@/app/app/programs/built/actions";
import { memberKey } from "@/lib/programs/memberTemplate";

export interface BuiltProgramItem {
  id: number;
  name: string;
  line: string;
  running: boolean;
}

export interface CurrentProgram {
  name: string;
  /** "Week 2 of 4", or that it is paused. */
  line: string;
}

/**
 * "Build your own", then My programs: the running program first with
 * Continue, then the member's own saved programs with Edit, Start and Delete.
 */
export function BuiltProgramList({ current, programs, anyLive }: { current: CurrentProgram | null; programs: BuiltProgramItem[]; anyLive: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<number | null>(null);
  const [, start] = useTransition();
  const saved = programs.filter((p) => !p.running);

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
    <>
      <Link href="/app/programs/built/new" className="pk-dashed">
        <Plus size={18} aria-hidden /> Build your own
      </Link>
      {(current || saved.length > 0) && (
        <PkSection label="My programs">
          {current && (
            <PkCard href="/app/programs/mine" accent>
              <div className="pk-row">
                <div>
                  <h3 className="pk-card-title">{current.name}</h3>
                  <span className="pk-small">{current.line}</span>
                </div>
                <span className="pk-ghost">
                  Continue <ChevronRight size={16} />
                </span>
              </div>
            </PkCard>
          )}
          {saved.map((p) => (
            <PkCard key={p.id}>
              <Link href={`/app/programs/${encodeURIComponent(memberKey(p.id))}`} className="pk-linkrow">
                <div>
                  <h3 className="pk-card-title">{p.name}</h3>
                  <span className="pk-small">{p.line}</span>
                </div>
                <ChevronRight size={18} aria-hidden className="pk-chev" />
              </Link>
              <div className="pk-actions">
                <Link href={`/app/programs/built/${p.id}`} className="pk-btn">
                  Edit
                </Link>
                {!anyLive && (
                  <Link href={`/app/programs/built/${p.id}/start`} className="pk-btn">
                    Start
                  </Link>
                )}
                <button type="button" className="pk-btn pk-btn--danger" disabled={busy !== null} onClick={() => void remove(p)}>
                  Delete
                </button>
              </div>
            </PkCard>
          ))}
          {saved.length > 0 && anyLive && <span className="pk-small">End your current program on My program to start another.</span>}
        </PkSection>
      )}
    </>
  );
}
```

- [ ] **Step 6: Rewrite the page**

Replace the whole of `app/src/app/app/programs/page.tsx` with:

```tsx
// app/src/app/app/programs/page.tsx
import { requireProgramsPage } from "@/lib/programs/access";
import { parseFilter, toStoryCard } from "@/lib/programs/cards";
import { programContent } from "@/lib/programs/content";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { listMemberPrograms } from "@/lib/programs/memberPrograms";
import { memberLine, parseMemberKey } from "@/lib/programs/memberTemplate";
import { weekLabel } from "@/lib/programs/planner";
import { PkHeader } from "@/components/clientapp/programs/kit";
import { BuiltProgramList } from "@/components/clientapp/BuiltProgramList";
import { ProgramBrowser } from "@/components/clientapp/ProgramBrowser";

export const dynamic = "force-dynamic";

type Search = { goal?: string | string[]; days?: string | string[]; length?: string | string[] };

export default async function ProgramsPage(props: { searchParams: Promise<Search> }) {
  const sp = await props.searchParams;
  const { clientId } = requireProgramsPage();
  const cards = memberPrograms().map((e) =>
    toStoryCard(e.template, programContent(e.template, e.copyId !== null ? { kind: "copy", basedOnName: e.basedOnName ?? e.template.name } : { kind: "platform" }), e.basedOnName),
  );
  const live = liveEnrolment(clientId);
  const runningOwn = live?.programKey ? parseMemberKey(live.programKey) : null;
  const built = listMemberPrograms(clientId).map((p) => ({ id: p.id, name: p.name, line: memberLine(p.template), running: runningOwn === p.id }));
  const current = live ? { name: live.template.name, line: live.status === "paused" ? "Paused while you're coach guided" : weekLabel(live.template, live.state) } : null;
  return (
    <div className="pk">
      <PkHeader title="Programs" lead="Well-known programs, with your weights worked out." />
      <ProgramBrowser cards={cards} initial={parseFilter(sp)}>
        <BuiltProgramList current={current} programs={built} anyLive={!!live} />
      </ProgramBrowser>
    </div>
  );
}
```

- [ ] **Step 7: Check it**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts && npm test -- src/lib/programs/cards.test.ts`
Expected: no type errors; the kit test passes (every `pk-` class used has a rule); `app/programs gating: ok`.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/programs/cards.ts app/src/lib/programs/cards.test.ts app/src/components/clientapp/ProgramBrowser.tsx app/src/components/clientapp/BuiltProgramList.tsx app/src/app/app/programs/page.tsx
git commit -m "$(cat <<'MSG'
feat(programs): Programs tab with story cards by goal, URL filters and My programs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 8: The program page (direction B: story and phases)

**Files:**
- Create: `app/src/components/clientapp/programs/ProgramDetail.tsx`
- Modify (rewrite): `app/src/app/app/programs/[key]/page.tsx`

**Interfaces:**
- Consumes: `programContent`, `currentPhase`, `weeksText`, `ProgramContent` (Task 1); `howWeightsMove` (Task 2); `sessionMinutes`, `typicalWeek`, `wholeProgram`, `lengthTag`, `OutlineDay` (Task 2); the kit (Task 6); `getMemberProgram` (`memberPrograms.ts`, filters by `clientId`); `programByKey` (`library.ts`); `liveEnrolment` (`enrolments.ts`).
- Produces: `type DetailAction = { kind: "start"; href: string } | { kind: "continue" } | { kind: "busy"; runningName: string }`; `ProgramDetail({ template, content, memberBuilt, current, unit, stepKg, action, editHref? })`. The route `/app/programs/<key>` now also opens `member:<id>` (URL-encoded `member%3A<id>`), for the signed-in member's own programs only.

The page, top to bottom (mockup `program-page-direction.html`, option B): a crumb line (family, length), the title, the summary as the lead, the byline; pills for days a week, length, "About N min" and level (no level for a member program); then sections "The shape of it" (the named phase bar, the current phase brighter when this is the running program, and "These N weeks repeat." when the phases repeat), "A typical week" (each day of week 1 with up to three exercises and "And N more"), "What to expect" (one note per phase, named with its weeks), "Why it works" (left out for member programs), "How your weights move" (the generated list, in the member's unit and smallest jump), "The whole program" (one `<details>` fold per week, each opening to its days, exercises, sets, reps, percentages, notes and supersets); the warning line; "You need a max for: ..."; then the sticky primary action: "Start this program", "Continue" when it is the running program, or, when another program is running, a card saying so with a link to My program.

- [ ] **Step 1: Write the page body**

Create `app/src/components/clientapp/programs/ProgramDetail.tsx`:

```tsx
// app/src/components/clientapp/programs/ProgramDetail.tsx
/**
 * The program page (direction B, story and phases): what the program is, its
 * shape, a typical week, what each phase is like, why it works, how the
 * weights move and every week in full. Server-renderable; the page does the
 * reading and the gates.
 */
import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";

import { PhaseBar, Pills, PkCard, PkHeader, PkSection, StickyBar, Warn } from "@/components/clientapp/programs/kit";
import { weeksText, type ProgramContent } from "@/lib/programs/content";
import { lengthTag, sessionMinutes, typicalWeek, wholeProgram, type OutlineDay } from "@/lib/programs/outline";
import { howWeightsMove } from "@/lib/programs/progressionText";
import { FAMILY_LABEL, LEVEL_LABEL, LIFT_LABEL, type ProgramTemplate, type WeightUnit } from "@/lib/programs/types";

export type DetailAction = { kind: "start"; href: string } | { kind: "continue" } | { kind: "busy"; runningName: string };

/** How many exercises a typical-week day lists before "and N more". */
const DAY_LINES = 3;

function DayRow({ d, all }: { d: OutlineDay; all?: boolean }) {
  const lines = all ? d.lines : d.lines.slice(0, DAY_LINES);
  return (
    <div className="pk-day">
      <span className="pk-day-name">
        {d.name}
        {d.test ? ", test day" : ""}
      </span>
      {lines.map((l, i) => (
        <div key={i}>
          <div className="pk-line">
            <span>
              {l.name}
              {l.joined ? ", superset with the one above" : ""}
            </span>
            <span>{l.rx}</span>
          </div>
          {all && l.notes && <span className="pk-small">{l.notes}</span>}
        </div>
      ))}
      {!all && d.lines.length > DAY_LINES && <span className="pk-small">And {d.lines.length - DAY_LINES} more</span>}
    </div>
  );
}

export function ProgramDetail({
  template: t,
  content,
  memberBuilt,
  current,
  unit,
  stepKg,
  action,
  editHref,
}: {
  template: ProgramTemplate;
  content: ProgramContent;
  memberBuilt: boolean;
  /** The phase the member is in, when this is their running program. */
  current: number | null;
  unit: WeightUnit;
  stepKg: number;
  action: DetailAction;
  /** A member's own program: where to edit it. */
  editHref?: string;
}) {
  const length = lengthTag(t, content.repeats);
  const pills = [`${t.daysPerWeek} ${t.daysPerWeek === 1 ? "day" : "days"} a week`, length, `About ${sessionMinutes(t)} min`, ...(memberBuilt ? [] : [LEVEL_LABEL[t.level]])];
  const notes = content.phases.filter((p) => p.note.trim());
  return (
    <div className="pk">
      <PkHeader crumb={`${memberBuilt ? "Your program" : FAMILY_LABEL[t.family]} · ${length}`} title={t.name} lead={content.summary} byline={content.byline}>
        <Pills items={pills} />
        {editHref && (
          <Link href={editHref} className="pk-ghost">
            <Pencil size={16} aria-hidden /> Edit program
          </Link>
        )}
      </PkHeader>

      <PkSection label="The shape of it">
        <PhaseBar phases={content.phases} current={current} named />
        {content.repeats && <span className="pk-small">{t.weeks.length === 1 ? "One week that repeats." : `These ${t.weeks.length} weeks repeat.`}</span>}
      </PkSection>

      <PkSection label="A typical week">
        {typicalWeek(t).map((d, i) => (
          <DayRow key={i} d={d} />
        ))}
      </PkSection>

      {notes.length > 0 && (
        <PkSection label="What to expect">
          {notes.map((p) => {
            const weeks = weeksText(p.fromWeek, p.toWeek);
            return (
              <div key={`${p.fromWeek}-${p.name}`} className="pk-note">
                <b>{p.name === weeks ? weeks : `${p.name}, ${weeks.toLowerCase()}`}</b>
                <span className="pk-muted">{p.note}</span>
              </div>
            );
          })}
        </PkSection>
      )}

      {content.whyItWorks && (
        <PkSection label="Why it works">
          <p className="pk-muted">{content.whyItWorks}</p>
        </PkSection>
      )}

      <PkSection label="How your weights move">
        <ul className="pk-list">
          {howWeightsMove(t, unit, stepKg).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </PkSection>

      <PkSection label="The whole program">
        {wholeProgram(t).map((w) => (
          <details key={w.title} className="pk-fold">
            <summary>
              <span>{w.title}</span>
              <ChevronDown size={18} aria-hidden />
            </summary>
            <div className="pk-fold-body">
              {w.days.map((d, i) => (
                <DayRow key={i} d={d} all />
              ))}
            </div>
          </details>
        ))}
        <span className="pk-small">Your weights are worked out from your maxes when you start.</span>
      </PkSection>

      {t.warning && <Warn>{t.warning}</Warn>}
      {t.lifts.length > 0 && action.kind === "start" && <span className="pk-small">You need a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.</span>}

      {action.kind === "busy" ? (
        <PkCard>
          <span className="pk-muted">You&rsquo;re running {action.runningName}. End it on My program before you start another.</span>
          <Link href="/app/programs/mine" className="pk-ghost">
            Go to My program
          </Link>
        </PkCard>
      ) : (
        <StickyBar>
          <Link href={action.kind === "continue" ? "/app/programs/mine" : action.href} className="pk-cta">
            {action.kind === "continue" ? "Continue" : "Start this program"}
          </Link>
        </StickyBar>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the route**

Replace the whole of `app/src/app/app/programs/[key]/page.tsx` with:

```tsx
// app/src/app/app/programs/[key]/page.tsx
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { currentPhase, programContent, type ProgramContent } from "@/lib/programs/content";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey, parseMemberKey } from "@/lib/programs/memberTemplate";
import type { ProgramTemplate } from "@/lib/programs/types";
import { ProgramDetail, type DetailAction } from "@/components/clientapp/programs/ProgramDetail";

export const dynamic = "force-dynamic";

/** A library program (platform key or "copy-<id>"), or one of the member's own ("member:<id>"). */
export default async function ProgramDetailPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId, client } = requireProgramsPage();
  // A malformed escape (e.g. "%E0%A4%A") makes decodeURIComponent throw: a 404, not a 500.
  let programKey: string;
  try {
    programKey = decodeURIComponent(key);
  } catch {
    notFound();
  }
  const live = liveEnrolment(clientId);
  const ownId = parseMemberKey(programKey);
  let t: ProgramTemplate;
  let content: ProgramContent;
  let running: boolean;
  let startHref: string;
  if (ownId !== null) {
    // Only the member's own: another member's id finds nothing.
    const p = getMemberProgram(clientId, ownId);
    if (!p) notFound();
    t = p.template;
    content = programContent(t, { kind: "member" });
    running = live?.programKey === memberKey(ownId);
    startHref = `/app/programs/built/${ownId}/start`;
  } else {
    const entry = programByKey(programKey);
    if (!entry) notFound();
    t = entry.template;
    content = programContent(t, entry.copyId !== null ? { kind: "copy", basedOnName: entry.basedOnName ?? t.name } : { kind: "platform" });
    running = !!live && (entry.copyId !== null ? live.copyId === entry.copyId : live.programKey === t.key);
    startHref = `/app/programs/${encodeURIComponent(t.key)}/start`;
  }
  const action: DetailAction = running ? { kind: "continue" } : live ? { kind: "busy", runningName: live.template.name } : { kind: "start", href: startHref };
  const unit = running && live ? live.unit : client.weightUnit === "lb" ? "lb" : "kg";
  const stepKg = running && live ? live.stepKg : client.plateStepKg > 0 ? client.plateStepKg : 2.5;
  return (
    <ProgramDetail
      template={t}
      content={content}
      memberBuilt={ownId !== null}
      current={running && live && !live.state.finished ? currentPhase(content, live.template, live.state) : null}
      unit={unit}
      stepKg={stepKg}
      action={action}
      editHref={ownId !== null ? `/app/programs/built/${ownId}` : undefined}
    />
  );
}
```

- [ ] **Step 3: Check it**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts`
Expected: no type errors, both tests pass.

Then a quick look in the dev server (`cd app && npm run dev`) is optional here; the full browser check is in Task 12.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/clientapp/programs/ProgramDetail.tsx "app/src/app/app/programs/[key]/page.tsx"
git commit -m "$(cat <<'MSG'
feat(programs): program page with phases, typical week, why it works and every session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 9: Start a program in four screens (direction A, with the first week in the review)

**Files:**
- Create: `app/src/lib/programs/startFlow.ts`
- Test: `app/src/lib/programs/startFlow.test.ts`
- Modify (rewrite): `app/src/components/clientapp/StartProgramForm.tsx`
- Modify (rewrite): `app/src/app/app/programs/[key]/start/page.tsx`
- Modify (rewrite): `app/src/app/app/programs/built/[id]/start/page.tsx`

**Interfaces:**
- Consumes: `firstSets`, `firstWeek`, `shortDate`, `trainingDates` (Task 2); `PkCard`, `PkSection`, `StepBar`, `StickyBar`, `PkHeader` (Task 6); `startProgramAction` (unchanged: same payload `{ key, unit, step, startDate, weekdays, maxes }`); `convertTyped`, `maxFromSet`, `parseWeightIn`, `stepFromKey`, `trainingMax`, `STEP_OPTIONS`, `StepKey` (`units.ts`).
- Produces:
  - `startFlow.ts`: `type StartStep = "weights" | "maxes" | "days" | "review"`; `STEP_TITLE: Record<StartStep, string>`; `startSteps(hasMaxes: boolean): StartStep[]`; `interface MaxRow { mode: "one_rm" | "set" | "logged"; weight: string; reps: string }`; `interface StartState { at: number; unit; step: StepKey; rows: MaxRow[]; startDate: string; days: number[] }`; `interface StartLift { lift; label; logged: { kg; reps; e1rm } | null; keptKg?: number | null }`; `initialStart(input, keptInUnit): StartState`; `type StartAction` (`next`, `back`, `go`, `unit`, `step`, `row`, `day`, `startDate`); `reduceStart(s, a, count): StartState`; `rowMaxKg(row, lift, unit): number | null`; `maxesKg(s, lifts)`; `maxEntries(s, lifts)` (the action's `maxes`); `stepForError(error: string, steps: StartStep[]): number`.
  - `StartProgramForm({ programKey, programName, template, lifts, initialUnit, initialStep, defaultWeekdays, today, backHref })`. The old `tmPct` prop goes (it comes from `template.tmPct`).

The screens (mockup `start-flow-direction.html`, A for the steps and C for the review): a line "Start <program>, step N of M" and a step bar on every screen. 1. Weights: kg or lb, and the smallest jump. 2. Maxes (left out when the program takes none): one card per lift with three ways in (1-rep max, a recent set, from my log when there is a logged set), a big number entry, and a live line under it: "Max about 140 kg. Your first sets: 4 x 9 at 97.5 kg." 3. Days: weekday toggles and the start date. 4. Review: each max, the units and jump, the training days, the first session date, then the whole first week with real weights, each day on its training date. The sticky button reads "Next: maxes" (and so on) and, on the review, "Start program". Back (a ghost button) keeps everything; on the first screen it goes back to the program page. When the server refuses, its error shows at the top of the screen it belongs to and the flow moves there.

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/programs/startFlow.test.ts`:

```ts
// app/src/lib/programs/startFlow.test.ts
// Run: npm test -- src/lib/programs/startFlow.test.ts
//
// The start flow's state: going back keeps every entry, a unit switch carries
// typed weights over, the review's first week uses the entered maxes, the
// action gets the same payload as before, and each server error lands on
// the screen it belongs to.
import assert from "node:assert/strict";

import { firstWeek } from "./outline";
import { platformProgram } from "./registry";
import { initialStart, maxEntries, maxesKg, reduceStart, rowMaxKg, startSteps, stepForError, type StartAction, type StartLift, type StartState } from "./startFlow";
import { kgToUnit } from "./units";

const steps = startSteps(true);
assert.deepEqual(steps, ["weights", "maxes", "days", "review"]);
assert.deepEqual(startSteps(false), ["weights", "days", "review"], "no maxes screen when the program takes none");

const lifts: StartLift[] = [
  { lift: "squat", label: "Squat", logged: null },
  { lift: "bench", label: "Bench press", logged: { kg: 100, reps: 3, e1rm: 110 } },
];
const kept = (kg: number) => String(kgToUnit(kg, "kg"));
let s: StartState = initialStart({ lifts, unit: "kg", step: "2.5kg", weekdays: [1, 3, 5, 6], today: "2026-11-16" }, kept);
assert.equal(s.at, 0);
assert.deepEqual(s.rows.map((r) => r.mode), ["one_rm", "logged"], "a logged lift starts on its best logged set");
assert.equal(initialStart({ lifts, unit: "lb", step: "2.5kg", weekdays: [], today: "2026-11-16" }, kept).step, "5lb", "the jump follows the unit");
assert.equal(initialStart({ lifts: [{ ...lifts[0], keptKg: 140 }], unit: "kg", step: "2.5kg", weekdays: [], today: "2026-11-16" }, kept).rows[0].weight, "140", "a kept max is filled in");

const run = (state: StartState, ...actions: StartAction[]) => actions.reduce((x, a) => reduceStart(x, a, steps.length), state);

// ── forward, edit, back: everything is kept ──
s = run(s, { type: "step", step: "1.25kg" }, { type: "next" }, { type: "row", index: 0, patch: { weight: "140" } }, { type: "row", index: 1, patch: { mode: "set", weight: "90", reps: "5" } }, { type: "next" });
s = run(s, { type: "day", day: 3 }, { type: "startDate", value: "2026-11-18" }, { type: "next" });
assert.equal(s.at, 3, "on the review");
const before = JSON.stringify({ ...s, at: 0 });
s = run(s, { type: "back" }, { type: "back" }, { type: "back" }, { type: "back" });
assert.equal(s.at, 0, "back stops at the first screen");
assert.equal(JSON.stringify(s), before, "going back keeps every entry");
assert.equal(run(s, { type: "go", at: 9 }).at, 3, "go is clamped");
assert.equal(run(s, { type: "next" }, { type: "next" }, { type: "next" }, { type: "next" }).at, 3, "next stops at the review");
assert.deepEqual(s.days, [1, 5, 6], "a day toggles off");
assert.deepEqual(run(s, { type: "day", day: 2 }).days, [1, 2, 5, 6], "and on, in order");

// ── the maxes, as the server works them out ──
assert.equal(rowMaxKg(s.rows[0], lifts[0], "kg"), 140);
assert.equal(rowMaxKg(s.rows[1], lifts[1], "kg"), 105, "90 x 5 by Epley");
assert.equal(rowMaxKg({ mode: "set", weight: "90", reps: "12" }, lifts[1], "kg"), null, "more than 10 reps reads no max");
assert.equal(rowMaxKg({ mode: "logged", weight: "", reps: "" }, lifts[1], "kg"), 110);
assert.equal(rowMaxKg({ mode: "one_rm", weight: "", reps: "" }, lifts[0], "kg"), null);
assert.deepEqual(maxesKg(s, lifts), { squat: 140, bench: 105 });
assert.deepEqual(maxEntries(s, lifts), [
  { lift: "squat", kind: "one_rm", weight: 140, reps: null },
  { lift: "bench", kind: "set", weight: 90, reps: 5 },
]);

// ── a unit switch carries typed weights over and resets the jump ──
const lb = run(s, { type: "unit", unit: "lb" });
assert.equal(lb.unit, "lb");
assert.equal(lb.step, "5lb");
assert.equal(lb.rows[0].weight, "308.6");
assert.equal(run(lb, { type: "unit", unit: "kg" }).rows[0].weight, "140");
assert.equal(run(s, { type: "unit", unit: "kg" }), s, "the same unit changes nothing");

// ── the review's first week uses the entered max ──
const smolov = platformProgram("smolov-base")!;
const sm: StartLift[] = [{ lift: "squat", label: "Squat", logged: null }];
let ss = initialStart({ lifts: sm, unit: "kg", step: "2.5kg", weekdays: [1, 3, 5, 6], today: "2026-11-16" }, kept);
ss = run(ss, { type: "row", index: 0, patch: { weight: "140" } });
assert.deepEqual(firstWeek(smolov, maxesKg(ss, sm), 2.5, "kg").map((d) => d.lines[0]), ["Back squat 4 x 9 at 97.5 kg", "Back squat 5 x 7 at 105 kg", "Back squat 7 x 5 at 112.5 kg", "Back squat 10 x 3 at 120 kg"]);

// ── a server error shows on its own screen ──
assert.equal(stepForError("Pick a smallest jump in the same unit.", steps), 0);
assert.equal(stepForError("Enter your squat max.", steps), 1);
assert.equal(stepForError("Use a bench press set of 10 reps or fewer.", steps), 1);
assert.equal(stepForError("No deadlift logged in the last 90 days. Enter a max instead.", steps), 1);
assert.equal(stepForError("Add your squat max.", steps), 1);
assert.equal(stepForError("Pick a start date between last week and a year from now.", steps), 2);
assert.equal(stepForError("That program isn't available.", steps), 3);
assert.equal(stepForError("End your current program before you start another.", steps), 3);
assert.equal(stepForError("Pick a start date between last week and a year from now.", startSteps(false)), 1, "without the maxes screen");

console.log("programs/startFlow: ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/startFlow.test.ts`
Expected: FAIL with `Cannot find module './startFlow'`.

- [ ] **Step 3: Write the start flow state**

Create `app/src/lib/programs/startFlow.ts`:

```ts
// app/src/lib/programs/startFlow.ts
/**
 * Starting a program, one question per screen: weights, maxes, days, then a
 * review. The screens share one state, so going back keeps everything. The
 * server checks the entries exactly as before; its error is shown on the
 * screen it belongs to. Pure: the start form runs it in the browser.
 */
import type { LiftKey, WeightUnit } from "./types";
import { convertTyped, maxFromSet, parseWeightIn, type StepKey } from "./units";

export type StartStep = "weights" | "maxes" | "days" | "review";
export const STEP_TITLE: Record<StartStep, string> = { weights: "Weights", maxes: "Maxes", days: "Training days", review: "Review" };

/** The screens in order. A program that takes no max skips the maxes screen. */
export function startSteps(hasMaxes: boolean): StartStep[] {
  return hasMaxes ? ["weights", "maxes", "days", "review"] : ["weights", "days", "review"];
}

export type MaxMode = "one_rm" | "set" | "logged";
export interface MaxRow {
  mode: MaxMode;
  /** As typed, in the member's unit. */
  weight: string;
  reps: string;
}

export interface StartState {
  /** Index into startSteps. */
  at: number;
  unit: WeightUnit;
  step: StepKey;
  rows: MaxRow[];
  startDate: string;
  days: number[];
}

export interface StartLift {
  lift: LiftKey;
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
  /** A max carried from the member's last program, filled in as their 1-rep max. */
  keptKg?: number | null;
}

export function initialStart(input: { lifts: StartLift[]; unit: WeightUnit; step: StepKey; weekdays: number[]; today: string }, keptInUnit: (kg: number) => string): StartState {
  return {
    at: 0,
    unit: input.unit,
    // The smallest jump is always in the member's unit.
    step: input.unit === "lb" ? "5lb" : input.step === "5lb" ? "2.5kg" : input.step,
    rows: input.lifts.map((l) => (l.keptKg ? { mode: "one_rm", weight: keptInUnit(l.keptKg), reps: "" } : { mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })),
    startDate: input.today,
    days: [...input.weekdays],
  };
}

export type StartAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "go"; at: number }
  | { type: "unit"; unit: WeightUnit }
  | { type: "step"; step: StepKey }
  | { type: "row"; index: number; patch: Partial<MaxRow> }
  | { type: "day"; day: number }
  | { type: "startDate"; value: string };

/** One change to the start flow. `count` is how many screens there are. */
export function reduceStart(s: StartState, a: StartAction, count: number): StartState {
  switch (a.type) {
    case "next":
      return { ...s, at: Math.min(count - 1, s.at + 1) };
    case "back":
      return { ...s, at: Math.max(0, s.at - 1) };
    case "go":
      return { ...s, at: Math.max(0, Math.min(count - 1, a.at)) };
    case "unit":
      if (a.unit === s.unit) return s;
      // A max or set weight already typed in follows the switch.
      return { ...s, unit: a.unit, step: a.unit === "lb" ? "5lb" : "2.5kg", rows: s.rows.map((r) => (r.weight ? { ...r, weight: convertTyped(r.weight, s.unit, a.unit) } : r)) };
    case "step":
      return { ...s, step: a.step };
    case "row":
      return { ...s, rows: s.rows.map((r, i) => (i === a.index ? { ...r, ...a.patch } : r)) };
    case "day":
      return { ...s, days: s.days.includes(a.day) ? s.days.filter((d) => d !== a.day) : [...s.days, a.day].sort((x, y) => x - y) };
    case "startDate":
      return { ...s, startDate: a.value };
    default: {
      const never: never = a;
      return never;
    }
  }
}

/** A row's max in kg, as the server will work it out; null when it can't be read yet. */
export function rowMaxKg(r: MaxRow, lift: Pick<StartLift, "logged">, unit: WeightUnit): number | null {
  if (r.mode === "logged") return lift.logged?.e1rm ?? null;
  const kg = parseWeightIn(r.weight, unit);
  if (kg === null || kg <= 0) return null;
  return r.mode === "one_rm" ? kg : maxFromSet(kg, Number(r.reps));
}

/** Every lift's max that can be read, for the previews and the review. */
export function maxesKg(s: StartState, lifts: StartLift[]): Partial<Record<LiftKey, number>> {
  const out: Partial<Record<LiftKey, number>> = {};
  lifts.forEach((l, i) => {
    const kg = rowMaxKg(s.rows[i], l, s.unit);
    if (kg !== null) out[l.lift] = kg;
  });
  return out;
}

/** The maxes as startProgramAction takes them, weights in the member's unit. */
export function maxEntries(s: StartState, lifts: StartLift[]): { lift: LiftKey; kind: MaxMode; weight: number | null; reps: number | null }[] {
  return s.rows.map((r, i) => ({
    lift: lifts[i].lift,
    kind: r.mode,
    weight: r.mode === "logged" ? null : Number(r.weight.replace(",", ".")) || null,
    reps: r.mode === "set" ? Number(r.reps) || null : null,
  }));
}

/** The screen a server error belongs to, so it shows where it can be fixed. */
export function stepForError(error: string, steps: StartStep[]): number {
  const at = (step: StartStep) => Math.max(0, steps.indexOf(step));
  if (/smallest jump/i.test(error)) return at("weights");
  if (/start date/i.test(error)) return at("days");
  if (steps.includes("maxes") && /\bmax\b|\bset of\b|logged in the last/i.test(error)) return at("maxes");
  return at("review");
}
```

Run: `cd app && npm test -- src/lib/programs/startFlow.test.ts`
Expected: PASS, `programs/startFlow: ok`.

- [ ] **Step 4: Rewrite the form as four screens**

Replace the whole of `app/src/components/clientapp/StartProgramForm.tsx` with:

```tsx
// app/src/components/clientapp/StartProgramForm.tsx
"use client";

import { useReducer, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PkCard, PkSection, StepBar, StickyBar } from "@/components/clientapp/programs/kit";
import { startProgramAction } from "@/app/app/programs/actions";
import { firstSets, firstWeek, shortDate, trainingDates } from "@/lib/programs/outline";
import { STEP_TITLE, initialStart, maxEntries, maxesKg, reduceStart, rowMaxKg, startSteps, stepForError, type StartLift } from "@/lib/programs/startFlow";
import type { ProgramTemplate, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, kgToUnit, stepFromKey, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

/**
 * Starting a program, one question per screen: weights, maxes (when the
 * program takes any), days, then a review with the whole first week at the
 * member's real weights. Back keeps everything; the server checks it all on
 * Start, and an error shows on the screen it belongs to.
 */
export function StartProgramForm({
  programKey,
  programName,
  template,
  lifts,
  initialUnit,
  initialStep,
  defaultWeekdays,
  today,
  backHref,
}: {
  programKey: string;
  programName: string;
  /** The program as it will start, for the previews. */
  template: ProgramTemplate;
  lifts: StartLift[];
  initialUnit: WeightUnit;
  initialStep: StepKey;
  defaultWeekdays: number[];
  today: string;
  /** Where Back goes from the first screen. */
  backHref: string;
}) {
  const router = useRouter();
  const steps = startSteps(lifts.length > 0);
  const [s, dispatch] = useReducer(
    (state: ReturnType<typeof initialStart>, a: Parameters<typeof reduceStart>[1]) => reduceStart(state, a, steps.length),
    { lifts, unit: initialUnit, step: initialStep, weekdays: defaultWeekdays, today },
    (input) => initialStart(input, (kg) => String(kgToUnit(kg, input.unit))),
  );
  const [error, setError] = useState<{ at: number; text: string } | null>(null);
  const [pending, start] = useTransition();
  const step = steps[s.at];
  const stepKg = stepFromKey(s.step);
  const fmt = (kg: number) => formatWeight(kg, s.unit);
  const maxes = maxesKg(s, lifts);

  function go(next: number) {
    dispatch({ type: "go", at: next });
    window.scrollTo({ top: 0 });
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await startProgramAction({ key: programKey, unit: s.unit, step: s.step, startDate: s.startDate, weekdays: s.days, maxes: maxEntries(s, lifts) });
      if (!res.ok) {
        const at = stepForError(res.error, steps);
        setError({ at, text: res.error });
        toast.error(res.error);
        go(at);
        return;
      }
      toast.success("Program started");
      router.push("/app/programs/mine");
      router.refresh();
    });
  }

  const kgSteps = STEP_OPTIONS.filter((o) => o.unit === s.unit);
  const dates = trainingDates(s.startDate, s.days, template.weeks[0]?.days.length ?? 0);

  return (
    <div className="pk">
      <div className="pk-head">
        <span className="pk-small">
          Start {programName}, step {s.at + 1} of {steps.length}
        </span>
        <StepBar at={s.at} of={steps.length} label={`Step ${s.at + 1} of ${steps.length}: ${STEP_TITLE[step]}`} />
      </div>

      {error && error.at === s.at && (
        <div className="pk-error" role="alert">
          {error.text}
        </div>
      )}

      {step === "weights" && (
        <>
          <h1 className="pk-question">How do you want your weights?</h1>
          <PkSection label="Weights in">
            <div className="pk-seg" role="group" aria-label="Weights in">
              {(["kg", "lb"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={s.unit === u} onClick={() => dispatch({ type: "unit", unit: u })}>
                  {u === "kg" ? "Kilograms" : "Pounds"}
                </button>
              ))}
            </div>
          </PkSection>
          <PkSection label="Smallest jump">
            <div className="pk-seg" role="group" aria-label="Smallest jump">
              {kgSteps.map((o) => (
                <button key={o.key} type="button" aria-pressed={s.step === o.key} onClick={() => dispatch({ type: "step", step: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
            <span className="pk-small">Every weight rounds to this jump.</span>
          </PkSection>
        </>
      )}

      {step === "maxes" && (
        <>
          <h1 className="pk-question">{lifts.length === 1 ? `What's your ${lifts[0].label.toLowerCase()} max?` : "What are your maxes?"}</h1>
          <span className="pk-muted">Every weight in the program is worked out from {lifts.length === 1 ? "this" : "these"}.</span>
          {lifts.map((l, i) => {
            const r = s.rows[i];
            const est = rowMaxKg(r, l, s.unit);
            const preview = est !== null ? firstSets(template, l.lift, est, stepKg, s.unit) : null;
            return (
              <PkCard key={l.lift}>
                <h2 className="pk-card-title">{l.label}</h2>
                {l.keptKg ? <span className="pk-small">Filled in from your last program.</span> : null}
                <div className="pk-seg" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
                  <button type="button" aria-pressed={r.mode === "one_rm"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "one_rm" } })}>
                    1-rep max
                  </button>
                  <button type="button" aria-pressed={r.mode === "set"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "set" } })}>
                    A recent set
                  </button>
                  {l.logged && (
                    <button type="button" aria-pressed={r.mode === "logged"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "logged" } })}>
                      From my log
                    </button>
                  )}
                </div>
                {r.mode === "logged" && l.logged && (
                  <span className="pk-muted">
                    Your best in the last 90 days: {fmt(l.logged.kg)} x {l.logged.reps}.
                  </span>
                )}
                {r.mode === "one_rm" && (
                  <input
                    className="pk-input pk-big"
                    inputMode="decimal"
                    aria-label={`${l.label} 1-rep max in ${s.unit}`}
                    placeholder={s.unit}
                    value={r.weight}
                    onChange={(e) => dispatch({ type: "row", index: i, patch: { weight: e.target.value } })}
                  />
                )}
                {r.mode === "set" && (
                  <div className="pk-pair">
                    <label className="pk-field">
                      <span>Weight ({s.unit})</span>
                      <input className="pk-input" inputMode="decimal" aria-label={`${l.label} weight in ${s.unit}`} value={r.weight} onChange={(e) => dispatch({ type: "row", index: i, patch: { weight: e.target.value } })} />
                    </label>
                    <label className="pk-field">
                      <span>Reps, 1 to 10</span>
                      <input
                        className="pk-input"
                        inputMode="numeric"
                        aria-label={`${l.label} reps`}
                        value={r.reps}
                        onChange={(e) => dispatch({ type: "row", index: i, patch: { reps: e.target.value.replace(/\D/g, "").slice(0, 2) } })}
                      />
                    </label>
                  </div>
                )}
                {est !== null ? (
                  <span className="pk-muted">
                    Max about {fmt(est)}
                    {template.tmPct !== 1 ? `. Training max ${fmt(trainingMax(est, template.tmPct))}.` : "."}
                    {preview ? ` Your first sets: ${preview}.` : ""}
                  </span>
                ) : r.mode === "set" && Number(r.reps) > 10 ? (
                  <span className="pk-muted">Use a set of 10 reps or fewer.</span>
                ) : null}
              </PkCard>
            );
          })}
        </>
      )}

      {step === "days" && (
        <>
          <h1 className="pk-question">When do you train?</h1>
          <PkSection label="Days you train">
            <div className="td-days" role="group" aria-label="Days you train">
              {WEEKDAY_SHORT.map((label, i) => (
                <button key={label} type="button" className="td-day" aria-pressed={s.days.includes(i + 1)} onClick={() => dispatch({ type: "day", day: i + 1 })}>
                  {label}
                </button>
              ))}
            </div>
            <span className="pk-small">Your program moves on when you finish a session, so a missed day just waits for you.</span>
          </PkSection>
          <label className="pk-field">
            <span>Start date</span>
            <input className="pk-input" type="date" value={s.startDate} min={today} onChange={(e) => dispatch({ type: "startDate", value: e.target.value || today })} />
          </label>
        </>
      )}

      {step === "review" && (
        <>
          <h1 className="pk-question">Ready to go</h1>
          <div>
            {lifts.map((l) => (
              <div key={l.lift} className="pk-sum">
                <span>{l.label} max</span>
                <span>{maxes[l.lift] !== undefined ? fmt(maxes[l.lift]!) : "Not set"}</span>
              </div>
            ))}
            <div className="pk-sum">
              <span>Weights in</span>
              <span>
                {s.unit}, {fmt(stepKg)} jumps
              </span>
            </div>
            <div className="pk-sum">
              <span>Training days</span>
              <span>{s.days.length ? s.days.map((d) => WEEKDAY_SHORT[d - 1]).join(" ") : "None picked"}</span>
            </div>
            <div className="pk-sum">
              <span>First session</span>
              <span>{shortDate(dates[0] ?? s.startDate)}</span>
            </div>
          </div>
          <PkSection label="Your first week">
            {firstWeek(template, maxes, stepKg, s.unit).map((d, i) => (
              <div key={i} className="pk-day">
                <span className="pk-day-name">
                  {dates[i] ? `${shortDate(dates[i])}, ` : ""}
                  {d.name}
                </span>
                {d.lines.map((line, k) => (
                  <span key={k} className="pk-muted">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </PkSection>
        </>
      )}

      <StickyBar>
        {step === "review" ? (
          <button type="button" className="pk-cta" onClick={submit} disabled={pending}>
            {pending ? "Starting" : "Start program"}
          </button>
        ) : (
          <button type="button" className="pk-cta" onClick={() => go(s.at + 1)}>
            Next: {STEP_TITLE[steps[s.at + 1]].toLowerCase()}
          </button>
        )}
      </StickyBar>
      {s.at > 0 ? (
        <button type="button" className="pk-ghost" onClick={() => go(s.at - 1)} disabled={pending}>
          Back
        </button>
      ) : (
        <Link href={backHref} className="pk-ghost">
          Back
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Pass the template to it from both start pages**

Replace the whole of `app/src/app/app/programs/[key]/start/page.tsx` with:

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
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";

export const dynamic = "force-dynamic";

export default async function StartProgramPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId, client } = requireProgramsPage();
  // A malformed escape (e.g. "%E0%A4%A") makes decodeURIComponent throw: a 404, not a 500.
  let programKey: string;
  try {
    programKey = decodeURIComponent(key);
  } catch {
    notFound();
  }
  const entry = programByKey(programKey);
  if (!entry) notFound();
  if (liveEnrolment(clientId)) redirect("/app/programs/mine");
  const t = entry.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <StartProgramForm
      programKey={t.key}
      programName={t.name}
      template={t}
      lifts={lifts}
      initialUnit={unit}
      initialStep={keyFromStep(client.plateStepKg)}
      defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
      today={dateKey(Date.now())}
      backHref={`/app/programs/${encodeURIComponent(t.key)}`}
    />
  );
}
```

Replace the whole of `app/src/app/app/programs/built/[id]/start/page.tsx` with:

```tsx
// app/src/app/app/programs/built/[id]/start/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey, validateMemberTemplate } from "@/lib/programs/memberTemplate";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { PkHeader } from "@/components/clientapp/programs/kit";
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
  const check = validateMemberTemplate(p.template, memberKey(id));
  if (!check.ok) {
    return (
      <div className="pk">
        <PkHeader title="Start program" lead={p.name} />
        <div className="pk-error" role="alert">
          <b>Fix these before you start</b>
          <ul>
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        <Link href={`/app/programs/built/${id}`} className="pk-btn">
          Edit program
        </Link>
      </div>
    );
  }
  const t = check.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null, keptKg: p.maxes[lift] ?? null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <StartProgramForm
      programKey={memberKey(id)}
      programName={t.name}
      template={t}
      lifts={lifts}
      initialUnit={unit}
      initialStep={keyFromStep(client.plateStepKg)}
      defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
      today={dateKey(Date.now())}
      backHref={`/app/programs/${encodeURIComponent(memberKey(id))}`}
    />
  );
}
```

- [ ] **Step 6: Check it**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/startFlow.test.ts && npm test -- src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts && npm test -- src/app/app/programs/actions.test.ts`
Expected: no type errors; all four pass (the action and its validation are untouched).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/programs/startFlow.ts app/src/lib/programs/startFlow.test.ts app/src/components/clientapp/StartProgramForm.tsx "app/src/app/app/programs/[key]/start/page.tsx" "app/src/app/app/programs/built/[id]/start/page.tsx"
git commit -m "$(cat <<'MSG'
feat(programs): start a program one question per screen, ending in the first week

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 10: My program (direction A: today first)

**Files:**
- Modify: `app/src/lib/programs/enrolments.ts` (add `enrolmentCounts`)
- Modify: `app/src/lib/programs/enrolments.test.ts`
- Modify (rewrite): `app/src/app/app/programs/mine/page.tsx`
- Modify: `app/src/components/clientapp/OwnMaxForm.tsx` (class names only)
- Modify: `app/src/components/clientapp/RestartProgramForm.tsx` (class names only)

**Interfaces:**
- Consumes: `programContent`, `withContentFrom`, `currentPhase` (Task 1); `weightWhy` (Task 2); `PhaseBar`, `PkCard`, `PkHeader`, `PkSection`, `StatTiles`, `Timeline`, `Warn` (Task 6); `copyKey`, `programByKey` (`library.ts`); unchanged: `MyProgramControls`, `StartProgramSessionButton`, `WeekStrip`, `RestartProgramForm`, `OwnMaxForm` behaviour.
- Produces: `enrolmentCounts(enrolmentId: number): { done: number; skipped: number }` in `enrolments.ts` (done = `progress` events, skipped = `skip` events, for that enrolment only).

The screen (mockup `my-program-direction.html`, option A): the title; "Week 2 of 4 · Plus 10 kg" (the week, then the current phase when there is one, then "Starts Mon 16 Nov" when it starts later; "Program done" when finished) and the phase bar with the current phase brightest and earlier ones a step dimmer; the paused card when paused; the "Next session" hero (an accent card: "Next session · Wed" or "Today" from this week's plan, or "In progress"; the session title; each exercise with its planned weights and, under it, the line on why (e.g. "70% of your max, plus 10 kg this week."); the test-day warning; Start or Continue session); the "Program done" card with the restart form when the block is finished; "Your numbers" tiles (each max, with the training max under it when it differs, and Sessions "5 of 13" for a full block or "5 done", with "None skipped" or "2 skipped"); "This week" (the existing week strip); "Recent changes" as a timeline of the 10 newest changes; "See the whole program" (links to the program page when the member can open it); then "Your program": Edit program (member programs), the existing controls, and Change a max (member programs with a max).

- [ ] **Step 1: Write the failing test**

In `app/src/lib/programs/enrolments.test.ts`, insert directly above the line `  test("a live enrolment survives deleting the gym copy it started from", () => {`:

```ts
  test("sessions done and skipped are counted from the change log", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    assert.deepEqual(en.enrolmentCounts(id), { done: 0, skipped: 0 });
    runNext(clientId);
    runNext(clientId);
    assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
    assert.deepEqual(en.enrolmentCounts(id), { done: 2, skipped: 1 });
    const other = newMember();
    const otherId = enrolIn(other, "stronglifts-5x5", maxes);
    assert.deepEqual(en.enrolmentCounts(otherId), { done: 0, skipped: 0 }, "counts are per enrolment");
  });

```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/enrolments.test.ts`
Expected: the new case FAILS (`en.enrolmentCounts is not a function`), every other case passes.

- [ ] **Step 3: Add the counts**

In `app/src/lib/programs/enrolments.ts`, replace

```ts
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
```

with

```ts
import { and, count, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
```

and insert directly above the line `export interface EnrolInput {`:

```ts
/** Sessions finished and skipped on this enrolment, from its change log. */
export function enrolmentCounts(enrolmentId: number): { done: number; skipped: number } {
  const rows = db
    .select({ kind: programEnrolmentEvents.kind, n: count() })
    .from(programEnrolmentEvents)
    .where(and(eq(programEnrolmentEvents.enrolmentId, enrolmentId), inArray(programEnrolmentEvents.kind, ["progress", "skip"])))
    .groupBy(programEnrolmentEvents.kind)
    .all();
  return { done: rows.find((r) => r.kind === "progress")?.n ?? 0, skipped: rows.find((r) => r.kind === "skip")?.n ?? 0 };
}

```

Run: `cd app && npm test -- src/lib/programs/enrolments.test.ts`
Expected: every case passes, `programs/enrolments: ok`.

- [ ] **Step 4: Rewrite the page**

Replace the whole of `app/src/app/app/programs/mine/page.tsx` with:

```tsx
// app/src/app/app/programs/mine/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pause, Pencil } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { actorLabel } from "@/lib/programs/cards";
import { currentPhase, programContent, withContentFrom } from "@/lib/programs/content";
import { isFullBlock } from "@/lib/programs/editing";
import { enrolmentCounts, enrolmentEvents, liveEnrolment, planFor, programWeek, sessionTitle } from "@/lib/programs/enrolments";
import { copyKey, programByKey } from "@/lib/programs/library";
import { memberKey, parseMemberKey } from "@/lib/programs/memberTemplate";
import { weightWhy } from "@/lib/programs/outline";
import { sessionCount, summarisePlanned, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { formatWeight } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { openSession } from "@/lib/workoutLog";
import { PhaseBar, PkCard, PkHeader, PkSection, StatTiles, Timeline, Warn } from "@/components/clientapp/programs/kit";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";
import { MyProgramControls } from "@/components/clientapp/MyProgramControls";
import { RestartProgramForm } from "@/components/clientapp/RestartProgramForm";
import { OwnMaxForm } from "@/components/clientapp/OwnMaxForm";

export const dynamic = "force-dynamic";

/** How many changes the timeline shows. */
const RECENT = 10;

function when(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

/** My program (direction A, today first): where the member is, the next session with its weights and why, key numbers, recent changes, then the controls. */
export default async function MyProgramPage() {
  const { clientId } = requireProgramsPage();
  const view = liveEnrolment(clientId);
  if (!view) redirect("/app/programs");
  const t = view.template;
  // One of the member's own programs: they can edit it and set its maxes.
  const ownId = view.programKey ? parseMemberKey(view.programKey) : null;
  // The library entry it came from, for content a snapshot taken before programs had it, and for the link to the program page.
  const source = ownId !== null ? null : view.copyId !== null ? programByKey(copyKey(view.copyId)) : view.programKey ? programByKey(view.programKey, { includeHidden: true }) : null;
  const content =
    ownId !== null
      ? programContent(t, { kind: "member" })
      : programContent(withContentFrom(t, source?.template ?? null), source && source.copyId !== null ? { kind: "copy", basedOnName: source.basedOnName ?? t.name } : { kind: "platform" });
  const programHref =
    ownId !== null ? `/app/programs/${encodeURIComponent(memberKey(ownId))}` : source && !source.hidden ? `/app/programs/${encodeURIComponent(source.template.key)}` : null;

  const active = view.status === "active";
  const plan = active ? planFor(view) : null;
  const day = t.weeks[view.state.week]?.days[view.state.day];
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  const events = enrolmentEvents(view.id, RECENT);
  const counts = enrolmentCounts(view.id);
  const today = dateKey(Date.now());
  const week = active && !view.state.finished ? programWeek(view) : [];
  const next = week.find((d) => d.status === "today" || d.status === "planned");
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  const phase = view.state.finished ? null : currentPhase(content, t, view.state);
  const startsLater = view.startDate > today ? `. Starts ${new Date(`${view.startDate}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}` : "";
  const where = view.state.finished ? "Program done" : `${weekLabel(t, view.state)}${phase !== null ? ` · ${content.phases[phase].name}` : ""}${startsLater}`;

  return (
    <div className="pk">
      <PkHeader title={t.name} lead={where}>
        <PhaseBar phases={content.phases} current={phase} />
      </PkHeader>

      {view.status === "paused" && (
        <PkCard>
          <div className="pk-row">
            <span className="pk-muted">Paused while you&rsquo;re coach guided. Nothing is lost.</span>
            <Pause size={18} aria-hidden className="pk-chev" />
          </div>
        </PkCard>
      )}

      {plan && (
        <PkCard accent>
          <span className="pk-small">{inProgress ? "In progress" : next ? `Next session · ${next.status === "today" ? "Today" : next.label}` : "Next session"}</span>
          <h2 className="pk-card-title">{sessionTitle(view, plan)}</h2>
          {plan.test && <Warn>Test day. Work up to a new max with a spotter or safety bars.</Warn>}
          {plan.exercises.map((ex) => {
            const why = weightWhy(ex, day?.exercises[ex.index], t.tmPct, view.unit);
            return (
              <div key={ex.index}>
                <div className="pk-line">
                  <span>{ex.name}</span>
                  <span>{summarisePlanned(ex.sets, view.unit)}</span>
                </div>
                {why && <span className="pk-small">{why}</span>}
              </div>
            );
          })}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </PkCard>
      )}

      {active && view.state.finished && (
        <PkCard>
          <h2 className="pk-card-title">Program done</h2>
          <span className="pk-muted">Enter your new max to run it again, or end it and pick another.</span>
          <RestartProgramForm unit={view.unit} lifts={t.lifts.map((l) => ({ lift: l, label: LIFT_LABEL[l], suggestionKg: view.state.testMaxes[l] ?? view.state.maxes[l] ?? null }))} />
        </PkCard>
      )}

      <PkSection label="Your numbers">
        <StatTiles
          tiles={[
            ...t.lifts.map((l) => ({
              label: `${LIFT_LABEL[l]} max`,
              value: view.state.maxes[l] !== undefined ? fmt(view.state.maxes[l]!) : "-",
              sub: t.tmPct !== 1 && view.state.tms[l] !== undefined ? `Training max ${fmt(view.state.tms[l]!)}` : undefined,
            })),
            {
              label: "Sessions",
              value: isFullBlock(t) ? `${counts.done} of ${sessionCount(t)}` : `${counts.done} done`,
              sub: counts.skipped === 0 ? "None skipped" : `${counts.skipped} skipped`,
            },
          ]}
        />
      </PkSection>

      {week.length > 0 && (
        <PkSection label="This week">
          <WeekStrip days={week} todayKey={today} />
        </PkSection>
      )}

      {events.length > 0 && (
        <PkSection label="Recent changes">
          <Timeline items={events.map((e) => ({ id: e.id, when: `${when(e.at)}, ${actorLabel(e.actor, e.actorName, true)}`, lines: e.reason.split("\n") }))} />
        </PkSection>
      )}

      {programHref && (
        <Link href={programHref} className="pk-btn">
          See the whole program
        </Link>
      )}

      <PkSection label="Your program">
        {ownId !== null && (
          <Link href={`/app/programs/built/${ownId}`} className="pk-ghost">
            <Pencil size={16} aria-hidden /> Edit program
          </Link>
        )}
        {active && <MyProgramControls canSkip={!!plan} weekdays={view.weekdays} />}
        {ownId !== null && t.lifts.length > 0 && <OwnMaxForm unit={view.unit} lifts={t.lifts} />}
      </PkSection>
    </div>
  );
}
```

- [ ] **Step 5: Move the two max forms onto kit classes**

In `app/src/components/clientapp/OwnMaxForm.tsx`, change `className="pg-row"` to `className="pk-pair"`, and both `className="pg-input"` to `className="pk-input"` (the select keeps the global 36px right padding). In `app/src/components/clientapp/RestartProgramForm.tsx`, change `className="pg-input"` to `className="pk-input"`. Nothing else in either file changes.

- [ ] **Step 6: Check it**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts && npm test -- src/lib/programs/enrolments.test.ts`
Expected: no type errors, all pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/programs/enrolments.ts app/src/lib/programs/enrolments.test.ts app/src/app/app/programs/mine/page.tsx app/src/components/clientapp/OwnMaxForm.tsx app/src/components/clientapp/RestartProgramForm.tsx
git commit -m "$(cat <<'MSG'
feat(programs): My program shows today first, the phase, key numbers and recent changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 11: The builder (direction A: day cards with an edit sheet)

**Files:**
- Modify: `app/src/lib/programs/memberEditing.ts` (the sheet's field helpers)
- Modify: `app/src/lib/programs/memberEditing.test.ts`
- Modify (rewrite): `app/src/components/clientapp/MemberProgramBuilder.tsx`
- Modify (rewrite): `app/src/app/app/programs/built/[id]/page.tsx`
- Modify (rewrite): `app/src/app/app/programs/built/new/page.tsx`

**Interfaces:**
- Consumes: `ruleSentence` (Task 2); `Sheet`, `PkCard`, `StickyBar`, `PkHeader`, `PkSection` (Task 6); every existing helper in `memberEditing.ts` (`draftFrom`, `addWeek`, `removeWeek`, `moveWeek`, `addDay`, `removeDay`, `moveDay`, `moveExercise`, `removeExercise`, `newExercise`, `applyRule`, `addSet`, `setRest`); `saveBuiltProgramAction`, `deleteBuiltProgramAction` (unchanged).
- Produces: in `memberEditing.ts`, `setStartKg(ex, kg | null)`, `setIncKg(ex, kg | null)`, `setDeloadAfter(ex, n | null)`, `setLift(ex, lift)`, `setSetReps(ex, si, min | null, max | null, keepRange)`, `setSetCount(ex, si, n | null)`, `setSetPct(ex, si, percent | null)`, `setSetRpe(ex, si, rpe | null)`, `toggleAmrap(ex, si)`, `removeSet(ex, si)`, `setNotes(ex, text)`, `toggleJoined(ex)`. Each does exactly what the current builder's inline handler does (they are moved out so the sheet's edits can be tested). `MemberProgramBuilder` gains a required `stepKg: number` prop.

What stays exactly as it is (read the current `MemberProgramBuilder.tsx` before you replace it and compare): the `edit()` draft update through `structuredClone`; `save()` with `const sent = d`, `programId = id ?? createdId.current`, `createdId.current = r.id` on the first create, `from` sent only when there is no id yet, `weekOrigins: sent.origins`, and on success `setD((prev) => (prev.template === sent.template ? { ...prev, origins: sent.template.weeks.map((_, i) => i) } : prev))`; `router.replace` to the new id after a create; `remove()` asking before the transition starts; the `<fieldset className="pk-lock" disabled={pending}>` around everything editable (the sheet renders inside it); the Save button outside the fieldset with `disabled={pending}`; the exercise picker; the week tabs, week move, label and remove; day rename, move and remove; every limit from `MEMBER_LIMITS`. New: Save also closes the sheet; moving an exercise moves the sheet with it; the picker hides the sheet while it is open (so Escape closes only the picker).

The screen (mockup `builder-direction.html`, option A): the header (name, "See the program" and, when nothing is running, "Start this program"); a card with the name box, the "4 days a week, one week that repeats" line and the units switch; the week tabs with "Add a week"; a card per day with its name box and tools, a row per exercise (name, "4 x 3-5", "superset with the one above" when joined, and a rule badge), and a dashed "Add exercise"; "Add a day"; the sticky "Save program"; "Delete this program". Tapping an exercise opens the sheet: "Change exercise"; the rule picker as five tiles (Add weight each session, Rep range then add weight, Percent of my max, Target effort (RPE), I choose the weight); the sets with reps (and percentages or RPE); rest; the rule's fields (add each time, misses, start weight with "Now X" while running, percent-of lift); notes; superset; one generated sentence on how it will progress; then move up, move down, Remove, and Done.

- [ ] **Step 1: Write the failing test**

In `app/src/lib/programs/memberEditing.test.ts`, replace the import line

```ts
import { addDay, addSet, addWeek, applyRule, defaultIncKg, draftFrom, guessLift, moveDay, moveExercise, moveWeek, newExercise, removeDay, removeExercise, removeWeek, setRest } from "./memberEditing";
```

with

```ts
import {
  addDay,
  addSet,
  addWeek,
  applyRule,
  defaultIncKg,
  draftFrom,
  guessLift,
  moveDay,
  moveExercise,
  moveWeek,
  newExercise,
  removeDay,
  removeExercise,
  removeSet,
  removeWeek,
  setDeloadAfter,
  setIncKg,
  setLift,
  setNotes,
  setRest,
  setSetCount,
  setSetPct,
  setSetReps,
  setSetRpe,
  setStartKg,
  toggleAmrap,
  toggleJoined,
} from "./memberEditing";
```

and replace the last line `console.log("programs/memberEditing: ok");` with

```ts
// ── the exercise sheet: each box changes the field it is for, and the saved program carries it ──
{
  const lin = newExercise("Back squat");
  setIncKg(lin, 5);
  setDeloadAfter(lin, 2.4);
  setStartKg(lin, 60);
  assert.deepEqual(lin.rule, { kind: "linear", incKg: 5, deloadAfter: 2, startKg: 60 });
  setStartKg(lin, null);
  assert.ok(lin.rule?.kind === "linear" && !("startKg" in lin.rule), "an empty start box removes the start weight");
  setIncKg(lin, null);
  setDeloadAfter(lin, null);
  assert.deepEqual(lin.rule, { kind: "linear", incKg: 0, deloadAfter: 0 }, "an empty linear box is 0, for the save check to refuse");

  const rng = applyRule(newExercise("Bench press"), "range");
  setIncKg(rng, 1.25);
  assert.deepEqual(rng.rule, { kind: "range", incKg: 1.25 });
  setIncKg(rng, 0);
  assert.deepEqual(rng.rule, { kind: "range" }, "range goes back to the smallest jump");
  setSetReps(rng, 0, 6, 10, true);
  assert.deepEqual(rng.sets[0].kind === "fixed" && rng.sets[0].reps, { min: 6, max: 10 });
  setSetReps(rng, 0, 6, null, true);
  assert.deepEqual(rng.sets[0].kind === "fixed" && rng.sets[0].reps, { min: 6, max: 0 }, "a range stays a range");

  const man = applyRule(newExercise("Curl"), "manual");
  setSetReps(man, 1, 8, 12, false);
  assert.deepEqual(man.sets[1].kind === "fixed" && man.sets[1].reps, { min: 8, max: 12 });
  setSetReps(man, 1, 8, 8, false);
  assert.equal(man.sets[1].kind === "fixed" && man.sets[1].reps, 8, "a top no higher than the bottom is a single count");

  const pc = applyRule(newExercise("Bench press"), "percent");
  setLift(pc, "press");
  setSetPct(pc, 0, 82.5);
  setSetCount(pc, 0, 3);
  toggleAmrap(pc, 2);
  assert.equal(pc.lift, "press");
  assert.deepEqual(pc.sets[0], { kind: "pct", pct: 0.825, reps: 3, rest: 120 });
  assert.equal(pc.sets[2].kind, "amrap");
  toggleAmrap(pc, 2);
  assert.equal(pc.sets[2].kind, "pct", "and back");

  const rp = applyRule(newExercise("Barbell row"), "rpe");
  setSetRpe(rp, 1, 9);
  setSetCount(rp, 1, 6);
  assert.deepEqual(rp.sets[1], { kind: "rpe", rpe: 9, reps: 6, rest: 120 });

  const lin2 = newExercise("Deadlift");
  toggleAmrap(lin2, 2);
  assert.ok(lin2.sets[2].kind === "fixed" && lin2.sets[2].amrap === true);
  removeSet(lin2, 0);
  removeSet(lin2, 0);
  removeSet(lin2, 0);
  assert.equal(lin2.sets.length, 1, "the last set stays");

  setNotes(lin2, "Belt on.");
  assert.equal(lin2.notes, "Belt on.");
  setNotes(lin2, "");
  assert.ok(!("notes" in lin2));
  toggleJoined(lin2);
  assert.equal(lin2.joined, true);
  toggleJoined(lin2);
  assert.ok(!("joined" in lin2));

  // What the sheet changed is what the save check sees.
  const t = blankMemberTemplate();
  t.weeks[0].days[0].exercises = [newExercise("Back squat"), pc, rng];
  setSetReps(t.weeks[0].days[0].exercises[2], 0, 6, 10, true);
  const checked = validateMemberTemplate(t, "member:1");
  assert.ok(checked.ok, checked.ok ? "" : checked.errors.join(" | "));
  assert.deepEqual(checked.template.weeks[0].days[0].exercises[1].sets[0], { kind: "pct", pct: 0.825, reps: 3, rest: 120 });
  assert.equal(checked.template.weeks[0].days[0].exercises[1].lift, "press");
  assert.deepEqual(checked.template.lifts, ["press"], "the percent exercise's max is asked for");
}

console.log("programs/memberEditing: ok");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd app && npm test -- src/lib/programs/memberEditing.test.ts`
Expected: FAIL (`setIncKg` and the rest are not exported).

- [ ] **Step 3: Add the sheet's field helpers**

Append to the end of `app/src/lib/programs/memberEditing.ts`:

```ts
// ── The builder's exercise sheet. Each helper changes one field of the exercise it is given, as the sheet's boxes do. ──

/** A linear, range or manual rule's starting weight in kg; empty, 0 or less removes it. */
export function setStartKg(ex: ExerciseRx, kg: number | null): void {
  const r = ex.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return;
  if (kg === null || kg <= 0) delete r.startKg;
  else r.startKg = kg;
}

/** The weight a rule adds, in kg. Linear: an empty box is 0, which the save check refuses. Range: empty, 0 or less goes back to the smallest jump. */
export function setIncKg(ex: ExerciseRx, kg: number | null): void {
  const r = ex.rule;
  if (r?.kind === "linear") r.incKg = kg === null ? 0 : kg;
  else if (r?.kind === "range") {
    if (kg === null || kg <= 0) delete r.incKg;
    else r.incKg = kg;
  }
}

/** Linear: misses in a row before it gets lighter. An empty box is 0, which the save check refuses. */
export function setDeloadAfter(ex: ExerciseRx, n: number | null): void {
  if (ex.rule?.kind === "linear") ex.rule.deloadAfter = n === null ? 0 : Math.round(n);
}

/** Percent: the max the percentages come from. */
export function setLift(ex: ExerciseRx, lift: LiftKey): void {
  ex.lift = lift;
}

/** Set si's reps on a fixed set. keepRange (a range rule) always stores a range; otherwise a top above the bottom makes a range. Empty is 0. */
export function setSetReps(ex: ExerciseRx, si: number, min: number | null, max: number | null, keepRange: boolean): void {
  const cur = ex.sets[si];
  if (!cur || cur.kind !== "fixed") return;
  const lo = min === null ? 0 : Math.round(min);
  if (keepRange) cur.reps = { min: lo, max: max === null ? 0 : Math.round(max) };
  else cur.reps = max !== null && max > lo ? { min: lo, max: Math.round(max) } : lo;
}

/** Set si's rep count on a percent or RPE set. Empty is 0. */
export function setSetCount(ex: ExerciseRx, si: number, n: number | null): void {
  const cur = ex.sets[si];
  if (cur && (cur.kind === "pct" || cur.kind === "amrap" || cur.kind === "rpe")) cur.reps = n === null ? 0 : Math.round(n);
}

/** Set si's percentage, typed as a percent (75 is 75%). Empty is 0. */
export function setSetPct(ex: ExerciseRx, si: number, percent: number | null): void {
  const cur = ex.sets[si];
  if (cur && (cur.kind === "pct" || cur.kind === "amrap")) cur.pct = percent === null ? 0 : percent / 100;
}

/** Set si's RPE. Empty is 0. */
export function setSetRpe(ex: ExerciseRx, si: number, rpe: number | null): void {
  const cur = ex.sets[si];
  if (cur?.kind === "rpe") cur.rpe = rpe === null ? 0 : rpe;
}

/** Set si as many reps as you can, or back. */
export function toggleAmrap(ex: ExerciseRx, si: number): void {
  const cur = ex.sets[si];
  if (!cur) return;
  if (cur.kind === "fixed") {
    if (cur.amrap) delete cur.amrap;
    else cur.amrap = true;
  } else if (cur.kind === "pct" || cur.kind === "amrap") ex.sets[si] = { ...cur, kind: cur.kind === "pct" ? "amrap" : "pct" };
}

/** Remove set si; the last set stays. */
export function removeSet(ex: ExerciseRx, si: number): void {
  if (ex.sets.length > 1 && inRange(si, ex.sets.length)) ex.sets.splice(si, 1);
}

/** The exercise's notes; empty removes them. */
export function setNotes(ex: ExerciseRx, text: string): void {
  if (text) ex.notes = text;
  else delete ex.notes;
}

/** Done back to back with the exercise above, or not. */
export function toggleJoined(ex: ExerciseRx): void {
  if (ex.joined) delete ex.joined;
  else ex.joined = true;
}
```

Run: `cd app && npm test -- src/lib/programs/memberEditing.test.ts`
Expected: PASS, `programs/memberEditing: ok`.

- [ ] **Step 4: Rewrite the builder**

Replace the whole of `app/src/components/clientapp/MemberProgramBuilder.tsx` with:

```tsx
// app/src/components/clientapp/MemberProgramBuilder.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PkCard, StickyBar } from "@/components/clientapp/programs/kit";
import { Sheet } from "@/components/clientapp/programs/Sheet";
import { ExercisePicker } from "@/components/clientapp/ExercisePicker";
import { deleteBuiltProgramAction, saveBuiltProgramAction } from "@/app/app/programs/built/actions";
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
  removeSet,
  removeWeek,
  setDeloadAfter,
  setIncKg,
  setLift,
  setNotes,
  setRest,
  setSetCount,
  setSetPct,
  setSetReps,
  setSetRpe,
  setStartKg,
  toggleAmrap,
  toggleJoined,
  type BuilderDraft,
} from "@/lib/programs/memberEditing";
import { MEMBER_LIMITS, memberLine } from "@/lib/programs/memberTemplate";
import { stateKey, summariseRx } from "@/lib/programs/planner";
import { ruleSentence } from "@/lib/programs/progressionText";
import { LIFT_KEYS, LIFT_LABEL, RULE_KINDS, RULE_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type WeightUnit } from "@/lib/programs/types";
import { STEP_5LB_KG, formatWeight, kgToUnit, unitToKg } from "@/lib/programs/units";

/** The rule picker's tiles, in the member's words. */
const RULE_TILE: Record<RuleKind, string> = {
  linear: "Add weight each session",
  range: "Rep range, then add weight",
  percent: "Percent of my max",
  rpe: "Target effort (RPE)",
  manual: "I choose the weight",
};

/** A number box that can be emptied while typing: an empty box is null, a usable number is passed on as typed. */
function NumberBox({ value, onValue, label, decimal, placeholder }: { value: number | null; onValue: (n: number | null) => void; label: string; decimal?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="pk-input pk-num"
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
  const toKg = (n: number | null) => (n === null ? null : unitToKg(n, unit));
  const start =
    r.kind === "linear" || r.kind === "range" || r.kind === "manual" ? (
      <label className="pk-field">
        <span>Start at ({unit})</span>
        <NumberBox decimal label={`Start weight in ${unit}`} placeholder="Optional" value={inUnit(r.startKg)} onValue={(n) => onChange((x) => setStartKg(x, toKg(n)))} />
        {running && nowKg !== null && <span className="pk-small">Now {formatWeight(nowKg, unit)}. Change this to set a new weight from your next session.</span>}
      </label>
    ) : null;
  if (r.kind === "linear") {
    return (
      <div className="pk-pair">
        <label className="pk-field">
          <span>Add each time ({unit})</span>
          <NumberBox decimal label={`Weight to add in ${unit}`} value={inUnit(r.incKg)} onValue={(n) => onChange((x) => setIncKg(x, toKg(n)))} />
        </label>
        <label className="pk-field">
          <span>Lighter after misses</span>
          <NumberBox label="Misses in a row before it gets lighter" value={r.deloadAfter} onValue={(n) => onChange((x) => setDeloadAfter(x, n))} />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "range") {
    return (
      <div className="pk-pair">
        <label className="pk-field">
          <span>Add at the top ({unit})</span>
          <NumberBox decimal label={`Weight to add in ${unit}`} placeholder="Smallest jump" value={inUnit(r.incKg)} onValue={(n) => onChange((x) => setIncKg(x, toKg(n)))} />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "percent") {
    return (
      <label className="pk-field">
        <span>Percent of your</span>
        <select className="pk-input" value={ex.lift ?? ""} onChange={(e) => onChange((x) => setLift(x, e.target.value as LiftKey))}>
          {LIFT_KEYS.map((l) => (
            <option key={l} value={l}>
              {LIFT_LABEL[l]} max
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (r.kind === "manual") return start;
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
    <div className="pk-sets">
      <div className="pk-set pk-set--head" aria-hidden>
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
        return (
          <div key={si} className="pk-set">
            <span className="pk-setno">{n}</span>
            {kind === "linear" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, null, false))} />
                <span />
              </>
            )}
            {kind === "range" && (
              <>
                <NumberBox label={`Set ${n} bottom of the rep range`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, fixedMax, true))} />
                <NumberBox label={`Set ${n} top of the rep range`} value={fixedMax} onValue={(v) => onChange((x) => setSetReps(x, si, fixedMin, v, true))} />
              </>
            )}
            {kind === "manual" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, fixedMax, false))} />
                <NumberBox label={`Set ${n} top of the rep range`} placeholder="-" value={fixedMax} onValue={(v) => onChange((x) => setSetReps(x, si, fixedMin, v, false))} />
              </>
            )}
            {kind === "percent" && (s.kind === "pct" || s.kind === "amrap") && (
              <>
                <NumberBox decimal label={`Set ${n} percentage of your max`} value={Math.round(s.pct * 1000) / 10} onValue={(v) => onChange((x) => setSetPct(x, si, v))} />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={(v) => onChange((x) => setSetCount(x, si, v))} />
              </>
            )}
            {kind === "rpe" && s.kind === "rpe" && (
              <>
                <NumberBox decimal label={`Set ${n} RPE`} value={s.rpe} onValue={(v) => onChange((x) => setSetRpe(x, si, v))} />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={(v) => onChange((x) => setSetCount(x, si, v))} />
              </>
            )}
            {plus ? (
              <button
                type="button"
                className="pk-plus"
                aria-pressed={s.kind === "amrap" || (s.kind === "fixed" && s.amrap === true)}
                aria-label={`Set ${n}: as many reps as you can`}
                onClick={() => onChange((x) => toggleAmrap(x, si))}
              >
                +
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="pk-icon" aria-label={`Remove set ${n}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => removeSet(x, si))}>
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {ex.sets.length < MEMBER_LIMITS.sets && (
        <button type="button" className="pk-ghost" onClick={() => onChange((x) => addSet(x))}>
          <Plus size={16} /> Add set
        </button>
      )}
    </div>
  );
}

/**
 * The edit sheet for one exercise: how it moves, its sets, reps and rest, the
 * rule's fields, notes, superset, a sentence on how it will progress, then
 * move, remove and Done. Every change goes straight into the draft.
 */
function ExerciseSheet({
  ex,
  index,
  count,
  unit,
  stepKg,
  running,
  nowKg,
  onChange,
  onRule,
  onRename,
  onMove,
  onRemove,
  onClose,
}: {
  ex: ExerciseRx;
  index: number;
  count: number;
  unit: WeightUnit;
  stepKg: number;
  running: boolean;
  nowKg: number | null;
  onChange: Edit;
  onRule: (kind: RuleKind) => void;
  onRename: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const rule = ex.rule?.kind ?? "manual";
  return (
    <Sheet
      title={ex.name}
      onClose={onClose}
      footer={
        <>
          <div className="pk-actions">
            <button type="button" className="pk-icon" aria-label={`Move ${ex.name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="pk-icon" aria-label={`Move ${ex.name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="pk-btn pk-btn--danger" onClick={onRemove}>
              <Trash2 size={16} aria-hidden /> Remove
            </button>
          </div>
          <button type="button" className="pk-cta" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <button type="button" className="pk-ghost" onClick={onRename}>
        <Pencil size={16} aria-hidden /> Change exercise
      </button>
      <div className="pk-section">
        <span className="pk-label">How it moves</span>
        <div className="pk-tiles" role="group" aria-label="How the weight moves">
          {RULE_KINDS.map((k) => (
            <button key={k} type="button" className="pk-tile" aria-pressed={rule === k} onClick={() => onRule(k)}>
              {RULE_TILE[k]}
            </button>
          ))}
        </div>
      </div>
      <SetRows ex={ex} onChange={onChange} />
      <label className="pk-field">
        <span>Rest between sets (seconds)</span>
        <NumberBox label="Rest in seconds" value={ex.sets[0]?.rest ?? 0} onValue={(n) => onChange((x) => setRest(x, n ?? 0))} />
      </label>
      <RuleFields ex={ex} unit={unit} running={running} nowKg={nowKg} onChange={onChange} />
      <label className="pk-field">
        <span>Notes</span>
        <textarea
          className="pk-input pk-notes"
          rows={2}
          maxLength={MEMBER_LIMITS.notes}
          placeholder="Optional"
          value={ex.notes ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange((x) => setNotes(x, v));
          }}
        />
      </label>
      {index > 0 && (
        <button type="button" className="pk-tile" aria-pressed={ex.joined === true} onClick={() => onChange((x) => toggleJoined(x))}>
          Superset with the exercise above
        </button>
      )}
      <p className="pk-muted">{ruleSentence(ex, unit, stepKg)}</p>
    </Sheet>
  );
}

type Spot = { w: number; di: number; xi: number | null };

/**
 * The member's program builder (direction A, day cards with an edit sheet):
 * name and units, week tabs, a card per day with a row per exercise, and a
 * sheet to edit the exercise tapped. Phone-first. Save checks everything on
 * the server and lists what needs fixing. While saving, everything is locked;
 * a new program is created once and every later save edits it.
 * `from` is set for a new program (the builder's ?from=); `running` when the
 * member is running this program, with its working weights by state key.
 */
export function MemberProgramBuilder({
  id,
  from,
  initial,
  initialUnit,
  stepKg,
  running,
  current,
}: {
  id: number | null;
  from: string | null;
  initial: ProgramTemplate;
  initialUnit: WeightUnit;
  /** The member's smallest jump, for the sentence on how an exercise progresses. */
  stepKg: number;
  running: boolean;
  current: Record<string, number>;
}) {
  const router = useRouter();
  const [d, setD] = useState<BuilderDraft>(() => draftFrom(initial, id !== null));
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [wi, setWi] = useState(0);
  const [open, setOpen] = useState<{ w: number; di: number; xi: number } | null>(null);
  const [picking, setPicking] = useState<Spot | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  // Set the moment the create action returns, so no later save can create a second program.
  const createdId = useRef<number | null>(null);
  const t = d.template;
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];
  // The step the sentences use follows the unit shown on this screen.
  const shownStep = unit === "lb" ? STEP_5LB_KG : Math.abs(stepKg - STEP_5LB_KG) < 1e-3 ? 2.5 : stepKg;
  const sheetEx = open ? t.weeks[open.w]?.days[open.di]?.exercises[open.xi] : undefined;

  function edit(fn: (draft: BuilderDraft) => void) {
    setD((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  function save() {
    const sent = d;
    const programId = id ?? createdId.current;
    setOpen(null);
    start(async () => {
      const r = await saveBuiltProgramAction({ id: programId, from: programId === null ? from : null, template: sent.template, weekOrigins: sent.origins });
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Not saved. See what needs fixing at the top.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (programId === null) createdId.current = r.id;
      setErrors([]);
      // Saved: every week of the saved snapshot is now a saved week. If the draft moved on, leave origins alone.
      setD((prev) => (prev.template === sent.template ? { ...prev, origins: sent.template.weeks.map((_, i) => i) } : prev));
      toast.success(r.edited ? "Saved. Your program uses it from your next session." : "Saved.");
      if (id === null) router.replace(`/app/programs/built/${r.id}`);
      router.refresh();
    });
  }

  function remove() {
    if (id === null) return;
    // Ask before the transition starts, so the dialog is not inside it.
    if (!confirm(`Delete "${t.name || "this program"}"? This can't be undone.`)) return;
    start(async () => {
      const r = await deleteBuiltProgramAction(id);
      if (!r.ok) {
        setErrors([r.error]);
        toast.error(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      toast.success("Program deleted.");
      router.replace("/app/programs");
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
    // A new exercise opens in the sheet; a renamed one stays open.
    if (p.xi === null) setOpen({ w: p.w, di: p.di, xi: t.weeks[p.w].days[p.di].exercises.length });
  }

  return (
    <div className="pk">
      {errors.length > 0 && (
        <div className="pk-error" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="pk-lock" disabled={pending}>
        <PkCard>
          <label className="pk-field">
            <span>Name</span>
            <input
              className="pk-input"
              maxLength={MEMBER_LIMITS.name}
              value={t.name}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => void (x.template.name = v));
              }}
            />
          </label>
          <span className="pk-small">{memberLine(t)}</span>
          <div className="pk-field">
            <span>Weights in</span>
            <div className="pk-seg" role="group" aria-label="Units">
              {(["kg", "lb"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
                  {u === "kg" ? "Kilograms" : "Pounds"}
                </button>
              ))}
            </div>
            <span className="pk-small">This changes how weights are shown on this screen. They are saved in kg.</span>
          </div>
          {running && <span className="pk-small">You&rsquo;re running this program. Changes apply from your next session. Nothing you have logged changes.</span>}
        </PkCard>

        <div className="pk-tabs" role="group" aria-label="Weeks">
          {t.weeks.map((wk, i) => (
            <button key={i} type="button" aria-pressed={i === w} className="pk-tab" onClick={() => setWi(i)}>
              Week {i + 1}
              {wk.label ? `: ${wk.label}` : ""}
            </button>
          ))}
          {t.weeks.length < MEMBER_LIMITS.weeks && (
            <button
              type="button"
              className="pk-tab"
              onClick={() => {
                edit((x) => void addWeek(x, w));
                setOpen(null);
                setWi(w + 1);
              }}
            >
              <Copy size={16} aria-hidden /> Add a week
            </button>
          )}
        </div>
        <span className="pk-small">{t.weeks.length === 1 ? "Week 1 repeats. Add a week to copy it and change the copy, for a block or a deload." : `The ${t.weeks.length} weeks run in order, then start again.`}</span>
        {t.weeks.length > 1 && (
          <div className="pk-row">
            <button
              type="button"
              className="pk-icon"
              aria-label="Move this week earlier"
              disabled={w === 0}
              onClick={() => {
                edit((x) => void moveWeek(x, w, -1));
                setOpen(null);
                setWi(w - 1);
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              className="pk-icon"
              aria-label="Move this week later"
              disabled={w === t.weeks.length - 1}
              onClick={() => {
                edit((x) => void moveWeek(x, w, 1));
                setOpen(null);
                setWi(w + 1);
              }}
            >
              <ArrowRight size={16} />
            </button>
            <input
              className="pk-input"
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
              className="pk-icon"
              aria-label={`Remove week ${w + 1}`}
              onClick={() => {
                edit((x) => removeWeek(x, w));
                setOpen(null);
                setWi(Math.max(0, w - 1));
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {week.days.map((day, di) => (
          <PkCard key={`${w}-${di}`}>
            <div className="pk-row">
              <input
                className="pk-input"
                aria-label={`Day ${di + 1} name`}
                maxLength={MEMBER_LIMITS.name}
                value={day.name}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((x) => void (x.template.weeks[w].days[di].name = v));
                }}
              />
              <button
                type="button"
                className="pk-icon"
                aria-label={`Move ${day.name} up`}
                disabled={di === 0}
                onClick={() => {
                  edit((x) => void moveDay(x.template, w, di, -1));
                  setOpen(null);
                }}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="pk-icon"
                aria-label={`Move ${day.name} down`}
                disabled={di === week.days.length - 1}
                onClick={() => {
                  edit((x) => void moveDay(x.template, w, di, 1));
                  setOpen(null);
                }}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="pk-icon"
                aria-label={`Remove ${day.name}`}
                disabled={week.days.length === 1}
                onClick={() => {
                  edit((x) => removeDay(x.template, w, di));
                  setOpen(null);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {day.exercises.length === 0 && <span className="pk-small">No exercises yet.</span>}
            {day.exercises.map((ex, xi) => (
              <button key={`${w}-${di}-${xi}`} type="button" className="pk-ex" data-joined={ex.joined ? "true" : undefined} onClick={() => setOpen({ w, di, xi })}>
                <span className="pk-ex-name">
                  {ex.name}
                  <span>
                    {summariseRx(ex.sets)}
                    {ex.joined ? ", superset with the one above" : ""}
                  </span>
                </span>
                <span className="pk-badge">{RULE_LABEL[ex.rule?.kind ?? "manual"]}</span>
              </button>
            ))}
            {day.exercises.length < MEMBER_LIMITS.exercises && (
              <button type="button" className="pk-dashed" onClick={() => setPicking({ w, di, xi: null })}>
                <Plus size={16} /> Add exercise
              </button>
            )}
          </PkCard>
        ))}

        {week.days.length < MEMBER_LIMITS.days && (
          <button type="button" className="pk-dashed" onClick={() => edit((x) => addDay(x.template, w))}>
            <Plus size={16} /> Add a day
          </button>
        )}

        {open && sheetEx && !picking && (
          <ExerciseSheet
            ex={sheetEx}
            index={open.xi}
            count={t.weeks[open.w].days[open.di].exercises.length}
            unit={unit}
            stepKg={shownStep}
            running={running}
            nowKg={current[stateKey(sheetEx)] ?? null}
            onClose={() => setOpen(null)}
            onChange={(fn) => edit((x) => fn(x.template.weeks[open.w].days[open.di].exercises[open.xi]))}
            onRule={(k) =>
              edit((x) => {
                const list = x.template.weeks[open.w].days[open.di].exercises;
                list[open.xi] = applyRule(list[open.xi], k);
              })
            }
            onRename={() => setPicking(open)}
            onMove={(dir) => {
              const to = open.xi + dir;
              if (to < 0 || to >= t.weeks[open.w].days[open.di].exercises.length) return;
              edit((x) => void moveExercise(x.template, open.w, open.di, open.xi, dir));
              // The sheet follows the exercise it is editing.
              setOpen({ ...open, xi: to });
            }}
            onRemove={() => {
              edit((x) => removeExercise(x.template, open.w, open.di, open.xi));
              setOpen(null);
            }}
          />
        )}
      </fieldset>

      <StickyBar>
        <button type="button" className="pk-cta" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save program"}
        </button>
      </StickyBar>

      {id !== null && !running && (
        <button type="button" className="pk-dashed pk-btn--danger" onClick={remove} disabled={pending}>
          <Trash2 size={16} /> Delete this program
        </button>
      )}

      {picking && <ExercisePicker onClose={() => setPicking(null)} onPick={(hit) => pick(hit.name)} />}
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the two builder pages**

Replace the whole of `app/src/app/app/programs/built/[id]/page.tsx` with:

```tsx
// app/src/app/app/programs/built/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey } from "@/lib/programs/memberTemplate";
import { PkHeader } from "@/components/clientapp/programs/kit";
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
    <div className="pk">
      <PkHeader title={p.name} lead={running ? "You're running this program." : "Your own program."}>
        <div className="pk-actions">
          <Link href={`/app/programs/${encodeURIComponent(memberKey(id))}`} className="pk-btn">
            See the program
          </Link>
          {!live && (
            <Link href={`/app/programs/built/${id}/start`} className="pk-btn">
              Start this program
            </Link>
          )}
        </div>
      </PkHeader>
      <MemberProgramBuilder
        id={id}
        from={null}
        initial={p.template}
        initialUnit={unit}
        stepKg={client.plateStepKg > 0 ? client.plateStepKg : 2.5}
        running={running}
        current={running && live ? live.state.weights : {}}
      />
    </div>
  );
}
```

Replace the whole of `app/src/app/app/programs/built/new/page.tsx` with:

```tsx
// app/src/app/app/programs/built/new/page.tsx
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { parseStartFrom, startingDraft } from "@/lib/programs/memberPrograms";
import { PkCard, PkHeader, PkSection } from "@/components/clientapp/programs/kit";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

function Choice({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <PkCard href={href}>
      <div className="pk-row">
        <div>
          <h3 className="pk-card-title">{title}</h3>
          <span className="pk-small">{sub}</span>
        </div>
        <ChevronRight size={18} aria-hidden className="pk-chev" />
      </div>
    </PkCard>
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
      <div className="pk">
        <PkHeader title="Build your own" lead="Nothing is kept until you save." />
        <MemberProgramBuilder id={null} from={from} initial={draft.template} initialUnit={unit} stepKg={client.plateStepKg > 0 ? client.plateStepKg : 2.5} running={false} current={{}} />
      </div>
    );
  }

  const live = liveEnrolment(clientId);
  const library = memberPrograms();
  return (
    <div className="pk">
      <PkHeader title="Build your own" lead="Start blank or from a program you know." />
      <Choice href="/app/programs/built/new?from=blank" title="Start blank" sub="One week, one day. Add your own exercises." />
      {live && <Choice href="/app/programs/built/new?from=current" title="Start from my current program" sub={`${live.template.name}, with your weights and maxes.`} />}
      <PkSection label="Or copy a library program">
        {library.map((e) => (
          <Choice key={e.template.key} href={`/app/programs/built/new?from=${encodeURIComponent(e.template.key)}`} title={e.template.name} sub={byline(toCard(e.template, e.basedOnName))} />
        ))}
      </PkSection>
    </div>
  );
}
```

- [ ] **Step 6: Check it**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/memberEditing.test.ts && npm test -- src/components/clientapp/programs/kit.test.ts && npm test -- src/app/app/programs/gating.test.ts && npm test -- src/lib/programs/memberPrograms.test.ts`
Expected: no type errors, all pass.

Then confirm the old builder classes are gone from the code: `cd app && grep -rnE "\b(pg|bld)-[a-z]" src --include='*.tsx' --include='*.ts'` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/programs/memberEditing.ts app/src/lib/programs/memberEditing.test.ts app/src/components/clientapp/MemberProgramBuilder.tsx "app/src/app/app/programs/built/[id]/page.tsx" app/src/app/app/programs/built/new/page.tsx
git commit -m "$(cat <<'MSG'
feat(programs): builder with day cards and an edit sheet per exercise

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 12: Retire the old styles, full checks, browser checks, deploy

**Files:**
- Modify: `app/src/app/globals.css` (remove the `.pg-` and `.bld-` blocks, nothing else)

**Interfaces:**
- Consumes: everything above.
- Produces: `main` with the redesign, checked at 320 and 390 px in Inspire's and Optimal Health's colours, reviewed as a whole, and (when the controller says so) deployed.

- [ ] **Step 1: Prove nothing uses the old classes, then remove their rules**

Run: `cd app && grep -rnE "\b(pg|bld)-[a-z]" src --include='*.tsx' --include='*.ts'`
Expected: no output. If anything prints, stop: a screen still uses an old class; move it to the kit first.

In `app/src/app/globals.css`, delete every line from `/* Member app: the program library (Programs tab). Tenant brand tokens. */` down to and including `.bld-chip-link { display: inline-flex; align-items: center; text-decoration: none; }`, and the blank line after it. That range holds only `.pg-` and `.bld-` rules and their comments; the Programs kit block follows it and stays.

Run: `cd app && grep -nE "\.(pg|bld)-" src/app/globals.css; npm test -- src/components/clientapp/programs/kit.test.ts`
Expected: the grep prints nothing; the kit test passes.

```bash
git add app/src/app/globals.css
git commit -m "$(cat <<'MSG'
chore(programs): remove the pg- and bld- styles the kit replaced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
)"
```

- [ ] **Step 2: Full checks**

Run: `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`
Expected: no type errors; every test file passes; the build succeeds and lists `/app/programs`, `/app/programs/[key]`, `/app/programs/[key]/start`, `/app/programs/mine`, `/app/programs/built/new`, `/app/programs/built/[id]` and `/app/programs/built/[id]/start`.

- [ ] **Step 3: No emojis in anything new or changed**

Run:

```bash
cd app && node -e "
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk('src/lib/programs'), ...walk('src/app/app/programs'), ...walk('src/components/clientapp/programs'),
  'src/components/clientapp/ProgramBrowser.tsx', 'src/components/clientapp/BuiltProgramList.tsx', 'src/components/clientapp/StartProgramForm.tsx',
  'src/components/clientapp/MemberProgramBuilder.tsx', 'src/components/clientapp/OwnMaxForm.tsx', 'src/components/clientapp/RestartProgramForm.tsx'];
const bad = files.filter((f) => /\p{Extended_Pictographic}/u.test(fs.readFileSync(f, 'utf8')));
console.log(bad.length ? bad.join('\n') : 'no emojis');
process.exit(bad.length ? 1 : 0);
"
```

Expected: `no emojis`.

- [ ] **Step 4: Local dev setup (dev files only, all undone in Step 8)**

This touches only the local `app/data/` files, never production. Stop any running dev server first, then back up the three files the check writes to:

```bash
cd app && B=/tmp/programs-ui-check-backup && mkdir -p $B && for f in data/control.db data/tenants/inspire/inspire.db data/tenants/optimal-health/optimal-health.db; do for x in "" -wal -shm; do [ -f "$f$x" ] && cp "$f$x" "$B/$(echo $f$x | tr / _)"; done; done; ls $B
```

Find the two businesses and switch Programs on for them only (an allow row; note what was there before):

```bash
cd app && sqlite3 data/control.db "SELECT id, slug FROM tenants WHERE slug IN ('inspire', 'optimal-health')"
sqlite3 data/control.db "SELECT key, mode, percent, allow, updated_at FROM platform_flags WHERE key = 'programs'"
sqlite3 data/control.db "INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES ('programs', 'allow', 0, '[<INSPIRE_ID>,<OH_ID>]', CAST(strftime('%s','now') AS INTEGER) * 1000) ON CONFLICT(key) DO UPDATE SET mode = 'allow', percent = 0, allow = excluded.allow"
```

For each business (Inspire first, then Optimal Health), pick a member who opens the app home with no welcome steps pending, and make them DIY:

```bash
cd app && sqlite3 data/tenants/inspire/inspire.db "SELECT id, first_name, training_mode FROM clients ORDER BY id LIMIT 10"
sqlite3 data/tenants/inspire/inspire.db "UPDATE clients SET training_mode = 'diy' WHERE id = <CLIENT_ID>"
```

Give that member a temporary sign-in. Use their existing credential if they have one, else add a throwaway one:

```bash
cd app && sqlite3 data/control.db "SELECT id FROM client_credentials WHERE tenant_id = <TENANT_ID> AND client_id = <CLIENT_ID>"
# only if that printed nothing:
sqlite3 data/control.db "INSERT INTO client_credentials (email, password_hash, tenant_id, client_id) VALUES ('programs-ui-check-<TENANT_ID>@example.invalid', 'unused', <TENANT_ID>, <CLIENT_ID>) RETURNING id"
node -e "const c=require('node:crypto');const t=c.randomBytes(32).toString('hex');console.log('cookie value: '+t);console.log('session id:   h1:'+c.createHash('sha256').update(t,'utf8').digest('hex'))"
sqlite3 data/control.db "INSERT INTO client_sessions (id, credential_id, tenant_id, client_id, expires_at) VALUES ('<SESSION_ID>', <CREDENTIAL_ID>, <TENANT_ID>, <CLIENT_ID>, (CAST(strftime('%s','now') AS INTEGER) + 86400) * 1000)"
```

Start the dev server (`cd app && npm run dev`, Node at `/usr/local/bin`), open http://localhost:3000/app in a private window, and in the console run `document.cookie = "cf_client_session=<COOKIE_VALUE>; path=/"`, then reload. The app home opens as that member. If `/app/programs` sends you to `/app/workouts`, the business's own Programs switch is off: turn it on in the local admin console's Features tab for that business and note it for Step 8.

- [ ] **Step 5: Browser check at 320 px, Inspire**

Set the device toolbar to 320 x 640. For every screen: no sideways page scroll; every button, select, tile and box at least 44px tall (inspect a few); the gold accent is Inspire's brand colour on the buttons, pills, bars, badges and timeline dots; nothing in the admin orange. Fix anything wrong before moving on.

1. Programs tab: the title and line; the goal select on its own row and days and length beside each other; the dashed Build your own; goal headings in the order Get strong, Peak your total, Start lifting, Build size; each card with a level pill, name, summary, mini phase bar and three pills. Pick Goal: Powerlifting peak: only Peak your total remains and the address ends `?goal=peaking`. Open Smolov base, press the browser's back button: the filter is still set.
2. Program page, Smolov base: the crumb "Powerlifting peak · 4 weeks"; pills "4 days a week", "4 weeks", "About 25 min", "Advanced"; the named phase bar with Base, Plus 10 kg, Plus 15 kg and Test; A typical week with four days; What to expect with four notes; Why it works; How your weights move including "Week 2 adds 10 kg and week 3 adds 15 kg to every set."; The whole program: Tab to a week and press Enter, it opens to its days; the warning; "You need a max for: squat."; the sticky Start this program above the tab bar. Open Candito-style 6-week: five phase names fit their segments or end in an ellipsis, never overflow.
3. Start Smolov base: "Start Smolov base mesocycle, step 1 of 4" and the step bar. Next. Type 140: "Max about 140 kg. Your first sets: 4 x 9 at 97.5 kg." Back, switch to Pounds, Next: the max reads 308.6. Back, switch to Kilograms. Next twice, then clear a training day and pick Saturday. Review: the four lines, then the first week with dates and "Back squat 4 x 9 at 97.5 kg". Back three times and forward three times: everything is as you left it. Go back to the maxes, empty the box, go to the review and press Start program: the flow moves to the maxes screen with "Enter your squat max." at the top. Type 140 and start.
4. My program: "Week 1 of 4 · Base" and the bar with Base brightest; the Next session hero with each exercise and "70% of your max." under it; Start session opens the logger; back on My program the tiles show "Squat max 140 kg" and "Sessions 0 of 13, None skipped"; This week; Recent changes starts "Started Smolov base mesocycle."; See the whole program opens the program page with Continue and Base brightest. Skip next session (confirm): the tile reads "1 skipped" and a timeline entry appears. End program (confirm).
5. Start 5/3/1 Boring But Big with any maxes: the tiles show each training max under its max; the program page's phase bar has four repeating weeks and "These 4 weeks repeat."
6. Builder: Build your own, Start blank. Add exercise, pick Bench press: the sheet opens with focus inside; Tab and Shift+Tab stay in the sheet; Escape closes it and focus returns to the Bench press row. Open it again, pick the Rep range tile: the sentence reads "Bench press goes up 2.5 kg once all 3 sets reach 9 reps, then the reps go back to 5." Add a set, change one top to 10: the sentence changes to "every set reaches the top of its range". Done. The row shows "3 x 5-9" style text and a Rep range badge. Add Back squat, open it, move it up: the sheet stays on Back squat. Save: the address becomes `/app/programs/built/<id>`; Save again: still one program on the Programs tab. Start it, edit it while running: the start weight field shows "Now ...".
7. Member program page: Programs tab, My programs, tap the saved program's name: crumb "Your program · Repeats weekly", no level pill, no Why it works, phases named by week, the Edit program link.

- [ ] **Step 6: The same at 390 px, and in Optimal Health's colours**

Set the device toolbar to 390 x 844 and repeat items 1 to 4 and 6. Then sign in as the Optimal Health member (Step 4 for tenant `optimal-health`, set the new cookie value) and repeat items 1, 2, 4 and 6 at 320 and 390: every accent element is Optimal Health's brand colour, and no Inspire gold appears.

- [ ] **Step 7: Workouts and Nutrition are unchanged**

Run: `git diff 4f0b5bc..HEAD --stat -- app/src/app/app/workouts app/src/app/app/nutrition app/src/components/clientapp/WorkoutLogger.tsx app/src/components/clientapp/MealBreakdown.tsx app/src/components/clientapp/MealLog.tsx app/src/components/clientapp/MyProgramCard.tsx app/src/components/clientapp/WeekStrip.tsx app/src/components/clientapp/MyProgramControls.tsx`
Expected: no output.

Then read `git diff 4f0b5bc..HEAD -- app/src/app/globals.css`: it adds the kit block and removes the `.pg-`/`.bld-` block, and changes nothing else. In the browser at 320 px, open `/app/workouts` (the My program card, the logger with a program session) and `/app/nutrition` (the meal breakdown): they look as they did before this work.

- [ ] **Step 8: Undo the dev setup**

Stop the dev server, then put the three files back exactly and remove the backup:

```bash
cd app && B=/tmp/programs-ui-check-backup && for f in data/control.db data/tenants/inspire/inspire.db data/tenants/optimal-health/optimal-health.db; do rm -f "$f-wal" "$f-shm"; for x in "" -wal -shm; do [ -f "$B/$(echo $f$x | tr / _)" ] && cp "$B/$(echo $f$x | tr / _)" "$f$x"; done; done; rm -rf $B
sqlite3 data/control.db "SELECT key, mode, allow FROM platform_flags WHERE key = 'programs'"
```

Expected: the flag row is what Step 4 printed before the change (or no row). If you turned a business's Programs switch on in the admin console, the restore of `control.db` put it back too. Clear the `cf_client_session` cookie in the private window.

- [ ] **Step 9: Whole-branch review**

Review the whole branch as one change, not task by task: `git diff 4f0b5bc..HEAD -- app/src`. Check in particular:
- Every member Programs page still calls `requireProgramsPage()` and every action file is unchanged (`git diff 4f0b5bc..HEAD -- app/src/app/app/programs/actions.ts app/src/app/app/programs/built/actions.ts` prints nothing).
- `/app/programs/member%3A<id>` reads through `getMemberProgram(clientId, id)` only, so another member's id is a 404.
- `MemberProgramBuilder.save()` matches the old one line for line apart from `setOpen(null)`: the `createdId` ref, `from` only before the first create, `weekOrigins: sent.origins`, and the origins reset only when `prev.template === sent.template`.
- No engine, planner, units or logger file changed (`git diff 4f0b5bc..HEAD --stat -- app/src/lib/programs/engines.ts app/src/lib/programs/planner.ts app/src/lib/programs/units.ts app/src/lib/workoutLog.ts` prints nothing).
- The kit block has no fixed colours (the kit test), every select keeps 36px right padding, and the copy follows the house rules.

Fix what it finds, run Step 2 again, and commit each fix with its exact paths.

- [ ] **Step 10: Land on main and deploy (only when the controller says so)**

Run: `git status` (only the unrelated files listed in the controller decisions are modified or untracked) and `git log --oneline -14`.
Then, on the controller's word only: `git push origin main` and `cd app && railway up --detach`. Expect a few minutes of 502 errors while the new build starts; then `curl -s -o /dev/null -w "%{http_code}\n" https://www.adonisagent.ie/api/health` returns `200`. The Programs module is still off for every business, so members see no change until it is switched on.
