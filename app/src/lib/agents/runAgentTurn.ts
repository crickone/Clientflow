import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { executeTool, isWriteTool, summarizeToolAction, type ToolArtifact } from "@/lib/assistant/tools";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";
import { getProvider, type ModelProvider, type NeutralMessage } from "@/lib/ai/providers";

/**
 * One write tool call collected instead of executed. Same `{ name, input,
 * summary }` shape the chat route has always deferred to the UI's
 * Approve/Cancel flow (`confirm` SSE frame -> POST /api/assistant/execute).
 */
export type PendingWrite = { name: string; input: Record<string, unknown>; summary: string };

export interface RunAgentTurnArgs {
  tenantId: number;
  agentKey: string; // metering key for recordUsage — the specialist's registry key
  userId?: number;
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  // Plain text initial conversation — what every caller already builds
  // (a one-off task message, or a client-supplied chat history). Converted to
  // NeutralMessage[] internally; the wire shape any particular ModelProvider
  // needs (Anthropic content blocks, OpenAI tool_calls, ...) is that
  // provider's own concern, never this function's or its callers'.
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onTool?: (name: string) => void;
  onArtifact?: (artifact: Record<string, unknown>) => void;
  maxTurns?: number; // default 8
  maxTokens?: number; // default 16000
  // MP1 testing hook — defaults to the real provider for `model`
  // (@/lib/ai/providers). Injecting a fake ModelProvider is what makes this
  // loop testable without an actual Anthropic API call or any SDK at all —
  // see runAgentTurn.test.ts.
  provider?: ModelProvider;
}

/**
 * The specialist tool-use loop, extracted verbatim (Orchestrator Task 1) from
 * `/api/agents/[key]/chat` so both that route and the orchestrator's future
 * `delegate_to_<specialist>` tools (Task 2) run the exact same loop, just
 * wired to different callbacks. Pure refactor — no behaviour change: the
 * Sales/Marketing/Operations chat route calls this with `onText`/`onTool`/
 * `onArtifact` wired to its SSE `send()`, so the frames a client receives are
 * unchanged.
 *
 * THE SAFETY PROPERTY THIS PRESERVES: a WRITE tool (per `isWriteTool`) is
 * NEVER executed in here — it is collected into `pendingWrites` and returned
 * to the caller, which is responsible for surfacing it to the operator for an
 * explicit Approve click. Only read tools run inline via `executeTool`. This
 * is the code-level barrier against prompt injection driving a real action —
 * see the comment on `WRITE_TOOLS` in `@/lib/assistant/tools`. Approval POSTs
 * to the shared `/api/assistant/execute`, which re-validates via the same
 * `isWriteTool`/`WRITE_TOOLS` set; that endpoint is untouched by this
 * refactor.
 *
 * Orchestrator Task 2: a READ tool's result can ITSELF carry `pendingWrites`
 * (`ToolResult.pendingWrites?`, @/lib/assistant/tools) — this is how a
 * `delegate_to_<specialist>` tool (@/lib/agents/tools.orchestrator) surfaces
 * writes a DELEGATED specialist's nested `runAgentTurn` deferred. Delegation
 * never bypasses this function's write gate: the specialist's own nested loop
 * defers its writes exactly the same way (delegate tools call this same
 * `runAgentTurn`, recursively), so by the time a write reaches the outer
 * loop's `pendingWrites`, it has already passed through this exact NEVER-
 * execute-a-write branch at least once, possibly twice. The read branch below
 * folds any such nested writes into THIS turn's own `pendingWrites`, so the
 * SAME `if (pendingWrites.length > 0) break` + confirm/Approve path handles a
 * delegated write identically to a direct one — the caller (the chat route)
 * needs no delegation-specific code at all.
 *
 * Concierge Task 1: `artifacts` mirrors `pendingWrites` exactly, one field
 * over, for downloadable/viewable outputs (an invoice-bundle ZIP, a plan doc)
 * instead of deferred writes. A READ tool's single `ToolResult.artifact` AND
 * a delegate's possibly-multiple `ToolResult.artifacts` (bubbled up from a
 * NESTED `runAgentTurn` — e.g. `delegate_to_concierge` running `bundle_invoices`
 * inline) both accumulate into THIS turn's own `artifacts` array, in addition
 * to firing the existing `onArtifact` callback (unchanged — the specialist
 * chat route's SSE stream still gets them live, one at a time, as before).
 * The return value additionally hands the caller the full collected list —
 * new, since previously only `onArtifact` ever saw them — so a delegate tool
 * (which has no SSE stream of its own to push onto) can hand its artifacts
 * back up through its own `ToolResult`, exactly like `pendingWrites`.
 *
 * `assertUnderCap` runs once, before the first model call, and its
 * `AiCapError` is deliberately left to propagate — this function knows
 * nothing about SSE, so callers that need the error+done framing (the chat
 * route) catch `AiCapError` themselves around this call. A delegated
 * specialist's nested `runAgentTurn` call runs this same check again at ITS
 * OWN start, so the cap is enforced at every level of a delegation, not just
 * the top.
 *
 * MP1 (multi-provider model choice): the actual model call used to be inline
 * here (`anthropic.messages.stream(...)`) — it now goes through an injected
 * `ModelProvider` (`provider` arg, default `getProvider(model)`; see
 * @/lib/ai/providers), so this loop no longer hard-codes the Anthropic SDK.
 * Nothing else on this page changed: the loop still drives a
 * provider-neutral `NeutralMessage[]` conversation, and tool dispatch / the
 * write gate / metering / artifact collection all still live HERE, not in any
 * provider. See .superpowers/sdd/multiprovider-task-1-brief.md for the
 * fidelity mechanism (`NeutralMessage.providerRaw`) that keeps
 * AnthropicProvider's actual wire request byte-for-byte what this function
 * used to send directly.
 */
