import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import type { ModelProvider, NeutralMessage, ProviderTurnResult, StreamTurnArgs } from "./types";

/**
 * MP2 (multi-provider model choice): OpenRouterProvider — see
 * .superpowers/sdd/multiprovider-design.md +
 * .superpowers/sdd/multiprovider-task-2-brief.md. OpenRouter speaks the
 * OpenAI-compatible `/chat/completions` wire format (`functions`/`tool_calls`,
 * separate `role:"tool"` result messages, `prompt_tokens`/`completion_tokens`
 * usage) instead of Anthropic's content-block shape — this file owns ONLY
 * that wire conversion + the SSE streaming call. Tool dispatch, the
 * write-approval gate, and per-turn metering all stay in `runAgentTurn`
 * (@/lib/agents/runAgentTurn), completely unaware this provider exists: it
 * calls `provider.streamTurn(...)` and gets back the exact same
 * `ProviderTurnResult` shape AnthropicProvider returns, so the gate (a write
 * tool call -> pendingWrites, never executed) and the €25/tenant cap
 * (recordUsage on `usage`) apply to OpenRouter models automatically — see
 * that file's doc comment for the safety property this preserves.
 *
 * FIDELITY: like AnthropicProvider's `providerRaw`/`assistantRaw` pair (see
 * that file's doc comment + ./types's `NeutralMessage.providerRaw`),
 * `streamTurn` below returns `assistantRaw` as the EXACT OpenAI assistant
 * message (`{role:"assistant", content, tool_calls}`) this call produced —
 * each tool call's `arguments` is the RAW string concatenated from the
 * model's own streamed fragments, never a re-`JSON.stringify`'d version of
 * the parsed `input` — so a later turn resending it via `toOpenAIMessages`'s
 * `providerRaw` branch reproduces this exact request, byte for byte, even if
 * the model's own JSON was malformed (nothing here "fixes" what the model
 * actually said).
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Thrown by both `getProvider` (the primary gate — see ./index.ts) and this
 * class's own `streamTurn` (defense in depth for a directly-constructed
 * instance, e.g. a future caller that bypasses getProvider). NEVER a silent
 * fallback to Anthropic — that would run and bill a different model than the
 * one the picker requested. See the design doc's non-negotiables.
 */
export const OPENROUTER_MISSING_KEY_ERROR = "OpenRouter is not configured (missing OPENROUTER_API_KEY).";

// ─────────────────────────────────────────────────────────────────────────
// OpenAI-compatible wire types — the minimal shape this file actually reads
// and writes, not the full OpenAI API surface.
// ─────────────────────────────────────────────────────────────────────────

export type OpenAITool = { type: "function"; function: { name: string; description?: string; parameters: unknown } };

type OpenAIToolCallWire = { id: string; type: "function"; function: { name: string; arguments: string } };

/** The exact shape stashed on `NeutralMessage.providerRaw` for an assistant turn — see the file doc comment's FIDELITY note. */
export type OpenAIAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCallWire[];
};

export type OpenAIWireMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | OpenAIAssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAIStreamChunk {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  // Present on OpenRouter's final chunk when the request body asked for
  // `usage: { include: true }` (see streamTurn below). `cost` is OpenRouter's
  // actual USD spend for this call — see the note where it's read below.
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Pure conversion helpers — exported for unit testing (openrouter.test.ts).
// No network, no environment reads: safe to call from anywhere.
// ─────────────────────────────────────────────────────────────────────────

/** Anthropic's canonical `Tool[]` (what every caller of runAgentTurn already builds — see StreamTurnArgs.tools) -> OpenAI's `functions` shape. */
export function toOpenAITools(tools: Anthropic.Tool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/**
 * NeutralMessage[] -> the OpenAI messages array for one request, `system`
 * leading. Mirrors AnthropicProvider's `toWireMessage`: `providerRaw` is
 * checked FIRST, unconditionally, for every message — whenever it is set
 * (this provider's own prior output, stashed there by `runAgentTurn`; see
 * NeutralMessage's doc comment in ./types), that EXACT value is resent
 * verbatim instead of ever being rebuilt from
 * `content`/`toolCalls`/`toolResults`. Unlike Anthropic (one NeutralMessage
 * <-> one wire message), OpenAI needs ONE `role:"tool"` message PER tool
 * result, so a toolResults message's `providerRaw` is the ARRAY of those wire
 * messages rather than a single object — distinguished with `Array.isArray`
 * and spread back in, not pushed as one. (In practice `runAgentTurn` never
 * stamps a providerRaw on a toolResults message — see its doc comment — so
 * that half mainly matters for a hypothetical caller that seeds one
 * directly; handled anyway, for the same reason AnthropicProvider does.)
 */
export function toOpenAIMessages(system: string, messages: NeutralMessage[]): OpenAIWireMessage[] {
  const out: OpenAIWireMessage[] = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.providerRaw !== undefined) {
      if (Array.isArray(m.providerRaw)) out.push(...(m.providerRaw as OpenAIWireMessage[]));
      else out.push(m.providerRaw as OpenAIWireMessage);
      continue;
    }

    if (m.role === "user" && m.toolResults?.length) {
      for (const r of m.toolResults) {
        out.push({ role: "tool", tool_call_id: r.toolCallId, content: r.content });
      }
      continue;
    }

    if (m.role === "assistant") {
      // A real OpenAI assistant turn never carries an empty tool_calls array
      // — omit the key entirely rather than set it to `undefined`/`[]`, same
      // guard AnthropicProvider applies to its own text block.
      const toolCalls = m.toolCalls?.length
        ? m.toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          }))
        : undefined;
      out.push({ role: "assistant", content: m.content || null, ...(toolCalls ? { tool_calls: toolCalls } : {}) });
      continue;
    }

    // Plain user text — the only shape runAgentTurn's own seed messages and
    // its post-tool-result-less user turns ever take.
    out.push({ role: "user", content: m.content });
  }

  return out;
}

