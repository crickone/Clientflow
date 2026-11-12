// app/src/lib/programs/library.test.ts
// Run: npm test -- src/lib/programs/library.test.ts
//
// Hide switches and gym copies against a scratch tenant (control row + a real
// tenant DB file, so ensureTenantTables creates the new tables).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// ./library -> @/lib/db (ambient db proxy) -> @/lib/db/tenant (react cache)
// and @/lib/tenants -> @/lib/auth -> next/navigation. Same shim as forms.test.ts.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in programs/library.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const lib = requireLocal("./library") as typeof import("./library");
  const { PLATFORM_PROGRAMS } = requireLocal("./registry") as typeof import("./registry");

  const slug = "programs-library-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, "Programs Library Test", dbFile) as {
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

  try {
    runWithTenant(tid, () => {
      // ── hide switches ──
      assert.equal(lib.hiddenKeys().size, 0);
      assert.equal(lib.setHidden("smolov-base", true, 7), true);
      assert.equal(lib.setHidden("smolov-base", true, 7), true, "hiding twice is harmless");
      assert.equal(lib.setHidden("not-a-program", true, 7), false);
      assert.deepEqual([...lib.hiddenKeys()], ["smolov-base"]);
      assert.equal(lib.programByKey("smolov-base"), null, "a member cannot open a hidden program");
      assert.equal(lib.programByKey("smolov-base", { includeHidden: true })?.hidden, true);
      assert.ok(!lib.memberPrograms().some((e) => e.template.key === "smolov-base"));

      // ── make our version ──
      const id = lib.makeCopy("smolov-base", 7);
      assert.ok(id);
      const copy = lib.getCopy(id)!;
      assert.equal(copy.template.key, `copy-${id}`);
      assert.equal(copy.name, "Smolov base mesocycle");
      assert.equal(copy.basedOnName, "Smolov base mesocycle");
      assert.equal(lib.parseCopyKey(`copy-${id}`), id);
      assert.equal(lib.parseCopyKey("smolov-base"), null);
      assert.equal(lib.makeCopy("not-a-program", 7), null);

      // ── edit it: rename, change a percentage, add a note; an engine change is ignored ──
      const edited = structuredClone(copy.template);
      edited.name = "Our Smolov";
      edited.weeks[0].days[0].exercises[0].sets[0] = { kind: "pct", pct: 0.68, reps: 9, rest: 150 };
      edited.weeks[0].days[0].exercises[0].notes = "Belt on for the last two sets.";
      (edited as { engine: unknown }).engine = { key: "double_progression" };
      assert.deepEqual(lib.saveCopy(id, edited), { ok: true });
      const saved = lib.getCopy(id)!;
      assert.equal(saved.name, "Our Smolov");
      assert.equal(saved.template.engine.key, "fixed_block", "the original's engine always runs a copy");
      const firstSet = saved.template.weeks[0].days[0].exercises[0].sets[0];
      assert.ok(firstSet.kind === "pct" && firstSet.pct === 0.68);
      assert.equal(lib.listCopies().length, 1);

      // ── a copy that drops a lift the engine needs is refused, naming the lift ──
      const dropped = structuredClone(saved.template);
      for (const w of dropped.weeks) for (const d of w.days) d.exercises = d.exercises.map(() => ({ name: "Front squat", sets: [{ kind: "fixed" as const, reps: 5, rest: 120 }] }));
      assert.deepEqual(lib.saveCopy(id, dropped), {
        ok: false,
        errors: ["This version has no exercise that uses the squat max. Smolov base mesocycle needs one."],
      });
      const badName = structuredClone(saved.template);
      badName.weeks[0].days[0].exercises[0].name = "Zercher thing";
      const badCheck = lib.saveCopy(id, badName);
      assert.ok(!badCheck.ok && badCheck.errors[0].includes("not in the exercise list"));
      assert.equal(lib.getCopy(id)!.name, "Our Smolov", "a refused save changes nothing");

      // ── members see the gym's copies first, then the platform programs not hidden ──
      const keys = lib.memberPrograms().map((e) => e.template.key);
      assert.equal(keys[0], `copy-${id}`);
      assert.ok(keys.includes("stronglifts-5x5"));
      assert.equal(keys.length, PLATFORM_PROGRAMS.length - 1 + 1);
      assert.equal(lib.programByKey(`copy-${id}`)?.copyId, id);
      assert.equal(lib.programByKey(`copy-${id}`)?.basedOnName, "Smolov base mesocycle");

      // ── a stored copy that is valid JSON but not a template is skipped, not thrown on ──
      const origError = console.error;
      const logged: unknown[][] = [];
      console.error = (...a: unknown[]) => void logged.push(a);
      const { db: tdb } = requireLocal("../db") as typeof import("../db");
      const { programTemplates } = requireLocal("../db/schema") as typeof import("../db/schema");
      const now = Date.now();
      const [bad] = tdb
        .insert(programTemplates)
        .values({ basedOn: "smolov-base", engine: "fixed_block", name: "Broken", templateJson: JSON.stringify({ name: "Broken", weeks: "nope" }), createdBy: 7, createdAt: now, updatedAt: now })
        .returning({ id: programTemplates.id })
        .all();
      try {
        assert.equal(lib.getCopy(bad.id), null);
        assert.ok(!lib.listCopies().some((c) => c.id === bad.id));
        assert.ok(!lib.memberPrograms().some((e) => e.template.key === `copy-${bad.id}`));
        assert.ok(logged.length >= 1, "the skip is logged");
      } finally {
        console.error = origError;
        lib.deleteCopy(bad.id);
      }

      // ── unhide, delete ──
      assert.equal(lib.setHidden("smolov-base", false, 7), true);
      assert.equal(lib.hiddenKeys().size, 0);
      assert.equal(lib.deleteCopy(id), true);
      assert.equal(lib.getCopy(id), null);
      assert.equal(lib.programByKey(`copy-${id}`), null);
    });
    console.log("programs/library: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
