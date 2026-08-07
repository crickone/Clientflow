import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { executeTool, isWriteTool, summarizeToolAction } from "@/lib/assistant/tools";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";

/**
 * One write tool call collected instead of executed. Same `{ name, input,
 * summary }` shape the chat route has always deferred to the UI's
 * Approve/Cancel flow (`confirm` SSE frame -> POST /api/assistant/execute).
 */
export type PendingWrite = { name: string; input: Record<string, unknown>; summary: string };

export interface RunAgentTurnArgs {
  // Injected rather than constructed in here — the route passes the real
  // getAnthropic() client, tests pass a stub. This is what makes the loop
  // testable without an actual Anthropic API call.
  anthropic: Anthropic;
  tenantId: number;
  agentKey: string; // metering key for recordUsage — the specialist's registry key
  userId?: number;
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[]; // initial conversation
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onTool?: (name: string) => void;
  onArtifact?: (artifact: Record<string, unknown>) => void;
  maxTurns?: number; // default 8
  maxTokens?: number; // default 16000
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
 * `assertUnderCap` runs once, before the first model call, and its
 * `AiCapError` is deliberately left to propagate — this function knows
 * nothing about SSE, so callers that need the error+done framing (the chat
 * route) catch `AiCapError` themselves around this call.
 */
export async function runAgentTurn(
  args: RunAgentTurnArgs,
): Promise<{ text: string; pendingWrites: PendingWrite[] }> {
  const {
    anthropic,
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
  } = args;

  // Enforce the per-tenant monthly AI spend cap before burning any tokens on
  // this turn. Not caught here — see the doc comment above.
  assertUnderCap(tenantId);

  const convo: Anthropic.MessageParam[] = [...messages];
  let fullText = "";
  const pendingWrites: PendingWrite[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) break; // caller disconnected — stop burning tokens

    const stream = anthropic.messages.stream({
      model,
      // Full nutrition/workout plans serialise to large tool inputs; 4096 was
      // truncating them mid-JSON, which failed and made the model retry.
      max_tokens: maxTokens,
      system,
      tools,
      messages: convo,
    });
    stream.on("text", (delta) => {
      fullText += delta;
      onText?.(delta);
    });
    const final = await stream.finalMessage();
    recordUsage(tenantId, agentKey, model, {
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      cacheReadTokens: (final.usage as any).cache_read_input_tokens ?? 0,
      cacheCreateTokens: (final.usage as any).cache_creation_input_tokens ?? 0,
    });
    convo.push({ role: "assistant", content: final.content });

    // A tool call that got cut off by the token limit is malformed — don't
    // feed it back (that just loops). Tell the caller and stop cleanly.
    if (final.stop_reason === "max_tokens") {
      onText?.("\n\n_(That response was longer than expected — please ask me to continue or narrow it down.)_");
      break;
    }

    if (final.stop_reason === "tool_use") {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of final.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          if (isWriteTool(block.name)) {
            // NEVER execute a write in the loop. Collect it and hand it back
            // to the caller for an explicit Approve click.
            pendingWrites.push({ name: block.name, input, summary: summarizeToolAction(block.name, input) });
          } else {
            onTool?.(block.name);
            const r = await executeTool(block.name, input, { tenantId, userId });
            if (r.artifact) onArtifact?.(r.artifact);
            results.push({ type: "tool_result", tool_use_id: block.id, content: r.text });
          }
        }
      }
      if (pendingWrites.length > 0) break; // wait for the caller to approve/cancel
      convo.push({ role: "user", content: results });
      continue;
    }

    break;
  }

  return { text: fullText, pendingWrites };
}
