# Coach-assigned programs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a coach assign any library program or gym version to one member, edit that person's copy before it starts and while it runs (keeping the program's own engine), and lock the member to following it.

**Architecture:** The enrolment row already stores a per-person snapshot of the template (`program_enrolments.template_json`). Two new columns (`assigned_by`, `assigned_at`) mark a coach-set enrolment. A new server module, `lib/programs/coachPrograms.ts`, assigns, edits and ends. Edits reuse `rebaseEdit` (extended so library engines keep training maxes, GZCLP bases and 5/3/1 holds) and `writeTemplateEdit` (given an actor). Staff screens live under `/clients/[id]/program/`. The gym-version editor `ProgramCopyEditor` becomes save-agnostic and tracks week origins.

**Tech Stack:** Next.js 15 App Router (server components + server actions), better-sqlite3 + drizzle, zod, TypeScript, tsx test files run by `npm test` (`scripts/test.mjs` runs every `*.test.ts` under `src/`).

Spec: `docs/superpowers/specs/2026-11-14-coach-assigned-programs-design.md`.

## Global Constraints

- NO EMOJIS anywhere: UI, code, comments, commits. lucide-react icons only.
- Plain sentence case copy, short factual sentences. The member's refusal message is exactly: `Your coach set this program. Ask them to change it.`
- The member sees "Set by your coach" on a coach-set program.
- A coach-set program keeps its own engine; it is never converted to own rules.
- Member on a coach-set program: may log sessions, skip a session, and change training days. May NOT edit, change a max, end, restart from a test, or start another program. Enforced on the server, not only hidden.
- A coach-set program runs in coach-guided or DIY mode. Switching training mode never pauses a coach-set program.
- Every save of a person's copy runs `validateTemplate` plus `copyErrors(original, copy)`.
- Staff actions start with `const actor = await currentStaffActor(); if (!actor) return OFF;` (signed in, Programs on). Members of another business are not in the ambient tenant DB, so an unknown client id must return an error, never throw.
- An edit that changes nothing writes no change-log event.
- Controls at least 44px tall on member screens; inputs 16px on member screens. Never reuse an existing CSS prefix; staff screens reuse the editor's existing `.pe-` and panel's `.dp-` classes.
- Everything stays behind the Programs module (`programsOn`), still off for every business.
- Commits: never `git add -A`; add files by name. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before claiming a task done: `cd app && npx tsc --noEmit -p .` clean, and the task's test files pass via `npx tsx <file>` (DB tests need `npm test -- <file>`).

---

## File Structure

- Modify `app/src/lib/db/schema.ts` (programEnrolments: `assignedBy`, `assignedAt`), `app/src/lib/db/tenant.ts` (addColumn x2), `app/src/lib/db/tenant.test.ts` (column list).
- Modify `app/src/lib/programs/enrolments.ts`:
  - `EnrolmentView.assignedBy` / `assignedAt`;
  - shared `insertEnrolment`;
  - `writeTemplateEdit` actor parameter;
  - member locks in `endEnrolment`, `restartFromTest` and `enrolBlocked`;
  - `setTrainingMode` skips pausing a coach-set program;
  - export `COACH_SET`.
- Modify `app/src/lib/programs/memberEdit.ts`: library engines keep training maxes, `t2Base`, `short`, `testMaxes`; `editReason(lines, who)`.
- Create `app/src/lib/programs/coachPrograms.ts`: `checkPersonCopy`, `coachAssign`, `coachEditProgram`, `coachEndProgram`.
- Create `app/src/lib/programs/coachPrograms.test.ts`.
- Create `app/src/lib/programs/startInput.ts`: the shared zod start schema and `resolveMaxes`, moved out of `app/src/app/app/programs/actions.ts`.
- Modify `app/src/lib/programs/access.ts`: `memberSeesPrograms` is also true for a live coach-set program.
- Modify `app/src/components/workout/ProgramCopyEditor.tsx`: a `save` prop, week-origin tracking, and `saveLabel`.
- Create `app/src/components/workout/CopyEditorSave.tsx`: the client wrapper for the gym-version page.
- Modify `app/src/components/clientapp/StartProgramForm.tsx`: an optional `submit` prop and `doneHref`.
- Create `app/src/app/clients/[id]/program/actions.ts`: the staff server actions.
- Create `app/src/app/clients/[id]/program/assign/page.tsx` and `app/src/components/clients/AssignProgramFlow.tsx`.
- Create `app/src/app/clients/[id]/program/edit/page.tsx` and `app/src/components/clients/PersonProgramEditor.tsx`.
- Modify `app/src/components/clients/ClientProgramPanel.tsx`, `app/src/lib/programs/panel.ts`, `app/src/lib/programs/staffView.ts` and `app/src/app/clients/[id]/page.tsx`: the Assign, Edit and End buttons and the "Set by" line.
- Modify `app/src/app/app/programs/mine/page.tsx` and `app/src/components/clientapp/MyProgramControls.tsx`: "Set by your coach" and hidden controls.

---

### Task 1: Mark a coach-set enrolment and lock the member out

**Files:**
- Modify: `app/src/lib/db/schema.ts` (programEnrolments, ~line 3698)
- Modify: `app/src/lib/db/tenant.ts` (the `addColumn` block, ~line 3242)
- Modify: `app/src/lib/db/tenant.test.ts` (the column list near line 95)
- Modify: `app/src/lib/programs/enrolments.ts`
- Test: `app/src/lib/programs/enrolments.test.ts` (add cases)

**Interfaces:**
- Produces:
  - `EnrolmentView.assignedBy: number | null`
  - `EnrolmentView.assignedAt: number | null`
  - `export const COACH_SET = { ok: false as const, error: "Your coach set this program. Ask them to change it." }`
  - `export function insertEnrolment(tx: Tx, clientId: number, input: Omit<EnrolInput, "key">, src: EnrolSource, opts: { actor: Actor; reason: string; assignedBy: number | null }): number`, which inserts the row, logs a `"start"` event, and returns the id;
  - `export function writeTemplateEdit(tx, view, template, state, reason, weekOrigins = null, actor: Actor = { kind: "member" }): boolean`.
- Behaviour:
  - `endEnrolment(clientId, { kind: "member" })` returns false on a coach-set program;
  - `restartFromTest` returns `COACH_SET` on a coach-set program;
  - `enrolBlocked` returns `COACH_SET` when the live program is coach-set;
  - `setTrainingMode` never pauses a coach-set program.

- [ ] **Step 1: Add the columns.** In `schema.ts`, inside `programEnrolments` after `weekdays`:

```ts
  /** The staff user who set this program for the member; null when the member chose it. */
  assignedBy: integer("assigned_by"),
  assignedAt: integer("assigned_at"),
```

In `tenant.ts` `CREATE TABLE IF NOT EXISTS program_enrolments`, add `assigned_by INTEGER,` and `assigned_at INTEGER,` before `created_at`. Then in the `addColumn` block add:

```ts
    addColumn("program_enrolments", "assigned_by", "assigned_by INTEGER");
    addColumn("program_enrolments", "assigned_at", "assigned_at INTEGER");
```

