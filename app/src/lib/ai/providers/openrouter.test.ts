// Run: npm test -- src/lib/ai/providers/openrouter.test.ts
//
// MP2 unit tests for OpenRouterProvider's PURE pieces: the two wire-format
// conversion helpers (toOpenAITools, toOpenAIMessages) and the SSE-stream
// assembler (parseOpenRouterStream), plus getProvider's OPENROUTER_API_KEY
// gate. Deliberately does NOT exercise OpenRouterProvider.streamTurn's actual
// `fetch` call — there is no OpenRouter key in this environment, and the
// brief for this task defers the live end-to-end call (same spirit as
// anthropic.test.ts never hitting the real Anthropic network — see that
// file). `parseOpenRouterStream` is structured to take a plain iterable of
// SSE lines precisely so it can be tested directly with sample chunk
// strings, with no fetch/Response/ReadableStream involved at all.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";

import { getProvider } from "./index";
import {
  OPENROUTER_MISSING_KEY_ERROR,
  OpenRouterProvider,
  parseOpenRouterStream,
  toOpenAIMessages,
  toOpenAITools,
} from "./openrouter";
import type { NeutralMessage } from "./types";

/**
 * Wraps a plain array as a real async generator, so at least one test below
 * proves the parser works over an actual async iterable (what `streamTurn`
 * feeds it from a live fetch body), not just a plain array — `for await...of`
 * accepts both, and every other test here uses a plain array for brevity.
 */
