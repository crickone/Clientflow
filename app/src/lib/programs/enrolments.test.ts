// app/src/lib/programs/enrolments.test.ts
// Run: npm test -- src/lib/programs/enrolments.test.ts
//
// A member runs StrongLifts end to end against a scratch tenant: enrol, start
// a session from the plan, log it (planned weights survive saves), finish it
// (the engine runs once), skip, pause and resume with the training mode, coach
// changes logged with the actor, best logged set, end and start again. Then
// the fix-wave cases: finishing is idempotent, every change and its event are
// written together, ticked sets count at the planned weight, enrolling needs
// DIY, week labels agree, RPE is checked and members only finish their own
// sessions. Each case runs on its own member; failures are listed by name.
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
  const { eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const log = requireLocal("../workoutLog") as typeof import("../workoutLog");
  const en = requireLocal("./enrolments") as typeof import("./enrolments");
  const lib = requireLocal("./library") as typeof import("./library");

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
  const NOT_DIY = { ok: false, error: "Programs are for DIY members. Switch this member to DIY first." };
  const DAY = 86400000;

  const failures: string[] = [];
  const cases: [string, () => void][] = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);

  // ── helpers ──
  const newMember = (diy = true): number => {
    const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Lifter", phone: "0" }).returning({ id: clients.id }).all();
    if (diy) assert.ok(en.setTrainingMode(c.id, "diy", staff));
    return c.id;
  };
  const mode = (clientId: number) => db.select().from(clients).where(eq(clients.id, clientId)).get()!.trainingMode;
  const enrolIn = (clientId: number, key: string, maxesKg: Record<string, number>, weekdays = [1, 3, 5]) => {
    const r = en.enrol(clientId, { ...input, key, maxesKg, weekdays });
    assert.ok(r.ok, `enrolled in ${key}: ${JSON.stringify(r)}`);
    return r.id;
  };
  /** Start the next program session and log every planned set as done; typed = the member typed the weights in. */
  const logNext = (clientId: number, typed: boolean): number => {
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok, `started a session: ${JSON.stringify(s)}`);
    const v = log.getSession(clientId, s.sessionId)!;
    log.saveSessionSets(
      clientId,
      v.id,
      v.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p) => ({ weightKg: typed ? p.kg : null, reps: p.reps, done: true })) })),
    );
    assert.equal(log.finishSession(clientId, v.id), true);
    return v.id;
  };
  const runNext = (clientId: number, typed = true) => {
    const id = logNext(clientId, typed);
    const out = en.finishEnrolmentSession(clientId, id);
    assert.ok(out, "the finish moved the program");
    return id;
  };
  const progressEvents = (enrolmentId: number, sessionId: number) =>
    en.enrolmentEvents(enrolmentId, 500).filter((x) => x.kind === "progress" && x.sessionId === sessionId).length;
  const stateOf = (clientId: number) => JSON.stringify(en.liveEnrolment(clientId)!.state);
  const block = (kind: string) =>
    db.run(sql.raw(`CREATE TRIGGER block_${kind} BEFORE INSERT ON program_enrolment_events WHEN NEW.kind = '${kind}' BEGIN SELECT RAISE(ABORT, 'event write failed'); END`));
  const unblock = (kind: string) => db.run(sql.raw(`DROP TRIGGER IF EXISTS block_${kind}`));

  test("StrongLifts end to end", () => {
    const clientId = newMember(false);
    assert.equal(mode(clientId), "coach", "members start coach guided");
    assert.ok(en.setTrainingMode(clientId, "diy", staff));

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
    assert.equal(en.sessionTitle(view, plan), "Workout A, week 1 of 12");

    // ── start a session from the plan; starting again resumes it ──
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    const again = en.startEnrolmentSession(clientId);
    assert.ok(again.ok && again.sessionId === s.sessionId);
    const session = log.getSession(clientId, s.sessionId)!;
    assert.equal(session.enrolmentId, view.id);
    assert.equal(session.programId, null);
    assert.equal(session.dayName, "Workout A, week 1 of 12");
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
    const eventsBefore = en.enrolmentEvents(view.id).length;
    assert.equal(en.finishEnrolmentSession(clientId, session.id), null, "a second finish is a no-op");
    assert.equal(en.liveEnrolment(clientId)!.state.day, 1, "a second finish does not move the program again");
    assert.equal(en.enrolmentEvents(view.id).length, eventsBefore, "a second finish writes nothing");

    // ── a finished session that is no longer the current one is noted, not counted ──
    const s2 = en.startEnrolmentSession(clientId);
    assert.ok(s2.ok);
    assert.equal(log.finishSession(clientId, s2.sessionId), true);

    // ── skip ──
    assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
    assert.equal(en.liveEnrolment(clientId)!.state.day, 2);
    assert.deepEqual(en.finishEnrolmentSession(clientId, s2.sessionId)!.reasons, ["This wasn't your current session, so your program did not move on."]);
    assert.equal(en.liveEnrolment(clientId)!.state.day, 2);

    // ── switching to coach guided pauses; back to DIY resumes ──
    assert.deepEqual(en.setTrainingMode(clientId, "coach", staff), { paused: true, resumed: false });
    assert.equal(en.liveEnrolment(clientId)!.status, "paused");
    assert.deepEqual(en.startEnrolmentSession(clientId), { ok: false, error: "Your program is paused while you're coach guided." });
    assert.deepEqual(en.setTrainingMode(clientId, "diy", staff), { paused: false, resumed: true });
    assert.equal(en.liveEnrolment(clientId)!.status, "active");
    assert.equal(mode(clientId), "diy");

    // ── coach changes, logged with who made them ──
    assert.deepEqual(en.coachSetMax(clientId, view.id, "squat", 140, staff), { ok: true });
    const cm = en.liveEnrolment(clientId)!;
    assert.equal(cm.state.maxes.squat, 140);
    assert.equal(cm.state.weights["back squat"], 70);
    assert.deepEqual(en.coachSetMax(clientId, view.id, "squat", 0, staff), { ok: false, error: "Enter a max between 1 and 600 kg." });
    assert.deepEqual(en.coachSetMax(clientId + 999, view.id, "squat", 140, staff), { ok: false, error: "That program has ended." });
    assert.deepEqual(en.coachMoveToWeek(clientId, view.id, 1, staff), { ok: true });
    assert.deepEqual([en.liveEnrolment(clientId)!.state.week, en.liveEnrolment(clientId)!.state.day], [1, 0]);
    assert.equal(
      en.enrolmentEvents(view.id).find((x) => x.kind === "week")!.reason,
      "Coach Ann moved the program to week 2 of 12.",
      "the move names the week as weekLabel does",
    );
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
    assert.equal(en.bestLoggedSet(clientId, "squat", Date.now() + 91 * DAY), null, "only the last 90 days count");

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

  // ── 1. finishing is idempotent ──
  test("finish refuses a session that is not finished", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    assert.equal(en.finishEnrolmentSession(clientId, s.sessionId), null);
    assert.equal(en.liveEnrolment(clientId)!.state.day, 0, "an open session does not move the program");
    assert.equal(en.enrolmentEvents(id).length, 1, "only the start event");
  });

  test("finishing the same session twice runs progression once", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const sid = logNext(clientId, true);
    assert.ok(en.finishEnrolmentSession(clientId, sid));
    const once = stateOf(clientId);
    assert.equal(en.finishEnrolmentSession(clientId, sid), null);
    assert.equal(stateOf(clientId), once);
    assert.equal(progressEvents(id, sid), 1);
  });

  test("after a GVT cycle wraps, re-finishing an old session changes nothing", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "german-volume-training", { bench: 100, squat: 140 });
    const first = runNext(clientId);
    const second = runNext(clientId);
    runNext(clientId);
    const v = en.liveEnrolment(clientId)!;
    assert.deepEqual([v.state.cycle, v.state.week, v.state.day], [1, 0, 0], "the cycle wrapped back to position 0");
    const before = stateOf(clientId);
    const count = en.enrolmentEvents(id, 500).length;
    assert.equal(en.finishEnrolmentSession(clientId, first), null);
    assert.equal(en.finishEnrolmentSession(clientId, second), null);
    assert.equal(stateOf(clientId), before);
    assert.equal(en.enrolmentEvents(id, 500).length, count);
    assert.equal(progressEvents(id, first), 1);
  });

  test("a noted session cannot move the program after the cycle wraps", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "german-volume-training", { bench: 100, squat: 140 });
    const old = logNext(clientId, true);
    assert.equal(en.skipEnrolmentSession(clientId).ok, true);
    const noted = en.finishEnrolmentSession(clientId, old);
    assert.ok(noted, "the off-position finish wrote a note");
    assert.equal(en.enrolmentEvents(id, 500).filter((x) => x.kind === "note" && x.sessionId === old).length, 1);
    runNext(clientId);
    runNext(clientId);
    const v = en.liveEnrolment(clientId)!;
    assert.equal(v.state.day, 0, "the cycle wrapped back to position 0");
    const before = stateOf(clientId);
    const count = en.enrolmentEvents(id, 500).length;
    assert.equal(en.finishEnrolmentSession(clientId, old), null);
    assert.equal(stateOf(clientId), before);
    assert.equal(en.enrolmentEvents(id, 500).length, count, "no second note and no progress");
  });

  test("skip refuses while an open session has ticked sets", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    const v = log.getSession(clientId, s.sessionId)!;
    log.saveSessionSets(clientId, v.id, [{ id: v.exercises[0].id, sets: [{ weightKg: 50, reps: 5, done: true }] }]);
    const before = stateOf(clientId);
    assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: false, error: "Finish or discard your open workout first." });
    assert.equal(stateOf(clientId), before);
    assert.ok(log.getSession(clientId, v.id), "the open session is kept");
    assert.equal(en.enrolmentEvents(id, 500).filter((x) => x.kind === "skip").length, 0);
  });

  test("skip deletes an open session that has no ticked sets", () => {
    const clientId = newMember();
    enrolIn(clientId, "stronglifts-5x5", maxes);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
    assert.equal(log.getSession(clientId, s.sessionId), null);
    assert.equal(log.openSession(clientId), null);
    assert.equal(en.liveEnrolment(clientId)!.state.day, 1);
  });

  test("programWeek maps second-cycle positions back into the cycle", () => {
    const clientId = newMember();
    enrolIn(clientId, "german-volume-training", { bench: 100, squat: 140 }, [1, 2, 3, 4, 5, 6, 7]);
    const v = en.liveEnrolment(clientId)!;
    const days = en.programWeek(v, new Date(2026, 10, 16, 8).getTime());
    const planned = days.filter((d) => d.dayPosition !== null);
    assert.equal(planned.length, 7, "a Monday with seven training days has every day ahead");
    assert.deepEqual(planned.map((d) => d.dayPosition), [0, 1, 2, 0, 1, 2, 0], "positions 3 to 6 are the second cycle, mapped back");
  });

  // ── 2. every change and its event are written in one transaction ──
  test("finish writes state and event together; a retry works", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const sid = logNext(clientId, true);
    block("progress");
    try {
      assert.throws(() => en.finishEnrolmentSession(clientId, sid), /event write failed/);
    } finally {
      unblock("progress");
    }
    assert.equal(en.liveEnrolment(clientId)!.state.day, 0, "the position did not move");
    assert.equal(en.liveEnrolment(clientId)!.state.weights["back squat"], 50);
    assert.equal(progressEvents(id, sid), 0);
    assert.ok(en.finishEnrolmentSession(clientId, sid), "the retry runs");
    assert.equal(en.liveEnrolment(clientId)!.state.day, 1);
    assert.equal(progressEvents(id, sid), 1);
  });

  test("skip, coach max, coach week, mode switch and end roll back when the event fails", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const tries: [string, () => unknown][] = [
      ["skip", () => en.skipEnrolmentSession(clientId)],
      ["max", () => en.coachSetMax(clientId, id, "squat", 150, staff)],
      ["week", () => en.coachMoveToWeek(clientId, id, 1, staff)],
      ["end", () => en.endEnrolment(clientId, { kind: "member" })],
    ];
    for (const [kind, run] of tries) {
      const before = stateOf(clientId);
      block(kind);
      try {
        assert.throws(run, /event write failed/, kind);
      } finally {
        unblock(kind);
      }
      assert.equal(stateOf(clientId), before, `${kind}: state unchanged`);
      assert.equal(en.liveEnrolment(clientId)!.status, "active", `${kind}: still active`);
    }
    block("pause");
    try {
      assert.throws(() => en.setTrainingMode(clientId, "coach", staff), /event write failed/);
    } finally {
      unblock("pause");
    }
    assert.equal(mode(clientId), "diy", "the member row rolled back too");
    assert.equal(en.liveEnrolment(clientId)!.status, "active");
    assert.equal(en.enrolmentEvents(id).length, 1, "only the start event");
  });

  test("enrol writes the enrolment and its start event together", () => {
    const clientId = newMember();
    block("start");
    try {
      assert.throws(() => en.enrol(clientId, input), /event write failed/);
    } finally {
      unblock("start");
    }
    assert.equal(en.liveEnrolment(clientId), null);
    assert.equal(en.listEnrolments(clientId).length, 0);
    assert.ok(en.enrol(clientId, input).ok);
  });

  test("restart from test rolls back when the event fails", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "smolov-base", { squat: 140 });
    const v = en.liveEnrolment(clientId)!;
    assert.deepEqual(en.coachMoveToWeek(clientId, id, v.template.weeks.length - 1, staff), { ok: true });
    for (let i = 0; i < 20 && !en.liveEnrolment(clientId)!.state.finished; i++) assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
    assert.equal(en.liveEnrolment(clientId)!.state.finished, true);
    const before = stateOf(clientId);
    block("restart");
    try {
      assert.throws(() => en.restartFromTest(clientId, { squat: 150 }), /event write failed/);
    } finally {
      unblock("restart");
    }
    assert.equal(stateOf(clientId), before);
    assert.deepEqual(en.restartFromTest(clientId, { squat: 150 }), { ok: true });
    assert.equal(en.liveEnrolment(clientId)!.state.maxes.squat, 150);
    // after a restart the session title reads as a second round of the block
    const again = en.liveEnrolment(clientId)!;
    assert.match(en.sessionTitle(again, en.planFor(again)!), /, week 1 of 4, round 2$/);
  });

  // ── 3. a ticked set counts at its planned weight ──
  test("5/3/1: ticked sets with no weight typed still raise the training max", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb", { press: 50, deadlift: 140, bench: 80, squat: 120 }, [1, 2, 4, 5]);
    const start = en.liveEnrolment(clientId)!;
    const perCycle = start.template.weeks.reduce((n, w) => n + w.days.length, 0);
    for (let i = 0; i < perCycle; i++) runNext(clientId, false);
    const end = en.liveEnrolment(clientId)!;
    assert.equal(end.state.cycle, 1);
    for (const lift of start.template.lifts) assert.ok(end.state.tms[lift]! > start.state.tms[lift]!, `${lift} training max went up`);
  });

  test("5/3/1: a coach move in the second cycle is logged as a week of that cycle", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "531-bbb", { press: 50, deadlift: 140, bench: 80, squat: 120 }, [1, 2, 4, 5]);
    const perCycle = en.liveEnrolment(clientId)!.template.weeks.reduce((n, w) => n + w.days.length, 0);
    for (let i = 0; i < perCycle; i++) assert.deepEqual(en.skipEnrolmentSession(clientId), { ok: true });
    assert.equal(en.liveEnrolment(clientId)!.state.cycle, 1);
    assert.deepEqual(en.coachMoveToWeek(clientId, id, 2, staff), { ok: true });
    const moved = en.enrolmentEvents(id).find((x) => x.kind === "week")!;
    assert.equal(moved.reason, "Coach Ann moved the program to week 7 of 12.");
    const v = en.liveEnrolment(clientId)!;
    assert.equal(en.sessionTitle(v, en.planFor(v)!), "Press day, week 7 of 12");
    const skips = en.enrolmentEvents(id, 500).filter((x) => x.kind === "skip").sort((x, y) => x.id - y.id);
    assert.match(skips[0].reason, /^Skipped Press day, week 1 of 12\./);
    assert.match(skips[skips.length - 1].reason, /^Skipped Squat day, week 4 of 12\./);
  });

  test("bestLoggedSet counts a ticked set at its planned weight", () => {
    const clientId = newMember();
    enrolIn(clientId, "stronglifts-5x5", maxes);
    runNext(clientId, false);
    const best = en.bestLoggedSet(clientId, "squat");
    assert.ok(best, "a ticked set with no weight typed counts");
    assert.equal(best!.kg, 50);
    assert.equal(best!.reps, 5);
  });

  test("switching mode says whether a program was paused", () => {
    const clientId = newMember(false);
    assert.deepEqual(en.setTrainingMode(clientId, "diy", staff), { paused: false, resumed: false }, "no program to resume");
    assert.deepEqual(en.setTrainingMode(clientId, "coach", staff), { paused: false, resumed: false }, "no program to pause");
    assert.equal(en.setTrainingMode(999999, "coach", staff), null, "an unknown member");
  });

  // ── 4. enrolling needs a DIY member ──
  test("enrol refuses a coach-guided member", () => {
    const clientId = newMember(false);
    assert.deepEqual(en.enrol(clientId, input), NOT_DIY);
    assert.equal(en.listEnrolments(clientId).length, 0);
    assert.ok(en.setTrainingMode(clientId, "diy", staff));
    assert.ok(en.enrol(clientId, input).ok);
  });

  // ── 5. week labels agree ──
  test("sessionTitle and programWeek use the same week number after a cycle wraps", () => {
    const clientId = newMember();
    enrolIn(clientId, "german-volume-training", { bench: 100, squat: 140 }, [1, 2, 3, 4, 5, 6, 7]);
    const first = runNext(clientId);
    runNext(clientId);
    runNext(clientId);
    assert.equal(log.getSession(clientId, first)!.dayName, "Chest and back, week 1 of 6");
    const v = en.liveEnrolment(clientId)!;
    const title = en.sessionTitle(v, en.planFor(v)!);
    assert.equal(title, "Chest and back, week 2 of 6");
    const today = en.programWeek(v, Date.now() + 8 * DAY).find((d) => d.status === "today")!;
    assert.equal(today.title, title);
    assert.equal(today.dayPosition, 0);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    assert.equal(log.getSession(clientId, s.sessionId)!.dayName, title);
  });

  // ── 6. RPE ──
  test("RPE is stored only from 1 to 10 in half steps", () => {
    const clientId = newMember();
    enrolIn(clientId, "stronglifts-5x5", maxes);
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    const ex = log.getSession(clientId, s.sessionId)!.exercises[0];
    const tries: unknown[] = [8.5, 11, 7.3, 0, Number.NaN, "8", 10, 1, -2];
    log.saveSessionSets(clientId, s.sessionId, [{ id: ex.id, sets: tries.map((rpe) => ({ weightKg: 50, reps: 5, done: true, rpe: rpe as number })) }]);
    const got = log.getSession(clientId, s.sessionId)!.exercises[0].sets.map((x) => x.rpe);
    assert.deepEqual(got, [8.5, null, null, null, null, null, 10, 1, null]);
  });

  // ── 7. ownership ──
  test("a member cannot finish another member's session", () => {
    const a = newMember();
    const b = newMember();
    const aId = enrolIn(a, "stronglifts-5x5", maxes);
    enrolIn(b, "stronglifts-5x5", maxes);
    const sid = logNext(a, true);
    const before = stateOf(a);
    assert.equal(en.finishEnrolmentSession(b, sid), null);
    assert.equal(stateOf(a), before);
    assert.equal(en.liveEnrolment(b)!.state.day, 0);
    assert.equal(progressEvents(aId, sid), 0);
    assert.ok(en.finishEnrolmentSession(a, sid));
  });

  test("finishing while the enrolment is paused does not progress it", () => {
    const clientId = newMember();
    const id = enrolIn(clientId, "stronglifts-5x5", maxes);
    const sid = logNext(clientId, true);
    assert.ok(en.setTrainingMode(clientId, "coach", staff));
    const before = stateOf(clientId);
    assert.deepEqual(en.finishEnrolmentSession(clientId, sid), { reasons: ["Your program is paused, so it did not move on."], finished: false });
    assert.equal(stateOf(clientId), before);
    assert.equal(progressEvents(id, sid), 0);
  });

  // ── 8. gym copies ──
  test("a live enrolment survives deleting the gym copy it started from", () => {
    const clientId = newMember();
    const copyId = lib.makeCopy("stronglifts-5x5", 1);
    assert.ok(copyId);
    const id = enrolIn(clientId, `copy-${copyId}`, maxes);
    const before = en.liveEnrolment(clientId)!;
    assert.equal(before.copyId, copyId);
    assert.equal(before.programKey, null);
    assert.equal(lib.deleteCopy(copyId), true);
    const after = en.liveEnrolment(clientId);
    assert.ok(after, "still live");
    assert.equal(after.id, id);
    assert.equal(after.status, "active");
    assert.equal(after.copyId, null, "the link to the deleted copy is cleared");
    assert.deepEqual(after.template, before.template, "the snapshot is kept");
    runNext(clientId);
    assert.equal(en.liveEnrolment(clientId)!.state.day, 1, "and it still runs");
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
    console.log("programs/enrolments: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