In `tenant.test.ts`, add `["program_enrolments", "assigned_by"]` and `["program_enrolments", "assigned_at"]` to the list of `[table, column]` pairs checked after the retry.

- [ ] **Step 2: Write the failing tests.** In `enrolments.test.ts`, add cases using the file's `test(name, fn)` helper and `newMember`. Insert the coach-set marker directly, because the assign function arrives in Task 3:

```ts
  const markCoachSet = (enrolmentId: number) =>
    db.run(sql`UPDATE program_enrolments SET assigned_by = 1, assigned_at = ${Date.now()} WHERE id = ${enrolmentId}`);

  test("a coach-set program locks the member out of end, restart and starting another", () => {
    const c = newMember();
    const id = enrolIn(c, "stronglifts-5x5", maxes);
    markCoachSet(id);
    assert.equal(en.liveEnrolment(c)!.assignedBy, 1);
    assert.equal(en.endEnrolment(c, { kind: "member" }), false, "the member can't end it");
    assert.deepEqual(en.enrol(c, input), en.COACH_SET, "nor start another");
    assert.deepEqual(en.restartFromTest(c, maxes), en.COACH_SET);
    assert.equal(en.skipEnrolmentSession(c).ok, true, "skip still works");
    assert.equal(en.setEnrolmentDays(c, [2, 4]), true, "training days still work");
    assert.equal(en.endEnrolment(c, staff), true, "a coach can end it");
  });

  test("switching to coach guided never pauses a coach-set program", () => {
    const c = newMember();
    const id = enrolIn(c, "stronglifts-5x5", maxes);
    markCoachSet(id);
    assert.deepEqual(en.setTrainingMode(c, "coach", staff), { paused: false, resumed: false });
    assert.equal(en.liveEnrolment(c)!.status, "active");
  });
```

`restartFromTest` currently checks "finished" first. Put the coach-set check before it so the test reads `COACH_SET`.

- [ ] **Step 3: Run the tests to see them fail.**
  - Run: `cd app && npm test -- src/lib/programs/enrolments.test.ts`
  - Expected: FAIL, because `assignedBy` is undefined and `COACH_SET` is not exported.

- [ ] **Step 4: Implement it in `enrolments.ts`.**
  1. Add `assignedBy: number | null; assignedAt: number | null;` to `EnrolmentView`. In `toView` add `assignedBy: row.assignedBy ?? null, assignedAt: row.assignedAt ?? null,`.
  2. Add `export const COACH_SET = { ok: false as const, error: "Your coach set this program. Ask them to change it." };` near `BUSY`.
  3. Change `enrolBlocked`:

```ts
function enrolBlocked(clientId: number): EnrolResult | null {
  const live = liveEnrolment(clientId);
  if (live?.assignedBy) return COACH_SET;
  const member = db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get();
  if (member?.mode !== "diy") return { ok: false, error: "Programs are for DIY members. Switch this member to DIY first." };
  if (live) return BUSY;
  return null;
}
```

  4. Extract the body of the transaction in `enrolTemplate` into `insertEnrolment`. `enrolTemplate` then calls `insertEnrolment(tx, clientId, input, src, { actor: { kind: "member" }, reason: `Started ${t.name}.${tmLine(t, state, input.unit)}`, assignedBy: null })`:

```ts
/** Insert a live enrolment and its "start" event, in the caller's transaction. The member's unit and step are saved too. */
export function insertEnrolment(tx: Tx, clientId: number, input: Omit<EnrolInput, "key">, src: EnrolSource, opts: { actor: Actor; reason: string; assignedBy: number | null }): number {
  const t = src.template;
  const state = initState(t, input.maxesKg, input.stepKg);
  const now = Date.now();
  tx.update(clients).set({ weightUnit: input.unit, plateStepKg: input.stepKg }).where(eq(clients.id, clientId)).run();
  const [row] = tx
    .insert(programEnrolments)
    .values({
      clientId,
      programKey: src.programKey,
      copyId: src.copyId,
      templateJson: JSON.stringify(t),
      ...stateColumns(state),
      status: "active",
      startDate: input.startDate,
      weekdays: parseWeekdays(input.weekdays.join(",")).join(","),
      assignedBy: opts.assignedBy,
      assignedAt: opts.assignedBy === null ? null : now,
      createdAt: now,
    })
    .returning({ id: programEnrolments.id })
    .all();
  logEvent(tx, row.id, opts.actor, "start", opts.reason, null, state);
  return row.id;
}
```

  Also export `tmLine` (Task 3 uses it in the assign reason).

  5. `endEnrolment`: after `if (!view) return false;` add `if (actor.kind === "member" && view.assignedBy) return false;`.
  6. `restartFromTest`: first line after reading `view`: `if (view?.assignedBy) return COACH_SET;`.
  7. `setTrainingMode`: select `assignedBy: programEnrolments.assignedBy` in the `live` query, and change the pause condition to `if (live && mode === "coach" && live.status === "active" && !live.assignedBy)`.
  8. `writeTemplateEdit`: add a final parameter `actor: Actor = { kind: "member" }` and use it in its `logEvent(tx, view.id, actor, "edit", ...)` call.

