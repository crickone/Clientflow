// Run: npm test -- src/app/workout/exercises/actions.test.ts
//
// GEL Task 5: saveExerciseAction/deleteExerciseAction now catch
// ExerciseOwnershipError (thrown by saveExercise()/deleteExercise(),
// @/lib/exerciseLibrary, GEL T2) instead of letting it 500. The scenario
// being guarded against is a crafted/direct POST that targets a GLOBAL row's
// id (tenant_id IS NULL) or another tenant's custom. Covers:
//   1. saveExerciseAction on a GLOBAL row's id -> { ok: false, error }
//      (does NOT throw), row left untouched;
//   1b. same guard against ANOTHER tenant's custom, not just a global;
//   2. deleteExerciseAction on a GLOBAL row's id -> resolves without
//      throwing, row survives;
//   2b. same guard against ANOTHER tenant's custom;
//   3. a normal tenant-custom save (new insert) and edit still work
//      ({ ok: true }), and delete still removes the row -- proving the
//      guard is ownership-based, not an admin-only gate (the acting user
//      below is deliberately 'staff', per the brief: "staff must still
//      edit their OWN customs").
//
// Unlike most *.test.ts files in this repo, this one exercises the REAL
// "use server" actions end-to-end INCLUDING their real requireUser() gate
// (the brief is explicit: do not change/bypass that auth gate) rather than
// sidestepping it -- every other test that touches @/lib/db/tenant resolves
// its tenant via runWithTenant's AsyncLocalStorage, which requireUser()'s
// getCurrentMembership() (@/lib/auth) has no equivalent bypass for: it
// always calls next/headers's cookies() directly, unconditionally. So this
// file shims next/headers with a fake, mutable single-cookie jar backed by a
// REAL auth_sessions row (inserted below via raw SQL, same style as
// updateMemberEmail.test.ts's scratch users/memberships) -- requireUser()
// runs for real and authenticates a genuine scratch user in a scratch
// tenant. next/navigation is stubbed too (auth.ts imports `redirect` at
// module top level even though requireUser() itself never calls it) and
// next/cache's revalidatePath is stubbed to a no-op (the real one throws
// outside an actual Next request/build: "Invariant: static generation store
// missing in revalidatePath").
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

let cookieToken: string | undefined;
let sessionCookieName = ""; // filled in below once control.ts's real SESSION_COOKIE is known

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/headers") {
    return {
      cookies: () => ({
        get: (name: string) => (cookieToken && name === sessionCookieName ? { value: cookieToken } : undefined),
        set: () => {},
        delete: () => {},
      }),
    };
  }
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in workout/exercises/actions.test.ts");
      },
    };
  }
  if (request === "next/cache") {
    return { revalidatePath: () => {} };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as exerciseLibrary.test.ts).