async function* toAsyncIterable<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // toOpenAITools: Anthropic's canonical Tool[] -> OpenAI's `functions` shape.
  // ════════════════════════════════════════════════════════════════════
  {
    const inputSchema = { type: "object" as const, properties: { location: { type: "string" } }, required: ["location"] };
    const tools = toOpenAITools([{ name: "get_weather", description: "Look up the weather.", input_schema: inputSchema }]);
    assert.deepEqual(tools, [
      { type: "function", function: { name: "get_weather", description: "Look up the weather.", parameters: inputSchema } },
    ]);
  }

  // ════════════════════════════════════════════════════════════════════
  // toOpenAIMessages: system leads; plain user text passes through; an
  // assistant turn's toolCalls become `tool_calls` with STRINGIFIED
  // `arguments`; a toolResults turn becomes one role:"tool" message PER
  // result (never one message bundling N results).
  // ════════════════════════════════════════════════════════════════════
  {
    const messages: NeutralMessage[] = [
      { role: "user", content: "What's the weather in Cork and Dublin?" },
      {
        role: "assistant",
        content: "Let me check both.",
        toolCalls: [
          { id: "call_1", name: "get_weather", input: { location: "Cork" } },
          { id: "call_2", name: "get_weather", input: { location: "Dublin" } },
        ],
      },
      {
        role: "user",
        content: "",
        toolResults: [
          { toolCallId: "call_1", content: "14C, cloudy" },
          { toolCallId: "call_2", content: "12C, rain" },
        ],
      },
    ];
    const out = toOpenAIMessages("You are a helpful assistant.", messages);
    assert.deepEqual(out, [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What's the weather in Cork and Dublin?" },
      {
        role: "assistant",
        content: "Let me check both.",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_weather", arguments: JSON.stringify({ location: "Cork" }) } },
          { id: "call_2", type: "function", function: { name: "get_weather", arguments: JSON.stringify({ location: "Dublin" }) } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "14C, cloudy" },
      { role: "tool", tool_call_id: "call_2", content: "12C, rain" },
    ]);
  }

  // An assistant turn with NO tool calls: content is null when empty, and
  // the `tool_calls` key is OMITTED entirely (not present-with-undefined or
  // present-as-[]) — a real OpenAI assistant message never carries an empty
  // array here.
  {
    const out = toOpenAIMessages("sys", [{ role: "assistant", content: "" }]);
    assert.deepEqual(out, [
      { role: "system", content: "sys" },
      { role: "assistant", content: null },
    ]);
    assert.ok(!("tool_calls" in out[1]), "tool_calls key is absent, not present-and-empty");
  }

  // Fidelity: providerRaw, when present, is reused by EXACT object
  // reference — never rebuilt from content/toolCalls/toolResults, and
  // checked BEFORE any role-specific logic. This is what keeps a real
  // multi-turn OpenRouter request byte-for-byte identical to what the model
  // actually produced (mirrors anthropic.test.ts's fidelity tests for
  // AnthropicProvider's own toWireMessage).
  {
    const rawAssistant = {
      role: "assistant" as const,
      content: null,
      tool_calls: [{ id: "call_9", type: "function" as const, function: { name: "lookup", arguments: '{"broken' } }],
    };
    const out = toOpenAIMessages("sys", [
      { role: "assistant", content: "", toolCalls: [{ id: "call_9", name: "lookup", input: {} }], providerRaw: rawAssistant },
    ]);
    assert.equal(out[1], rawAssistant, "assistant providerRaw reused by exact object reference, not rebuilt");

    const rawToolMessages = [
      { role: "tool" as const, tool_call_id: "call_9", content: "result A" },
      { role: "tool" as const, tool_call_id: "call_10", content: "result B" },
    ];
    const out2 = toOpenAIMessages("sys", [
      { role: "user", content: "", toolResults: [{ toolCallId: "call_9", content: "result A" }], providerRaw: rawToolMessages },
    ]);
    assert.deepEqual(out2.slice(1), rawToolMessages, "toolResults providerRaw ARRAY is spread back verbatim (2 wire messages from 1 NeutralMessage)");
    assert.equal(out2[1], rawToolMessages[0], "...by exact reference, not a copy");
  }

  // ════════════════════════════════════════════════════════════════════
  // parseOpenRouterStream: text deltas accumulate + fire onText live; a
  // tool_call streamed across 3 fragments assembles correctly; a stray
  // SSE comment/keep-alive line and a blank line are ignored; the final
  // usage chunk maps to ProviderUsage; finish_reason "tool_calls" ->
  // "tool_use"; assistantRaw round-trips the RAW (unparsed) arguments string.
  // ════════════════════════════════════════════════════════════════════
  {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: ", world!" }, finish_reason: null }] })}`,
      `: OPENROUTER PROCESSING`, // SSE comment/keep-alive line — must be ignored, not crash the parser
      "",
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, id: "call_abc", function: { name: "get_weather", arguments: "" } }] },
            finish_reason: null,
          },
        ],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"location":' } }] }, finish_reason: null }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"Cork"}' } }] }, finish_reason: "tool_calls" }],
      })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, cost: 0.00041 } })}`,
      "data: [DONE]",
    ];
    const deltas: string[] = [];
    const result = await parseOpenRouterStream(toAsyncIterable(chunks), (d) => deltas.push(d));

    assert.deepEqual(deltas, ["Hello", ", world!"], "onText receives every content delta in order");
    assert.equal(result.text, "Hello, world!", "text is the deltas accumulated");
    assert.deepEqual(
      result.toolCalls,
      [{ id: "call_abc", name: "get_weather", input: { location: "Cork" } }],
      "tool_call fragments assembled by index into one call, arguments JSON-parsed into input",
    );
    assert.equal(result.stopReason, "tool_use", 'finish_reason "tool_calls" -> "tool_use"');
    assert.deepEqual(
      result.usage,
      { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheCreateTokens: 0 },
      "usage maps prompt_tokens/completion_tokens; cache fields are always 0 for OpenRouter",
    );
    assert.deepEqual(
      result.assistantRaw,
      {
        role: "assistant",
        content: "Hello, world!",
        tool_calls: [{ id: "call_abc", type: "function", function: { name: "get_weather", arguments: '{"location":"Cork"}' } }],
      },
      "assistantRaw is the exact OpenAI assistant message to resend next turn, arguments as the RAW concatenated string",
    );
  }

  // Multiple tool calls, assembled out of arrival order (index 1's fragment
  // arrives before index 0 is confirmed complete) still come back in INDEX
  // order — "preserve order" per the brief means call order, not arrival
  // order of fragments.
  {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "first", arguments: "{}" } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "second", arguments: "{}" } }] } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}`,
      "data: [DONE]",
    ];
    const result = await parseOpenRouterStream(chunks);
    assert.deepEqual(
      result.toolCalls.map((c) => c.name),
      ["first", "second"],
      "assembled calls are emitted in index order",
    );
  }

  // finish_reason "length" -> stopReason "max_tokens"; a pure-text turn with
  // no tool calls omits `tool_calls` from assistantRaw entirely.
  {
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "cut off" }, finish_reason: null }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}`,
      "data: [DONE]",
    ];
    const result = await parseOpenRouterStream(chunks);
    assert.equal(result.stopReason, "max_tokens");
    assert.deepEqual(result.toolCalls, []);
    assert.ok(!("tool_calls" in (result.assistantRaw as object)), "no tool calls -> assistantRaw omits the tool_calls key");
  }

  // A plain "stop" finish_reason defaults to "end" (same fallback
  // AnthropicProvider applies for any non-tool_use/non-max_tokens reason).
  {
    const chunks = [`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}`, "data: [DONE]"];
    const result = await parseOpenRouterStream(chunks);
    assert.equal(result.stopReason, "end");
  }

  // Malformed tool-call arguments JSON is GUARDED, never thrown: `input`
  // comes back `{}`, but assistantRaw still preserves the model's ORIGINAL
  // (broken) string verbatim — the round-trip never silently "fixes" what
  // the model actually said.
  {
    const chunks = [
      `data: ${JSON.stringify({
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: "call_x", function: { name: "broken_tool", arguments: "{not valid json" } }] },
            finish_reason: "tool_calls",
          },
        ],
      })}`,
      "data: [DONE]",
    ];
    const result = await parseOpenRouterStream(chunks);
    assert.deepEqual(
      result.toolCalls,
      [{ id: "call_x", name: "broken_tool", input: {} }],
      "malformed JSON guarded to {} instead of throwing",
    );
    const raw = result.assistantRaw as { tool_calls: { function: { arguments: string } }[] };
    assert.equal(raw.tool_calls[0].function.arguments, "{not valid json", "assistantRaw preserves the RAW broken string, not a re-stringified {}");
  }

  // ════════════════════════════════════════════════════════════════════
  // getProvider: the OPENROUTER_API_KEY gate. Missing -> throws the clear
  // error (never a silent Anthropic fallback); set -> returns an
  // OpenRouterProvider, and constructing one never itself throws. A
  // claude-* id is untouched (MP1 routing preserved).
  // ════════════════════════════════════════════════════════════════════
  {
    const original = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      assert.throws(
        () => getProvider("openrouter:deepseek/deepseek-chat"),
        { message: OPENROUTER_MISSING_KEY_ERROR },
        "missing OPENROUTER_API_KEY throws the clear error, not a fallback",
      );

      process.env.OPENROUTER_API_KEY = "test-openrouter-key";
      const provider = getProvider("openrouter:deepseek/deepseek-chat");
      assert.ok(provider instanceof OpenRouterProvider, "OPENROUTER_API_KEY set -> an OpenRouterProvider, no throw at construction");

      const anthropicRoute = getProvider("claude-sonnet-5");
      assert.ok(!(anthropicRoute instanceof OpenRouterProvider), "a claude-* id never routes to OpenRouterProvider (MP1 behaviour preserved)");
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = original;
    }
  }

  // streamTurn's OWN key guard (defense in depth for a directly-constructed
  // instance that bypasses getProvider) fires too — and does so BEFORE any
  // `fetch` call, so this is still zero-network: the throw happens on the
  // very first line of streamTurn.
  {
    const original = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      const directProvider = new OpenRouterProvider();
      await assert.rejects(
        directProvider.streamTurn({ model: "openrouter:x/y", system: "s", tools: [], messages: [], maxTokens: 100 }),
        { message: OPENROUTER_MISSING_KEY_ERROR },
        "streamTurn's own guard rejects before ever reaching fetch",
      );
    } finally {
      if (original === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = original;
    }
  }

  console.log("ai/providers/openrouter.test.ts: all assertions passed");
})();
