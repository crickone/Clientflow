// Run: npm test -- src/lib/ai/providers/anthropic.test.ts
//
// MP1 unit tests for AnthropicProvider — the one part of the multi-provider
// refactor runAgentTurn.test.ts's fake-ModelProvider tests deliberately do
// NOT exercise (that file injects a fake `ModelProvider` precisely so the
// LOOP's tests never need to know AnthropicProvider exists — see its
// file-level comment). This file is what actually proves AnthropicProvider's
// own wire-conversion behaviour, most importantly the fidelity claim from
// .superpowers/sdd/multiprovider-task-1-brief.md: a NeutralMessage carrying
// `providerRaw` is sent back to the API with that EXACT value (same
// reference), never reconstructed from `content`/`toolCalls` — that is what
// keeps a real multi-turn Anthropic request byte-for-byte identical to what
// the pre-MP1 inline loop sent (it just pushed `final.content` straight back
// onto its own `convo` array; AnthropicProvider does the same thing, just one
// layer further out).
//
// No network call: `getAnthropic()`'s cached Anthropic client is real (a
// real `Anthropic` instance — it needs ANTHROPIC_API_KEY set, faked below if
// absent, but the constructor itself never calls the network), but its
// `.messages.stream` method is monkey-patched to a fake before any test
// runs, so nothing here ever reaches the network. `getAnthropic()` is a
// plain function with no DI seam of its own; patching the one instance
// method AnthropicProvider actually calls, on the exact singleton it
// actually gets back, is simpler than — and just as airtight as — the
// module-mocking shim other test files use for react/next/navigation (which
// this file has no need for: neither AnthropicProvider nor @/lib/ai/client
// touches the tenant DB, react's `cache`, or next/navigation at all, so
// plain static imports are safe here, unlike runAgentTurn.test.ts).
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";

import { getAnthropic } from "../client";
import { AnthropicProvider } from "./anthropic";
import type { NeutralMessage } from "./types";

// getAnthropic() throws without this; the value is never used for a real
// call (the fake `.stream` below is installed before any test runs).
if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = "test-key-anthropic-provider-test";

type FakeFinal = { content: unknown[]; stop_reason: string; usage: Record<string, unknown> };

// Faithful to the real `Anthropic.MessageStream` surface AnthropicProvider
// actually uses: `.on("text", cb)` and `.finalMessage()` — same shape
// runAgentTurn.test.ts's own fake used pre-MP1.
function fakeStream(
  textDeltas: string[],
  final: FakeFinal,
  // Progress updates (Sonnet 5.5 / Opus 5.5): the `thinking` deltas a block
  // streams, and the finished blocks `contentBlock` hands over. Default empty,
  // so every older case below behaves exactly as it always did.
  extra: { thinkingDeltas?: string[]; blocks?: unknown[] } = {},
) {
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === "text") for (const d of textDeltas) cb(d, d);
      if (event === "thinking") for (const d of extra.thinkingDeltas ?? []) cb(d, d);
      if (event === "contentBlock") for (const b of extra.blocks ?? []) cb(b);
      return this;
    },
    finalMessage: async () => final,
  };
}