- [ ] **Step 5: Run the tests to see them pass.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/enrolments.test.ts && npm test -- src/lib/db/tenant.test.ts && npm test -- src/lib/programs/memberPrograms.test.ts`
  - Expected: all pass. The existing member-built tests still pass, because `writeTemplateEdit` defaults to the member actor.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/db/tenant.test.ts app/src/lib/programs/enrolments.ts app/src/lib/programs/enrolments.test.ts
git commit -m "feat(programs): mark coach-set enrolments and lock the member out of changing them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Carry-over for every engine

**Files:**
- Modify: `app/src/lib/programs/memberEdit.ts`
- Test: `app/src/lib/programs/memberEdit.test.ts` (add cases at the end, before its final `console.log`)

**Interfaces:**
- Produces:
  - `rebaseEdit` keeps `state.tms` for library engines (every engine except `own_rules`). A lift with a max but no training max gets `trainingMax(max, after.tmPct)`.
  - `t2Base` entries for removed state keys are dropped.
  - `short` and `testMaxes` are kept only for lifts in `after.lifts`.
  - `export function editReason(lines: string[], who = "You"): string` returns `[`${who} edited the program.`, ...lines].join("\n")`.
- Unchanged: own-rules behaviour (training max follows the max).

- [ ] **Step 1: Write the failing tests.** Append to `memberEdit.test.ts`:

```ts
// ── library engines keep their own progress across an edit ──
{
  const bbb = platformProgram("531-bbb")!;
  const s0 = initState(bbb, { squat: 111.11, bench: 111.11, deadlift: 111.11, press: 111.11 }, 2.5);
  // One cycle later: the training maxes rose and the bench + set fell short this cycle.
  const s = { ...structuredClone(s0), cycle: 1, week: 1, day: 2, tms: { squat: 105, bench: 102.5, deadlift: 105, press: 102.5 }, short: { bench: true } };
  const after = structuredClone(bbb);
  after.weeks[1].days[2].exercises[2] = { name: "Barbell row", sets: [{ kind: "fixed", reps: 10, rest: 90 }], progress: false };
  const out = rebaseEdit({ before: bbb, after, state: s, weekOrigins: [0, 1, 2, 3], stepKg: 2.5, unit: "kg" });
  assert.deepEqual(out.state.tms, s.tms, "5/3/1 training maxes are kept, not reset from the max");
  assert.deepEqual(out.state.short, { bench: true }, "the + set hold survives");
  assert.equal(out.state.week, 1);
  assert.equal(out.state.day, 2);
  assert.ok(out.lines.length > 0);
}
{
  const gz = platformProgram("gzclp")!;
  const s0 = initState(gz, { squat: 100, bench: 80, press: 50, deadlift: 120 }, 2.5);
  const s = structuredClone(s0);
  s.stages["t1:back squat"] = 1;
  s.weights["t1:back squat"] = 90;
  const after = structuredClone(gz);
  after.weeks[0].days[0].exercises[2] = { name: "Dumbbell row", sets: [{ kind: "fixed", reps: 15, rest: 60 }, { kind: "fixed", reps: 15, rest: 60 }, { kind: "fixed", reps: 15, rest: 60, amrap: true }], tier: "t3" };
  const out = rebaseEdit({ before: gz, after, state: s, weekOrigins: [0], stepKg: 2.5, unit: "kg" });
  assert.equal(out.state.stages["t1:back squat"], 1, "a GZCLP stage is kept");
  assert.equal(out.state.weights["t1:back squat"], 90, "and its weight");
  assert.equal(out.state.t2Base["t2:bench press"], s.t2Base["t2:bench press"], "a kept T2 base is kept");
  assert.equal(out.state.weights["t3:lat pulldown"], undefined, "a removed exercise drops out");
}
{
  // An edit that changes nothing writes no lines.
  const jug = platformProgram("juggernaut-style")!;
  const s = initState(jug, { squat: 100, bench: 100, deadlift: 100, press: 100 }, 2.5);
  assert.deepEqual(rebaseEdit({ before: jug, after: structuredClone(jug), state: s, weekOrigins: jug.weeks.map((_, i) => i), stepKg: 2.5, unit: "kg" }).lines, []);
}
assert.equal(editReason(["Weeks: 4 to 5."], "Coach Ann"), "Coach Ann edited the program.\nWeeks: 4 to 5.");
assert.equal(editReason(["Weeks: 4 to 5."]), "You edited the program.\nWeeks: 4 to 5.");
```

Add the imports the block needs at the top if missing: `platformProgram` from `./registry`, `initState` from `./engines`, and `editReason` from `./memberEdit`.

- [ ] **Step 2: Run the tests to see them fail.**
  - Run: `cd app && npx tsx src/lib/programs/memberEdit.test.ts`
  - Expected: FAIL on "5/3/1 training maxes are kept", because the training max is recomputed from the max.

- [ ] **Step 3: Implement it.** In `rebaseEdit`, replace the `// ── maxes:` block with:

```ts
  // ── maxes: own rules take the training max from the max; library engines keep the training max they reached ──
  const own = after.engine.key === "own_rules";
  for (const lift of after.lifts) {
    const max = next.maxes[lift];
    if (max !== undefined && (own || next.tms[lift] === undefined)) next.tms[lift] = trainingMax(max, after.tmPct);
    else if (max === undefined && !before.lifts.includes(lift)) first.push(`Add your ${LIFT_LABEL[lift].toLowerCase()} max on My program to get its weights.`);
  }
  for (const k of Object.keys(next.t2Base)) if (!newKeys.has(k)) delete next.t2Base[k];
  for (const lift of Object.keys(next.short) as LiftKey[]) if (!after.lifts.includes(lift)) delete next.short[lift];
  for (const lift of Object.keys(next.testMaxes) as LiftKey[]) if (!after.lifts.includes(lift)) delete next.testMaxes[lift];
```

Add `type LiftKey` to the `./types` import. Change `editReason`:

```ts
/** The change-log entry for an edit: "You edited the program." for the member, "<name> edited the program." for a coach. */
export function editReason(lines: string[], who = "You"): string {
  return [`${who} edited the program.`, ...lines].join("\n");
}
```

