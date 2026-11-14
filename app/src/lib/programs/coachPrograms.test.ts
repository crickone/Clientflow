// app/src/lib/programs/coachPrograms.test.ts
// Run: npm test -- src/lib/programs/coachPrograms.test.ts
//
// A coach assigns a library program to one member, edits that person's copy
// keeping its engine and training maxes, and ends it.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/coachPrograms.test.ts");
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
  const cp = requireLocal("./coachPrograms") as typeof import("./coachPrograms");
  const reg = requireLocal("./registry") as typeof import("./registry");

  const slug = "programs-coach-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Coach Test", dbFile) as {
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

  const staff = { kind: "staff" as const, userId: 7, name: "Coach Ann" };
  const base = { key: "531-bbb", template: null, maxesKg: { squat: 140, bench: 100, deadlift: 180, press: 60 }, unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 2, 4, 5], replace: false };
  const SL = { key: "stronglifts-5x5", maxesKg: { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, unit: "kg" as const, stepKg: 2.5, startDate: "2026-11-16", weekdays: [1, 3, 5] };

  const failures: string[] = [];
  const cases: [string, () => void][] = [];
  const test = (name: string, fn: () => void) => cases.push([name, fn]);

  const newMember = (diy = true): number => {
    const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Lifter", phone: "0" }).returning({ id: clients.id }).all();
    if (diy) assert.ok(en.setTrainingMode(c.id, "diy", staff));
    return c.id;
  };

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
    assert.ok(en.enrol(c, SL).ok);
    const first = cp.coachAssign(c, base, staff);
    assert.ok(!first.ok && first.needsReplace);
    const old = en.liveEnrolment(c)!.id;
    assert.ok(cp.coachAssign(c, { ...base, replace: true }, staff).ok);
    assert.equal(en.getEnrolmentFor(c, old)!.status, "ended");
    assert.equal(en.enrolmentEvents(old)[0].reason, "Coach Ann ended this program to set a new one.");
  });

  test("an edited copy is checked: a lift the engine needs can't be dropped", () => {
    const c = newMember(false);
    const t = structuredClone(reg.platformProgram("531-bbb")) as any;
    for (const w of t.weeks) for (const d of w.days) d.exercises = d.exercises.filter((x: { lift?: string }) => x.lift !== "press");
    for (const w of t.weeks) w.days = w.days.filter((d: { exercises: unknown[] }) => d.exercises.length > 0);
    const r = cp.coachAssign(c, { ...base, template: t }, staff);
    assert.ok(!r.ok && r.errors?.some((e) => /overhead press max/.test(e)), JSON.stringify(r));
    assert.equal(en.liveEnrolment(c), null, "nothing written");
  });

  test("a coach edits a running program; the training max survives", () => {
    const c = newMember(false);
    assert.ok(cp.coachAssign(c, base, staff).ok);
    const v = en.liveEnrolment(c)!;
    db.run(sql`UPDATE program_enrolments SET tms_json = ${JSON.stringify({ squat: 130, bench: 92.5, deadlift: 167.5, press: 57.5 })} WHERE id = ${v.id}`);
    const t = structuredClone(v.template) as any;
    t.weeks[0].days[0].exercises.push({ name: "Face pull", sets: [{ kind: "fixed", reps: 15, rest: 60 }], progress: false });
    assert.deepEqual(cp.coachEditProgram(c, v.id, t, t.weeks.map((_: unknown, i: number) => i), staff), { ok: true });
    const after = en.liveEnrolment(c)!;
    assert.equal(after.state.tms.squat, 130);
    assert.equal(after.template.weeks[0].days[0].exercises.at(-1)!.name, "Face pull");
    assert.match(en.enrolmentEvents(v.id)[0].reason, /^Coach Ann edited the program\./);
    const n = en.enrolmentEvents(v.id).length;
    assert.deepEqual(cp.coachEditProgram(c, v.id, after.template, after.template.weeks.map((_: unknown, i: number) => i), staff), { ok: true });
    assert.equal(en.enrolmentEvents(v.id).length, n);
  });

  test("a coach can't edit a program the member chose", () => {
    const c = newMember(true);
    assert.ok(en.enrol(c, SL).ok);
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
    console.log("programs/coachPrograms: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
