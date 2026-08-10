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
//   4. First-class-Concierge task (.superpowers/sdd/concierge-agent-brief.md):
//        - `resolveConciergeModel` (Requirement 2) — the model-selection seam
//          `delegateToConcierge` uses — returns the Concierge's OWN
//          `agents` row model (set via updateAgentModel, exactly like the
//          Agents-tab picker would), NOT `ctx.callerModel`, even when both are
//          set to different models (proves the priority order, not just that
//          A value comes back); and still falls back to `ctx.callerModel`
//          then a hardcoded Sonnet if called with a tenant that has no
//          concierge row at all (simulated the same way the dormant-sales
//          guard below simulates an edge case AGENT_CATALOG wouldn't
//          otherwise let a real tenant reach).
//        - `buildConciergeSystem` (Requirement 5) — appends the tenant's
//          saved concierge instructions to `buildAssistantSystem`'s output
//          (mirroring `composeAgentSystem`'s labelled-block layering), is a
//          no-op (byte-identical to `buildAssistantSystem`'s own output) when
//          instructions are empty/unset, and never mutates/duplicates the
//          base text it's built from.
//        - `delegateToConcierge`'s source actually CALLS
//          `resolveConciergeModel`/`buildConciergeSystem` (not re-derived
//          equivalents) — same "no second driftable copy" proof
//          tools.concierge.test.ts already does for `conciergeToolSlice`.
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

