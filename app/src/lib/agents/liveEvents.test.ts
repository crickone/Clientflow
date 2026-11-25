// Run: npm test -- src/lib/agents/liveEvents.test.ts
//
// The events the /adonis chat is sent while Adonis works: how they are framed
// for Server-Sent Events, read back, and applied to the conversation the page
// holds.
import assert from "node:assert/strict";

import type { ConversationView } from "./conversationModel";
import { applyLiveEvent, formatSse, parseLiveEvent, SSE_HEARTBEAT, SSE_RETRY } from "./liveEvents";

const base: ConversationView = {
  id: "c1",
  title: "Hi",
  updatedAt: 1,
  running: true,
  building: false,
  stopRequested: false,
  campaignEvents: [],
  messages: [
    { role: "user", content: "Hi", tools: [], artifacts: [] },
    { role: "assistant", content: "", tools: [], artifacts: [] },
  ],
};

let c = applyLiveEvent(base, { type: "tool", index: 1, name: "list_leads" });
assert.deepEqual(c?.messages[1].tools, ["list_leads"], "a tool event adds the tool to that reply");
c = applyLiveEvent(c, { type: "text", index: 1, delta: "Hel" });
c = applyLiveEvent(c, { type: "text", index: 1, delta: "lo" });
assert.equal(c?.messages[1].content, "Hello", "text deltas append in order");
assert.equal(base.messages[1].content, "", "the view passed in is never mutated");
assert.equal(applyLiveEvent(c, { type: "text", index: 0, delta: "x" }), c, "a delta aimed at a user message is ignored");
assert.equal(applyLiveEvent(c, { type: "text", index: 9, delta: "x" }), c, "a delta past the end waits for the next state");
assert.equal(applyLiveEvent(null, { type: "text", index: 1, delta: "x" }), null, "nothing to apply to stays nothing");
const replaced: ConversationView = { ...base, running: false };
assert.equal(applyLiveEvent(c, { type: "state", conversation: replaced }), replaced, "a state replaces everything");
assert.equal(applyLiveEvent(c, { type: "end" }), c, "end changes nothing by itself");

const frame = formatSse({ type: "text", index: 1, delta: "a\nb" });
assert.ok(frame.startsWith("data: ") && frame.endsWith("\n\n"), "one data frame");
assert.equal(frame.split("\n").length, 3, "a newline inside the text stays inside one data line");
assert.deepEqual(parseLiveEvent(frame.slice(6).trim()), { type: "text", index: 1, delta: "a\nb" }, "a frame reads back");
assert.ok(SSE_HEARTBEAT.startsWith("data: ") && SSE_HEARTBEAT.endsWith("\n\n"), "the heartbeat is a data frame, so the page sees it");
assert.deepEqual(parseLiveEvent(SSE_HEARTBEAT.slice(6).trim()), { type: "ping" }, "the heartbeat reads back as a ping");
assert.equal(applyLiveEvent(c, { type: "ping" }), c, "a ping changes nothing");
assert.equal(applyLiveEvent(null, { type: "ping" }), null, "a ping before any conversation changes nothing");
assert.ok(SSE_RETRY.startsWith("retry: "), "the retry hint is an SSE retry field");
assert.equal(parseLiveEvent("not json"), null, "junk is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "text", index: "1", delta: "x" })), null, "a wrong field type is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "nope" })), null, "an unknown type is ignored");
assert.equal(parseLiveEvent(JSON.stringify({ type: "state", conversation: { id: "x" } })), null, "a state without messages is ignored");
assert.deepEqual(parseLiveEvent(JSON.stringify({ type: "end" })), { type: "end" });

console.log("liveEvents: all checks passed");
