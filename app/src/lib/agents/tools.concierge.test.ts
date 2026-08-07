// Run: npm test -- src/lib/agents/tools.concierge.test.ts
//
// Verifies Concierge Task 1 (the Orchestrator gains a general-purpose
// delegate) WITHOUT ever calling the live Anthropic API:
//   1. `delegate_to_concierge` is registered in TOOLS with a required "task"
//      input, is NOT in WRITE_TOOLS (delegating is a read — see
//      tools.orchestrator.ts's file-level doc comment), and `executeTool`
//      actually routes it to `delegateToConciergeTool` (not just that the
//      wrapper function works in isolation, but that the public
//      name -> executor wiring in @/lib/assistant/tools is correct).
//   2. `delegateToConciergeTool`'s guard: a missing/blank `task` returns a
//      clean error with NO Claude call (the same guard shape delegateTo's
//      three specialist wrappers already have — see tools.orchestrator.test.ts
//      — proven here for the 4th, differently-implemented delegate).
//   3. `conciergeToolSlice(schedulingMode, driveConnected)` — the general
//      assistant's tool slice, now shared by `/api/assistant/chat` and
//      `delegate_to_concierge`:
//        - excludes EVERY `delegate_to_*` tool (all 4, including itself —
//          the concrete proof the Concierge can never delegate further, so
//          delegation stays exactly one level deep even via this path);
//        - includes general tools unconditionally (list_invoices,
//          financial_summary, business_overview);
//        - scopes create_appointment/cancel_appointment/reschedule_appointment
//          to "appointments" mode and create_class/list_classes/
//          book_client_into_class/cancel_class/cancel_booking to "timetable"
//          mode — never both, never neither;
//        - scopes upload_invoices_to_drive to `driveConnected`;
//        - the resulting slice has no duplicate tool names, and its size is
//          EXACTLY TOOLS.length minus the excluded set for that combination
//          (computed from TOOLS itself, not a hardcoded count, so this stays
//          correct as unrelated tools are added over time);
//      and the assistant route (`/api/assistant/chat`) source is confirmed to
//      actually CALL this function (not a re-derived equivalent) — the
//      concrete evidence the refactor didn't leave a second, driftable copy
//      of this filter behind (brief: "Assert it matches what the assistant
//      route now uses").
//
// NOT tested here (deliberately, per the task brief): the live-delegation
// happy path (a real delegate_to_concierge call that reaches runAgentTurn and
// talks to Claude) — see runAgentTurn.test.ts's Concierge Task 1 section for
// the noted limitation on runtime-proving the artifact accumulation lines
// specifically, which applies here too (delegate_to_concierge is the only
// tool whose nested runAgentTurn can populate ToolResult.artifacts, and
// exercising that needs a live Claude call).
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// exact pattern of tools.orchestrator.test.ts / runAgentTurn.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// Same two-part shim as tools.orchestrator.test.ts / runAgentTurn.test.ts,
// for the identical reason: tools.concierge.test.ts loads @/lib/assistant/tools
// (-> @/lib/db/tenant, react's server-only `cache`) and, separately,
// @/lib/agents/tools.orchestrator (-> @/lib/assistant/system ->
// @/lib/ai/businessContext -> @/lib/db, the ambient proxy -> @/lib/tenants ->
// @/lib/auth -> next/navigation). Under the runner's `--conditions=react-server`,
// npm's react "react-server" entry throws on load, so `cache` needs stubbing;
// next/navigation's real module drags in Next's client-router internals we
// have no reason to load here (redirect() is never called in this test's
// code path). Installed via a dynamic require (below) rather than a static
// import, since a static `import ... from "./tools.concierge"` would be
// hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.concierge.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.orchestrator.test.ts).
(async () => {
  // ── REQUIRE ORDER MATTERS — do not "tidy" this ── (same rationale as
  // tools.orchestrator.test.ts: tools.ts <-> tools.orchestrator.ts is a
  // genuine require cycle, safe only because tools.orchestrator.ts touches
  // TOOLS/conciergeToolSlice/runAgentTurn exclusively inside function bodies,
  // never at module top level. Loading "../assistant/tools" FIRST establishes
  // it as the require-graph root.)
  const { TOOLS, WRITE_TOOLS, executeTool, conciergeToolSlice } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { delegateToConciergeTool } =
    requireLocal("./tools.orchestrator") as typeof import("./tools.orchestrator");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");

  // ── scratch tenant (control row + a real tenant DB file) — same pattern as
  // tools.orchestrator.test.ts. Not strictly required for the guard-only
  // paths exercised below (they return before touching the DB), but keeps
  // this file consistent with the rest of the suite and defensive against a
  // future refactor that touches ctx.tenantId earlier. ──
  const slug = "agents-concierge-tools-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Agents Concierge Tools Test", dbFile) as { id: number };
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

  try {
    assert.ok(getTenantDbById(tid), "getTenantDbById resolves the scratch tenant");

    // ════════════════════════════════════════════════════════════════════
    // 1. Registration: delegate_to_concierge is in TOOLS, NOT in
    //    WRITE_TOOLS, requires "task", and executeTool routes it correctly
    // ════════════════════════════════════════════════════════════════════
    const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    assert.ok(toolsByName.has("delegate_to_concierge"), "delegate_to_concierge is registered in TOOLS");
    assert.ok(
      !WRITE_TOOLS.has("delegate_to_concierge"),
      "delegate_to_concierge must NOT be in WRITE_TOOLS — delegating is a read; the Concierge's real writes are already-gated tools that bubble up via ToolResult.pendingWrites, not by this tool executing a write itself",
    );
    const schema = toolsByName.get("delegate_to_concierge")!.input_schema as { required?: string[] };
    assert.deepEqual(schema.required, ["task"], "delegate_to_concierge requires a \"task\" input");

    // executeTool's switch actually dispatches to delegateToConciergeTool —
    // proven via the missing-task guard (below) so this needs no Claude call.
    const viaExecuteTool = JSON.parse((await executeTool("delegate_to_concierge", {}, ctx)).text);
    assert.equal(
      viaExecuteTool.error,
      "task is required.",
      "executeTool(\"delegate_to_concierge\", ...) reaches delegateToConciergeTool's guard — proves the switch case is wired, not just that the wrapper function works standalone",
    );

    // ════════════════════════════════════════════════════════════════════
    // 2. Guard: missing/blank task -> clean error, no Claude call
    // ════════════════════════════════════════════════════════════════════
    const missingTask = JSON.parse((await delegateToConciergeTool(ctx, {})).text);
    assert.equal(missingTask.error, "task is required.", "delegateToConciergeTool rejects a missing task");
    const blankTask = JSON.parse((await delegateToConciergeTool(ctx, { task: "   " })).text);
    assert.equal(blankTask.error, "task is required.", "a whitespace-only task is also rejected (matches the trim() in delegateToConcierge)");

    // ════════════════════════════════════════════════════════════════════
    // 3. conciergeToolSlice — the general assistant's tool slice
    // ════════════════════════════════════════════════════════════════════
    const DELEGATE_NAMES = TOOLS.filter((t) => t.name.startsWith("delegate_to_")).map((t) => t.name);
    assert.deepEqual(
      [...DELEGATE_NAMES].sort(),
      ["delegate_to_concierge", "delegate_to_marketing", "delegate_to_operations", "delegate_to_sales"],
      "sanity: TOOLS has exactly the 4 delegate_to_* tools this test reasons about",
    );

    const APPT_ONLY = ["create_appointment", "cancel_appointment", "reschedule_appointment"];
    const TIMETABLE_ONLY = ["create_class", "list_classes", "book_client_into_class", "cancel_class", "cancel_booking"];

    for (const mode of ["appointments", "timetable"] as const) {
      for (const drive of [true, false]) {
        const slice = conciergeToolSlice(mode, drive);
        const names = new Set(slice.map((t) => t.name));

        // (a) no delegate_to_* tool ever appears — the Concierge can never
        // delegate further, in EITHER mode, regardless of Drive state.
        for (const d of DELEGATE_NAMES) {
          assert.ok(!names.has(d), `conciergeToolSlice(${mode}, drive=${drive}) must exclude ${d}`);
        }

        // (b) general tools (no mode/drive scoping) always present.
        for (const general of ["business_overview", "list_invoices", "financial_summary", "get_client"]) {
          assert.ok(names.has(general), `conciergeToolSlice(${mode}, drive=${drive}) must include ${general}`);
        }

        // (c) scheduling-mode scoping — exactly one family present, never both.
        const apptPresent = APPT_ONLY.every((n) => names.has(n));
        const apptAbsent = APPT_ONLY.every((n) => !names.has(n));
        const ttPresent = TIMETABLE_ONLY.every((n) => names.has(n));
        const ttAbsent = TIMETABLE_ONLY.every((n) => !names.has(n));
        if (mode === "appointments") {
          assert.ok(apptPresent, `appointments mode must include all of ${APPT_ONLY.join(", ")}`);
          assert.ok(ttAbsent, `appointments mode must exclude all of ${TIMETABLE_ONLY.join(", ")}`);
        } else {
          assert.ok(apptAbsent, `timetable mode must exclude all of ${APPT_ONLY.join(", ")}`);
          assert.ok(ttPresent, `timetable mode must include all of ${TIMETABLE_ONLY.join(", ")}`);
        }

        // (d) Drive scoping.
        assert.equal(
          names.has("upload_invoices_to_drive"),
          drive,
          `upload_invoices_to_drive present iff driveConnected=${drive}`,
        );

        // (e) no dupes, and the count is exactly TOOLS.length minus the
        // excluded set for this combination — computed from TOOLS itself so
        // this stays correct as unrelated tools are added later.
        assert.equal(names.size, slice.length, `conciergeToolSlice(${mode}, drive=${drive}) has no duplicate tool names`);
        const excludedCount =
          DELEGATE_NAMES.length +
          (mode === "appointments" ? TIMETABLE_ONLY.length : APPT_ONLY.length) +
          (drive ? 0 : 1);
        assert.equal(
          slice.length,
          TOOLS.length - excludedCount,
          `conciergeToolSlice(${mode}, drive=${drive}) drops exactly the expected ${excludedCount} tool(s) from TOOLS' ${TOOLS.length}`,
        );
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. The assistant route actually USES conciergeToolSlice (not a
    //    re-derived equivalent left behind by the refactor)
    // ════════════════════════════════════════════════════════════════════
    const routeSrc = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/assistant/chat/route.ts"),
      "utf8",
    );
    assert.ok(
      /conciergeToolSlice\(\s*schedulingMode\s*,\s*driveConnected\s*\)/.test(routeSrc),
      "/api/assistant/chat/route.ts calls conciergeToolSlice(schedulingMode, driveConnected) directly",
    );
    assert.ok(
      !/APPT_ONLY/.test(routeSrc) && !/TIMETABLE_ONLY/.test(routeSrc),
      "/api/assistant/chat/route.ts no longer has its own inline copy of the mode-scoping Sets — conciergeToolSlice is the ONE place that logic lives",
    );

    console.log("tools.concierge.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