/**
 * Malformed/truncated JSON (e.g. a tool call cut off mid-argument by
 * max_tokens) never throws the whole turn away — the model just gets `{}`
 * back as that one call's `input`. Not exported: exercised via the
 * SSE-parsing tests below with a deliberately-broken `arguments` fragment.
 */
function safeJsonParse(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Consumes an OpenAI-compatible SSE stream — an (async OR sync) iterable of
 * RAW lines, each either `data: {json}`, the terminal `data: [DONE]`, or a
 * non-`data:` line to ignore (OpenRouter periodically sends `: OPENROUTER
 * PROCESSING`-style comment/keep-alive lines on long-running requests; blank
 * lines separate SSE events too) — and assembles the normalised
 * `ProviderTurnResult`. `for await...of` works over a plain array just as
 * well as a real async generator, which is what makes this directly
 * unit-testable with sample chunk strings and NO network at all; `streamTurn`
 * below is the only caller that feeds it a REAL stream (via `sseLines`,
 * reading the fetch response body) — that plumbing is deliberately NOT
 * exercised by openrouter.test.ts (no network in tests; see the file-level
 * brief).
 *
 * Tool calls stream as fragments keyed by `index` (`id` + `function.name`
 * typically arrive whole in the first fragment, `function.arguments`
 * accumulates char-by-char or in bursts across many more) — assembled here
 * into one entry per index, then emitted in index order regardless of the
 * order fragments for DIFFERENT calls interleave in.
 */
export async function parseOpenRouterStream(
  lines: AsyncIterable<string> | Iterable<string>,
  onText?: (delta: string) => void,
): Promise<ProviderTurnResult> {
  let text = "";
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason: string | null | undefined;
  let usage: OpenAIStreamChunk["usage"];

  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue; // blank lines / SSE comment or keep-alive lines between chunks
    const payload = line.slice("data:".length).trim();
    if (payload === "[DONE]") break;

    let chunk: OpenAIStreamChunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue; // a stray non-JSON data line — never abort the whole turn over it
    }

    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) {
      text += choice.delta.content;
      onText?.(choice.delta.content);
    }
    for (const tc of choice?.delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const entry = calls.get(idx) ?? { id: "", name: "", arguments: "" };
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name += tc.function.name;
      if (tc.function?.arguments) entry.arguments += tc.function.arguments;
      calls.set(idx, entry);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    // OpenRouter's final chunk (once `usage: { include: true }` was requested
    // in the request body — see streamTurn) carries `{prompt_tokens,
    // completion_tokens, cost}`. `cost` — OpenRouter's actual USD spend for
    // this call — is captured here as part of `usage` but not propagated
    // into the return value below: `ProviderTurnResult` (MP1's shape, left
    // unchanged by this task per its brief) has no field for it yet.
    // TODO(MP3): wire real OpenRouter cost into metering instead of the
    // token-count estimate `recordUsage` uses today.
    if (chunk.usage) usage = chunk.usage;
  }

  const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  const toolCalls = ordered.map((c) => ({ id: c.id, name: c.name, input: safeJsonParse(c.arguments) }));

  const assistantRaw: OpenAIAssistantMessage = {
    role: "assistant",
    content: text || null,
    ...(ordered.length
      ? {
          tool_calls: ordered.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: c.arguments },
          })),
        }
      : {}),
  };

  return {
    text,
    toolCalls,
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
    },
    stopReason: finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end",
    assistantRaw,
  };
}

/**
 * Decodes a fetch response body into raw SSE lines. Network-facing (only
 * `streamTurn` calls this, with a real body) — deliberately NOT exercised by
 * openrouter.test.ts, which feeds `parseOpenRouterStream` sample lines
 * directly instead (see that function's doc comment + the brief's "NO
 * network calls in tests").
 */
