// Run: npm test -- src/lib/agents/salesToolSlice.test.ts
//
// Verifies Task 8 (specialist chat route)'s tool-slice wiring: every tool
// name in SALES_SPECIALIST.toolNames actually resolves to a registered tool
// in TOOLS, and the computed slice (exactly `TOOLS.filter((t) =>
// allowed.has(t.name))`, what the chat route builds) has exactly
// toolNames.length tools and excludes at least one known non-sales tool.
//
// This matters because `Array.prototype.filter` silently drops any name that
// doesn't match — a typo in SALES_SPECIALIST.toolNames (or a tool renamed in
// @/lib/assistant/tools without updating the specialist list) would quietly
// shrink the sales agent's tool slice with no error anywhere, not even at
// runtime. Pure/static: no route, HTTP, DB writes, or credentials required.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// Module._load shim pattern from tools.sales.test.ts / context.test.ts
// (Tasks 6/7), needed because @/lib/assistant/tools -> @/lib/db/tenant
// (React's server-only `cache`) and, separately, ->
// @/lib/agents/tools.sales -> @/lib/leads / @/lib/pipeline/stage /
// @/lib/whatsapp/send / @/lib/ai/draftFollowup -> @/lib/db (the ambient `db`
// proxy) -> @/lib/tenants -> @/lib/auth -> `next/navigation` — both at module
// scope. Under the runner's `--conditions=react-server`, npm's react
// "react-server" entry point throws on load, so `cache` needs stubbing;
// next/navigation's real module drags in Next's client-router internals we
// have no reason to load here (redirect() is never called in this test).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in salesToolSlice.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as context.test.ts).
(async () => {
  const { TOOLS } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { SALES_SPECIALIST } = requireLocal("./specialists/sales") as typeof import("./specialists/sales");

  // ── (a) every SALES_SPECIALIST.toolNames entry resolves to a real tool in
  // TOOLS — checked BY NAME, not just by count, so a typo is caught even if
  // it happened to leave the slice's length unchanged. ──
  const toolsByName = new Map(TOOLS.map((t) => [t.name, t]));
  for (const name of SALES_SPECIALIST.toolNames) {
    assert.ok(
      toolsByName.has(name),
      `SALES_SPECIALIST.toolNames entry "${name}" must resolve to a real tool registered in TOOLS`,
    );
  }

  // Sanity: the brief specifies exactly 9 tools (6 sales-specific from Task 7
  // + 3 pre-existing: get_client, send_client_email, create_calendar_event).
  // This isn't the safety property itself (that's the per-name check above),
  // but pins the expected shape so a future accidental addition/removal to
  // the list is visible here too.
  assert.equal(SALES_SPECIALIST.toolNames.length, 9, "SALES_SPECIALIST.toolNames has exactly 9 entries");

  // ── (b) the computed slice — exactly what the chat route builds via
  // `TOOLS.filter((t) => allowed.has(t.name))` — has exactly
  // toolNames.length tools (no dupes, no silent drops) ... ──
  // Set<string> (not the inferred literal-union type) — same reasoning as the
  // chat route: compared below against t.name, a plain `string`.
  const allowed = new Set<string>(SALES_SPECIALIST.toolNames);
  const slice = TOOLS.filter((t) => allowed.has(t.name));
  assert.equal(
    slice.length,
    SALES_SPECIALIST.toolNames.length,
    "the computed tool slice has exactly one entry per toolNames entry",
  );

  // ... and excludes at least one known non-sales tool, proving the filter is
  // actually narrowing TOOLS rather than passing everything through.
  const nonSalesTool = "create_workout_program";
  assert.ok(toolsByName.has(nonSalesTool), "sanity: the chosen non-sales tool actually exists in TOOLS");
  assert.ok(!allowed.has(nonSalesTool), "sanity: the chosen non-sales tool is not in SALES_SPECIALIST.toolNames");
  assert.ok(
    !slice.some((t) => t.name === nonSalesTool),
    `the sales tool slice must exclude non-sales tools (e.g. "${nonSalesTool}")`,
  );

  console.log("salesToolSlice.test.ts: all assertions passed");
})();
