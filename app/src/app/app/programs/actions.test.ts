// Run: npm test -- src/app/app/programs/actions.test.ts
//
// The member program actions against a scratch tenant, through the real
// "use server" functions: starting another member's "member:<id>" program is
// refused, a member's own max is refused on a library program, and an edit
// saved without week origins is refused. The client session is stubbed
// (requireClient returns the member under test, memberSeesPrograms says yes);
// next/cache, next/headers and next/navigation are stubbed the way
// src/app/workout/exercises/actions.test.ts does it.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

let currentClientId = 0;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/headers") return { cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }) };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in app/programs/actions.test.ts");
      },
    };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "@/lib/clientAuth") return { requireClient: () => ({ clientId: currentClientId, tenantId: 0, client: { trainingMode: "diy" } }) };
  if (request === "@/lib/programs/access") return { memberSeesPrograms: () => true };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../../lib/db/control") as typeof import("../../../lib/db/control");
  const { runWithTenant } = requireLocal("../../../lib/db/tenant") as typeof import("../../../lib/db/tenant");
  const { db } = requireLocal("../../../lib/db") as typeof import("../../../lib/db");
  const { clients } = requireLocal("../../../lib/db/schema") as typeof import("../../../lib/db/schema");
  const en = requireLocal("../../../lib/programs/enrolments") as typeof import("../../../lib/programs/enrolments");
  const mp = requireLocal("../../../lib/programs/memberPrograms") as typeof import("../../../lib/programs/memberPrograms");
  const { blankMemberTemplate } = requireLocal("../../../lib/programs/memberTemplate") as typeof import("../../../lib/programs/memberTemplate");
  const actions = requireLocal("./actions") as typeof import("./actions");
  const built = requireLocal("./built/actions") as typeof import("./built/actions");

  const slug = "programs-member-actions-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Member Actions Test", dbFile) as { id: number }
  ).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  type Template = import("../../../lib/programs/types").ProgramTemplate;
  type Exercise = import("../../../lib/programs/types").ExerciseRx;
  const staff = { kind: "staff" as const, userId: 1, name: "Coach Ann" };
  const squat: Exercise = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }], rule: { kind: "percent" } };
  const bench: Exercise = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 60 } };
  const program = (): Template => ({ ...blankMemberTemplate(), name: "Strength block", weeks: [{ days: [{ name: "Upper", exercises: [bench] }, { name: "Lower", exercises: [squat] }] }] });
  const startInput = (key: string) => ({
    key,
    unit: "kg",
    step: "2.5kg",
    startDate: new Date().toISOString().slice(0, 10),
    weekdays: [1, 4],
    maxes: [{ lift: "squat", kind: "one_rm", weight: 150, reps: null }],
  });

  const newMember = (): number => {
    const [c] = db.insert(clients).values({ firstName: "Test", lastName: "Actions", phone: "0" }).returning({ id: clients.id }).all();
    assert.ok(en.setTrainingMode(c.id, "diy", staff));
    return c.id;
  };
  const create = (clientId: number): number => {
    const r = mp.createMemberProgram(clientId, { template: program(), maxes: {}, basedOn: null });
    assert.ok(r.ok, `created: ${JSON.stringify(r)}`);
    return r.id;
  };

  const failures: string[] = [];
  const cases: [string, () => Promise<void>][] = [];
  const test = (name: string, fn: () => Promise<void>) => cases.push([name, fn]);

  test("starting another member's member:<id> program is refused", async () => {
    const owner = newMember();
    const other = newMember();
    const id = create(owner);
    currentClientId = other;
    assert.deepEqual(await actions.startProgramAction(startInput(`member:${id}`)), { ok: false, error: "That program isn't available." });
    assert.equal(en.liveEnrolment(other), null, "nothing started for the other member");
    assert.equal(en.liveEnrolment(owner), null, "nor for the owner");
    currentClientId = owner;
    assert.deepEqual(await actions.startProgramAction(startInput(`member:${id}`)), { ok: true }, "the owner can start it");
    assert.equal(en.liveEnrolment(owner)!.programKey, `member:${id}`);
  });

  test("a member's own max is refused on a library program", async () => {
    const lib = newMember();
    currentClientId = lib;
    assert.deepEqual(await actions.startProgramAction(startInput("smolov-base")), { ok: true });
    const max = { max: { lift: "squat", kind: "one_rm", weight: 160, reps: null } };
    assert.deepEqual(await actions.setOwnMaxAction(max), { ok: false, error: "You don't have a program of your own running." });
    assert.equal(en.liveEnrolment(lib)!.state.maxes.squat, 150, "the library max is unchanged");
    const own = newMember();
    currentClientId = own;
    const id = create(own);
    assert.deepEqual(await actions.startProgramAction(startInput(`member:${id}`)), { ok: true });
    assert.deepEqual(await actions.setOwnMaxAction(max), { ok: true }, "a program the member built takes it");
    assert.equal(en.liveEnrolment(own)!.state.maxes.squat, 160);
  });

  test("an edit saved without week origins is refused", async () => {
    const clientId = newMember();
    currentClientId = clientId;
    const created = await built.saveBuiltProgramAction({ id: null, from: "blank", template: program() });
    assert.ok(created.ok, `a new program needs no origins: ${JSON.stringify(created)}`);
    const renamed = { ...program(), name: "Spring block" };
    assert.deepEqual(await built.saveBuiltProgramAction({ id: created.id, from: null, template: renamed }), {
      ok: false,
      errors: ["Couldn't read the program. Reload the page and try again."],
    });
    assert.equal(mp.getMemberProgram(clientId, created.id)!.name, "Strength block", "nothing saved");
    assert.deepEqual(await built.saveBuiltProgramAction({ id: created.id, from: null, template: renamed, weekOrigins: [0] }), { ok: true, id: created.id, edited: false });
    assert.equal(mp.getMemberProgram(clientId, created.id)!.name, "Spring block");
  });

  test("an edit to another member's program says it no longer exists", async () => {
    const owner = newMember();
    const id = create(owner);
    currentClientId = newMember();
    assert.deepEqual(await built.saveBuiltProgramAction({ id, from: null, template: program(), weekOrigins: [0] }), { ok: false, errors: ["That program no longer exists."] });
  });

  try {
    await runWithTenant(tid, async () => {
      for (const [name, fn] of cases) {
        try {
          await fn();
          console.log(`  pass  ${name}`);
        } catch (err) {
          failures.push(name);
          console.log(`  FAIL  ${name}\n        ${String((err as Error).message ?? err).split("\n")[0]}`);
        }
      }
    });
    if (failures.length) throw new Error(`${failures.length} of ${cases.length} cases failed: ${failures.join("; ")}`);
    console.log("app/programs actions: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
