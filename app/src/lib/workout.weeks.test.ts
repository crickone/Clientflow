// Run: npm test -- src/lib/workout.weeks.test.ts
//
// Weeks and target load in the data layer, against a real scratch tenant DB
// (same setup as assistant/tools.addExercise.test.ts):
//   1. saveProgram + getProgram round trip with two weeks and loads;
//   2. a one-week program keeps positions, names and labels exactly as before;
//   3. limits refuse with a plain error;
//   4. startSession snapshots load and the week label;
//   5. Adonis create_workout_program (via the real executeTool) with weeks + loads;
//   6. trainingOverview's day names carry the week.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in workout.weeks.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const { workoutDays, workoutSessionExercises, workoutSessions, clients, clientWorkoutPrograms } = requireLocal("./db/schema") as typeof import("./db/schema");
  const { getProgram, saveProgram, listPrograms, duplicateProgram } = requireLocal("./workout") as typeof import("./workout");
  const { startSession, getSession } = requireLocal("./workoutLog") as typeof import("./workoutLog");
  const { trainingOverview } = requireLocal("./trainingOverview") as typeof import("./trainingOverview");
  const { executeTool } = requireLocal("./assistant/tools") as typeof import("./assistant/tools");
  const { blankExercise } = requireLocal("./workoutModel") as typeof import("./workoutModel");
  type ProgramInput = import("./workoutModel").ProgramInput;
  const { asc, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");

  const slug = "workout-weeks-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Workout Weeks Test", dbFile) as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const ex = (name: string, load: string | null = null) => ({ ...blankExercise("workout"), name, load });
  const base = (days: ProgramInput["days"]): ProgramInput => ({
    title: "Strength block",
    type: "detailed",
    status: "active",
    tags: [],
    summary: null,
    content: null,
    uploadFilename: null,
    uploadOriginalName: null,
    days,
  });

  try {
    const tdb = getTenantDbById(tid);
    let id = 0;
    let oneId = 0;
    await runWithTenant(tid, async () => {
      // ── 1. two weeks + loads round trip ──
      id = saveProgram(
        base([
          // Deliberately out of order and with a gap: saved as weeks 1..2.
          { week: 4, name: "", instructions: null, exercises: [ex("Squat", "  75%  ")] },
          { week: 2, name: "Push", instructions: null, exercises: [ex("Bench", "70%"), ex("Dips", "")] },
          { week: 2, name: "", instructions: null, exercises: [ex("Row", "RPE 8")] },
        ]),
      );
      const p = getProgram(id)!;
      assert.deepEqual(p.days.map((d) => d.week), [1, 1, 2]);
      assert.deepEqual(p.days.map((d) => d.name), ["Push", "Day 2", "Day 1"], "blank names fall back within their week");
      assert.deepEqual(p.days.map((d) => d.exercises.map((e) => e.load)), [["70%", null], ["RPE 8"], ["75%"]], "loads trimmed, empty -> null");
      const rows = tdb.select().from(workoutDays).where(eq(workoutDays.programId, id)).orderBy(asc(workoutDays.position)).all();
      assert.deepEqual(rows.map((r) => [r.position, r.week]), [[0, 1], [1, 1], [2, 2]], "position is the running index");

      const list = listPrograms().find((r) => r.id === id)!;
      assert.equal(list.weekCount, 2);
      assert.equal(list.dayCount, 3);

      const dup = getProgram(duplicateProgram(id)!)!;
      assert.deepEqual(dup.days.map((d) => [d.week, d.name, d.exercises.map((e) => e.load).join("|")]), p.days.map((d) => [d.week, d.name, d.exercises.map((e) => e.load).join("|")]), "duplicate keeps weeks and loads");

      // Re-save (the builder's path): ids come back, positions stay running.
      saveProgram(p);
      assert.deepEqual(getProgram(id)!.days.map((d) => [d.week, d.name]), [[1, "Push"], [1, "Day 2"], [2, "Day 1"]]);

      // ── 2. one week, exactly as before ──
      oneId = saveProgram(base([
        { week: 1, name: "Upper", instructions: null, exercises: [ex("Press")] },
        { week: 1, name: "", instructions: null, exercises: [ex("Squat")] },
        { week: 1, name: "  ", instructions: null, exercises: [] },
      ]));
      const one = getProgram(oneId)!;
      assert.deepEqual(one.days.map((d) => d.name), ["Upper", "Day 2", "Day 3"], "one-week fallback counts across the program, as before");
      assert.deepEqual(
        tdb.select().from(workoutDays).where(eq(workoutDays.programId, oneId)).orderBy(asc(workoutDays.position)).all().map((r) => [r.position, r.week]),
        [[0, 1], [1, 1], [2, 1]],
      );

      // ── 3. limits ──
      assert.throws(
        () => saveProgram(base(Array.from({ length: 8 }, () => ({ week: 1, name: "x", instructions: null, exercises: [] })))),
        /Week 1 has 8 days/,
      );

      // ── 4. startSession snapshots load + week label ──
      const [client] = tdb.insert(clients).values({ firstName: "Test", lastName: "Member", phone: "000" }).returning({ id: clients.id }).all();
      const started = startSession(client.id, getProgram(id)!, 2);
      assert.ok(started.ok);
      const sid = (started as { sessionId: number }).sessionId;
      const sess = tdb.select().from(workoutSessions).where(eq(workoutSessions.id, sid)).get()!;
      assert.equal(sess.dayName, "Week 2 · Day 1");
      assert.equal(sess.dayPosition, 2);
      const sx = tdb.select().from(workoutSessionExercises).where(eq(workoutSessionExercises.sessionId, sid)).all();
      assert.deepEqual(sx.map((r) => [r.name, r.load]), [["Squat", "75%"]]);
      assert.equal(getSession(client.id, sid)!.exercises[0].load, "75%", "session view carries load");
    });

    await runWithTenant(tid, async () => {
      const [client2] = tdb.insert(clients).values({ firstName: "Second", lastName: "Member", phone: "001" }).returning({ id: clients.id }).all();
      const s = startSession(client2.id, getProgram(oneId)!, 1);
      assert.ok(s.ok);
      const row = tdb.select().from(workoutSessions).where(eq(workoutSessions.id, (s as { sessionId: number }).sessionId)).get()!;
      assert.equal(row.dayName, "Day 2", "one-week session day name unchanged");

      // ── 6. trainingOverview labels ──
      tdb.insert(clientWorkoutPrograms).values({ clientId: client2.id, programId: id }).run();
      const ov = trainingOverview(client2.id);
      const multi = ov.programs.find((p) => p.id === id)!;
      assert.deepEqual(multi.dayNames, ["Week 1 · Push", "Week 1 · Day 2", "Week 2 · Day 1"]);
    });

    // ── 5. Adonis create_workout_program ──
    const result = await runWithTenant(tid, () =>
      executeTool(
        "create_workout_program",
        {
          title: "Coach sheet",
          tags: "strength, block",
          days: [
            { name: "Day 1 – Squat", week: 1, exercises: [{ name: "Back squat", sets: 5, reps: "5", load: "75%" }] },
            { name: "Day 2 – Bench", week: 1, exercises: [{ name: "Bench", sets: 5, reps: "5", load: "RPE 8", joined: false }] },
            { name: "Day 1 – Squat", week: 2, exercises: [{ name: "Back squat", sets: 5, reps: "3", load: "80%" }] },
            { name: "Day 2 – Bench", week: 2, exercises: [{ name: "Bench", sets: 5, reps: "3", load: "RPE 9" }] },
          ],
        },
        { tenantId: tid },
      ),
    );
    const parsed = JSON.parse(result.text) as { result?: string; programId?: number; error?: string };
    assert.ok(!parsed.error, parsed.error);
    assert.equal(parsed.result, 'Created workout program "Coach sheet" with 4 day(s). Find it under Workout → Programs.');
    await runWithTenant(tid, async () => {
      const p = getProgram(parsed.programId!)!;
      assert.deepEqual(p.tags, ["strength", "block"]);
      assert.deepEqual(p.days.map((d) => [d.week, d.name, d.exercises[0].load]), [
        [1, "Day 1 – Squat", "75%"],
        [1, "Day 2 – Bench", "RPE 8"],
        [2, "Day 1 – Squat", "80%"],
        [2, "Day 2 – Bench", "RPE 9"],
      ]);
    });

    // No weeks given: one week, as before.
    const plain = JSON.parse(
      (await runWithTenant(tid, () =>
        executeTool("create_workout_program", { title: "Plain", days: [{ name: "A", exercises: [{ name: "Squat" }] }, { exercises: [{ name: "Row" }] }] }, { tenantId: tid }),
      )).text,
    ) as { programId: number };
    await runWithTenant(tid, async () => {
      assert.deepEqual(getProgram(plain.programId)!.days.map((d) => [d.week, d.name]), [[1, "A"], [1, "Day 2"]]);
    });

    // Over the limits: a plain error, nothing written.
    const tooMany = JSON.parse(
      (await runWithTenant(tid, () =>
        executeTool("create_workout_program", { title: "Huge", days: Array.from({ length: 8 }, () => ({ name: "x", week: 1, exercises: [] })) }, { tenantId: tid }),
      )).text,
    ) as { error?: string };
    assert.match(tooMany.error ?? "", /Week 1 has 8 days/);
    await runWithTenant(tid, async () => {
      assert.ok(!listPrograms().some((r) => r.title === "Huge"));
    });

    console.log("workout.weeks.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
