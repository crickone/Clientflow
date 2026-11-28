import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { executeTool, isWriteTool, summarizeToolAction, type ToolArtifact } from "@/lib/assistant/tools";
import { assertAiAllowed, meterAndCharge } from "@/lib/ai/usage";
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
 * The agent tool-use loop, extracted (Orchestrator Task 1) from
 * `/api/agents/[key]/chat`. The chat route calls this with `onText`/`onTool`/
 * `onArtifact` wired to its SSE `send()`; Adonis is the only agent that runs it
 * today.
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
 * A READ tool's result can ITSELF carry `pendingWrites`
 * (`ToolResult.pendingWrites?`, @/lib/assistant/tools) — the bubble-up path for
 * a NESTED `runAgentTurn`'s deferred writes: the read branch below folds them
 * into THIS turn's own `pendingWrites`, so the SAME `if (pendingWrites.length >
 * 0) break` + confirm/Approve path handles a bubbled-up write identically to a
 * direct one. draft_program_from_file uses it: it reads a program
 * spreadsheet and proposes one create_workout_program write. Since the loop
 * stops for approval before the model reads that tool's result, the result's
 * text is added to the reply so the operator sees what the card holds.
 *
 * `artifacts` mirrors `pendingWrites` exactly, one field over, for
 * downloadable/viewable outputs (an invoice-bundle ZIP, a plan doc) instead of
 * deferred writes. A READ tool's single `ToolResult.artifact` AND a nested
 * turn's possibly-multiple `ToolResult.artifacts` both accumulate into THIS
 * turn's own `artifacts` array, in addition to firing the `onArtifact`
 * callback (the chat route's SSE stream gets them live, one at a time). The
 * return value also hands the caller the full collected list. Same status as
 * `pendingWrites` above: `ToolResult.artifacts` was the delegate bubble-up path
 * (now removed) — kept as defensive plumbing.
 *
 * `assertAiAllowed` runs once, before the first model call (free monthly
 * tranche, or prepaid AI credits), and its `AiCapError` is deliberately left to
 * propagate — this function knows nothing about SSE, so callers that need the
 * error+done framing (the chat route) catch `AiCapError` themselves around this
 * call. Per-turn `meterAndCharge` records usage and bills any overflow beyond
 * the tranche to credits.
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

  // Gate the tenant (free monthly tranche, or prepaid AI credits) before
  // burning any tokens on this turn. Not caught here — see the doc comment above.
  assertAiAllowed(tenantId);

  const convo: NeutralMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  let fullText = "";
  const pendingWrites: PendingWrite[] = [];
  const artifacts: ToolArtifact[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) break; // caller disconnected or stopped — start no new model call

    // `signal` is deliberately NOT given to the provider: a model call that
    // has started runs to the end so `meterAndCharge` below always records
    // it (every paid AI call is metered). The signal only stops the NEXT
    // call from starting. A caller that must stop showing words at once
    // (the chat's Stop) stops listening instead; see conversation.ts `drive`.
    const r = await provider.streamTurn({ model, system, tools, messages: convo, maxTokens, onText });
    meterAndCharge(tenantId, agentKey, model, r.usage);
    convo.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls, providerRaw: r.assistantRaw });
    fullText += r.text;

    // Stopped while that call ran: run none of its tools. Any writes it
    // asked for are dropped with it.
    if (signal?.aborted) break;

    // A tool call that got cut off by the token limit is malformed — don't
    // feed it back (that just loops). Tell the caller and stop cleanly.
    if (r.stopReason === "max_tokens") {
      // Part of the reply too, or it shows while streaming and then vanishes
      // when the caller replaces the streamed words with `text`.
      const note = "\n\n_(That response was longer than expected — please ask me to continue or narrow it down.)_";
      fullText += note;
      onText?.(note);
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
          // Pass this loop's `model` as `callerModel` so a tool that runs a
          // nested loop without its own agent record could inherit THIS agent's
          // configured model instead of a hardcoded one. (No current tool does;
          // the field is harmless — see ToolContext in @/lib/assistant/tools.)
          const tr = await executeTool(call.name, call.input, { tenantId, userId, callerModel: model, agentKey });
          if (tr.artifact) { artifacts.push(tr.artifact); onArtifact?.(tr.artifact); }
          // A nested runAgentTurn's result can carry MULTIPLE artifacts (its own
          // whole `artifacts` list) rather than the single `tr.artifact` a
          // normal tool produces — fold each into this turn's own list.
          // Defensive: no in-tree tool produces a nested turn now (the
          // delegation layer that did was removed).
          if (tr.artifacts?.length) { for (const a of tr.artifacts) { artifacts.push(a); onArtifact?.(a); } }
          // A READ tool's result can carry deferred writes of its own (today
          // draft_program_from_file's create_workout_program) — fold them into
          // this turn's pendingWrites so they hit the same confirm/Approve
          // path as a direct write below.
          if (tr.pendingWrites?.length) {
            pendingWrites.push(...tr.pendingWrites);
            // The loop stops below before the model reads this result, so its
            // text (what the card is, anything to check) is shown to the
            // operator as part of the reply instead of being lost.
            // draft_program_from_file is the tool that does this.
            if (tr.text.trim()) {
              const note = `${fullText.trim() ? "\n\n" : ""}${tr.text.trim()}`;
              fullText += note;
              onText?.(note);
            }
          }
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
