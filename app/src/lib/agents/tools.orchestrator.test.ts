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
//        - a DELEGATABLE target that is not actually runnable right now ->
//          "... isn't available." Single-agent product (2026-08-25):
//          sales/marketing/operations are retired from AGENT_CATALOG (Adonis
//          does their work directly now — see specialists/orchestrator.ts),
//          so this branch fires unconditionally for "sales": getAgent(tid,
//          "sales") is undefined on every call, no more dormant-flip
//          simulation needed to reach it (see the inline comment at that
//          assertion for the mechanism this replaced, back when sales was
//          still a real, temporarily-dormant-able catalog entry).
//   3. Orchestrator's OWN wiring (Adonis merge task — Adonis is now a full
//      working agent, not a 4-tool router): ORCHESTRATOR_SPECIALIST.toolNames
//      is non-empty, every entry resolves to a real TOOLS entry, it holds
//      ZERO delegate_to_* tools (no routing hop), it's a superset of every
//      other specialist's own toolNames (the union stays in sync if a
//      specialist gains a tool), the 4 delegate_to_* tools are still
//      registered in TOOLS (unused, not deleted) and still not writes,
//      orchestrator is "active" in AGENT_CATALOG, and it's registered in
//      SPECIALISTS. (specialistToolSlice.test.ts separately pins
//      orchestrator's shape + honesty lines, generalizing the same
//      per-specialist checks it already does for sales/marketing/operations.)
//   4. Concierge delegation helpers (originally
//      .superpowers/sdd/concierge-agent-brief.md; downstream of the
//      single-agent-product retirement, 2026-08-25, which removed the
//      Concierge's own AGENT_CATALOG entry/row alongside its card):
//        - `resolveConciergeModel` — the model-selection seam
//          `delegateToConcierge` uses — now ALWAYS falls back to
//          `ctx.callerModel` (then a hardcoded Sonnet): there is no more
//          concierge `agents` row for it to prefer — getAgent(tid,
//          "concierge") is unconditionally undefined post-retirement, since
//          ensureAgents prunes any row whose key isn't in AGENT_CATALOG on
//          every read (even a raw-inserted one). Pinned as the new,
//          permanent behaviour rather than an edge case.
//        - `buildConciergeSystem` — same story: with no concierge row ever
//          reachable, its output is now always byte-identical to
//          `buildAssistantSystem`'s own output, for any mode/driveConnected
//          combination — proven rather than assumed, so a future regression
//          (e.g. a stray undefined-instructions block) would be caught.
//        - `delegateToConcierge`'s source still CALLS
//          `resolveConciergeModel`/`buildConciergeSystem` directly (not
//          re-derived equivalents) — same "no second driftable copy" proof
//          as before, verified by source inspection.
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
  const { AGENT_CATALOG, getAgent } =
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
    // "finance" — a former catalog key, retired in the single-agent product
    // (2026-08-25): the DELEGATABLE guard is a static allowlist that never
    // consults AGENT_CATALOG, so whether "finance" is a live entry, a dormant
    // one, or fully retired (as now), it's outside DELEGATABLE and rejected
    // the same way — never even reaching getAgent.
    const toFinance = JSON.parse((await delegateTo("finance", ctx, { task: "do something" })).text);
    assert.equal(toFinance.error, "Cannot delegate to finance.", "a non-DELEGATABLE key is rejected the same way");
    // A key that isn't in AGENT_CATALOG at all.
    const toBogus = JSON.parse((await delegateTo("bogus", ctx, { task: "do something" })).text);
    assert.equal(toBogus.error, "Cannot delegate to bogus.", "an unknown key is rejected by the same guard");

    // ════════════════════════════════════════════════════════════════════
    // 2c. Guard: a DELEGATABLE target that is not actually runnable right
    //     now -> "... isn't available."
    // ════════════════════════════════════════════════════════════════════
    // Single-agent product (2026-08-25): "sales" was retired from
    // AGENT_CATALOG (Adonis absorbed its tools/playbook — see
    // specialists/orchestrator.ts), so — unlike before that retirement —
    // there is no need to temporarily flip anything dormant to reach this
    // branch: getAgent(tid, "sales") is unconditionally undefined now
    // (ensureAgents never seeds a row for a catalog-absent key), so the exact
    // same `!agent` guard fires every time, with the identical error text a
    // genuinely dormant specialist would have produced. DELEGATABLE itself
    // (this file) still lists "sales" — it's deliberately left registered,
    // dead code, same as the delegate_to_* tools themselves (see this file's
    // header comment) — so this also proves the vestigial delegate_to_sales
    // tool degrades cleanly (a clean error result) rather than crashing now
    // that its target is gone.
    assert.ok(
      !AGENT_CATALOG.some((a) => a.key === "sales"),
      "setup: sales is no longer an AGENT_CATALOG entry (single-agent product)",
    );
    const agentRow = getAgent(tid, "sales");
    assert.equal(agentRow, undefined, "sales has no seeded agent row — ensureAgents never creates one for a retired key");
    const dormantResult = JSON.parse((await delegateToSalesTool(ctx, { task: "chase a lead" })).text);
    assert.equal(
      dormantResult.error,
      "The sales agent isn't available.",
      "delegating to a retired/unavailable specialist is rejected with the exact guard text, no crash",
    );

    // ════════════════════════════════════════════════════════════════════
    // 3. Orchestrator's own wiring — Adonis merge task: Adonis is now a full
    //    working agent, not a 4-tool router. Its toolNames is the
    //    deduplicated union of the Concierge's general toolkit
    //    (conciergeToolSlice) plus Sales/Marketing/Operations' own
    //    toolNames, computed lazily in specialists/orchestrator.ts (a
    //    getter, not a plain array — see that file's doc comment on why an
    //    EAGER top-level call into @/lib/assistant/tools would crash at
    //    module load given the existing tools.ts <-> tools.orchestrator.ts
    //    <-> specialists/index.ts require cycle).
    // ════════════════════════════════════════════════════════════════════
    // (a) non-empty — a real toolkit, not an accidental empty array.
    assert.ok(ORCHESTRATOR_SPECIALIST.toolNames.length > 0, "ORCHESTRATOR_SPECIALIST.toolNames is non-empty");

    // (b) every entry resolves to a real TOOLS entry — nothing silently
    // dropped by the chat route's TOOLS.filter((t) => allowed.has(t.name)).
    for (const name of ORCHESTRATOR_SPECIALIST.toolNames) {
      assert.ok(toolsByName.has(name), `ORCHESTRATOR_SPECIALIST.toolNames entry "${name}" resolves in TOOLS`);
    }

    // (c) ZERO delegate_to_* — the whole point of this task: Adonis does the
    // work directly, one runAgentTurn, no delegation hop into a nested turn.
    assert.ok(
      !ORCHESTRATOR_SPECIALIST.toolNames.some((n) => n.startsWith("delegate_to_")),
      "ORCHESTRATOR_SPECIALIST.toolNames contains zero delegate_to_* tools — no routing hop",
    );
    for (const name of [...DELEGATE_NAMES, "delegate_to_concierge"]) {
      assert.ok(
        !ORCHESTRATOR_SPECIALIST.toolNames.includes(name),
        `ORCHESTRATOR_SPECIALIST.toolNames no longer includes ${name} — the delegate machinery is left registered in TOOLS but unused`,
      );
    }

    // (d) still a proper superset of each specialist's OWN tools, so the
    // "stays in sync if a specialist gains a tool" property actually holds.
    for (const [specialistKey, spec] of Object.entries(SPECIALISTS)) {
      if (specialistKey === "orchestrator") continue;
      for (const name of spec.toolNames) {
        assert.ok(
          ORCHESTRATOR_SPECIALIST.toolNames.includes(name),
          `ORCHESTRATOR_SPECIALIST.toolNames includes "${name}" (from ${specialistKey}) — Adonis's union is a superset of every specialist's own tools`,
        );
      }
    }

    // (e) the 4 delegate_to_* tools are still registered in TOOLS (unused,
    // not deleted — a later cleanup task can remove them) and still not
    // writes — delegation was never gated by WRITE_TOOLS in the first place.
    for (const name of [...DELEGATE_NAMES, "delegate_to_concierge"]) {
      assert.ok(toolsByName.has(name), `${name} is still registered in TOOLS (unused by Adonis now, not deleted)`);
      assert.ok(!WRITE_TOOLS.has(name), `${name} is still not a write tool`);
    }

    // orchestrator active in AGENT_CATALOG.
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
    // 4. Concierge delegation helpers: model resolution + editable-context
    //    wiring, now permanently fallback-only post-retirement (see the
    //    file-level header comment's section 4 for why)
    // ════════════════════════════════════════════════════════════════════

    // ── 4a. resolveConciergeModel: single-agent product (2026-08-25) retired
    // "concierge" from AGENT_CATALOG, so there is no more concierge `agents`
    // row to read a model from — getAgent(tid, "concierge") is
    // unconditionally undefined (ensureAgents prunes any row whose key isn't
    // in AGENT_CATALOG, on every read, even one inserted directly — see
    // registry.test.ts's prune coverage). What used to be a defensive
    // fallback tail is now the ONLY reachable path: the caller's own model
    // always wins... ──
    assert.equal(
      resolveConciergeModel({ tenantId: tid, callerModel: MODELS.opus }),
      MODELS.opus,
      "resolveConciergeModel falls back to ctx.callerModel — the concierge row is permanently unreachable now that \"concierge\" is retired from AGENT_CATALOG",
    );
    // ...and its picker must work for OpenRouter models too (e.g. Kimi), not
    // just Anthropic tiers — proving the fallback returns whatever
    // callerModel is, verbatim, not just a hardcoded Sonnet/Opus.
    const openRouterEntry = MODEL_CATALOG.find((m) => m.provider === "openrouter")!;
    assert.ok(openRouterEntry, "sanity: MODEL_CATALOG has an OpenRouter entry to test against");
    assert.equal(
      resolveConciergeModel({ tenantId: tid, callerModel: openRouterEntry.id }),
      openRouterEntry.id,
      "resolveConciergeModel's callerModel fallback works for any model id, including an OpenRouter one",
    );
    // ...and a hardcoded Sonnet is the final fallback when even that's absent.
    assert.equal(
      resolveConciergeModel({ tenantId: tid }),
      MODELS.sonnet,
      "resolveConciergeModel falls all the way back to MODELS.sonnet with no concierge row and no ctx.callerModel",
    );

    // Verified by source inspection too — the same technique
    // tools.concierge.test.ts already uses to pin delegateToConcierge's call
    // shape — which also doubles as the "delegate actually calls the seam,
    // not a re-derived equivalent" proof.
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

    // ── 4b. buildConciergeSystem: same story — with no concierge row ever
    // reachable now, this always equals buildAssistantSystem's own output,
    // byte-identical, for any mode/driveConnected combination. Still real
    // coverage: proves the wrapper never crashes and never appends a stray
    // instructions block when getAgent(..., "concierge") misses.
    // buildAssistantSystem calls getBusinessProfile() internally, which —
    // like getBusinessContext() in composeAgentSystem's doc comment — reads
    // the AMBIENT tenant rather than taking one as an argument, so every call
    // below is wrapped in runWithTenant(tid, ...), the exact same
    // requirement context.test.ts documents and follows for
    // composeAgentSystem. ──
    const mode = "appointments" as const;
    const baseline = runWithTenant(tid, () => buildAssistantSystem(mode, false));
    assert.equal(
      runWithTenant(tid, () => buildConciergeSystem(tid, mode, false)),
      baseline,
      "buildConciergeSystem is byte-identical to buildAssistantSystem's own output — no concierge row is ever reachable post-retirement",
    );
    assert.equal(
      runWithTenant(tid, () => buildConciergeSystem(tid, "timetable", true)),
      runWithTenant(tid, () => buildAssistantSystem("timetable", true)),
      "buildConciergeSystem threads mode/driveConnected through to buildAssistantSystem unchanged, still with no appended instructions block",
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