async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        yield buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
      }
    }
    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/**
 * C3 (Batch 3bc — .superpowers/sdd/batch3bc-brief.md, improvement-plan-2026-08.md
 * Theme C3): the Anthropic SDK retries 408/409/429/5xx twice by default;
 * OpenRouter-backed models (DeepSeek/Kimi/GPT-5/Gemini/Qwen) had NO retry at
 * all — `streamTurn` threw immediately on any non-OK response, failing a
 * whole agent turn on one transient blip. This is that same safety net,
 * scoped ENTIRELY to this provider's own HTTP call: it doesn't touch the
 * streaming contract (`ProviderTurnResult`) or `runAgentTurn` — the
 * write-approval gate and the per-tenant cap upstream neither know nor care
 * how this provider got its response.
 *
 * Retries up to 2 times (3 attempts total) on HTTP 429 or any 5xx, and on a
 * network-level `fetch` failure (DNS/connection reset/etc.) — but NEVER on
 * any other 4xx (400/401/403/404/...: not transient, retrying just repeats
 * the same error) and NEVER once the caller's own `AbortSignal` has fired (a
 * deliberate cancellation is not a blip to retry through). Backoff is
 * exponential with full jitter (attempt 0: 0-300ms, attempt 1: 0-600ms)
 * UNLESS the response carries a `Retry-After` header, which — being the
 * server's own authoritative wait — is honoured instead of the computed
 * backoff. On final failure this throws the EXACT SAME error shape
 * `streamTurn` always has for an HTTP failure; a network failure rethrows
 * whatever `fetch` itself threw (there was never an existing "shape" for
 * that case to preserve).
 */
const MAX_ATTEMPTS = 3; // 1 initial call + 2 retries
const BASE_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429 or any 5xx is treated as transient; every OTHER 4xx is not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** RFC 7231 Retry-After: either delta-seconds or an HTTP-date. Null when absent/unparseable — the caller falls back to its own backoff. */
function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - Date.now());
}

/** Exponential backoff with full jitter: attempt 0 -> 0-300ms, attempt 1 -> 0-600ms, ... */
function backoffMs(attempt: number): number {
  return Math.random() * BASE_DELAY_MS * 2 ** attempt;
}

/**
 * POSTs to OpenRouter with up to `MAX_ATTEMPTS` tries — see the retry policy
 * doc comment above. Not exported: `streamTurn` below is the only caller;
 * openrouter.test.ts exercises the policy through `OpenRouterProvider` itself
 * (injecting a fake `globalThis.fetch`), the same black-box way every other
 * provider-level behaviour in this file is tested.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (init.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

    const lastAttempt = attempt === MAX_ATTEMPTS - 1;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (lastAttempt || init.signal?.aborted) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.ok) return res;
    if (lastAttempt || !isRetryableStatus(res.status)) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`);
    }
    // Discarding this response (we're about to retry past it) — release its
    // unread body rather than leave it for GC to eventually close.
    await res.body?.cancel().catch(() => {});
    await sleep(retryAfterMs(res.headers) ?? backoffMs(attempt));
  }
  // Unreachable: every loop iteration above either returns or throws by the
  // time `attempt` reaches `MAX_ATTEMPTS - 1`. Keeps TypeScript satisfied.
  throw new Error("OpenRouter request failed after retries");
}

/**
 * Routes non-Anthropic models through OpenRouter's OpenAI-compatible API.
 * Stateless — identical reasoning to AnthropicProvider (see ./index.ts): all
 * per-call state lives in `StreamTurnArgs`, never on the instance — so one
 * instance serves the whole process. `getProvider` is the PRIMARY
 * `OPENROUTER_API_KEY` gate (thrown before this class is ever asked to run a
 * turn — see that file); the check here is defense in depth only, for a
 * caller that constructs `OpenRouterProvider` directly.
 */
export class OpenRouterProvider implements ModelProvider {
  async streamTurn(args: StreamTurnArgs): Promise<ProviderTurnResult> {
    const { model, system, tools, messages, maxTokens, signal, onText } = args;

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error(OPENROUTER_MISSING_KEY_ERROR);

    const slug = model.startsWith("openrouter:") ? model.slice("openrouter:".length) : model;
    const openAITools = toOpenAITools(tools);

    const res = await fetchWithRetry(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter's recommended attribution headers (identifies the
        // calling app on openrouter.ai's dashboard/rankings) — optional but
        // good practice, per the task brief.
        "HTTP-Referer": "https://app.clientflow.ie",
        "X-Title": "AdonisAgent",
      },
      body: JSON.stringify({
        model: slug,
        messages: toOpenAIMessages(system, messages),
        // Omit entirely rather than send `tools: []`: some OpenAI-compatible
        // backends reject an empty tools array outright.
        ...(openAITools.length ? { tools: openAITools } : {}),
        stream: true,
        max_tokens: maxTokens,
        usage: { include: true },
      }),
      signal,
    });

    // fetchWithRetry only ever resolves with an `ok` response (anything else
    // throws inside it, after the retry policy above has run its course) — an
    // ok response with no body at all is still theoretically possible, so
    // this guard stays as the original code's last line of defense.
    if (!res.body) {
      throw new Error(`OpenRouter request failed (${res.status} ${res.statusText}): empty response body`);
    }

    return parseOpenRouterStream(sseLines(res.body), onText);
  }
}