export async function runAgentTurn(
  args: RunAgentTurnArgs,
): Promise<{ text: string; pendingWrites: PendingWrite[]; artifacts: ToolArtifact[] }> {
  const {
    tenantId,
    agentKey,
    userId,
    model,
    system,
    tools,
    messages,
    signal,
    onText,
    onTool,
    onArtifact,
    maxTurns = 8,
    maxTokens = 16000,
    provider = getProvider(model),
  } = args;

  // Enforce the per-tenant monthly AI spend cap before burning any tokens on
  // this turn. Not caught here — see the doc comment above.
  assertUnderCap(tenantId);

  const convo: NeutralMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let fullText = "";
  const pendingWrites: PendingWrite[] = [];
  const artifacts: ToolArtifact[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) break; // caller disconnected — stop burning tokens

    const r = await provider.streamTurn({ model, system, tools, messages: convo, maxTokens, signal, onText });
    recordUsage(tenantId, agentKey, model, r.usage);
    convo.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls, providerRaw: r.assistantRaw });
    fullText += r.text;

    // A tool call that got cut off by the token limit is malformed — don't
    // feed it back (that just loops). Tell the caller and stop cleanly.
    if (r.stopReason === "max_tokens") {
      onText?.("\n\n_(That response was longer than expected — please ask me to continue or narrow it down.)_");
      break;
    }

    if (r.stopReason === "tool_use") {
      const toolResults: { toolCallId: string; content: string }[] = [];
      for (const call of r.toolCalls) {
        if (isWriteTool(call.name)) {
          // NEVER execute a write in the loop. Collect it and hand it back
          // to the caller for an explicit Approve click.
          pendingWrites.push({ name: call.name, input: call.input, summary: summarizeToolAction(call.name, call.input) });
        } else {
          onTool?.(call.name);
          const tr = await executeTool(call.name, call.input, { tenantId, userId });
          if (tr.artifact) { artifacts.push(tr.artifact); onArtifact?.(tr.artifact); }
          // A delegate_to_<specialist> tool's result can carry MULTIPLE
          // artifacts (its own nested runAgentTurn's whole `artifacts`
          // list) rather than the single `tr.artifact` a normal tool
          // produces — fold each into this turn's own list, same as below.
          if (tr.artifacts?.length) { for (const a of tr.artifacts) { artifacts.push(a); onArtifact?.(a); } }
          // A delegate_to_<specialist> tool is a READ (it never itself
          // mutates anything) whose result can carry the DELEGATED
          // specialist's own deferred writes — fold them into this turn's
          // pendingWrites so they hit the same confirm/Approve path as a
          // direct write below. The model still sees the normal tool_result
          // text either way (the human-readable summary), so it can keep
          // reasoning/synthesising across delegations before this turn ends.
          if (tr.pendingWrites?.length) pendingWrites.push(...tr.pendingWrites);
          toolResults.push({ toolCallId: call.id, content: tr.text });
        }
      }
      if (pendingWrites.length > 0) break; // wait for the caller to approve/cancel
      convo.push({ role: "user", content: "", toolResults });
      continue;
    }

    break;
  }

  return { text: fullText, pendingWrites, artifacts };
}
