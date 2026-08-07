// Run: npm test -- src/lib/agents/tools.orchestrator.test.ts
//
// Verifies Orchestrator Task 2 (delegation tools + activation) WITHOUT ever
// calling the live Anthropic API:
//   1. The 3 delegate_to_<specialist> tools are registered in TOOLS, and —
//      the hard-checked property — NOT in WRITE_TOOLS. Delegating is a READ:
//      it never itself mutates anything; a delegated specialist's real
//      writes are already-gated tools that bubble up via
//      ToolResult.pendingWrites instead (see runAgentTurn.ts's READ branch
//      and the ToolResult type in @/lib/assistant/tools).
//   2. delegateTo's guard paths — all reachable with NO Claude call, since
//      each returns before runAgentTurn is ever invoked:
//        - missing `task` -> a clean error (all 3 wrappers).
//        - a target outside DELEGATABLE (here: "orchestrator" itself, and a
//          catalog key that isn't a specialist at all) -> "Cannot delegate
//          to X." This is the concrete proof of the "no recursion" rule: an
//          orchestrator can never be made to delegate to another
//          orchestrator, even if a caller tried to force it.
//        - a DELEGATABLE target that isn't actually runnable right now
//          (dormant) -> "... isn't available." Simulated by temporarily
//          flipping AGENT_CATALOG's "sales" entry to "dormant" (restored
//          immediately after) — see the inline comment at that assertion for
//          why this is the only way to genuinely exercise this branch given
//          ensureAgents' catalog-driven status reconcile.
//   3. Orchestrator's OWN wiring: every ORCHESTRATOR_SPECIALIST.toolNames
//      entry resolves to a real TOOLS entry, orchestrator is "active" in
//      AGENT_CATALOG (flipped from "dormant" by this task), and it's
//      registered in SPECIALISTS. (specialistToolSlice.test.ts separately
//      pins orchestrator's exact shape + honesty line, generalizing the same
//      per-specialist checks it already does for sales/marketing/operations.)
//
// NOT tested here (deliberately, per the task brief): the live-delegation
// happy path (a real delegate_to_sales call that reaches runAgentTurn and
// talks to Claude) and a dedicated runtime test of the pendingWrites
// COLLECTION line added to runAgentTurn.ts's READ branch — the only tool
// that can produce ToolResult.pendingWrites is a delegate tool, and
// exercising that for real needs a live Claude turn. That collection line is
// one `if (r.pendingWrites?.length) pendingWrites.push(...)` mirroring the
// already-proven write-gate mechanism from runAgentTurn.test.ts (Orchestrator
// Task 1) — verified here by TYPE (ToolResult.pendingWrites?: PendingWrite[]
// must compile) and by code review rather than by a live run. See the task
// report for the explicit note on this gap.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// exact pattern of tools.sales.test.ts / runAgentTurn.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// tools.orchestrator.ts -> @/lib/assistant/tools (tools.ts) -> @/lib/db/tenant
// (react `cache`, next/headers) and, separately, -> @/lib/agents/tools.sales
// -> @/lib/leads / @/lib/pipeline/stage -> @/lib/db (the ambient `db` proxy)
// -> @/lib/tenants -> @/lib/auth -> `next/navigation`. Same two-part shim as
// tools.sales.test.ts / runAgentTurn.test.ts, for the same reason: under the
// runner's `--conditions=react-server`, npm's react "react-server" entry
// throws on load, so `cache` needs stubbing; next/navigation's real module
// drags in Next's client-router internals we have no reason to load here
// (redirect() is never actually called in this test's code path). Installed
// via a dynamic require (below) rather than a static import, since a static
// `import ... from "./tools.orchestrator"` would be hoisted and evaluated
// before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.orchestrator.test.ts");
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
  // ── REQUIRE ORDER MATTERS — do not "tidy" this ──
  // tools.ts <-> tools.orchestrator.ts is a genuine require cycle (tools.ts
  // registers the 3 delegate tools by importing this file; this file imports
  // TOOLS + runAgentTurn, which imports executeTool, back FROM tools.ts). It
  // is safe ONLY because tools.orchestrator.ts touches TOOLS/runAgentTurn
  // exclusively inside delegateTo's function body, never at module top
  // level — but tools.ts's OWN top-level `...ORCHESTRATOR_TOOLS` spread
  // (building its TOOLS array) is NOT deferred, so if tools.orchestrator.ts
  // were the very first module entered (i.e. required here before tools.ts),
  // tools.ts would end up importing an ORCHESTRATOR_TOOLS that doesn't exist
  // yet (tools.orchestrator.ts hasn't returned control to define it) and
  // crash on load — the exact failure mode the task brief calls out. Loading
  // "../assistant/tools" FIRST establishes it as the require-graph root, so
  // by the time IT reaches its own import of tools.orchestrator.ts, that
  // module runs to completion (its own runAgentTurn import hits the safe,
  // deferred-usage case instead) before control returns to tools.ts.
  const { TOOLS, WRITE_TOOLS } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { AGENT_CATALOG, getAgent } = requireLocal("./registry") as typeof import("./registry");
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");
  const { ORCHESTRATOR_SPECIALIST } = requireLocal("./specialists/orchestrator") as typeof import("./specialists/orchestrator");
  const {
    delegateTo,
    delegateToSalesTool,
    delegateToMarketingTool,
    delegateToOperationsTool,
  } = requireLocal("./tools.orchestrator") as typeof import("./tools.orchestrator");

  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");

  const DELEGATE_NAMES = ["delegate_to_sales", "delegate_to_marketing", "delegate_to_operations"];

  // ── scratch tenant (control row + a real tenant DB file, so getAgent's
  // internal ensureAgents() resolves it and has a real `agents` table to seed
  // into — same pattern as registry.test.ts / tools.sales.test.ts) ──
  const slug = "agents-orchestrator-tools-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Agents Orchestrator Tools Test", dbFile) as { id: number };
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
    // getTenantDbById(tid) must actually resolve the scratch tenant before
    // getAgent (called deep inside delegateTo) can.
    assert.ok(getTenantDbById(tid), "getTenantDbById resolves the scratch tenant");

    // ════════════════════════════════════════════════════════════════════
    // 1. Registration: the 3 delegate tools are in TOOLS, NOT in WRITE_TOOLS
    // ════════════════════════════════════════════════════════════════════
    const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    for (const name of DELEGATE_NAMES) {
      assert.ok(toolsByName.has(name), `${name} is registered in TOOLS`);
      assert.ok(
        !WRITE_TOOLS.has(name),
        `${name} must NOT be in WRITE_TOOLS — delegating is a read; a delegated specialist's real writes are already-gated and bubble up via ToolResult.pendingWrites, not by this tool executing a write itself`,
      );
      const schema = toolsByName.get(name)!.input_schema as { required?: string[] };
      assert.deepEqual(schema.required, ["task"], `${name} requires a "task" input`);
    }

    // ════════════════════════════════════════════════════════════════════
    // 2a. Guard: missing task -> clean error, no Claude call, on all 3
    // ════════════════════════════════════════════════════════════════════
    const missingSales = JSON.parse((await delegateToSalesTool(ctx, {})).text);
    assert.equal(missingSales.error, "task is required.", "delegateToSalesTool rejects a missing task");
    const missingMarketing = JSON.parse((await delegateToMarketingTool(ctx, {})).text);
    assert.equal(missingMarketing.error, "task is required.", "delegateToMarketingTool rejects a missing task");
    const missingOperations = JSON.parse((await delegateToOperationsTool(ctx, {})).text);
    assert.equal(missingOperations.error, "task is required.", "delegateToOperationsTool rejects a missing task");
    // Whitespace-only is the same as missing (matches the trim() in delegateTo).
    const blankTask = JSON.parse((await delegateToSalesTool(ctx, { task: "   " })).text);
    assert.equal(blankTask.error, "task is required.", "a whitespace-only task is also rejected");

    // ════════════════════════════════════════════════════════════════════
    // 2b. Guard: DELEGATABLE — no recursion, no delegating to a non-specialist
    // ════════════════════════════════════════════════════════════════════
    // "orchestrator" itself: the concrete proof that nothing can make an
    // orchestrator delegate to another orchestrator (self-recursion).
    const toOrchestrator = JSON.parse((await delegateTo("orchestrator", ctx, { task: "do something" })).text);
    assert.equal(
      toOrchestrator.error,
      "Cannot delegate to orchestrator.",
      "delegating to \"orchestrator\" is rejected — the DELEGATABLE guard names the rejected target",
    );
    // A dormant, non-specialist AGENT_CATALOG key (finance): also outside
    // DELEGATABLE, so rejected the same way — never even reaches getAgent.
    const toFinance = JSON.parse((await delegateTo("finance", ctx, { task: "do something" })).text);
    assert.equal(toFinance.error, "Cannot delegate to finance.", "a non-DELEGATABLE catalog key is rejected the same way");
    // A key that isn't in AGENT_CATALOG at all.
    const toBogus = JSON.parse((await delegateTo("bogus", ctx, { task: "do something" })).text);
    assert.equal(toBogus.error, "Cannot delegate to bogus.", "an unknown key is rejected by the same guard");

    // ════════════════════════════════════════════════════════════════════
    // 2c. Guard: a DELEGATABLE target that IS registered but not runnable
    //     right now (dormant) -> "... isn't available."
    // ════════════════════════════════════════════════════════════════════
    // getAgent() calls ensureAgents() on every call, which reconciles a
    // tenant's row status to CURRENTLY match AGENT_CATALOG (see registry.ts)
    // — so there is no way to leave "sales" dormant on a scratch tenant by
    // seeding the row directly; ensureAgents would just flip it back to
    // "active" on the very next getAgent() call, including the one inside
    // delegateTo. The only faithful way to exercise this branch is to
    // temporarily flip AGENT_CATALOG's own "sales" entry to "dormant" (it's a
    // plain mutable array of objects, not deep-frozen) so ensureAgents seeds/
    // reconciles the scratch tenant's row to "dormant" too, then restore it
    // immediately so nothing past this point (or in another test file, not
    // that it would matter — each test file is its own process) sees a
    // permanently-dormant sales agent.
    const salesCatalogEntry = AGENT_CATALOG.find((a) => a.key === "sales")!;
    assert.equal(salesCatalogEntry.status, "active", "setup: sales starts active in AGENT_CATALOG, as expected");
    salesCatalogEntry.status = "dormant";
    try {
      const dormantResult = JSON.parse((await delegateToSalesTool(ctx, { task: "chase a lead" })).text);
      assert.equal(
        dormantResult.error,
        "The sales agent isn't available.",
        "delegating to a dormant specialist is rejected with the exact guard text",
      );
      // Confirm the underlying agent row really was seeded/reconciled dormant
      // (not just that delegateTo happened to say so) — the real proof.
      const agentRow = getAgent(tid, "sales");
      assert.equal(agentRow?.status, "dormant", "the scratch tenant's sales row was actually reconciled to dormant");
    } finally {
      salesCatalogEntry.status = "active"; // restore — AGENT_CATALOG is a shared module-level singleton for this process
    }
    // Confirm the restore actually took, by re-reading the registry directly
    // — deliberately NOT by calling delegateToSalesTool again: past the
    // dormant guard, delegateTo proceeds to getAnthropic()/runAgentTurn, and
    // if ANTHROPIC_API_KEY happened to be set in whatever environment runs
    // this suite, that would be a real, live Claude call — exactly what this
    // test file must never do (see the file-level comment).
    assert.equal(getAgent(tid, "sales")?.status, "active", "restoring AGENT_CATALOG reconciles the row back to active");

    // ════════════════════════════════════════════════════════════════════
    // 3. Orchestrator's own wiring
    // ════════════════════════════════════════════════════════════════════
    // toolNames all resolve in TOOLS. Concierge Task 1 added a 4th delegate,
    // delegate_to_concierge — it doesn't go through delegateTo/DELEGATABLE
    // (see tools.concierge.test.ts for its own registration + guard
    // coverage), so DELEGATE_NAMES above stays the 3 delegateTo-backed
    // targets; the orchestrator's real toolNames is that set PLUS it.
    for (const name of ORCHESTRATOR_SPECIALIST.toolNames) {
      assert.ok(toolsByName.has(name), `ORCHESTRATOR_SPECIALIST.toolNames entry "${name}" resolves in TOOLS`);
    }
    assert.deepEqual(
      [...ORCHESTRATOR_SPECIALIST.toolNames].sort(),
      [...DELEGATE_NAMES, "delegate_to_concierge"].sort(),
      "ORCHESTRATOR_SPECIALIST.toolNames is exactly the 3 delegateTo-backed tools plus delegate_to_concierge — the orchestrator owns no domain tools of its own",
    );

    // orchestrator active in AGENT_CATALOG (flipped from "dormant" by this task).
    const orchestratorDef = AGENT_CATALOG.find((a) => a.key === "orchestrator");
    assert.ok(orchestratorDef, "orchestrator is a real AGENT_CATALOG entry");
    assert.equal(orchestratorDef!.status, "active", "orchestrator is active in AGENT_CATALOG");

    // orchestrator registered in SPECIALISTS, as the SAME object (not a copy).
    assert.equal(
      SPECIALISTS.orchestrator,
      ORCHESTRATOR_SPECIALIST,
      "SPECIALISTS.orchestrator is the same ORCHESTRATOR_SPECIALIST object reference",
    );

    console.log("tools.orchestrator.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