- [ ] **Step 4: Run the tests to see them pass.**
  - Run: `cd app && npx tsc --noEmit -p . && npx tsx src/lib/programs/memberEdit.test.ts && npm test -- src/lib/programs/memberPrograms.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/programs/memberEdit.ts app/src/lib/programs/memberEdit.test.ts
git commit -m "feat(programs): edits to library programs keep training maxes, GZCLP bases and holds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The coach store (assign, edit, end)

**Files:**
- Create: `app/src/lib/programs/coachPrograms.ts`
- Create: `app/src/lib/programs/coachPrograms.test.ts`

**Interfaces:**
- Consumes (Task 1):
  - `insertEnrolment`, `writeTemplateEdit(tx, view, t, state, reason, origins, actor)`;
  - `liveEnrolment`, `getEnrolmentFor`, `endEnrolment`, `tmLine`;
  - `MAX_KG`, `type StaffActor`, `type EnrolInput`, `type Tx`.
- Consumes (Task 2): `rebaseEdit`, `normaliseOrigins`, `editReason(lines, who)`.
- Produces:

```ts
export type AssignInput = Omit<EnrolInput, "key"> & { key: string; template: unknown | null; replace: boolean };
export type AssignResult = { ok: true; id: number } | { ok: false; error: string; needsReplace?: true; errors?: string[] };
/** The coach's draft of a person's copy, checked like a gym version: the template check plus every lift the original's engine needs. */
export function checkPersonCopy(original: ProgramTemplate, raw: unknown): { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] };
export function coachAssign(clientId: number, input: AssignInput, actor: StaffActor): AssignResult;
export function coachEditProgram(clientId: number, enrolmentId: number, raw: unknown, weekOrigins: unknown, actor: StaffActor): { ok: true } | { ok: false; errors: string[] };
export function coachEndProgram(clientId: number, enrolmentId: number, actor: StaffActor): { ok: true } | { ok: false; error: string };
```

- [ ] **Step 1: Write the failing test.** Create `coachPrograms.test.ts`. Copy the scratch-tenant harness from the top of `enrolments.test.ts`: the `Module._load` stub, `requireLocal`, the tenant insert, `cleanup`, `newMember` and the `test()` and `cases` runner. Use the slug `programs-coach-test`, require `./coachPrograms` as `cp` and `./enrolments` as `en`, and run every case inside `runWithTenant(tid, ...)` exactly as `enrolments.test.ts` does. Cases:

```ts
  const staff = { kind: "staff" as const, userId: 7, name: "Coach Ann" };
  const base = { key: "531-bbb", template: null, maxesKg: { squat: 140, bench: 100, deadlift: 180, press: 60 }, unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 2, 4, 5], replace: false };

  test("a coach assigns a program to a coach-guided member", () => {
    const c = newMember(false);
    const r = cp.coachAssign(c, base, staff);
    assert.ok(r.ok);
    const v = en.liveEnrolment(c)!;
    assert.equal(v.assignedBy, 7);
    assert.equal(v.template.engine.key, "tm_cycle", "keeps its own engine");
    const ev = en.enrolmentEvents(v.id)[0];
    assert.equal(ev.actor, "staff:7");
    assert.match(ev.reason, /^Coach Ann set this program: 5\/3\/1 Boring But Big\./);
  });

  test("a member with their own program: the coach must confirm the replace", () => {
    const c = newMember(true);
    assert.ok(en.enrol(c, { key: "stronglifts-5x5", maxesKg: { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, unit: "kg", stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 3, 5] }).ok);
    const first = cp.coachAssign(c, base, staff);
    assert.ok(!first.ok && first.needsReplace);
    const old = en.liveEnrolment(c)!.id;
    assert.ok(cp.coachAssign(c, { ...base, replace: true }, staff).ok);
    assert.equal(en.getEnrolmentFor(c, old)!.status, "ended");
    assert.equal(en.enrolmentEvents(old)[0].reason, "Coach Ann ended this program to set a new one.");
  });

  test("an edited copy is checked: a lift the engine needs can't be dropped", () => {
    const c = newMember(false);
    const t = structuredClone(require("./registry").platformProgram("531-bbb"));
    for (const w of t.weeks) for (const d of w.days) d.exercises = d.exercises.filter((x: { lift?: string }) => x.lift !== "press");
    for (const w of t.weeks) w.days = w.days.filter((d: { exercises: unknown[] }) => d.exercises.length > 0);
    const r = cp.coachAssign(c, { ...base, template: t }, staff);
    assert.ok(!r.ok && r.errors?.some((e) => /overhead press max/.test(e)));
    assert.equal(en.liveEnrolment(c), null, "nothing written");
  });

  test("a coach edits a running program; the training max survives", () => {
    const c = newMember(false);
    assert.ok(cp.coachAssign(c, base, staff).ok);
    const v = en.liveEnrolment(c)!;
    db.run(sql`UPDATE program_enrolments SET tms_json = ${JSON.stringify({ squat: 130, bench: 92.5, deadlift: 167.5, press: 57.5 })} WHERE id = ${v.id}`);
    const t = structuredClone(v.template);
    t.weeks[0].days[0].exercises.push({ name: "Face pull", sets: [{ kind: "fixed", reps: 15, rest: 60 }], progress: false });
    assert.deepEqual(cp.coachEditProgram(c, v.id, t, t.weeks.map((_: unknown, i: number) => i), staff), { ok: true });
    const after = en.liveEnrolment(c)!;
    assert.equal(after.state.tms.squat, 130);
    assert.equal(after.template.weeks[0].days[0].exercises.at(-1)!.name, "Face pull");
    assert.match(en.enrolmentEvents(v.id)[0].reason, /^Coach Ann edited the program\./);
    // The same template again: no new event.
    const n = en.enrolmentEvents(v.id).length;
    assert.deepEqual(cp.coachEditProgram(c, v.id, after.template, after.template.weeks.map((_: unknown, i: number) => i), staff), { ok: true });
    assert.equal(en.enrolmentEvents(v.id).length, n);
  });

  test("a coach can't edit a program the member chose", () => {
    const c = newMember(true);
    assert.ok(en.enrol(c, { key: "stronglifts-5x5", maxesKg: { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, unit: "kg", stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 3, 5] }).ok);
    const v = en.liveEnrolment(c)!;
    assert.deepEqual(cp.coachEditProgram(c, v.id, v.template, [0], staff), { ok: false, errors: ["The member chose this program, so only they can change it."] });
  });

  test("an unknown member or program is refused", () => {
    assert.deepEqual(cp.coachAssign(999999, base, staff), { ok: false, error: "Member not found." });
    assert.deepEqual(cp.coachEditProgram(999999, 1, {}, [], staff), { ok: false, errors: ["That program has ended."] });
    assert.deepEqual(cp.coachAssign(newMember(false), { ...base, key: "no-such" }, staff), { ok: false, error: "That program isn't available." });
  });

  test("a coach ends a coach-set program", () => {
    const c = newMember(false);
    const r = cp.coachAssign(c, base, staff);
    assert.ok(r.ok);
    assert.deepEqual(cp.coachEndProgram(c, r.id, staff), { ok: true });
    assert.equal(en.liveEnrolment(c), null);
  });
```

- [ ] **Step 2: Run the test to see it fail.**
  - Run: `cd app && npm test -- src/lib/programs/coachPrograms.test.ts`
  - Expected: FAIL, because the module `./coachPrograms` does not exist.

- [ ] **Step 3: Implement `coachPrograms.ts`.**

```ts
// app/src/lib/programs/coachPrograms.ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, programEnrolments } from "@/lib/db/schema";
import { MAX_KG, endEnrolment, getEnrolmentFor, insertEnrolment, liveEnrolment, logEnrolmentEvent, tmLine, writeTemplateEdit, type EnrolInput, type StaffActor } from "./enrolments";
import { programByKey } from "./library";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import { initState } from "./engines";
import { LIFT_LABEL, type ProgramTemplate } from "./types";
import { copyErrors, validateTemplate } from "./validate";

/**
 * A coach sets a library program for one member, edits that person's copy
 * (the enrolment's own template snapshot), and ends it. The copy keeps the
 * program's own engine. Ambient tenant `db`: a member of another business is
 * simply not found.
 */

export type AssignInput = Omit<EnrolInput, "key"> & { key: string; template: unknown | null; replace: boolean };
export type AssignResult = { ok: true; id: number } | { ok: false; error: string; needsReplace?: true; errors?: string[] };

export function checkPersonCopy(original: ProgramTemplate, raw: unknown): { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] } {
  const v = validateTemplate(raw);
  if (!v.ok) return v;
  // The engine is the original's, whatever the draft says.
  const t: ProgramTemplate = { ...v.template, key: original.key, engine: original.engine, tmPct: original.tmPct, lifts: original.lifts };
  const missing = copyErrors(original, t);
  return missing.length ? { ok: false, errors: missing } : { ok: true, template: t };
}

export function coachAssign(clientId: number, input: AssignInput, actor: StaffActor): AssignResult {
  const member = db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).get();
  if (!member) return { ok: false, error: "Member not found." };
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  let t = entry.template;
  if (input.template !== null) {
    const checked = checkPersonCopy(entry.template, input.template);
    if (!checked.ok) return { ok: false, error: checked.errors[0], errors: checked.errors };
    t = checked.template;
  }
  for (const lift of t.lifts) {
    const m = input.maxesKg[lift];
    if (!m || !Number.isFinite(m) || m <= 0 || m > MAX_KG) return { ok: false, error: `Add a ${LIFT_LABEL[lift].toLowerCase()} max.` };
  }
  const live = liveEnrolment(clientId);
  if (live && !input.replace) return { ok: false, error: `${live.template.name} is running. Setting a new program ends it.`, needsReplace: true };
  const state = initState(t, input.maxesKg, input.stepKg);
  try {
    const id = db.transaction((tx) => {
      if (live) {
        const r = tx
          .update(programEnrolments)
          .set({ status: "ended", endedAt: Date.now(), updatedAt: Date.now() })
          .where(and(eq(programEnrolments.id, live.id), inArray(programEnrolments.status, ["active", "paused"])))
          .run();
        if (r.changes > 0) logEnrolmentEvent(tx, live.id, actor, "end", `${actor.name} ended this program to set a new one.`);
      }
      return insertEnrolment(tx, clientId, input, { template: t, programKey: entry.copyId ? null : t.key, copyId: entry.copyId }, {
        actor,
        reason: `${actor.name} set this program: ${t.name}.${tmLine(t, state, input.unit)}`,
        assignedBy: actor.userId,
      });
    });
    return { ok: true, id };
  } catch (err) {
    if (String(err).includes("UNIQUE")) return { ok: false, error: "The member's program changed. Try again." };
    throw err;
  }
}

