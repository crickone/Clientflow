import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "@/lib/ai/client";
import { getAgent } from "@/lib/agents/registry";
import { composeAgentSystem } from "@/lib/agents/context";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { runAgentTurn } from "@/lib/agents/runAgentTurn";
import { TOOLS, type ToolContext, type ToolResult } from "@/lib/assistant/tools";

/**
 * Orchestrator delegation tools (Orchestrator Task 2). The Orchestrator is a
 * THIN routing agent — these 3 `delegate_to_<specialist>` tools are its ONLY
 * tools (see `specialists/orchestrator.ts`). Each one runs that specialist's
 * OWN loop (the shared `runAgentTurn`, extracted in Task 1) on a sub-task,
 * using the specialist's own playbook + tool slice + configured model. The
 * orchestrator itself owns no domain tools and does no domain work directly.
 *
 * WRITE-APPROVAL GATE THROUGH DELEGATION — the property this file exists to
 * preserve. `delegate_to_<specialist>` is registered as a READ (NOT in
 * WRITE_TOOLS, see @/lib/assistant/tools), so it executes INLINE in the
 * orchestrator's own `runAgentTurn` loop — but "executing" a delegate tool
 * never itself mutates anything: it runs the specialist's nested
 * `runAgentTurn`, which — per its own unconditional contract — NEVER executes
 * a write tool either. Any write the specialist's model attempts is collected
 * into `pendingWrites` and returned, never run. `delegateTo` forwards that
 * array unchanged on `ToolResult.pendingWrites`; the OUTER `runAgentTurn`'s
 * READ branch folds it into ITS OWN `pendingWrites` (see the collection line
 * added to runAgentTurn.ts for this task); the chat route then emits it as a
 * `confirm` SSE frame exactly as it would for a directly-called write tool.
 * The operator's Approve click POSTs to the shared `/api/assistant/execute`,
 * which re-validates `isWriteTool` and executes — UNTOUCHED by this task. So:
 * no write ever executes anywhere inside a delegation, at any depth, and the
 * operator sees every proposed write (direct or delegated) on the same card.
 *
 * NO RECURSION — `DELEGATABLE` is the closed set of valid delegation targets:
 * sales, marketing, operations. Orchestrator is deliberately absent (nothing
 * can delegate to itself or to another orchestrator), and no specialist's
 * `toolNames` includes a `delegate_to_*` tool, so there is no path back into
 * this file from inside a specialist's own nested loop — delegation is
 * exactly one level deep.
 *
 * ⚠ CIRCULAR IMPORT — @/lib/assistant/tools (tools.ts) registers these tools
 * by importing `ORCHESTRATOR_TOOLS` + the 3 executors from THIS file; this
 * file imports `TOOLS` + (via `runAgentTurn`) `executeTool` back FROM
 * tools.ts. That is safe ONLY because every one of those imported bindings
 * (`TOOLS`, `runAgentTurn`, and transitively `executeTool`) is touched
 * EXCLUSIVELY inside `delegateTo`'s function body below — never at this
 * file's module top level. A reference inside a function body is resolved
 * the first time `delegateTo` actually RUNS (a real chat turn), by which
 * point the whole module graph has finished loading and every export is
 * populated; a top-level reference (a module-scope `const tools = TOOLS...`,
 * for instance) would instead see whatever tools.ts had exported by the
 * moment this file's import of it was reached mid-cycle, which — depending on
 * which of the two files a given entry point (a route, or a test file) loads
 * first — can be an incomplete object. Do not lift `TOOLS`/`runAgentTurn`
 * usage out of `delegateTo` into a module-scope constant.
 */
const DELEGATABLE = ["sales", "marketing", "operations"] as const;