(async () => {
  const { controlSqlite, SESSION_COOKIE } = requireLocal("../../../lib/db/control") as
    typeof import("../../../lib/db/control");
  sessionCookieName = SESSION_COOKIE;
  const { saveExerciseAction, deleteExerciseAction } = requireLocal("./actions") as typeof import("./actions");

  const slugA = "gel-t5-actions-test-a";
  const slugB = "gel-t5-actions-test-b";
  const email = "gel-t5-actions-test@x.ie";

  // Clean slate -- idempotent across re-runs / a previously-crashed run.
  function wipe() {
    controlSqlite
      .prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)")
      .run(email);
    controlSqlite
      .prepare("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email = ?)")
      .run(email);
    controlSqlite.prepare("DELETE FROM users WHERE email = ?").run(email);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slugA, slugB);
  }
  wipe();

  const insertTenant = controlSqlite.prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
  );
  const tenantA = (insertTenant.get(slugA, "GEL T5 Actions Test A", `tenants/${slugA}/void.db`) as { id: number })
    .id;
  const tenantB = (insertTenant.get(slugB, "GEL T5 Actions Test B", `tenants/${slugB}/void.db`) as { id: number })
    .id;

  // The acting user is 'staff', not 'admin' -- saveExerciseAction/
  // deleteExerciseAction only ever call requireUser() (identity), never
  // requireAdmin(); the ownership guard is the ONLY thing protecting a
  // global row, matching the brief's "not an admin gate" framing.
  const user = controlSqlite
    .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, 'x', 'staff', 1) RETURNING id")
    .get(email) as { id: number };
  controlSqlite
    .prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, 'staff', 1)")
    .run(user.id, tenantA);
  const session = controlSqlite
    .prepare("INSERT INTO auth_sessions (id, user_id, active_tenant_id, expires_at) VALUES (?, ?, ?, ?) RETURNING id")
    .get(`gel-t5-test-session-${Date.now()}`, user.id, tenantA, Date.now() + 3_600_000) as { id: string };
  cookieToken = session.id; // "log in" as this user for every action call below

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
  const nameOf = (id: number): string | undefined =>
    (controlSqlite.prepare("SELECT name FROM exercise_library WHERE id = ?").get(id) as { name: string } | undefined)
      ?.name;
  const exists = (id: number): boolean => !!controlSqlite.prepare("SELECT 1 FROM exercise_library WHERE id = ?").get(id);

  try {
    const globalId = insertRaw(null, "Global Squat (T5 actions test)");
    exerciseIds.push(globalId);
    const otherTenantId = insertRaw(tenantB, "Tenant B Custom Row (T5 actions test)");
    exerciseIds.push(otherTenantId);

    // ── 1. saveExerciseAction: a crafted edit of a GLOBAL row is rejected, not a 500 ──
    const saveGlobalRes = await saveExerciseAction({ id: globalId, name: "Hacked Global" });
    assert.equal(saveGlobalRes.ok, false, "editing a GLOBAL row does not succeed");
    if (saveGlobalRes.ok) throw new Error("unreachable");
    assert.match(
      saveGlobalRes.error,
      /shared library exercise/i,
      "the ownership error is mapped to a readable message, not a raw exception",
    );
    assert.equal(nameOf(globalId), "Global Squat (T5 actions test)", "the global row is untouched");

    // ── 1b. same guard against ANOTHER TENANT's custom ──
    const saveOtherRes = await saveExerciseAction({ id: otherTenantId, name: "Hacked B" });
    assert.equal(saveOtherRes.ok, false, "editing another tenant's custom does not succeed");
    assert.equal(nameOf(otherTenantId), "Tenant B Custom Row (T5 actions test)", "tenant B's row is untouched");

    // ── 2. deleteExerciseAction: a crafted delete of a GLOBAL row resolves without throwing, row survives ──
    await assert.doesNotReject(
      () => deleteExerciseAction(globalId),
      "deleteExerciseAction on a GLOBAL row does not throw",
    );
    assert.ok(exists(globalId), "the global row still exists after the rejected delete");

    // ── 2b. same guard against ANOTHER TENANT's custom ──
    await assert.doesNotReject(
      () => deleteExerciseAction(otherTenantId),
      "deleteExerciseAction on another tenant's custom does not throw",
    );
    assert.ok(exists(otherTenantId), "tenant B's row still exists after the rejected cross-tenant delete");

    // ── 3. a normal tenant-custom save (insert) still works ──
    const createRes = await saveExerciseAction({
      name: "  T5 Actions Test Curl  ",
      muscleGroups: ["biceps", " forearms "],
    });
    assert.equal(createRes.ok, true, "a normal create still succeeds");
    if (!createRes.ok) throw new Error("unreachable");
    const newId = createRes.id;
    exerciseIds.push(newId);
    const newRow = controlSqlite
      .prepare("SELECT tenant_id, name FROM exercise_library WHERE id = ?")
      .get(newId) as { tenant_id: number | null; name: string };
    assert.equal(newRow.tenant_id, tenantA, "the new row is stamped with the logged-in user's active tenant");
    assert.equal(newRow.name, "T5 Actions Test Curl", "name is trimmed, same as before");

    // ── 3b. editing that SAME tenant's own row still works ──
    const editRes = await saveExerciseAction({ id: newId, name: "T5 Actions Test Curl (renamed)" });
    assert.equal(editRes.ok, true, "editing one's own custom still succeeds");
    assert.equal(nameOf(newId), "T5 Actions Test Curl (renamed)", "the rename persisted");

    // ── 3c. deleting that SAME tenant's own row still works ──
    await deleteExerciseAction(newId);
    assert.ok(!exists(newId), "deleting one's own custom still removes the row");
    exerciseIds.splice(exerciseIds.indexOf(newId), 1); // already gone -- don't re-delete in cleanup

    console.log("workout/exercises/actions.test.ts: all assertions passed");
  } finally {
    for (const id of exerciseIds) {
      controlSqlite.prepare("DELETE FROM exercise_library WHERE id = ?").run(id);
    }
    wipe();
  }
})();
