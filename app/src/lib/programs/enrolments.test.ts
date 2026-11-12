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