/**
 * Runs `specialistKey`'s own playbook + tool slice on `task`, exactly as if
 * the operator had sent that task straight to that agent's own chat, and
 * returns its result as a plain tool result for the orchestrator's model to
 * relay/synthesise. `ctx` must come from a call already scoped by
 * `runWithTenant(ctx.tenantId, ...)` — same ambient-tenant contract every
 * other tool executor in @/lib/assistant/tools relies on (guaranteed here
 * because `delegateTo` is only ever reached via `executeTool`, which is only
 * ever called from inside `runAgentTurn`, which the chat route always runs
 * inside `runWithTenant`).
 *
 * Guard clauses below return a plain error `ToolResult` — no Claude call at
 * all — for: a missing `task`; a target outside `DELEGATABLE` (no recursion,
 * no delegating to a non-specialist key — this is what stops, e.g., a
 * `delegate_to_orchestrator` call even if one were ever wired up by mistake);
 * or a target that IS in `DELEGATABLE` but isn't actually runnable right now
 * (dormant in `AGENT_CATALOG`, or — defensively — missing a `SPECIALISTS`
 * entry). Exported (not just the 3 thin wrappers below) so tests can exercise
 * these guard paths directly, including the `DELEGATABLE` guard, which the
 * wrappers can never trigger themselves since each hardcodes a valid key —
 * see tools.orchestrator.test.ts.
 */
export async function delegateTo(
  specialistKey: string,
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const task = String(input.task || "").trim();
  if (!task) return { text: JSON.stringify({ error: "task is required." }) };
  if (!DELEGATABLE.includes(specialistKey as (typeof DELEGATABLE)[number])) {
    return { text: JSON.stringify({ error: `Cannot delegate to ${specialistKey}.` }) };
  }
  const agent = getAgent(ctx.tenantId, specialistKey);
  const spec = SPECIALISTS[specialistKey];
  if (!agent || agent.status !== "active" || !spec) {
    return { text: JSON.stringify({ error: `The ${specialistKey} agent isn't available.` }) };
  }
  try {
    const system = composeAgentSystem(ctx.tenantId, specialistKey);
    const allowed = new Set<string>(spec.toolNames); // the SAME per-agent tool slice the chat route builds
    const tools = TOOLS.filter((t) => allowed.has(t.name));
    const { text, pendingWrites } = await runAgentTurn({
      anthropic: getAnthropic(),
      tenantId: ctx.tenantId,
      agentKey: specialistKey, // metering: the delegated specialist's OWN key, not "orchestrator"
      userId: ctx.userId,
      model: agent.model, // the specialist's OWN registry model — never hardcoded
      system,
      tools,
      messages: [{ role: "user", content: task }],
      maxTurns: 6, // bound nested cost/latency — a delegation is one sub-task, not an open-ended session
    });
    return {
      text: JSON.stringify({
        specialist: specialistKey,
        result: text || "(no textual output)",
        // Human-readable only, for the orchestrator MODEL to read/relay. The
        // actual PendingWrite objects (name + input, which /api/assistant/
        // execute needs to actually run one on Approve) travel via the
        // `pendingWrites` field below, not through this JSON string.
        proposedWrites: pendingWrites.map((p) => p.summary),
      }),
      pendingWrites,
    };
  } catch (e) {
    // Covers a delegated specialist hitting its own AiCapError (the tenant's
    // monthly AI spend cap) the same way any other tool failure is reported —
    // as a normal tool result the orchestrator's model can read and relay,
    // not a thrown error that would abort the orchestrator's own turn.
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Delegation failed." }) };
  }
}

export const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "delegate_to_sales",
    description:
      "Hand a sales task (lead replies, follow-ups, pipeline triage) to the Sales agent and get its result. Any message it drafts still needs the operator's approval before it sends.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The specific sales sub-task, in plain language." },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_marketing",
    description:
      "Hand a content task (blog posts, carousels) to the Marketing agent and get its result. Any content it drafts, saves, or proposes to publish still needs the operator's approval.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The specific marketing sub-task, in plain language." },
      },
      required: ["task"],
    },
  },
  {
    name: "delegate_to_operations",
    description:
      "Hand an operations task (no-show recovery, lapsed-member win-backs, under-filled classes) to the Operations agent and get its result. Any message or rebooking it proposes still needs the operator's approval.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "The specific operations sub-task, in plain language." },
      },
      required: ["task"],
    },
  },
];

export const delegateToSalesTool = (ctx: ToolContext, input: Record<string, unknown>) =>
  delegateTo("sales", ctx, input);
export const delegateToMarketingTool = (ctx: ToolContext, input: Record<string, unknown>) =>
  delegateTo("marketing", ctx, input);
export const delegateToOperationsTool = (ctx: ToolContext, input: Record<string, unknown>) =>
  delegateTo("operations", ctx, input);
