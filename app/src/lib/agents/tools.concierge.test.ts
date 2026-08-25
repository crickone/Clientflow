// Run: npm test -- src/lib/agents/tools.concierge.test.ts
//
// Verifies `conciergeToolSlice(schedulingMode, driveConnected)` (@/lib/assistant/
// tools) — the general assistant's tool slice, which is also half of Adonis's
// own toolNames union (specialists/orchestrator.ts takes this slice across both
// scheduling modes). WITHOUT any live Anthropic call, it pins that the slice:
//   - includes general tools unconditionally (list_invoices, financial_summary,
//     business_overview, get_client);
//   - scopes create_appointment/cancel_appointment/reschedule_appointment to
//     "appointments" mode and create_class/list_classes/book_client_into_class/
//     cancel_class/cancel_booking to "timetable" mode — never both, never
//     neither;
//   - scopes upload_invoices_to_drive to `driveConnected`;
//   - has no duplicate tool names, and its size is EXACTLY TOOLS.length minus
//     the excluded set for that combination (computed from TOOLS itself, not a
//     hardcoded count, so this stays correct as unrelated tools are added).
//
// Single-agent product (2026-08-25): this file used to also cover the
// `delegate_to_concierge` tool + `delegateToConciergeTool` guard + the slice's
// `delegate_to_*` exclusion. The whole delegation subsystem
// (tools.orchestrator.ts) was removed when Adonis became the one working agent,
// so those checks are gone; the check retained + hardened here is that NO
// delegate_to_* tool remains in TOOLS at all (regression pin against the
// subsystem creeping back), plus the mode/drive scoping that conciergeToolSlice
// still does for real.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// Shim: this test loads @/lib/assistant/tools, which pulls in @/lib/db/tenant
// (React's server-only `cache`) and, transitively via the tool executors,
// @/lib/auth -> next/navigation. Under the runner's `--conditions=react-server`,
// npm's react "react-server" entry throws on load, so `cache` needs stubbing;
// next/navigation's real module drags in Next's client-router internals we have
// no reason to load here (redirect() is never called). Installed via a dynamic
// require (below) rather than a static import so it runs before the load.
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
// top-level await is unsupported.
(async () => {
  const { TOOLS, conciergeToolSlice } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");

  // ── The delegation subsystem is gone: no delegate_to_* tool exists in TOOLS
  // anymore (regression pin — a re-introduced delegate tool would reopen the
  // routing hop the single-agent design removed). ──
  assert.ok(
    !TOOLS.some((t) => t.name.startsWith("delegate_to_")),
    "no delegate_to_* tools remain in TOOLS — the delegation subsystem was removed",
  );

  const APPT_ONLY = ["create_appointment", "cancel_appointment", "reschedule_appointment"];
  const TIMETABLE_ONLY = ["create_class", "list_classes", "book_client_into_class", "cancel_class", "cancel_booking"];

  for (const mode of ["appointments", "timetable"] as const) {
    for (const drive of [true, false]) {
      const slice = conciergeToolSlice(mode, drive);
      const names = new Set(slice.map((t) => t.name));

      // (a) general tools (no mode/drive scoping) always present.
      for (const general of ["business_overview", "list_invoices", "financial_summary", "get_client"]) {
        assert.ok(names.has(general), `conciergeToolSlice(${mode}, drive=${drive}) must include ${general}`);
      }

      // (b) scheduling-mode scoping — exactly one family present, never both.
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

      // (c) Drive scoping.
      assert.equal(
        names.has("upload_invoices_to_drive"),
        drive,
        `upload_invoices_to_drive present iff driveConnected=${drive}`,
      );

      // (d) no dupes, and the count is exactly TOOLS.length minus the excluded
      // set for this combination — computed from TOOLS itself so this stays
      // correct as unrelated tools are added later.
      assert.equal(names.size, slice.length, `conciergeToolSlice(${mode}, drive=${drive}) has no duplicate tool names`);
      const excludedCount =
        (mode === "appointments" ? TIMETABLE_ONLY.length : APPT_ONLY.length) +
        (drive ? 0 : 1);
      assert.equal(
        slice.length,
        TOOLS.length - excludedCount,
        `conciergeToolSlice(${mode}, drive=${drive}) drops exactly the expected ${excludedCount} tool(s) from TOOLS' ${TOOLS.length}`,
      );
    }
  }

  console.log("tools.concierge.test.ts: all assertions passed");
})();
