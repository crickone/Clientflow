// app/src/lib/programs/progressData.test.ts
// Run: npm test -- src/lib/programs/progressData.test.ts
//
// The Progress screen's data for one enrolment, against a scratch tenant: the
// chart series from the change log, the + set rows from logged sessions, and
// the labels. Failures are listed by name.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/progressData.test.ts");
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
  const { clients, workoutSessionExercises } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const Sqlite = requireLocal("better-sqlite3") as { prototype: { prepare: (...a: unknown[]) => unknown } };
  const log = requireLocal("../workoutLog") as typeof import("../workoutLog");
  const en = requireLocal("./enrolments") as typeof import("./enrolments");
  const pd = requireLocal("./progressData") as typeof import("./progressData");

  const slug = "programs-progress-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Progress Test", dbFile) as {
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
  const input = { key: "531-bbb", maxesKg: maxes, unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 3, 5, 6] };

  const failures: string[] = [];
  const cases: [string, () => void][] = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);

  const newMember = (): number => {
    const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Lifter", phone: "0" }).returning({ id: clients.id }).all();
    assert.ok(en.setTrainingMode(c.id, "diy", staff));
    return c.id;
  };
  const enrolIn = (clientId: number, key: string) => {
    const r = en.enrol(clientId, { ...input, key });
    assert.ok(r.ok, `enrolled in ${key}: ${JSON.stringify(r)}`);
    return r.id;
  };
  /** Start the next session, log every planned set as done (the last set of `lastReps` reps when given), finish it and move the program. */
  const runNext = (clientId: number, lastReps?: number): number => {
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok, `started a session: ${JSON.stringify(s)}`);
    const v = log.getSession(clientId, s.sessionId)!;
    log.saveSessionSets(
      clientId,
      v.id,
      v.exercises.map((ex) => ({
        id: ex.id,
        sets: ex.plan!.sets.map((p, i, all) => ({ weightKg: p.kg, reps: lastReps !== undefined && i === all.length - 1 && ex.plan!.sets.some((q) => q.amrap) ? lastReps : p.reps, done: true })),
      })),
    );
    assert.equal(log.finishSession(clientId, v.id), true);
    assert.ok(en.finishEnrolmentSession(clientId, v.id), "the finish moved the program");
    return v.id;
  };

  test("before any session: four charts, one so-far point, planned to the end, no rows", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.charts.length, 4);
    assert.equal(data.kindLabel, "Training max");
    assert.equal(data.kind, "tm");
    assert.equal(data.plus, true);
    assert.equal(data.plannedNote, "Dashed: if each + set hits its reps");
    assert.equal(data.totalWeeks, 12);
    const squat = data.charts.find((c) => c.lift === "squat")!;
    assert.equal(squat.label, "Squat");
    assert.deepEqual(squat.soFar, [{ week: 1, kg: 100 }]);
    assert.equal(squat.nowKg, 100);
    assert.equal(squat.planned[0].week, 1);
    assert.equal(squat.planned[squat.planned.length - 1].week, 12);
    assert.equal(squat.endKg, squat.planned[squat.planned.length - 1].kg);
    assert.deepEqual(data.rows, []);
    assert.equal(data.rowsTitle, "Your + sets");
    assert.equal(data.unit, "kg");
  });

  test("after the press day with a + set of 8 reps: the row, and the so-far line gains no false point", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    runNext(clientId, 8);
    runNext(clientId, 8);
    runNext(clientId, 8);
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.rows.length, 3, "bench and deadlift days come before the press day");
    assert.equal(data.rows[0].lift, "Overhead press");
    assert.ok(data.rows[0].got.endsWith("x 8"), data.rows[0].got);
    assert.equal(data.rows[0].week, 1, "the session ran in week 1");
    assert.equal(data.rows[0].planned, "85% x 5+");
    assert.deepEqual(data.charts.find((c) => c.lift === "squat")!.soFar, [{ week: 1, kg: 100 }]);
  });

  test("a finished session the program never counted still gets a week, from the latest snapshot", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    const s = en.startEnrolmentSession(clientId);
    assert.ok(s.ok);
    const v = log.getSession(clientId, s.sessionId)!;
    log.saveSessionSets(clientId, v.id, v.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p, i, all) => ({ weightKg: p.kg, reps: i === all.length - 1 ? 7 : p.reps, done: true })) })));
    assert.equal(log.finishSession(clientId, v.id), true);
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].week, 1);
    assert.ok(data.rows[0].got.endsWith("x 7"));
  });

  test("rows keep each session's own week, newest first, across weeks", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    for (let i = 0; i < 5; i++) runNext(clientId, 6 + i);
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.rows.length, 5);
    assert.deepEqual(
      data.rows.map((r) => r.week),
      [2, 1, 1, 1, 1],
    );
    assert.ok(data.rows[0].got.endsWith("x 10"));
    assert.ok(data.rows[0].at >= data.rows[1].at);
  });

  test("a program without lifts: no charts, Top sets", () => {
    const clientId = newMember();
    enrolIn(clientId, "phul");
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.deepEqual(data.charts, []);
    assert.equal(data.rowsTitle, "Top sets");
    assert.equal(data.plus, false);
    assert.equal(data.kind, "weight");
    assert.equal(data.plannedNote, "Dashed: if you get every rep");
    assert.deepEqual(data.rows, []);
  });

  test("a program without lifts: a logged session gives a top-set row (its first weighted exercise)", () => {
    const clientId = newMember();
    enrolIn(clientId, "phul");
    const st = en.startEnrolmentSession(clientId);
    assert.ok(st.ok);
    const v = log.getSession(clientId, st.sessionId)!;
    log.saveSessionSets(
      clientId,
      v.id,
      v.exercises.map((ex) => ({ id: ex.id, sets: ex.plan!.sets.map((p) => ({ weightKg: p.kg ?? 40, reps: p.reps, done: true })) })),
    );
    assert.equal(log.finishSession(clientId, v.id), true);
    assert.ok(en.finishEnrolmentSession(clientId, v.id));
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.rows.length, 1, "one row for the session");
    assert.equal(data.rows[0].lift, v.exercises[0].plan!.name, "the session's first exercise");
    assert.ok(/ x \d+/.test(data.rows[0].got), data.rows[0].got);
    assert.equal(data.rows[0].week, 1);
  });

  test("18 logged sessions: at most 12 rows, newest first, and a few queries however many sessions", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    // The deload week (sessions 13 to 16) has no + set, so 14 rows exist across the 18 sessions.
    for (let i = 0; i < 18; i++) runNext(clientId, 3 + i);
    const view = en.liveEnrolment(clientId)!;
    let prepares = 0;
    const realPrepare = Sqlite.prototype.prepare;
    Sqlite.prototype.prepare = function (this: unknown, ...a: unknown[]) {
      prepares++;
      return realPrepare.apply(this, a);
    };
    let data: ReturnType<typeof pd.programProgress>;
    try {
      data = pd.programProgress(view);
    } finally {
      Sqlite.prototype.prepare = realPrepare;
    }
    assert.equal(data.rows.length, 12);
    assert.deepEqual(
      data.rows.map((r) => Number(r.got.split(" x ")[1])),
      [20, 19, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5],
      "newest first: the two oldest + sets are not in the list",
    );
    assert.ok(data.rows.every((r, i) => i === 0 || r.at <= data.rows[i - 1].at));
    assert.ok(prepares < 20, `a handful of queries, not one per exercise and set (${prepares})`);
  });

  test("older sessions are not read once 12 rows exist", () => {
    const clientId = newMember();
    enrolIn(clientId, "greyskull-lp");
    // Greyskull logs several + sets a session, so the newest batch of sessions already holds more than 12 rows.
    for (let i = 0; i < 14; i++) runNext(clientId, 6 + (i % 5));
    const view = en.liveEnrolment(clientId)!;
    let prepares = 0;
    const realPrepare = Sqlite.prototype.prepare;
    Sqlite.prototype.prepare = function (this: unknown, ...a: unknown[]) {
      prepares++;
      return realPrepare.apply(this, a);
    };
    let data: ReturnType<typeof pd.programProgress>;
    try {
      data = pd.programProgress(view);
    } finally {
      Sqlite.prototype.prepare = realPrepare;
    }
    assert.equal(data.rows.length, 12);
    assert.ok(data.rows.every((r, i) => i === 0 || r.at <= data.rows[i - 1].at), "newest first");
    // The change log, the sessions and one batch of exercises and sets come to 8 prepared statements; the 2 sessions past the first batch of 12 would cost 4 more.
    assert.ok(prepares <= 8, `one batch of sessions was read (${prepares} prepared statements)`);
  });

  test("a stored exercise without a sets list is skipped, not a crash", () => {
    const clientId = newMember();
    enrolIn(clientId, "531-bbb");
    const id = runNext(clientId, 7);
    const first = db.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.sessionId, id)).all();
    db.update(workoutSessionExercises).set({ rxJson: '{"name":"Old format"}' }).where(eq(workoutSessionExercises.id, first[0].id)).run();
    db.update(workoutSessionExercises).set({ rxJson: "null" }).where(eq(workoutSessionExercises.id, first[1].id)).run();
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.ok(Array.isArray(data.rows));
  });

  test("a fixed block keeps its chart in the test week and after the test, ending at the test max", () => {
    const clientId = newMember();
    enrolIn(clientId, "smolov-base");
    for (let i = 0; i < 12; i++) runNext(clientId);
    const atTest = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(atTest.kind, "top");
    assert.equal(atTest.charts.length, 1, "the squat chart is still there in the test week");
    assert.equal(atTest.charts[0].soFar.at(-1)!.week, 3);
    runNext(clientId);
    const view = en.liveEnrolment(clientId)!;
    assert.equal(view.state.finished, true);
    const after = pd.programProgress(view);
    assert.equal(after.charts.length, 1, "and after the test");
    const last = after.charts[0].soFar.at(-1)!;
    assert.equal(last.week, 4);
    assert.ok(Math.abs(last.kg - view.state.testMaxes.squat!) <= 1.25 + 1e-9, "the last so-far point is the test max (to the member's step)");
    assert.equal(after.charts[0].nowKg, last.kg);
  });

  test("after a restart: rows and chart count from the round's first week", () => {
    const clientId = newMember();
    enrolIn(clientId, "smolov-base");
    for (let i = 0; i < 13; i++) runNext(clientId);
    const r = en.restartFromTest(clientId, { squat: 110 });
    assert.ok(r.ok, JSON.stringify(r));
    runNext(clientId);
    const data = pd.programProgress(en.liveEnrolment(clientId)!);
    assert.equal(data.totalWeeks, 8);
    assert.equal(data.firstWeek, 5, "round 2 starts at program week 5");
    assert.equal(data.charts[0].soFar[0].week, 5, "the so-far line starts at the round's first week");
    assert.equal(data.rows.length, 1, "only this round's session");
    assert.equal(data.rows[0].week, 1, "the row reads Week 1, as the program says it");
    const first = pd.programProgress(en.liveEnrolment(enrolFresh())!);
    assert.equal(first.firstWeek, 1);
  });

  const enrolFresh = () => {
    const c = newMember();
    enrolIn(c, "531-bbb");
    return c;
  };

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
    console.log("programs/progressData: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
