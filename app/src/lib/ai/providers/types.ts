import type Anthropic from "@anthropic-ai/sdk";

/**
 * Multi-provider model choice (MP1) — see .superpowers/sdd/multiprovider-design.md
 * + .superpowers/sdd/multiprovider-task-1-brief.md.
 *
 * A single turn in the provider-NEUTRAL conversation `runAgentTurn`
 * (@/lib/agents/runAgentTurn) maintains internally. Every `ModelProvider`
 * converts to/from this shape at its own edge; the shared loop — tool
 * dispatch, the write-approval gate, per-turn metering, the turn cap — never
 * sees a provider-specific wire type (Anthropic content blocks today; an
 * OpenAI-style `tool_calls`/role:"tool" shape once MP2's OpenRouterProvider
 * lands).
 */
export interface NeutralMessage {
  role: "user" | "assistant";
  /** Plain text only. The loop uses this for onText accumulation and the final returned `text` — never a provider-specific block shape. */
  content: string;
  /** Set on an assistant turn that proposed tool calls this turn. */
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  /** Set on a user turn carrying the results of the PRIOR turn's tool calls, in the order they were executed. */
  toolResults?: { toolCallId: string; content: string }[];
  /**
   * OPAQUE. The provider that PRODUCED this message may stash its exact wire
   * representation here (AnthropicProvider stores the real `Message.content`
   * block array it got back from the API — see ProviderTurnResult.assistantRaw)
   * and reuse it VERBATIM the next time this message is sent back to the API,
   * instead of reconstructing an equivalent-but-not-identical version from
   * `content`/`toolCalls`/`toolResults`. This is what guarantees a provider's
   * request stays byte-for-byte what it would have sent before this
   * abstraction existed. A single `runAgentTurn` run calls exactly ONE
   * provider for its whole loop, so a value stashed here never has to be
   * understood by a DIFFERENT provider.
   */
  providerRaw?: unknown;
}

/** Same fields/units `recordUsage` (@/lib/ai/usage) has always taken. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

export interface ProviderTurnResult {
  /** This turn's accumulated assistant text — the same string `onText`'s deltas concatenate to. */
  text: string;
  /** Every tool call the model made this turn, in the order it made them. */
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  usage: ProviderUsage;
  /** "tool_use" -> dispatch toolCalls; "max_tokens" -> the response was truncated; "end" -> a normal finish. */
  stopReason: "tool_use" | "end" | "max_tokens";
  /** This provider's exact assistant wire message, for the caller to stash on NeutralMessage.providerRaw and hand back verbatim next turn — see that field's doc comment. Optional: a provider with nothing worth preserving (nothing lossy about reconstructing from the neutral fields) can leave this undefined. */
  assistantRaw?: unknown;
}

export interface StreamTurnArgs {
  model: string;
  system: string;
  /** Anthropic's `Tool` shape is the one canonical tool schema every caller of runAgentTurn builds; each provider converts it to its own wire format. */
  tools: Anthropic.Tool[];
  messages: NeutralMessage[];
  maxTokens: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}

/**
 * One model turn: send `messages`, stream text live via `onText`, return the
 * normalised result. An implementation owns ONLY the wire conversion + the
 * actual network call — never tool execution, the write-approval gate, or
 * usage metering (those stay in runAgentTurn, identically for every provider).
 */
export interface ModelProvider {
  streamTurn(args: StreamTurnArgs): Promise<ProviderTurnResult>;
}