(async () => {
  const client = getAnthropic();
  const calls: { model: string; messages: unknown[]; thinking?: unknown; headers?: Record<string, string> }[] = [];
  let nextStream: ReturnType<typeof fakeStream> | null = null;
  (client.messages as unknown as { stream: unknown }).stream = (
    params: { model: string; messages: unknown[]; thinking?: unknown },
    options?: { headers?: Record<string, string> },
  ) => {
    calls.push({ model: params.model, messages: [...params.messages], thinking: params.thinking, headers: options?.headers });
    if (!nextStream) throw new Error("anthropic.test.ts: fakeStream not primed before this call");
    return nextStream;
  };

  const provider = new AnthropicProvider();

  // ════════════════════════════════════════════════════════════════════
  // 1. Plain text turn: text accumulates from deltas (in order, via
  //    onText), no tool calls, stopReason "end", usage mapped 1:1, cache
  //    fields default to 0 when the API response omits them, and
  //    assistantRaw is the EXACT final.content reference.
  // ════════════════════════════════════════════════════════════════════
  const finalText: FakeFinal = {
    content: [{ type: "text", text: "Hello, world!" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 5, output_tokens: 3 },
  };
  nextStream = fakeStream(["Hello", ", world!"], finalText);
  const deltas: string[] = [];
  const r1 = await provider.streamTurn({
    model: "claude-sonnet-5",
    system: "sys",
    tools: [],
    messages: [{ role: "user", content: "Hi" }],
    maxTokens: 1000,
    onText: (d) => deltas.push(d),
  });
  assert.deepEqual(deltas, ["Hello", ", world!"], "onText receives every delta in order");
  assert.equal(r1.text, "Hello, world!", "text is the deltas accumulated");
  assert.deepEqual(r1.toolCalls, [], "no tool_use blocks -> no tool calls");
  assert.equal(r1.stopReason, "end", "end_turn maps to \"end\"");
  assert.deepEqual(
    r1.usage,
    { inputTokens: 5, outputTokens: 3, cacheReadTokens: 0, cacheCreateTokens: 0 },
    "usage maps 1:1; absent cache fields default to 0, same as the pre-MP1 inline loop",
  );
  assert.equal(r1.assistantRaw, finalText.content, "assistantRaw is the exact final.content array reference, not a copy");
  assert.equal(calls[0]?.model, "claude-sonnet-5", "model id forwarded to the real client");

  // ════════════════════════════════════════════════════════════════════
  // 2. Tool-use turn: toolCalls mapped {id,name,input}, stopReason
  //    "tool_use", and BOTH cache usage fields mapped when the API
  //    response includes them.
  // ════════════════════════════════════════════════════════════════════
  const finalTool: FakeFinal = {
    content: [{ type: "tool_use", id: "tu_1", name: "do_thing", input: { a: 1 } }],
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
  };
  nextStream = fakeStream([], finalTool);
  const r2 = await provider.streamTurn({
    model: "claude-sonnet-5",
    system: "sys",
    tools: [],
    messages: [{ role: "user", content: "do it" }],
    maxTokens: 1000,
  });
  assert.deepEqual(r2.toolCalls, [{ id: "tu_1", name: "do_thing", input: { a: 1 } }], "tool_use block mapped to {id,name,input}");
  assert.equal(r2.stopReason, "tool_use");
  assert.deepEqual(r2.usage, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 100, cacheCreateTokens: 50 });
  assert.equal(r2.assistantRaw, finalTool.content, "assistantRaw is the exact final.content array reference");

  // ════════════════════════════════════════════════════════════════════
  // 3. max_tokens stop reason maps through (runAgentTurn uses this to stop
  //    the loop and warn the user instead of feeding back a truncated —
  //    possibly malformed — tool call).
  // ════════════════════════════════════════════════════════════════════
  nextStream = fakeStream(["cut off"], {
    content: [{ type: "text", text: "cut off" }],
    stop_reason: "max_tokens",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const r3 = await provider.streamTurn({
    model: "claude-sonnet-5",
    system: "sys",
    tools: [],
    messages: [{ role: "user", content: "x" }],
    maxTokens: 1000,
  });
  assert.equal(r3.stopReason, "max_tokens");

  // ════════════════════════════════════════════════════════════════════
  // 4. FIDELITY — the core claim of the task brief: a NeutralMessage
  //    carrying `providerRaw` is sent back to the API with that EXACT
  //    value, never rebuilt from content/toolCalls. This is what keeps a
  //    multi-turn Anthropic request byte-for-byte identical to what the
  //    pre-MP1 inline loop sent (it kept ONE convo array and pushed
  //    `final.content` straight back onto it — no reconstruction, ever,
  //    for a message it had produced itself in-run).
  // ════════════════════════════════════════════════════════════════════
  const assistantRawFromTurn2 = finalTool.content; // the exact array turn 2 returned as assistantRaw
  const seedWithProviderRaw: NeutralMessage[] = [
    { role: "user", content: "do it" },
    // Exactly what runAgentTurn appends after a tool_use turn: content +
    // toolCalls for the model/human to read back, PLUS providerRaw so this
    // provider never has to rebuild it.
    { role: "assistant", content: "", toolCalls: r2.toolCalls, providerRaw: assistantRawFromTurn2 },
    // Exactly what runAgentTurn appends after executing the tool call —
    // deliberately NO providerRaw (runAgentTurn never sets one for a
    // tool-results turn; see its doc comment), so this exercises the
    // reconstruction path for tool results specifically.
    { role: "user", content: "", toolResults: [{ toolCallId: "tu_1", content: "42" }] },
  ];
  nextStream = fakeStream(["ok"], {
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  await provider.streamTurn({ model: "claude-sonnet-5", system: "sys", tools: [], messages: seedWithProviderRaw, maxTokens: 1000 });
  const sentMessages = calls[calls.length - 1].messages as { role: string; content: unknown }[];
  assert.equal(
    sentMessages[1].content,
    assistantRawFromTurn2,
    "the assistant message carrying providerRaw was sent with that EXACT array reference — reused, not rebuilt",
  );
  assert.deepEqual(
    sentMessages[2],
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "42" }] },
    "a toolResults message with no providerRaw is reconstructed into a single tool_result block, matching what the pre-MP1 loop always built fresh here too",
  );
  assert.equal(sentMessages[0].content, "do it", "a plain user NeutralMessage is sent as a raw string, not a 1-element content-block array");

  // ════════════════════════════════════════════════════════════════════
  // 5. Reconstruction path: an assistant NeutralMessage with NO providerRaw
  //    (e.g. a hypothetical seed message carrying tool calls) rebuilds the
  //    text + tool_use blocks from the neutral fields.
  // ════════════════════════════════════════════════════════════════════
  nextStream = fakeStream([], { content: [{ type: "text", text: "noop" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  await provider.streamTurn({
    model: "claude-sonnet-5",
    system: "sys",
    tools: [],
    messages: [{ role: "assistant", content: "Let me check.", toolCalls: [{ id: "tu_9", name: "lookup", input: { x: 1 } }] }],
    maxTokens: 1000,
  });
  const rebuiltMessages = calls[calls.length - 1].messages as { role: string; content: unknown }[];
  assert.deepEqual(
    rebuiltMessages[0].content,
    [
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "tu_9", name: "lookup", input: { x: 1 } },
    ],
    "no providerRaw -> rebuilt from content + toolCalls",
  );

  // ════════════════════════════════════════════════════════════════════
  // 6. Progress updates. On Sonnet 5.5 / Opus 5.5 a note written between
  //    tool calls comes back as a `thinking` block, EMPTY unless the request
  //    asks for display "updates". Without this the chat would go quiet for
  //    a whole multi-step turn. The provider must (a) ask for it, with the
  //    beta header, (b) stream those notes through onText exactly as text
  //    used to arrive, with a paragraph break after each so the next turn's
  //    text doesn't run into it, and (c) leave the thinking blocks in
  //    assistantRaw so they are replayed verbatim next turn.
  // ════════════════════════════════════════════════════════════════════
  const noteBlock = { type: "thinking", thinking: "Found three open leads; checking which replied.", signature: "sig" };
  const finalNote: FakeFinal = {
    content: [noteBlock, { type: "tool_use", id: "tu_5", name: "list_leads", input: {} }],
    stop_reason: "tool_use",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  nextStream = fakeStream([], finalNote, {
    thinkingDeltas: ["Found three open leads; ", "checking which replied."],
    blocks: [noteBlock, finalNote.content[1]],
  });
  const noteDeltas: string[] = [];
  const r6 = await provider.streamTurn({
    model: "claude-sonnet-5-5",
    system: "sys",
    tools: [],
    messages: [{ role: "user", content: "who replied?" }],
    maxTokens: 1000,
    onText: (d) => noteDeltas.push(d),
  });
  const six = calls[calls.length - 1];
  assert.deepEqual(six.thinking, { type: "adaptive", display: "updates" }, "5.5 asks for progress updates");
  assert.equal(six.headers?.["anthropic-beta"], "thinking-display-updates-2026-08-18", "with the beta header");
  assert.equal(r6.text, "Found three open leads; checking which replied.\n\n", "the note streams as text, then a paragraph break");
  assert.deepEqual(noteDeltas.join(""), r6.text, "onText saw exactly what text holds");
  assert.equal(r6.assistantRaw, finalNote.content, "the thinking block stays in assistantRaw, replayed verbatim");

  // A model that rejects the field must not get it: the picker can still hold
  // an older id until the tenant migration reaches that database.
  nextStream = fakeStream(["ok"], { content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  await provider.streamTurn({ model: "claude-haiku-4-5", system: "sys", tools: [], messages: [{ role: "user", content: "x" }], maxTokens: 100 });
  const haiku = calls[calls.length - 1];
  assert.equal(haiku.thinking, undefined, "Haiku is sent no thinking field");
  assert.equal(haiku.headers, undefined, "and no beta header");

  console.log("ai/providers/anthropic.test.ts: all assertions passed");
})();
