import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "@/lib/ai/client";

import type { ModelProvider, NeutralMessage, ProviderTurnResult, StreamTurnArgs } from "./types";

/**
 * MP1: the Anthropic call that used to be inline in `runAgentTurn` (see
 * .superpowers/sdd/multiprovider-task-1-brief.md), moved behind
 * `ModelProvider` unchanged in substance — same `getAnthropic().messages.
 * stream({model, max_tokens, system, tools, messages})` call, same
 * text-delta streaming, same usage field mapping (including the
 * cache_read/cache_creation-fields-may-be-absent fallback to 0). `
 * getAnthropic()` remains the ONE Anthropic client for the whole app; this is
 * now the only file that calls it for an agent chat turn.
 *
 * FIDELITY — this is what keeps the actual request byte-for-byte identical to
 * what the pre-MP1 inline loop sent: `runAgentTurn` never asks this class to
 * rebuild an assistant/tool-result message it already has an exact wire copy
 * of. Every assistant NeutralMessage `runAgentTurn` appends after a call to
 * THIS class's `streamTurn` carries `providerRaw: assistantRaw` — this
 * class's own `final.content` from that turn (see the return below) — so on
 * a LATER turn (this same tool-use loop asking the model again after a tool
 * result), `toWireMessage` sends that exact array back unchanged, not a
 * reconstruction of it. Reconstruction (the `else` branches below) only ever
 * fires for a message this class did not itself just produce — i.e. the
 * caller's seed/history messages (e.g. `/api/agents/[key]/chat` replaying a
 * stored transcript), which are always plain text with no tool calls, so
 * there is nothing lossy to reconstruct there either.
 */
/**
 * PROGRESS UPDATES (2026-10-01). On Sonnet 5.5 and Opus 5.5, a note the model
 * writes between tool calls that runs past a sentence or two -- "found three
 * open leads, checking which have replied" -- no longer arrives as a `text`
 * block. It arrives as a `thinking` block, and under the default display its
 * text is EMPTY. Nothing fails; the chat just goes quiet for the length of a
 * multi-step turn and the notes never reach the transcript.
 *
 * `display: "updates"` (beta) returns a short summary of each such note as
 * the block's text while keeping the model's reasoning hidden, so it can be
 * streamed exactly where the old text block was. Only the models that accept
 * it get it: any other model 400s on the field, and the picker can still hold
 * an older id until the tenant migration reaches that database.
 *
 * The field and the header are passed by hand because the pinned SDK (0.95)
 * predates both; the SDK forwards unknown fields and extra headers untouched.
 */
const PROGRESS_UPDATES_MODELS: ReadonlySet<string> = new Set(["claude-sonnet-5-5", "claude-opus-5-5"]);
const PROGRESS_UPDATES_BETA = "thinking-display-updates-2026-08-18";

export class AnthropicProvider implements ModelProvider {
  async streamTurn(args: StreamTurnArgs): Promise<ProviderTurnResult> {
    // `args.signal` is deliberately NOT read here: the pre-MP1 inline loop
    // never wired it into the `.stream()` call either — runAgentTurn only
    // ever checked `signal?.aborted` BETWEEN turns, to skip starting another
    // one, never to cancel one already in flight. Reproducing that exactly
    // means this class must not newly pass `signal` to the SDK call (that
    // would let a request actually abort mid-stream, which is new — and
    // therefore not behaviour-preserving — capability the field only exists
    // on this interface for a future provider to use if it wants to).
    const { model, system, tools, messages, maxTokens, onText } = args;

    const wireMessages: Anthropic.MessageParam[] = messages.map(toWireMessage);

    const progressUpdates = PROGRESS_UPDATES_MODELS.has(model);
    const stream = getAnthropic().messages.stream(
      {
        model,
        // Full nutrition/workout plans serialise to large tool inputs; 4096 was
        // truncating them mid-JSON, which failed and made the model retry.
        max_tokens: maxTokens,
        system,
        tools,
        messages: wireMessages,
        ...(progressUpdates
          ? { thinking: { type: "adaptive", display: "updates" } as unknown as Anthropic.ThinkingConfigParam }
          : {}),
      },
      progressUpdates ? { headers: { "anthropic-beta": PROGRESS_UPDATES_BETA } } : undefined,
    );
    let text = "";
    const emit = (delta: string) => {
      text += delta;
      onText?.(delta);
    };
    stream.on("text", emit);
    if (progressUpdates) {
      // Under "updates" the only thinking text that comes back is the progress
      // notes -- the reasoning itself stays empty -- so every delta here is
      // something the user is meant to read.
      stream.on("thinking", (delta) => emit(delta));
      // A paragraph break after each note, so it doesn't run straight into
      // the text of the turn that follows the tool call.
      stream.on("contentBlock", (block) => {
        if (block.type === "thinking" && block.thinking) emit("\n\n");
      });
    }
    const final = await stream.finalMessage();

    const toolCalls = final.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input as Record<string, unknown> }));

    return {
      text,
      toolCalls,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        // `as any`: the exact cast the pre-extraction inline loop used — kept
        // verbatim rather than tightened, per the task's behaviour-preserving
        // brief (these fields ARE typed on Usage in the current SDK, but the
        // cast is harmless and this is a pure move, not a cleanup).
        cacheReadTokens: (final.usage as any).cache_read_input_tokens ?? 0,
        cacheCreateTokens: (final.usage as any).cache_creation_input_tokens ?? 0,
      },
      stopReason:
        final.stop_reason === "tool_use" ? "tool_use" : final.stop_reason === "max_tokens" ? "max_tokens" : "end",
      // Reused verbatim next turn if this exact message comes back around as
      // input — see the class doc comment + NeutralMessage.providerRaw.
      assistantRaw: final.content,
    };
  }
}

/**
 * NeutralMessage -> Anthropic.MessageParam. Reuses `providerRaw` whenever
 * it's set (see the class doc comment); otherwise reconstructs the
 * equivalent Anthropic shape from the neutral fields alone.
 */
function toWireMessage(m: NeutralMessage): Anthropic.MessageParam {
  if (m.providerRaw !== undefined) {
    return { role: m.role, content: m.providerRaw as Anthropic.MessageParam["content"] };
  }
  if (m.role === "user" && m.toolResults?.length) {
    const blocks: Anthropic.ToolResultBlockParam[] = m.toolResults.map((r) => ({
      type: "tool_result",
      tool_use_id: r.toolCallId,
      content: r.content,
    }));
    return { role: "user", content: blocks };
  }
  if (m.role === "assistant") {
    const blocks: Anthropic.ContentBlockParam[] = [];
    // A real Anthropic assistant turn never carries an empty text block (a
    // tool-only turn has no text block at all) — guard the same way here
    // rather than always pushing one, so a reconstruction can't send a shape
    // the real API would never have produced itself.
    if (m.content) blocks.push({ type: "text", text: m.content });
    for (const call of m.toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    return { role: "assistant", content: blocks };
  }
  // Plain user text — kept as a raw string (not a 1-element content-block
  // array), matching exactly how every caller's seed/history messages have
  // always been shaped.
  return { role: "user", content: m.content };
}
