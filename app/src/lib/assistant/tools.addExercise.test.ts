// Run: npm test -- src/lib/assistant/tools.addExercise.test.ts
//
// GEL Task 5: the AI `add_exercise` tool (@/lib/assistant/tools's addExercise,
// dispatched via executeTool) now delegates to saveExercise() (@/lib/exerciseLibrary,
// GEL T2 control-plane) instead of a direct drizzle insert into the now-legacy
// per-tenant `exercise_library` table -- listExercises()/the workout UI only
// ever read the control table, so a write into the old table would silently
// vanish. Covers the round trip end-to-end via the REAL
// executeTool("add_exercise", ...) dispatcher (not calling the internal
// addExercise() directly -- it isn't exported, matching every other tool in
// this file):
//   1. the new exercise is visible afterward via listExercisesForTenant(tid)
//      as a CUSTOM (tenant_id = tid, not global);
//   2. the SAME tenant's real per-tenant `exercise_library` table
//      (provisioned for real below via getTenantDbById, so this is a genuine
//      table, not a placeholder path) gets NO new row -- proving the old
//      per-tenant write path is gone, not just unused by coincidence;
//   3. the comma-separated `muscleGroups` string the tool schema promises the
//      model round-trips through ExerciseLibInput's string[] shape correctly.
//
// Ambient-tenant note (see the Task 5 report for the full trace): add_exercise
// is a WRITE_TOOL, so runAgentTurn.ts NEVER calls executeTool() for it inline
// (it's deferred to pendingWrites); the only production call site that
// actually executes it is /api/assistant/execute's approval endpoint, which
// wraps the whole batch in runWithTenant(tenantId, ...) using the SAME
// tenantId passed as ctx.tenantId -- reproduced exactly below.
//
// NOTE: this repo does NOT use vitest -- tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Shim style
// mirrors src/lib/agents/tools.sales.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// tools.ts -> @/lib/db/tenant (react `cache`, next/headers) and, separately,
// -> @/lib/agents/tools.sales / .marketing / .campaign / .operations /
// .orchestrator -> ... -> @/lib/auth -> `next/navigation`. Same shim as
// tools.sales.test.ts, for the same reason (see its comment): `cache` needs
// stubbing under `--conditions=react-server`, and next/navigation's real
// module drags in Next's client-router internals that redirect() never
// actually needs here. next/headers is NOT shimmed -- every ambient-tenant
// read below runs inside runWithTenant, which resolves from
// AsyncLocalStorage before resolveCurrentTenant() ever reaches cookies()
// (see tenant.ts).
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.addExercise.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.sales.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { exerciseLibrary } = requireLocal("../db/schema") as typeof import("../db/schema");
  const { executeTool } = requireLocal("./tools") as typeof import("./tools");
  const { listExercisesForTenant } = requireLocal("../exerciseLibrary") as typeof import("../exerciseLibrary");

  // ── scratch tenant (control row + a REAL tenant DB file, so
  // getTenantDbById() provisions genuine per-tenant tables -- including the
  // now-legacy `exercise_library` one -- so we can prove nothing lands in
  // it, not just assume so) ──
  const slug = "assistant-add-exercise-tool-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Assistant Add-Exercise Tool Test", dbFile) as { id: number };
  const tid = t.id;
  const ctx = { tenantId: tid };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const createdControlIds: number[] = [];

  try {
    const tenantDb = getTenantDbById(tid); // provisions the real per-tenant DB (incl. the legacy exercise_library table)

    const perTenantCountBefore = tenantDb.select().from(exerciseLibrary).all().length;
    assert.equal(
      perTenantCountBefore,
      0,
      "freshly-provisioned tenant DB starts with an empty legacy exercise_library table",
    );

    const before = listExercisesForTenant(tid);
    assert.ok(
      !before.some((e) => e.name === "AI Added Bulgarian Split Squat"),
      "sanity: not present before the call",
    );

    // Mirrors /api/assistant/execute's real dispatch exactly: runWithTenant(tenantId, …)
    // wrapping executeTool(name, input, { tenantId, userId }) with the SAME tenantId.
    const result = await runWithTenant(tid, () =>
      executeTool(
        "add_exercise",
        {
          name: "  AI Added Bulgarian Split Squat  ",
          category: "Legs",
          muscleGroups: "quads, glutes, hamstrings",
          equipment: "Dumbbell, Bench",
          instructions: "Rear foot elevated, front leg does the work.",
        },
        ctx,
      ),
    );

    const parsed = JSON.parse(result.text) as { result?: string; exerciseId?: number; error?: string };
    assert.ok(!parsed.error, `add_exercise should not error: ${parsed.error}`);
    assert.equal(typeof parsed.exerciseId, "number", "returns the new control-plane row's id");
    const newId = parsed.exerciseId as number;
    createdControlIds.push(newId);

    // ── 1. visible afterward as a CUSTOM (tenant_id = tid), via the T2 read path ──
    const after = listExercisesForTenant(tid);
    const created = after.find((e) => e.id === newId);
    assert.ok(created, "the new exercise is visible in this tenant's listExercisesForTenant() result");
    assert.equal(created?.name, "AI Added Bulgarian Split Squat", "name is trimmed, same as before");
    assert.deepEqual(
      created?.muscleGroups.slice().sort(),
      ["glutes", "hamstrings", "quads"].sort(),
      "the tool schema's comma-separated muscleGroups string round-trips through ExerciseLibInput's string[] shape",
    );
    const controlRow = controlSqlite.prepare("SELECT tenant_id FROM exercise_library WHERE id = ?").get(newId) as {
      tenant_id: number | null;
    };
    assert.equal(controlRow.tenant_id, tid, "stamped as a CUSTOM (tenant_id = tid), never a global row");

    // ── 2. the per-tenant (legacy) exercise_library table got NO new row ──
    const perTenantCountAfter = tenantDb.select().from(exerciseLibrary).all().length;
    assert.equal(
      perTenantCountAfter,
      perTenantCountBefore,
      "add_exercise must NOT write the old per-tenant exercise_library table -- only the control-plane one",
    );

    console.log("assistant/tools.addExercise.test.ts: all assertions passed");
  } finally {
    for (const id of createdControlIds) {
      controlSqlite.prepare("DELETE FROM exercise_library WHERE id = ?").run(id);
    }
    cleanup();
  }
})();