export function coachEditProgram(clientId: number, enrolmentId: number, raw: unknown, weekOrigins: unknown, actor: StaffActor): { ok: true } | { ok: false; errors: string[] } {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, errors: ["That program has ended."] };
  if (!view.assignedBy) return { ok: false, errors: ["The member chose this program, so only they can change it."] };
  const original = (view.programKey ? programByKey(view.programKey, { includeHidden: true })?.template : null) ?? view.template;
  const checked = checkPersonCopy(original, raw);
  if (!checked.ok) return checked;
  const t = checked.template;
  const origins = normaliseOrigins(weekOrigins, view.template.weeks.length, t.weeks.length, { before: view.template.weeks, after: t.weeks, current: view.state.week });
  const out = rebaseEdit({ before: view.template, after: t, state: view.state, weekOrigins: origins, stepKg: view.stepKg, unit: view.unit });
  const ok = db.transaction((tx) => writeTemplateEdit(tx, view, t, out.state, out.lines.length ? editReason(out.lines, actor.name) : null, origins, actor));
  return ok ? { ok: true } : { ok: false, errors: ["The member's program moved on while you were editing. Open it again."] };
}

export function coachEndProgram(clientId: number, enrolmentId: number, actor: StaffActor): { ok: true } | { ok: false; error: string } {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  return endEnrolment(clientId, actor) ? { ok: true } : { ok: false, error: "That program has ended." };
}
```

For a gym copy, `programKey` is null and `copyId` is set. In `coachEditProgram`, resolve the original as `view.copyId ? programByKey(`copy-${view.copyId}`)?.template : programByKey(view.programKey!, { includeHidden: true })?.template`, falling back to `view.template` when neither resolves. In `enrolments.ts`, export a thin wrapper so `coachAssign` can log the end event inside its own transaction:

```ts
/** A change-log event in the caller's transaction, with no state snapshot. */
export function logEnrolmentEvent(tx: Tx, enrolmentId: number, actor: Actor, kind: string, reason: string): void {
  logEvent(tx, enrolmentId, actor, kind, reason, null, null);
}
```

- [ ] **Step 4: Run the test to see it pass.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/coachPrograms.test.ts && npm test -- src/lib/programs/enrolments.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/programs/coachPrograms.ts app/src/lib/programs/coachPrograms.test.ts app/src/lib/programs/enrolments.ts
git commit -m "feat(programs): coaches assign, edit and end a member's program

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Share the start input and gate the member app

**Files:**
- Create: `app/src/lib/programs/startInput.ts`
- Modify: `app/src/app/app/programs/actions.ts` (import from it; behaviour unchanged)
- Modify: `app/src/lib/programs/access.ts`
- Test: `app/src/app/app/programs/actions.test.ts` (must still pass), `app/src/app/app/programs/gating.test.ts` (unchanged, must pass)

**Interfaces:**
- Produces (in `startInput.ts`, server-only):

```ts
export const startZ; // the zod object currently in app/app/programs/actions.ts (key, unit, step, startDate, weekdays, maxes)
export type StartProgramInput = z.infer<typeof startZ>;
export type MaxEntry = z.infer<typeof maxEntryZ>;
export function resolveMaxes(clientId: number, unit: WeightUnit, entries: MaxEntry[]): { ok: true; kg: Partial<Record<LiftKey, number>> } | { ok: false; error: string };
```

- Produces (in `access.ts`): `memberSeesPrograms(c)` returns true when Programs is on and either the member is DIY or their live program is coach-set.

- [ ] **Step 1: Move the code.** Cut `saneStartDate`, `liftZ`, `maxEntryZ`, `startZ`, `MaxEntry`, `StartProgramInput` and `resolveMaxes` from `app/src/app/app/programs/actions.ts` into `app/src/lib/programs/startInput.ts`, starting with `import "server-only";`. Keep their imports (`z`, `bestLoggedSet`, `LIFT_LABEL`, `maxFromSet`, `unitToKg`, the types). In `actions.ts`, import them back: `import { resolveMaxes, startZ, type MaxEntry, type StartProgramInput } from "@/lib/programs/startInput";` and re-export the types with `export type { MaxEntry, StartProgramInput };` so existing imports (`StartProgramForm`) still compile. A `"use server"` file may only export async functions. If tsc or Next complains about type re-exports there, change the importers to import the types from `@/lib/programs/startInput` instead.

- [ ] **Step 2: Gate the member app.** In `access.ts`:

```ts
import { db } from "@/lib/db";
import { programEnrolments } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

/** The member's live program was set by their coach. */
function hasCoachSetProgram(clientId: number): boolean {
  return !!db
    .select({ id: programEnrolments.id })
    .from(programEnrolments)
    .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"]), isNotNull(programEnrolments.assignedBy)))
    .get();
}

/** A member sees Programs where the module is on, in DIY mode or while their coach has set them a program. */
export function memberSeesPrograms(c: Pick<CurrentClient, "tenantId" | "client" | "clientId"> | null): boolean {
  if (!c || !programsOn(c.tenantId)) return false;
  return c.client.trainingMode === "diy" || hasCoachSetProgram(c.clientId);
}
```

Check every caller passes `clientId`. `app/app/page.tsx` and `app/app/workouts/page.tsx` pass `{ tenantId, client }`; add `clientId` from the same `requireClientPage()` result.

- [ ] **Step 3: Run the tests.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test -- src/app/app/programs/actions.test.ts && npx tsx src/app/app/programs/gating.test.ts`
  - Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add app/src/lib/programs/startInput.ts app/src/app/app/programs/actions.ts app/src/lib/programs/access.ts app/src/app/app/page.tsx app/src/app/app/workouts/page.tsx
git commit -m "feat(programs): members see a coach-set program in either training mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A save-agnostic editor that tracks week origins

**Files:**
- Modify: `app/src/components/workout/ProgramCopyEditor.tsx`
- Create: `app/src/components/workout/CopyEditorSave.tsx`
- Modify: `app/src/app/workout/library/copies/[id]/page.tsx`

**Interfaces:**
- Produces:

```ts
export type EditorSave = (t: ProgramTemplate, weekOrigins: (number | null)[]) => Promise<{ ok: true } | { ok: false; errors: string[] }>;
// ProgramCopyEditor props: replace `id: number` with
//   save: EditorSave; saveLabel: string; savedMessage: string;
// keep initial, lifts, engineLabel, isBlock, fullBlock.
export function CopyEditorSave(props: { id: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean; fullBlock: boolean }): JSX.Element; // wraps saveCopyAction
```

