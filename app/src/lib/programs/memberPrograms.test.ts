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
  const { listExercises } = requireLocal("../exerciseLibrary") as typeof import("../exerciseLibrary");
  const { matchLibraryId } = requireLocal("./exercises") as typeof import("./exercises");
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
    const added = log.addSessionExercise(clientId, free.sessionId, { exerciseId: matchLibraryId("Hammer curl", listExercises()), name: "Hammer curl", sets: 1 })!;
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