// @/lib/ai/client and @/lib/ai/modelCatalog are leaf-ish modules (no
// react/next-navigation in their chains — modelCatalog.ts has ZERO imports by
// design, see its own file-level doc comment), so — exactly like
// registry.test.ts's identical static imports of the same two modules —
// they're safe to import directly here, unlike the shimmed requireLocal()
// calls below.
import { MODELS } from "../ai/client";
import { MODEL_CATALOG } from "../ai/modelCatalog";

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
  const { AGENT_CATALOG, getAgent, updateAgentModel, updateAgentInstructions } =
    requireLocal("./registry") as typeof import("./registry");
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");
  const { ORCHESTRATOR_SPECIALIST } = requireLocal("./specialists/orchestrator") as typeof import("./specialists/orchestrator");
  const {
    delegateTo,
    delegateToSalesTool,
    delegateToMarketingTool,
    delegateToOperationsTool,
    resolveConciergeModel,
    buildConciergeSystem,
  } = requireLocal("./tools.orchestrator") as typeof import("./tools.orchestrator");
  // Not part of the tools.ts <-> tools.orchestrator.ts cycle (system.ts only
  // pulls in businessContext/businessProfile/responseStyle) — required here
  // purely as a comparison baseline for buildConciergeSystem's tests below,
  // same react-server-`cache` + next/navigation shim dependency as every
  // other module in this require chain (getBusinessContext -> @/lib/db ->
  // @/lib/tenants -> @/lib/auth -> next/navigation), so it must load via this
  // same shimmed requireLocal, never a static top-level import.
  const { buildAssistantSystem } = requireLocal("../assistant/system") as typeof import("../assistant/system");

  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");

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
    // dormant guard, delegateTo proceeds to runAgentTurn (MP1: which resolves
    // a ModelProvider and, for a claude-* model, that provider calls
    // getAnthropic()), and if ANTHROPIC_API_KEY happened to be set in
    // whatever environment runs this suite, that would be a real, live Claude
    // call — exactly what this test file must never do (see the file-level
    // comment).
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

    // ════════════════════════════════════════════════════════════════════
    // 4. First-class Concierge (.superpowers/sdd/concierge-agent-brief.md):
    //    model resolution + editable-context wiring
    // ════════════════════════════════════════════════════════════════════

    // ── 4a. resolveConciergeModel (Requirement 2): the Concierge's OWN
    // configured model wins — proven by setting it to something DIFFERENT
    // from ctx.callerModel, not just checking that "a" value comes back.
    // Both values used here must be real MODEL_CATALOG picker options (NOT
    // e.g. MODELS.haiku, which — unlike sonnet/opus — isn't in the curated
    // picker catalog and updateAgentModel would reject it, same as Fable). ──
    updateAgentModel(tid, "concierge", MODELS.opus);
    assert.equal(
      resolveConciergeModel({ tenantId: tid, callerModel: MODELS.sonnet }),
      MODELS.opus,
      "resolveConciergeModel uses the Concierge's OWN configured model, not the caller's, when both are set and differ",
    );

    // Change it again — this time to an OpenRouter catalog id (Requirement 4:
    // its picker must work for OpenRouter models too, e.g. Kimi) — proves
    // resolution is read live from the row on every call, not cached, and
    // confirms "changeable anytime" actually holds for a non-Anthropic model
    // too, not just Sonnet/Opus.
    const openRouterEntry = MODEL_CATALOG.find((m) => m.provider === "openrouter")!;
    assert.ok(openRouterEntry, "sanity: MODEL_CATALOG has an OpenRouter entry to test against");
    updateAgentModel(tid, "concierge", openRouterEntry.id);
    assert.equal(
      resolveConciergeModel({ tenantId: tid, callerModel: MODELS.opus }),
      openRouterEntry.id,
      "resolveConciergeModel picks up a changed concierge model immediately, including an OpenRouter model",
    );

    // No ctx.callerModel at all — the concierge's own model alone is enough,
    // proving it isn't a required input, just a defensive fallback.
    assert.equal(
      resolveConciergeModel({ tenantId: tid }),
      openRouterEntry.id,
      "resolveConciergeModel works with no ctx.callerModel — the concierge row is the primary source",
    );

    // The `ctx.callerModel ?? MODELS.sonnet` tail only matters for a
    // concierge row that doesn't exist — which, for any REAL tenant id,
    // getAgent's own ensureAgents() call rules out (proven throughout this
    // file and registry.test.ts: the row always gets seeded). A tenant id
    // with no control-plane row at all makes getTenantDbById THROW (see
    // @/lib/db/tenant), not return undefined, so that branch can't be forced
    // via a clean runtime call either. Verified by source inspection instead
    // — the same technique tools.concierge.test.ts already uses to pin
    // delegateToConcierge's call shape — which also doubles as the "delegate
    // actually calls the seam, not a re-derived equivalent" proof.
    const orchestratorSrc = fs.readFileSync(
      path.join(process.cwd(), "src/lib/agents/tools.orchestrator.ts"),
      "utf8",
    );
    assert.ok(
      /getAgent\(ctx\.tenantId,\s*"concierge"\)\?\.model\s*\?\?\s*ctx\.callerModel\s*\?\?\s*MODELS\.sonnet/.test(
        orchestratorSrc,
      ),
      "resolveConciergeModel's fallback chain is exactly: concierge's own model -> ctx.callerModel -> MODELS.sonnet",
    );
    assert.ok(
      /model:\s*resolveConciergeModel\(ctx\)/.test(orchestratorSrc),
      "delegateToConcierge's model comes from calling resolveConciergeModel(ctx) directly",
    );

    // ── 4b. buildConciergeSystem (Requirement 5): empty/never-edited
    // instructions -> byte-identical to buildAssistantSystem's own output —
    // a no-op, matching composeAgentSystem's own empty-custom-instructions
    // behaviour (see context.test.ts). buildAssistantSystem calls
    // getBusinessProfile() internally, which — like getBusinessContext() in
    // composeAgentSystem's doc comment — reads the AMBIENT tenant rather than
    // taking one as an argument, so every call below is wrapped in
    // runWithTenant(tid, ...), the exact same requirement context.test.ts
    // documents and follows for composeAgentSystem. ──
    const mode = "appointments" as const;
    const baseline = runWithTenant(tid, () => buildAssistantSystem(mode, false));
    assert.equal(
      runWithTenant(tid, () => buildConciergeSystem(tid, mode, false)),
      baseline,
      "buildConciergeSystem with no saved instructions is byte-identical to buildAssistantSystem's own output",
    );

    // ── set a distinctive marker as the Concierge's saved instructions
    // (the SAME AgentDetail "Operator instructions" editor every specialist
    // uses) and confirm it's appended, labelled, and never mutates the base ──
    const marker = "CONCIERGE-MARKER-7K1P-always-confirm-the-clinic-address";
    updateAgentInstructions(tid, "concierge", marker);
    const withInstructions = runWithTenant(tid, () => buildConciergeSystem(tid, mode, false));
    assert.ok(
      withInstructions.startsWith(baseline),
      "buildConciergeSystem's output starts with buildAssistantSystem's UNCHANGED output — the append never mutates the base",
    );
    assert.ok(
      withInstructions.includes("=== OPERATOR INSTRUCTIONS (from the Agents tab) ==="),
      "buildConciergeSystem labels the appended block the same way composeAgentSystem labels a specialist's editable layer",
    );
    assert.equal(
      withInstructions,
      baseline + "\n\n=== OPERATOR INSTRUCTIONS (from the Agents tab) ===\n" + marker,
      "buildConciergeSystem's output is exactly base + the labelled instructions block, nothing more",
    );

    // mode/driveConnected still thread through to buildAssistantSystem
    // unchanged (not hardcoded/dropped by the wrapper).
    assert.equal(
      runWithTenant(tid, () => buildConciergeSystem(tid, "timetable", true)),
      runWithTenant(tid, () => buildAssistantSystem("timetable", true)) +
        "\n\n=== OPERATOR INSTRUCTIONS (from the Agents tab) ===\n" +
        marker,
      "buildConciergeSystem threads mode/driveConnected through to buildAssistantSystem unchanged",
    );
    assert.ok(
      /system:\s*buildConciergeSystem\(ctx\.tenantId,\s*mode,\s*drive\)/.test(orchestratorSrc),
      "delegateToConcierge's system comes from calling buildConciergeSystem(ctx.tenantId, mode, drive) directly",
    );

    console.log("tools.orchestrator.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