- [ ] **Step 1: Track week origins in the editor.** In `ProgramCopyEditor`:
  - Add `const [origins, setOrigins] = useState<(number | null)[]>(() => initial.weeks.map((_, i) => i));`.
  - "Copy this week": `setOrigins((o) => [...o.slice(0, w + 1), null, ...o.slice(w + 1)])`.
  - "Remove this week": `setOrigins((o) => o.filter((_, i) => i !== w))`.
  - `save()`: call `props.save(t, origins)` instead of `saveCopyAction(id, t)`. On success, `toast.success(savedMessage)` and reset `origins` to `t.weeks.map((_, i) => i)`, because the saved version is the new baseline. Then `router.refresh()`.
  - Replace the button text `Save our version` with `{saveLabel}`.
  - Remove the `saveCopyAction` import from this file.

- [ ] **Step 2: The gym-version wrapper.** Create `CopyEditorSave.tsx`:

```tsx
"use client";

import { saveCopyAction } from "@/app/workout/library/actions";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import type { LiftKey, ProgramTemplate } from "@/lib/programs/types";

/** The gym-version page's editor: saves to the gym's own library. */
export function CopyEditorSave(props: { id: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean; fullBlock: boolean }) {
  const { id, ...rest } = props;
  return <ProgramCopyEditor {...rest} save={(t) => saveCopyAction(id, t)} saveLabel="Save our version" savedMessage="Saved. Members who start this version from now on get these changes." />;
}
```

In `app/workout/library/copies/[id]/page.tsx`, render `<CopyEditorSave id={copy.id} ... />` in place of `<ProgramCopyEditor id={copy.id} ... />`, with the same other props.

- [ ] **Step 3: Verify.**
  - Run: `cd app && npx tsc --noEmit -p . && npx tsx src/components/clientapp/programs/kit.test.ts`
  - Expected: clean, PASS.
  - Then `npm run dev`, open `/workout/library`, open a gym version, change a rep count and save. Expected: the toast "Saved. Members who start this version from now on get these changes." Use a dev staff login, never production.

- [ ] **Step 4: Commit.**

```bash
git add app/src/components/workout/ProgramCopyEditor.tsx app/src/components/workout/CopyEditorSave.tsx "app/src/app/workout/library/copies/[id]/page.tsx"
git commit -m "refactor(programs): the program editor takes its save and tracks week origins

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Staff actions and the assign screen

**Files:**
- Create: `app/src/app/clients/[id]/program/actions.ts`
- Create: `app/src/app/clients/[id]/program/assign/page.tsx`
- Create: `app/src/components/clients/AssignProgramFlow.tsx`
- Modify: `app/src/components/clientapp/StartProgramForm.tsx` (optional `submit`, `doneHref`, `submitLabel`)

**Interfaces:**
- Consumes:
  - `coachAssign`, `checkPersonCopy`, `coachEditProgram`, `coachEndProgram` (Task 3);
  - `startZ`, `resolveMaxes`, `StartProgramInput` (Task 4);
  - `ProgramCopyEditor`, `EditorSave` (Task 5);
  - `sendToClient` from `@/lib/push`.
- Produces (server actions, each starting with `currentStaffActor()`):

```ts
export async function coachAssignAction(clientId: number, raw: unknown, template: unknown | null, replace: boolean): Promise<{ ok: true } | { ok: false; error: string; needsReplace?: true }>;
export async function checkDraftAction(clientId: number, key: string, template: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }>;
export async function coachEditProgramAction(clientId: number, enrolmentId: number, template: unknown, weekOrigins: unknown): Promise<{ ok: true } | { ok: false; errors: string[] }>;
export async function coachEndProgramAction(clientId: number, enrolmentId: number): Promise<{ ok: true } | { ok: false; error: string }>;
```

- `StartProgramForm` gains:
  - `submit?: (input: StartProgramInput) => Promise<{ ok: true } | { ok: false; error: string }>` (default `startProgramAction`);
  - `doneHref?: string` (default `/app/programs/mine`);
  - `submitLabel?: string` (default the current label).

- [ ] **Step 1: Write the actions.** Create `app/src/app/clients/[id]/program/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { checkPersonCopy, coachAssign, coachEditProgram, coachEndProgram } from "@/lib/programs/coachPrograms";
import { programByKey } from "@/lib/programs/library";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { resolveMaxes, startZ } from "@/lib/programs/startInput";
import { stepFromKey } from "@/lib/programs/units";
import { sendToClient } from "@/lib/push";

const OFF = { ok: false as const, error: "Programs aren't switched on for this business." };
const idZ = z.number().int().positive();

function refresh(clientId: number) {
  revalidatePath(`/clients/${clientId}`);
  for (const p of ["/app/programs", "/app/programs/mine", "/app/workouts", "/app"]) revalidatePath(p);
}

/** Set a program for a member. replace: end the member's live program first (the coach confirmed). */
export async function coachAssignAction(clientId: number, raw: unknown, template: unknown | null, replace: boolean) {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const id = idZ.safeParse(clientId);
  const p = startZ.safeParse(raw);
  if (!id.success || !p.success) return { ok: false as const, error: "Check the entries and try again." };
  const v = p.data;
  if ((v.unit === "lb") !== (v.step === "5lb")) return { ok: false as const, error: "Pick a smallest jump in the same unit." };
  const maxes = resolveMaxes(id.data, v.unit, v.maxes);
  if (!maxes.ok) return maxes;
  const r = coachAssign(id.data, { key: v.key, template, maxesKg: maxes.kg, unit: v.unit, stepKg: stepFromKey(v.step), startDate: v.startDate, weekdays: v.weekdays, replace: replace === true }, actor);
  if (!r.ok) return { ok: false as const, error: r.error, ...(r.needsReplace ? { needsReplace: true as const } : {}) };
  refresh(id.data);
  const name = programByKey(v.key)?.template.name ?? "a program";
  // Best effort: a push failure never undoes the assignment.
  void sendToClient(id.data, { title: "New program", body: `Your coach set you a program: ${name}.`, url: "/app/programs/mine" }).catch((err) => console.error("[programs] assign push failed:", err));
  return { ok: true as const };
}

/** Check the coach's draft before the setup step, so errors show while they are still editing. */
export async function checkDraftAction(clientId: number, key: string, template: unknown) {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false as const, errors: [OFF.error] };
  if (!idZ.safeParse(clientId).success) return { ok: false as const, errors: ["Member not found."] };
  const entry = programByKey(String(key));
  if (!entry) return { ok: false as const, errors: ["That program isn't available."] };
  const r = checkPersonCopy(entry.template, template);
  return r.ok ? { ok: true as const } : r;
}

export async function coachEditProgramAction(clientId: number, enrolmentId: number, template: unknown, weekOrigins: unknown) {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false as const, errors: [OFF.error] };
  const p = z.object({ clientId: idZ, enrolmentId: idZ }).safeParse({ clientId, enrolmentId });
  if (!p.success) return { ok: false as const, errors: ["That program has ended."] };
  const r = coachEditProgram(p.data.clientId, p.data.enrolmentId, template, weekOrigins, actor);
  if (r.ok) refresh(p.data.clientId);
  return r;
}

