// Run: npm test -- src/lib/agents/runAgentTurn.test.ts
//
// Orchestrator Task 1 (OR1): runAgentTurn is the specialist chat loop
// extracted verbatim from `/api/agents/[key]/chat`. This test proves the
// extraction reproduces the pre-extraction loop's behaviour by covering the
// safety-critical branches called out in the task brief:
//   1. THE SAFETY PROPERTY — a WRITE tool_use is collected into
//      `pendingWrites` and is NEVER executed (this is what keeps the
//      operator Approve gate intact; without it, a prompt-injected model
//      could mutate data with no human in the loop). Proven three ways: the
//      write tool's real side effect (a DB column) never changes, `onTool`
//      (which only ever fires on the execute path) never fires for it, and
//      the loop stops rather than asking the model again.
//   2. A READ tool_use executes inline via the REAL `executeTool`, its real
//      result (against a real seeded scratch-tenant row) is threaded back
//      into the conversation, and the loop continues to a second model turn.
//   3. A plain end_turn text response streams through `onText` and comes
//      back as `text`, with `pendingWrites` empty.
//   4. `assertUnderCap` gates BEFORE the first model call: once a tenant is
//      over its monthly cap, `runAgentTurn` rejects with `AiCapError` and the
//      (fake) model is never invoked at all.
//   5. (Concierge Task 1) `artifacts` — the delegate-only mirror of
//      `pendingWrites`, one field over — is ALWAYS present on the return
//      value as an array (never undefined), proven for real against all
//      three real-executeTool/real-text scenarios above (empty in every
//      case, since none of set_lead_stage/business_overview/plain-text
//      produce one). The accumulation lines themselves (`if (r.artifact) ...`
//      / `if (r.artifacts?.length) ...`) are NOT independently exercised
//      end-to-end here: the only tool in the whole registry that ever sets
//      `ToolResult.artifact` (bundle_invoices) needs a live Gmail connection
//      to reach the code path that sets it, and the only way to make
//      `executeTool` see `ToolResult.artifacts` (plural) for real is a
//      delegate_to_<*> tool's nested runAgentTurn, which needs a live Claude
//      call — both outside what this test file may do (no network, no live
//      Claude — see the file-level rule below). This is a deliberate, noted
//      gap: the accumulation code is a one-line-each mirror of the
//      already-proven-above `pendingWrites` collection (same `if (cond)
//      push(...)` shape, same call site), reviewed rather than independently
//      runtime-proven — see the task report for the explicit callout.
//
// MP1 (multi-provider model choice): the model call moved from an inline
// `anthropic.messages.stream(...)` to an injected `ModelProvider` (see
// @/lib/ai/providers and .superpowers/sdd/multiprovider-task-1-brief.md).
// This file's fake now stubs THAT seam — a fake `ModelProvider.streamTurn()`
// returning scripted `ProviderTurnResult`s and recording every call's
// provider-neutral `messages` — instead of a fake Anthropic client. That is
// the point of the seam: every assertion below (the write gate, the read
// tool executing + looping, plain text, the cap) is unchanged and re-proven
// here WITHOUT any Anthropic SDK type or shape in this file at all, showing
// the loop itself is genuinely provider-agnostic now. The real
// `AnthropicProvider` wire conversion (NeutralMessage <-> Anthropic content
// blocks, incl. the `providerRaw` fidelity round-trip) is exercised
// separately in @/lib/ai/providers/anthropic.test.ts — nothing here proves
// THAT class's behaviour, only that runAgentTurn drives whatever
// `ModelProvider` it's given correctly.
// Only the ModelProvider is stubbed — nothing here makes a real network
// call. `executeTool`, `isWriteTool`, `assertUnderCap`, and `recordUsage` are
// all REAL, run against a scratch tenant, exactly like tools.sales.test.ts /
// context.test.ts / usage.test.ts.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// exact pattern of src/lib/agents/tools.sales.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// runAgentTurn.ts -> @/lib/assistant/tools -> @/lib/db/tenant (react `cache`,
// next/headers) and, separately, -> @/lib/agents/tools.sales / @/lib/leads /
// @/lib/pipeline/stage -> @/lib/db (the ambient `db` proxy, index.ts) ->
// @/lib/tenants -> @/lib/auth -> `next/navigation`. Same two-part shim as
// tools.sales.test.ts, for the same reason: under the runner's
// `--conditions=react-server`, npm's react "react-server" entry throws on
// load, so `cache` needs stubbing; next/navigation's real module drags in
// Next's client-router internals we have no reason to load here (redirect()
// is never actually called in this test's code path). Installed via a
// dynamic require (below) rather than a static import, since a static
// `import ... from "./runAgentTurn"` would be hoisted and evaluated before
// this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in runAgentTurn.test.ts");
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
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { leads, clients } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const { WRITE_TOOLS, summarizeToolAction } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { runAgentTurn } =
    requireLocal("./runAgentTurn") as typeof import("./runAgentTurn");
  const { MODELS } =
    requireLocal("../ai/client") as typeof import("../ai/client");
  const { recordUsage, AiCapError } =
    requireLocal("../ai/usage") as typeof import("../ai/usage");

  // ── fake ModelProvider ──
  // Scripts a queue of ProviderTurnResults, one per expected `streamTurn()`
  // call. Records each call's provider-neutral `messages` so tests can
  // inspect exactly what was fed back after a tool ran, plus how many turns
  // happened. This implements the ACTUAL `ModelProvider` interface (@/lib/ai/
  // providers/types) runAgentTurn now depends on — not a stand-in for the
  // Anthropic SDK — which is the point: it proves the loop only ever talks
  // to that interface, never anything Anthropic-shaped.
  type FakeTurn = {
    textDeltas?: string[];
    toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
    usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreateTokens?: number };
    stopReason: "tool_use" | "end" | "max_tokens";
  };
  function makeFakeProvider(turns: FakeTurn[]) {
    const calls: { messages: unknown[] }[] = [];
    let i = 0;
    const provider = {
      async streamTurn(args: { messages: unknown[]; onText?: (delta: string) => void }) {
        // Snapshot, not a reference: runAgentTurn keeps ONE `convo` array
        // and mutates it in place (`.push(...)`) across turns, then passes
        // that same array to every `streamTurn()` call. Storing the
        // reference here would make every recorded call retroactively show
        // the array's FINAL state once the whole loop finished — copy the
        // array now so each call's snapshot reflects what the model
        // actually saw at that point in the loop.
        calls.push({ messages: [...args.messages] });
        const turn = turns[i++];
        if (!turn) throw new Error(`fake provider: no scripted turn for call #${calls.length} — the loop asked the model again when it shouldn't have`);
        for (const d of turn.textDeltas ?? []) args.onText?.(d);
        return {
          text: (turn.textDeltas ?? []).join(""),
          toolCalls: turn.toolCalls ?? [],
          usage: {
            inputTokens: turn.usage?.inputTokens ?? 0,
            outputTokens: turn.usage?.outputTokens ?? 0,
            cacheReadTokens: turn.usage?.cacheReadTokens ?? 0,
            cacheCreateTokens: turn.usage?.cacheCreateTokens ?? 0,
          },
          stopReason: turn.stopReason,
          // Deliberately no `assistantRaw`: runAgentTurn will store
          // `providerRaw: undefined` on the assistant NeutralMessage it
          // appends, proving the loop never REQUIRES a provider to support
          // the providerRaw fidelity optimisation — only AnthropicProvider
          // needs it, to keep ITS OWN wire request byte-for-byte identical
          // (see @/lib/ai/providers/anthropic.test.ts).
        };
      },
    };
    // Cast through `any`: the fake implements only the one ModelProvider
    // member runAgentTurn actually calls (`streamTurn`), typed loosely here
    // so this file needs no direct import of the real ModelProvider/
    // NeutralMessage types — `runAgentTurn`'s own typed signature (recovered
    // via the `typeof import("./runAgentTurn")` cast above) is what actually
    // checks this fake is an acceptable `provider` at each call site below.
    return { provider: provider as any, calls };
  }

  // ── scratch tenant (control row + a real tenant DB file, so
  // getTenantDbById() resolves it and ensureTenantTables() gives us real
  // `leads`/`clients` tables to seed into — same pattern as
  // tools.sales.test.ts / context.test.ts) ──
  const slug = "agents-run-agent-turn-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents RunAgentTurn Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort
    }
  };

  try {
    const db = getTenantDbById(tid);

    // ── fixture precondition: set_lead_stage really is a write tool (gated
    // behind Approve) — if it weren't, test 1 below wouldn't be exercising
    // the property it claims to. ──
    assert.ok(WRITE_TOOLS.has("set_lead_stage"), "set_lead_stage is a write tool (requires Approve)");
    assert.ok(!WRITE_TOOLS.has("business_overview"), "business_overview is a read tool — must NOT require approval");

    // ════════════════════════════════════════════════════════════════════
    // 1. THE SAFETY PROPERTY: a WRITE tool_use is collected, never executed
    // ════════════════════════════════════════════════════════════════════
    const leadRow = db
      .insert(leads)
      .values({ firstName: "Ada", lastName: "Tester", phone: "0851234567", email: "ada@example.com" })
      .returning()
      .get();
    assert.equal(leadRow.pipelineStage, "new_lead", "seeded lead starts at the default stage");

    const writeInput = { leadId: leadRow.id, stage: "hot_lead" };
    const { provider: writeProvider, calls: writeCalls } = makeFakeProvider([
      {
        toolCalls: [{ id: "tu_write", name: "set_lead_stage", input: writeInput }],
        stopReason: "tool_use",
        usage: { inputTokens: 20, outputTokens: 8 },
      },
    ]);
    const toolsSeenDuringWrite: string[] = [];
    // runWithTenant, not a bare call: set_lead_stage's real implementation
    // (tools.sales.ts) reads/writes via the ambient-tenant pipeline lib, and
    // runAgentTurn is always invoked this way in production (the chat route
    // wraps its whole loop in runWithTenant). Wrapping it here too means
    // that IF the write-gate ever regressed and executeTool actually ran
    // this tool, it would cleanly succeed and mutate the row — giving the
    // assertion below a real, deliberate failure instead of a confusing
    // "no ambient tenant" crash unrelated to the property under test.
    const writeResult = await runWithTenant(tid, () =>
      runAgentTurn({
        provider: writeProvider,
        tenantId: tid,
        agentKey: "sales",
        model: MODELS.sonnet,
        system: "You are a test sales agent.",
        tools: [],
        messages: [{ role: "user", content: "Please move Ada to hot lead." }],
        onTool: (n) => toolsSeenDuringWrite.push(n),
      }),
    );

    assert.equal(writeCalls.length, 1, "the loop stopped after collecting the write — it never asked the model again");
    assert.deepEqual(writeResult.artifacts, [], "artifacts is an empty array, not undefined — a write tool_use never reaches executeTool, so nothing could have produced one");
    assert.equal(writeResult.pendingWrites.length, 1, "the write tool_use lands in pendingWrites");
    assert.equal(writeResult.pendingWrites[0].name, "set_lead_stage");
    assert.deepEqual(writeResult.pendingWrites[0].input, writeInput, "the tool's input is preserved verbatim for the Approve UI");
    assert.equal(
      writeResult.pendingWrites[0].summary,
      summarizeToolAction("set_lead_stage", writeInput),
      "the summary is the same human-readable label the route always showed on the Approve card",
    );
    assert.equal(
      toolsSeenDuringWrite.length,
      0,
      "onTool must NEVER fire for a write tool — it only fires on the executeTool path (see runAgentTurn.ts), so this proves that path was not taken",
    );
    const rereadLead = db.select().from(leads).where(eq(leads.id, leadRow.id)).get();
    assert.equal(
      rereadLead?.pipelineStage,
      "new_lead",
      "THE PROOF: the lead's real pipelineStage is unchanged — set_lead_stage's underlying DB write never ran",
    );

    // ════════════════════════════════════════════════════════════════════
    // 2. A READ tool_use executes inline (real executeTool) and the loop
    //    continues to a second turn with the real result threaded back
    // ════════════════════════════════════════════════════════════════════
    db.insert(clients).values({ firstName: "Cara", lastName: "Client", phone: "0870000000" }).run();

    const { provider: readProvider, calls: readCalls } = makeFakeProvider([
      {
        toolCalls: [{ id: "tu_read", name: "business_overview", input: {} }],
        stopReason: "tool_use",
        usage: { inputTokens: 15, outputTokens: 6 },
      },
      {
        textDeltas: ["You have 1 client."],
        stopReason: "end",
        usage: { inputTokens: 12, outputTokens: 4 },
      },
    ]);
    const toolsSeenDuringRead: string[] = [];
    const readResult = await runWithTenant(tid, () =>
      runAgentTurn({
        provider: readProvider,
        tenantId: tid,
        agentKey: "sales",
        model: MODELS.sonnet,
        system: "You are a test sales agent.",
        tools: [],
        messages: [{ role: "user", content: "Give me a quick business overview." }],
        onTool: (n) => toolsSeenDuringRead.push(n),
      }),
    );

    assert.equal(readCalls.length, 2, "the loop asked the model a second time after the read tool's result came back");
    assert.deepEqual(toolsSeenDuringRead, ["business_overview"], "onTool fired for the read tool — the executeTool path WAS taken");
    assert.deepEqual(readResult.artifacts, [], "artifacts is an empty array — business_overview's real ToolResult carries no artifact, so nothing was collected");
    assert.equal(readResult.pendingWrites.length, 0, "no writes were involved in this turn");
    assert.equal(readResult.text, "You have 1 client.", "the final turn's text is returned");

    // The real proof the read actually ran (not just that onTool fired):
    // inspect what the SECOND streamTurn() call was actually given. Its last
    // message must carry the toolResult for tu_read, with business_overview's
    // REAL output against our REAL seeded tenant (1 client) — not a stub.
    const secondCallMessages = readCalls[1].messages as {
      role: string;
      content: string;
      toolResults?: { toolCallId: string; content: string }[];
    }[];
    const fedBack = secondCallMessages[secondCallMessages.length - 1];
    assert.equal(fedBack.role, "user");
    const toolResultBlocks = fedBack.toolResults ?? [];
    assert.equal(toolResultBlocks.length, 1);
    assert.equal(toolResultBlocks[0].toolCallId, "tu_read", "the tool result is wired to the exact tool call that requested it");
    const overviewPayload = JSON.parse(toolResultBlocks[0].content);
    assert.equal(overviewPayload.clients, 1, "the tool result carries business_overview's REAL count from the scratch tenant");
    // Conversation accumulation matches the spec: assistant tool_use message,
    // then a user tool-results message, appended between the two model calls.
    assert.equal(
      secondCallMessages.length,
      (readCalls[0].messages as unknown[]).length + 2,
      "convo grew by exactly the assistant message + the tool-results message between turns",
    );

    // ════════════════════════════════════════════════════════════════════
    // 3. Plain text: no tools, single turn, onText receives every delta
    // ════════════════════════════════════════════════════════════════════
    const { provider: textProvider, calls: textCalls } = makeFakeProvider([
      {
        textDeltas: ["Hello", ", world!"],
        stopReason: "end",
        usage: { inputTokens: 5, outputTokens: 3 },
      },
    ]);
    const receivedDeltas: string[] = [];
    const textResult = await runWithTenant(tid, () =>
      runAgentTurn({
        provider: textProvider,
        tenantId: tid,
        agentKey: "sales",
        model: MODELS.sonnet,
        system: "You are a test sales agent.",
        tools: [],
        messages: [{ role: "user", content: "Hi there." }],
        onText: (d) => receivedDeltas.push(d),
      }),
    );

    assert.equal(textCalls.length, 1);
    assert.equal(textResult.text, "Hello, world!");
    assert.equal(textResult.pendingWrites.length, 0);
    assert.deepEqual(textResult.artifacts, [], "artifacts is an empty array — no tool ran at all this turn");
    assert.deepEqual(receivedDeltas, ["Hello", ", world!"], "onText receives every delta, in order, as they streamed");

    // ════════════════════════════════════════════════════════════════════
    // 4. assertUnderCap gates BEFORE the first model call; AiCapError
    //    propagates to the caller (run LAST — it pushes this scratch tenant
    //    over its cap, which would otherwise fail tests 1-3 above)
    // ════════════════════════════════════════════════════════════════════
    // 20,000,000 output tokens on sonnet ($15/1M out list price) = 30,000c,
    // comfortably over the $25 (2,500c) monthly cap.
    recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 20_000_000 });
    const { provider: overCapProvider, calls: overCapCalls } = makeFakeProvider([
      {
        textDeltas: ["should never run"],
        stopReason: "end",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
    await assert.rejects(
      () =>
        runWithTenant(tid, () =>
          runAgentTurn({
            provider: overCapProvider,
            tenantId: tid,
            agentKey: "sales",
            model: MODELS.sonnet,
            system: "You are a test sales agent.",
            tools: [],
            messages: [{ role: "user", content: "hello" }],
          }),
        ),
      AiCapError,
      "runAgentTurn rejects with AiCapError once the tenant is over its monthly cap",
    );
    assert.equal(overCapCalls.length, 0, "the model was never called — the cap is enforced before the first model call");

    console.log("runAgentTurn.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
