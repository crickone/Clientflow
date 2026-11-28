// Run: npm test -- src/lib/workout.sessionDays.test.ts
//
// Members' sessions follow their day when a coach edits a program
// (saveProgram), against a real scratch tenant DB:
//   1. a 2-week program, a finished session on week 2 day 1; a day added to
//      week 1 moves every later day down one, and the session moves with its
//      day (same name), so Next up is the day after it;
//   2. day ids are kept across saves;
//   3. removing that day detaches the session (-1) and Next up starts at day 1;
//   4. a one-week program with a day appended leaves positions unchanged;
//   5. a new program (Adonis create_workout_program, duplicate) carries no
//      other program's day ids;
//   6. an open session of a removed day blocks a new start (it has work in it)
//      and the program page start index stays in range.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const { workoutSessions, clients, clientWorkoutPrograms, workoutDays } = requireLocal("./db/schema") as typeof import("./db/schema");
  const { getProgram, saveProgram, duplicateProgram, DETACHED_DAY_POSITION } = requireLocal("./workout") as typeof import("./workout");
  const { trainingOverview } = requireLocal("./trainingOverview") as typeof import("./trainingOverview");
  const { startSession } = requireLocal("./workoutLog") as typeof import("./workoutLog");
  const { blankExercise, dayLabel } = requireLocal("./workoutModel") as typeof import("./workoutModel");
  type ProgramInput = import("./workoutModel").ProgramInput;
  type Day = ProgramInput["days"][number];
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");

  const slug = "workout-session-days-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, slug, `tenants/${slug}/${slug}.db`) as {
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

  let passed = 0;
  const ok = (name: string, cond: boolean) => {
    assert.ok(cond, name);
    passed++;
  };

  const day = (week: number, name: string): Day => ({ week, name, instructions: null, exercises: [{ ...blankExercise("workout"), name: `${name} lift` }] });
  const base = (days: Day[]): ProgramInput => ({
    title: "Block",
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
    await runWithTenant(tid, async () => {
      const [member] = tdb.insert(clients).values({ firstName: "Test", lastName: "Member", phone: "000" }).returning({ id: clients.id }).all();
      const addSession = (programId: number, dayPosition: number, finished: boolean, dayName = "x") => {
        const now = Date.now();
        const [row] = tdb
          .insert(workoutSessions)
          .values({ clientId: member.id, programId, dayPosition, programTitle: "Block", dayName, startedAt: now, updatedAt: now, finishedAt: finished ? now : null })
          .returning({ id: workoutSessions.id })
          .all();
        return row.id;
      };
      const positionOf = (sessionId: number) => tdb.select().from(workoutSessions).where(eq(workoutSessions.id, sessionId)).get()!.dayPosition;

      // ── 1. two weeks: A, B | C, D ──
      const id = saveProgram(base([day(1, "A"), day(1, "B"), day(2, "C"), day(2, "D")]));
      tdb.insert(clientWorkoutPrograms).values({ clientId: member.id, programId: id }).run();
      const saved = getProgram(id)!;
      const idsBefore = saved.days.map((d) => d.id);
      // Week 2 day 1 ("C") is at position 2.
      const s = addSession(id, 2, true, dayLabel(saved.days, 2));
      ok("start: Next up is D", trainingOverview(member.id).next?.dayName === "Week 2 · D");

      // The builder inserts a new day at the end of week 1: A, B, New | C, D.
      const edited = { ...saved, days: [saved.days[0], saved.days[1], day(1, "New"), saved.days[2], saved.days[3]] };
      saveProgram(edited);
      const after = getProgram(id)!;
      const pos = positionOf(s);
      ok("insert: the session moved with its day", pos === 3 && after.days[pos].name === "C");
      ok("insert: kept days keep their ids", [0, 1, 3, 4].map((i) => after.days[i].id).join(",") === idsBefore.join(","));
      ok("insert: the new day has a new id", !idsBefore.includes(after.days[2].id));
      const next = trainingOverview(member.id).next;
      ok("insert: Next up is still D, at its new position", next?.dayName === "Week 2 · D" && next.dayPosition === 4);

      // ── 2. saving the same program again changes nothing ──
      saveProgram(getProgram(id)!);
      ok("resave: unchanged", positionOf(s) === 3 && getProgram(id)!.days.map((d) => d.id).join(",") === after.days.map((d) => d.id).join(","));

      // ── 3. removing C detaches the session ──
      const now3 = getProgram(id)!;
      saveProgram({ ...now3, days: now3.days.filter((d) => d.name !== "C") });
      ok("remove: the session is detached", positionOf(s) === DETACHED_DAY_POSITION);
      const ov = trainingOverview(member.id);
      ok("remove: Next up starts at day 1", ov.next?.dayPosition === 0 && ov.next.dayName === "Week 1 · A");
      ok("remove: the plan only offers real days", (ov.plan?.days ?? []).every((d) => d.dayPosition === null || d.dayPosition >= 0));

      // ── 4. one week: an appended day leaves positions alone ──
      const one = saveProgram(base([day(1, "P"), day(1, "Q")]));
      const oneSaved = getProgram(one)!;
      const s1 = addSession(one, 1, true);
      saveProgram({ ...oneSaved, days: [...oneSaved.days, day(1, "R")] });
      ok("one week: append keeps the position", positionOf(s1) === 1 && getProgram(one)!.days[1].name === "Q");

      // ── 5. new programs never take another program's day ids ──
      const dup = duplicateProgram(id)!;
      const dupIds = getProgram(dup)!.days.map((d) => d.id);
      ok("duplicate: fresh day ids", dupIds.every((x) => !getProgram(id)!.days.some((d) => d.id === x)));
      ok("duplicate: the original still has its days", tdb.select().from(workoutDays).where(eq(workoutDays.programId, id)).all().length === 4);
      // A foreign id on an update is not taken over either.
      const foreign = getProgram(dup)!.days[0].id!;
      const oneNow = getProgram(one)!;
      saveProgram({ ...oneNow, days: [...oneNow.days, { ...day(1, "S"), id: foreign }] });
      ok("foreign id: not reused", getProgram(one)!.days[3].id !== foreign && getProgram(dup)!.days[0].id === foreign);

      // ── 6. an open session of a removed day ──
      const p6 = getProgram(id)!;
      const open = addSession(id, 0, false, dayLabel(p6.days, 0));
      saveProgram({ ...p6, days: p6.days.slice(1) });
      ok("open session of a removed day: detached", positionOf(open) === DETACHED_DAY_POSITION);
      // An open session with nothing ticked is dropped when the member starts another day.
      const started = startSession(member.id, getProgram(id)!, 0);
      ok("open detached session with nothing ticked: a new start goes ahead", started.ok);
    });
  } finally {
    cleanup();
  }

  console.log(`workout.sessionDays.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