export async function coachEndProgramAction(clientId: number, enrolmentId: number) {
  const actor = await currentStaffActor();
  if (!actor) return OFF;
  const p = z.object({ clientId: idZ, enrolmentId: idZ }).safeParse({ clientId, enrolmentId });
  if (!p.success) return { ok: false as const, error: "That program has ended." };
  const r = coachEndProgram(p.data.clientId, p.data.enrolmentId, actor);
  if (r.ok) refresh(p.data.clientId);
  return r;
}
```

Check `sendToClient`'s `PushMessage` fields in `app/src/lib/push.ts` (around line 64) and match them exactly. If the field names differ from `title`, `body` and `url`, use the real ones.

- [ ] **Step 2: Make StartProgramForm submit-agnostic.** In `StartProgramForm.tsx`:
  - Add the three optional props.
  - Where it calls `startProgramAction(input)`, call `(submit ?? startProgramAction)(input)`.
  - Where it navigates after success, use `doneHref ?? "/app/programs/mine"`.
  - Use `submitLabel` for the final button when given.

  The member start pages pass none of these, so they behave exactly as before.

- [ ] **Step 3: The assign page (server).** Create `app/src/app/clients/[id]/program/assign/page.tsx`:
  - `if (!(await currentStaffActor())) notFound();`
  - Read the client by id from `clients` in the ambient db; `notFound()` if missing.
  - Read `searchParams.key`:
    - **No key:** render a `PageHeader` ("Set a program for <first name>") and a list of `memberPrograms()` cards. Each card shows the name, `toStoryCard`-style summary line, days and length, and a link to `?key=<encodeURIComponent(key)>`. Group them with `groupByGoal` from `@/lib/programs/cards` if it fits; otherwise list them in library order.
    - **With a key:** `programByKey(key)`, else `notFound()`. Build `lifts` exactly as `app/app/programs/[key]/start/page.tsx` does (`bestLoggedSet` per lift) and `extra = planContextFor(clientId, t)`. If `liveEnrolment(clientId)` exists, pass its name as `liveName`. Render `<AssignProgramFlow ... />`.
  - Add a back link to `/clients/<id>` using the `cp-back` class, as on the copy page.

- [ ] **Step 4: The assign flow (client).** Create `app/src/components/clients/AssignProgramFlow.tsx`. Props:

```ts
{ clientId: number; memberName: string; programKey: string; template: ProgramTemplate; lifts: StartLift[]; extra: PlanExtra; initialUnit: WeightUnit; initialStep: StepKey; defaultWeekdays: number[]; today: string; liveName: string | null; engineLabel: string; isBlock: boolean; fullBlock: boolean; }
```

Behaviour:
- **State:** `draft: ProgramTemplate | null` (null means "as in the library") and `editing: boolean`.
- **Top of the screen:**
  - A line: "Set <program name> for <memberName>. Edits here change only <memberName>'s copy."
  - A button "Edit for <memberName> first", which sets `editing = true`.
- **While editing:** render `<ProgramCopyEditor initial={draft ?? template} save={async (t) => { const r = await checkDraftAction(clientId, programKey, t); if (r.ok) { setDraft(t); setEditing(false); } return r; }} saveLabel="Use these changes" savedMessage="Changes kept. Finish the setup to save them." lifts={template.lifts} engineLabel={engineLabel} isBlock={isBlock} fullBlock={fullBlock} />`.
- **Otherwise:** render `<StartProgramForm programKey={programKey} programName={(draft ?? template).name} template={draft ?? template} ... backHref={`/clients/${clientId}/program/assign`} doneHref={`/clients/${clientId}`} submitLabel="Set this program" submit={submit} />`.
- **`submit`:**
  - Call `coachAssignAction(clientId, input, draft, false)`.
  - If it returns `needsReplace`, open the app's confirm dialog (the same `confirm` helper `MyProgramControls.tsx` uses; import it from where that file does). Use the title "Replace <liveName>?", the body "Setting this program ends <liveName> for <memberName>. Its history is kept.", and the confirm label "End it and set this one". On yes, call `coachAssignAction(clientId, input, draft, true)`.
  - On success, `toast.success("Program set. <memberName> sees it in their app.")`.
- **Layout:** the `.pk-` kit styles use the gym's brand variables, which also exist on staff pages. Wrap the start form in a container capped at 480px wide, centred, so it reads like the member's phone screen.

- [ ] **Step 5: Verify.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/programs/coachPrograms.test.ts`
  - Expected: clean, PASS.
  - Then `npm run dev`, log in as dev staff, and open `/clients/<a dev member id>/program/assign`:
    1. Pick 5/3/1 Boring But Big.
    2. Edit it for the member: add a Face pull to week 1 day 1.
    3. Use these changes.
    4. Fill the setup and set it.

    Expected: you land on the client page, and the panel shows the program. Use dev DB data only. Back up `app/data` first and restore it after.

- [ ] **Step 6: Commit.**

```bash
git add "app/src/app/clients/[id]/program/actions.ts" "app/src/app/clients/[id]/program/assign/page.tsx" app/src/components/clients/AssignProgramFlow.tsx app/src/components/clientapp/StartProgramForm.tsx
git commit -m "feat(programs): coaches set a program for a member, with an optional edit first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Edit and end from the client page

**Files:**
- Create: `app/src/app/clients/[id]/program/edit/page.tsx`
- Create: `app/src/components/clients/PersonProgramEditor.tsx`
- Modify: `app/src/lib/programs/panel.ts` (`live.assignedBy`)
- Modify: `app/src/lib/programs/staffView.ts` (pass `assignedBy`, `assignedByName`)
- Modify: `app/src/components/clients/ClientProgramPanel.tsx` (buttons and line)
- Modify: `app/src/app/clients/[id]/page.tsx` (an Assign button when there is no panel)
- Test: `app/src/lib/programs/panel.test.ts` (if it exists, add a case; otherwise add one to `staffView`'s nearest pure test)

**Interfaces:**
- Consumes: `coachEditProgramAction`, `coachEndProgramAction` (Task 6); `ProgramCopyEditor` (Task 5).
- Produces:
  - `ProgramPanelData["live"]` gains `coachSet: boolean` and `setBy: string | null`, e.g. "Set by Coach Ann on 14 Nov 2026".
  - `PanelInput.enrolment` gains `assignedAt: number | null` and `assignedByName: string | null`.

- [ ] **Step 1: Panel data test.** In the panel's pure test, build a `PanelInput` as the existing cases do, with `assignedAt: Date.UTC(2026, 10, 14)` and `assignedByName: "Coach Ann"`, and assert:

```ts
assert.equal(data.live!.coachSet, true);
assert.equal(data.live!.setBy, "Set by Coach Ann on 14 Nov 2026");
```

and with `assignedAt: null`, `coachSet === false` and `setBy === null`. Run it and see it fail.

- [ ] **Step 2: Implement the panel data.** In `panel.ts` `panelFrom`, add `coachSet: e.assignedAt !== null` and `setBy: e.assignedAt !== null ? `Set by ${e.assignedByName ?? "a coach"} on ${dayText(e.assignedAt)}` : null`. In `staffView.ts`, pass `assignedAt: live.assignedAt`, and resolve `assignedByName` from the event log: the actor name of the newest `start` event whose actor starts with `staff:`, from `enrolmentEvents(live.id)`. That avoids reading the control-plane users table. Run the test and see it pass.

- [ ] **Step 3: The edit page.** Create `app/src/app/clients/[id]/program/edit/page.tsx`:
  - `if (!(await currentStaffActor())) notFound();`
  - Resolve `clientId`, `const live = liveEnrolment(clientId)`, and `if (!live || !live.assignedBy) notFound();`.
  - Resolve the original exactly as `coachEditProgram` does, for `lifts`, `isFullBlock` and the engine label.
  - Render a `PageHeader`:
    - eyebrow "Program for <first name>";
    - title `live.template.name`;
    - subtitle "Changes apply from <first name>'s next session. Kept exercises keep their weights; training maxes carry over."
  - Then render `<PersonProgramEditor clientId={clientId} enrolmentId={live.id} initial={live.template} lifts={...} engineLabel={ENGINE_LABEL[live.template.engine.key]} isBlock={...} fullBlock={...} />`, with the back link to `/clients/<id>`.

- [ ] **Step 4: The wrapper.** Create `PersonProgramEditor.tsx` (client):

```tsx
"use client";

