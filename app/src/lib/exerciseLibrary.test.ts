// Run: npm test -- src/lib/exerciseLibrary.test.ts
//
// GEL Task 2 (docs/superpowers/specs/2026-08-24-global-exercise-library-design.md):
// listExercises()/saveExercise()/deleteExercise() now read/write the
// control-plane exercise_library table (GEL T1) instead of the per-tenant
// one. Covers:
//   1. the merge read: two tenants + some globals -> each tenant's
//      listExercises() sees globals + only its OWN customs, never the
//      other tenant's (and listExercisesForTenant, the explicit-tenant
//      background sibling, agrees);
//   2. ExerciseLibRow's field set is unchanged (structural check here; the
//      REAL proof is the gate's `npx next build`, which compiles the 7
//      pages + 3 builders + ExerciseLibraryView against this same type);
//   3. saveExercise creates a new row stamped with the CURRENT tenant's id
//      (never NULL/global), with the same field trimming as before;
//   4. saveExercise editing its OWN row succeeds; editing a GLOBAL row, or
//      another tenant's row, is rejected (ExerciseOwnershipError) and
//      leaves the row untouched;
//   5. deleteExercise has the same guard (global / other-tenant rejected +
//      untouched; own row succeeds; an unknown id is a silent no-op);
//   6. setExerciseVideoUrl / setExerciseVideoUrlForTenant are NOT
//      tenant-guarded — both can set a video on a GLOBAL row, the
//      documented distinction from saveExercise/deleteExercise's guard.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// ./exerciseLibrary -> @/lib/db/tenant (react `cache`) -- same shim as
// forms.test.ts / cms/blog.test.ts, for the same reason (see forms.test.ts's
// comment): `cache()` from "react" needs a render context that doesn't exist
// under this plain-tsx test runner, so it's stubbed to the identity
// function. exerciseLibrary.ts's import chain (@/lib/db/control +
// @/lib/db/tenant only) never touches next/navigation, so unlike
// forms.test.ts that second stub isn't needed here.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { runWithTenant } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const {
    listExercises,
    listExercisesForTenant,
    saveExercise,
    deleteExercise,
    setExerciseVideoUrl,
    setExerciseVideoUrlForTenant,
    ExerciseOwnershipError,
  } = requireLocal("./exerciseLibrary") as typeof import("./exerciseLibrary");

  // ── two scratch tenants (control rows only -- exerciseLibrary.ts never
  // opens a per-tenant db file anymore, so no tenant db_file needs to exist) ──
  const slugA = "exlib-test-a";
  const slugB = "exlib-test-b";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slugA, slugB);
  const insertTenant = controlSqlite.prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
  );
  const tenantA = (insertTenant.get(slugA, "Exlib Test A", `tenants/${slugA}/void.db`) as { id: number }).id;
  const tenantB = (insertTenant.get(slugB, "Exlib Test B", `tenants/${slugB}/void.db`) as { id: number }).id;

  const exerciseIds: number[] = []; // every row this test creates -- cleaned up in `finally`

  const insertRaw = (tenantId: number | null, name: string): number =>
    (
      controlSqlite
        .prepare(
          `INSERT INTO exercise_library (tenant_id, name, category, muscle_groups, equipment, video_url, image_url, instructions)
           VALUES (?, ?, 'Test', NULL, NULL, NULL, NULL, NULL) RETURNING id`,
        )
        .get(tenantId, name) as { id: number }
    ).id;

  const cleanup = () => {
    for (const id of exerciseIds) {
      controlSqlite.prepare("DELETE FROM exercise_library WHERE id = ?").run(id);
    }
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tenantA, tenantB);
  };

  try {
    // ── seed: 2 globals + 1 custom for A + 1 custom for B ──
    const globalSquat = insertRaw(null, "Global Squat");
    exerciseIds.push(globalSquat);
    const globalBench = insertRaw(null, "Global Bench");
    exerciseIds.push(globalBench);
    const customA = insertRaw(tenantA, "Tenant A Custom Lunge");
    exerciseIds.push(customA);
    const customB = insertRaw(tenantB, "Tenant B Custom Row");
    exerciseIds.push(customB);

    // ── 1. merge read: each tenant sees globals + only its own customs ──
    const listA = runWithTenant(tenantA, () => listExercises());
    const idsA = listA.map((e) => e.id);
    assert.ok(idsA.includes(globalSquat), "tenant A sees the global squat");
    assert.ok(idsA.includes(globalBench), "tenant A sees the global bench");
    assert.ok(idsA.includes(customA), "tenant A sees its own custom");
    assert.ok(!idsA.includes(customB), "tenant A does NOT see tenant B's custom");

    const listB = runWithTenant(tenantB, () => listExercises());
    const idsB = listB.map((e) => e.id);
    assert.ok(idsB.includes(globalSquat), "tenant B ALSO sees the global squat (shared, not duplicated)");
    assert.ok(idsB.includes(customB), "tenant B sees its own custom");
    assert.ok(!idsB.includes(customA), "tenant B does NOT see tenant A's custom");

    // listExercisesForTenant (explicit id, no runWithTenant/ambient tenant needed) agrees
    const listAExplicit = listExercisesForTenant(tenantA);
    assert.deepEqual(
      listAExplicit.map((e) => e.id).sort((x, y) => x - y),
      idsA.slice().sort((x, y) => x - y),
      "listExercisesForTenant(tenantA) returns the identical merge listExercises() sees under runWithTenant(tenantA, ...)",
    );

    // ── 2. ExerciseLibRow shape (structural check -- npx next build against
    // the 7 pages/3 builders/ExerciseLibraryView is the full proof) ──
    const sample = listA[0];
    assert.deepEqual(
      Object.keys(sample).sort(),
      ["category", "equipment", "id", "imageUrl", "instructions", "muscleGroups", "name", "videoUrl"].sort(),
      "ExerciseLibRow keeps its original field set",
    );
    assert.ok(Array.isArray(sample.muscleGroups), "muscleGroups is parsed to a string[]");

    // ── 3. saveExercise creates a custom stamped with the CURRENT tenant ──
    const newId = runWithTenant(tenantA, () =>
      saveExercise({
        name: "  Brand New Curl  ",
        category: "Arms",
        muscleGroups: ["biceps", " forearms "],
        equipment: "Dumbbell",
        videoUrl: null,
        imageUrl: null,
        instructions: "Curl it.",
      }),
    );
    exerciseIds.push(newId);
    const newRow = controlSqlite
      .prepare("SELECT tenant_id, name, muscle_groups FROM exercise_library WHERE id = ?")
      .get(newId) as { tenant_id: number | null; name: string; muscle_groups: string | null };
    assert.equal(newRow.tenant_id, tenantA, "a new row is stamped with the CURRENT tenant's id, never NULL/global");
    assert.equal(newRow.name, "Brand New Curl", "name is trimmed, same as before");
    assert.equal(newRow.muscle_groups, "biceps,forearms", "muscleGroups is trimmed + comma-joined, same as before");
    assert.ok(
      runWithTenant(tenantA, () => listExercises()).some((e) => e.id === newId),
      "the new custom is visible in tenant A's own listExercises()",
    );
    assert.ok(
      !runWithTenant(tenantB, () => listExercises()).some((e) => e.id === newId),
      "tenant B does NOT see tenant A's brand-new custom",
    );

    // ── 4. saveExercise: editing its OWN row succeeds ──
    runWithTenant(tenantA, () =>
      saveExercise({
        id: customA,
        name: "Tenant A Custom Lunge (renamed)",
        category: "Legs",
        muscleGroups: [],
        equipment: null,
        videoUrl: null,
        imageUrl: null,
        instructions: null,
      }),
    );
    const renamed = controlSqlite.prepare("SELECT name FROM exercise_library WHERE id = ?").get(customA) as {
      name: string;
    };
    assert.equal(renamed.name, "Tenant A Custom Lunge (renamed)", "tenant A can edit its own custom");

    // ── 4b. saveExercise: editing a GLOBAL row is rejected ──
    assert.throws(
      () =>
        runWithTenant(tenantA, () =>
          saveExercise({
            id: globalSquat,
            name: "Hacked Global",
            category: null,
            muscleGroups: [],
            equipment: null,
            videoUrl: null,
            imageUrl: null,
            instructions: null,
          }),
        ),
      ExerciseOwnershipError,
      "editing a GLOBAL row is rejected",
    );
    const globalUnchanged = controlSqlite
      .prepare("SELECT name FROM exercise_library WHERE id = ?")
      .get(globalSquat) as { name: string };
    assert.equal(globalUnchanged.name, "Global Squat", "the global row is untouched after the rejected edit");

    // ── 4c. saveExercise: editing ANOTHER tenant's row is rejected ──
    assert.throws(
      () =>
        runWithTenant(tenantA, () =>
          saveExercise({
            id: customB,
            name: "Hacked B",
            category: null,
            muscleGroups: [],
            equipment: null,
            videoUrl: null,
            imageUrl: null,
            instructions: null,
          }),
        ),
      ExerciseOwnershipError,
      "tenant A editing tenant B's custom is rejected",
    );
    const bUnchanged = controlSqlite.prepare("SELECT name FROM exercise_library WHERE id = ?").get(customB) as {
      name: string;
    };
    assert.equal(bUnchanged.name, "Tenant B Custom Row", "tenant B's row is untouched after the rejected cross-tenant edit");

    // ── 5. deleteExercise: same guard ──
    assert.throws(
      () => runWithTenant(tenantA, () => deleteExercise(globalSquat)),
      ExerciseOwnershipError,
      "deleting a GLOBAL row is rejected",
    );
    assert.throws(
      () => runWithTenant(tenantA, () => deleteExercise(customB)),
      ExerciseOwnershipError,
      "deleting another tenant's row is rejected",
    );
    assert.ok(
      controlSqlite.prepare("SELECT 1 FROM exercise_library WHERE id = ?").get(globalSquat),
      "the global row still exists after the rejected delete",
    );
    assert.ok(
      controlSqlite.prepare("SELECT 1 FROM exercise_library WHERE id = ?").get(customB),
      "tenant B's row still exists after the rejected cross-tenant delete",
    );
    // deleting an id that doesn't exist is a silent no-op (matches the pre-rewrite drizzle behaviour)
    assert.doesNotThrow(
      () => runWithTenant(tenantA, () => deleteExercise(999_999_999)),
      "deleting an id that doesn't exist is a silent no-op, not a throw",
    );
    // deleting its OWN row succeeds
    runWithTenant(tenantA, () => deleteExercise(customA));
    assert.equal(
      controlSqlite.prepare("SELECT 1 FROM exercise_library WHERE id = ?").get(customA),
      undefined,
      "tenant A can delete its own custom",
    );
    exerciseIds.splice(exerciseIds.indexOf(customA), 1); // already gone -- don't re-delete in cleanup

    // ── 6. setExerciseVideoUrl / setExerciseVideoUrlForTenant: NOT
    // tenant-guarded (the documented distinction from saveExercise/
    // deleteExercise's ownership guard) -- both legitimately set a video on
    // a GLOBAL row: the bare setter for the per-tenant "auto-find missing
    // videos" bulk action, which walks the CURRENT tenant's listExercises()
    // (globals included); the ForTenant variant for the shared nightly
    // backfill, which walks every tenant the same way. ──
    setExerciseVideoUrl(globalBench, "https://youtube.com/watch?v=bare-setter");
    const afterBare = controlSqlite
      .prepare("SELECT video_url FROM exercise_library WHERE id = ?")
      .get(globalBench) as { video_url: string | null };
    assert.equal(
      afterBare.video_url,
      "https://youtube.com/watch?v=bare-setter",
      "setExerciseVideoUrl can set a video on a GLOBAL row (no tenant guard)",
    );

    setExerciseVideoUrlForTenant(tenantB, globalSquat, "https://youtube.com/watch?v=for-tenant-setter");
    const afterForTenant = controlSqlite
      .prepare("SELECT video_url FROM exercise_library WHERE id = ?")
      .get(globalSquat) as { video_url: string | null };
    assert.equal(
      afterForTenant.video_url,
      "https://youtube.com/watch?v=for-tenant-setter",
      "setExerciseVideoUrlForTenant can set a video on a GLOBAL row regardless of the tenantId argument (no tenant guard)",
    );

    console.log("exerciseLibrary.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