import { coachEditProgramAction } from "@/app/clients/[id]/program/actions";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import type { LiftKey, ProgramTemplate } from "@/lib/programs/types";

/** A coach's editor for one member's running program. */
export function PersonProgramEditor(props: { clientId: number; enrolmentId: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean; fullBlock: boolean }) {
  const { clientId, enrolmentId, ...rest } = props;
  return (
    <ProgramCopyEditor
      {...rest}
      save={(t, origins) => coachEditProgramAction(clientId, enrolmentId, t, origins)}
      saveLabel="Save changes"
      savedMessage="Saved. The member gets these changes from their next session."
    />
  );
}
```

- [ ] **Step 5: The panel buttons.** In `ClientProgramPanel.tsx`:
  - When `live.coachSet`, show `live.setBy` under the byline. Change the eyebrow to "Program set by coach"; otherwise keep "DIY program".
  - Add buttons, using the panel's existing `Button`:
    - "Edit program", a `Link` to `/clients/<id>/program/edit`, only when `live.coachSet`;
    - "End program", which confirms with the same confirm helper ("End <name>?", "Its history is kept.", "End it") and then calls `coachEndProgramAction`, with `toast.success("Program ended.")` and `router.refresh()`;
    - "Set a new program", a `Link` to `/clients/<id>/program/assign`.
  - When there is no live program, show "Set a program" linking to the same assign page.

  In `app/clients/[id]/page.tsx`, when `programsEnabled && !programPanel`, render a small section with the eyebrow "Programs", the line "No program yet.", and a "Set a program" link to `/clients/<id>/program/assign`.

- [ ] **Step 6: Verify.**
  - Run: `cd app && npx tsc --noEmit -p .` and the panel test.
  - Then in dev, on the member from Task 6:
    - Edit program: change the bench sets in week 2 and save. Expected: the panel log shows "Coach ... edited the program." and the change line.
    - End program, then confirm. Expected: the panel shows "No program" with "Set a program".

- [ ] **Step 7: Commit.**

```bash
git add "app/src/app/clients/[id]/program/edit/page.tsx" app/src/components/clients/PersonProgramEditor.tsx app/src/lib/programs/panel.ts app/src/lib/programs/staffView.ts app/src/components/clients/ClientProgramPanel.tsx "app/src/app/clients/[id]/page.tsx" app/src/lib/programs/panel.test.ts
git commit -m "feat(programs): coaches edit and end a member's program from the client page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The member's "Set by your coach" view

**Files:**
- Modify: `app/src/app/app/programs/mine/page.tsx`
- Modify: `app/src/components/clientapp/MyProgramControls.tsx`
- Modify: `app/src/app/app/programs/page.tsx` (a coach-set member sees "Continue", and Start buttons are not offered)

**Interfaces:**
- Consumes: `EnrolmentView.assignedBy` (Task 1); `memberSeesPrograms` (Task 4).
- Produces: `MyProgramControls` prop `canEnd: boolean` (default true).

- [ ] **Step 1: My program.** In `mine/page.tsx`, `const coachSet = view.assignedBy !== null;`:
  - Under the `PkHeader`, when `coachSet`, render a line in the kit's small text style: "Set by your coach. Ask them if you want to change it."
  - Hide the "Edit program" link (the `Pencil` link near line 148) when `coachSet`.
  - Hide `RestartProgramForm` when `coachSet`. Show instead: "Block finished. Your coach will set what comes next."
  - Hide `OwnMaxForm` when `coachSet`.
  - Pass `canEnd={!coachSet}` to `MyProgramControls`.

- [ ] **Step 2: Controls.** In `MyProgramControls.tsx`, add `canEnd = true` to the props and render the End button only when `canEnd`. Skip and training days are unchanged.

- [ ] **Step 3: The Programs tab.** In `app/app/programs/page.tsx`, read `liveEnrolment(clientId)`. When it is coach-set:
  - Show the running program's card first, with the "Continue" state the page already supports.
  - Hide the "Build your own" card.
  - Program detail pages still open, but their Start button is replaced, because `[key]/page.tsx` already shows "Continue" or "End your current program" for a live program. Check it, and when the live program is coach-set use the copy "Your coach set your current program." with no End link.

- [ ] **Step 4: Verify in the browser (dev only).**
  - Back up `app/data`. Mint a dev member session as in earlier Programs browser checks, and assign a program to that member from the staff side.
  - At 320px and 390px, in Inspire's and Optimal Health's colours, check that:
    - My program shows "Set by your coach";
    - there is no Edit, End or Restart;
    - Skip and training days work;
    - there is no horizontal scroll.
  - Switch the member to coach-guided on the client page. Expected: the Programs tab and My program still show, and the program is not paused.
  - Restore `app/data`, and remove any temporary credential.

- [ ] **Step 5: Run the checks.**
  - Run: `cd app && npx tsc --noEmit -p . && npm test`
  - Expected: all test files pass.

- [ ] **Step 6: Commit.**

```bash
git add app/src/app/app/programs/mine/page.tsx app/src/components/clientapp/MyProgramControls.tsx app/src/app/app/programs/page.tsx "app/src/app/app/programs/[key]/page.tsx"
git commit -m "feat(programs): members follow a coach-set program and can't change it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final: whole-branch checks and deploy

- [ ] `cd app && npx tsc --noEmit -p . && npm test && rm -rf .next && npx next build`, all passing.
- [ ] `git push origin main`, then `cd app && railway up --detach`. Wait for SUCCESS, then `curl https://www.adonisagent.ie/api/health` and expect 200.
- [ ] Update the memory file `diy-program-library.md` with a line on coach-assigned programs.
