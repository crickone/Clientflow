// Run: npm test -- src/lib/dashboard/metrics/communication.test.ts
import assert from "node:assert/strict";
import { categoryLabel, channelLabel, triagedPool, channelOf, countByChannel, formatDuration, responseStats, truncate, type MsgRow } from "./communication";

assert.equal(formatDuration(0.4), "1 min");
assert.equal(formatDuration(42), "42 min");
assert.equal(formatDuration(59.6), "1 h");
assert.equal(formatDuration(210), "3.5 h");
assert.equal(formatDuration(180), "3 h");
assert.equal(formatDuration(2.1 * 1440), "2.1 days");
assert.equal(formatDuration(1440), "1 day");
assert.equal(formatDuration(131.3 * 1440), "131 days", "whole days past a week");

assert.equal(channelOf({ channel: "whatsapp" }), "whatsapp");
assert.equal(channelOf({ channel: null }), "other");
assert.equal(channelLabel("sms"), "SMS");
assert.equal(channelLabel("whatsapp"), "WhatsApp");
assert.equal(channelLabel("other"), "Other");

assert.equal(categoryLabel("new_lead"), "New enquiry");
assert.equal(categoryLabel("faq"), "Question");
assert.equal(categoryLabel(null), "Not triaged");
assert.equal(categoryLabel("weird"), "Other");

assert.equal(truncate("short", 80), "short");
assert.equal(truncate("x".repeat(100), 80).length, 80);
assert.ok(truncate("x".repeat(100), 80).endsWith("..."));

const H = 3_600_000;
const t0 = Date.UTC(2026, 9, 1, 9);
const row = (convo: string, direction: "inbound" | "outbound", atMs: number, channel: string | null): MsgRow => ({
  source: convo.startsWith("thread:") ? "gmail" : "lead",
  convo, direction, atMs, channel, aiCategory: null, aiPriority: null, autoReplyStatus: null, triagedAtMs: null,
});
const rows = [
  row("lead:1", "inbound", t0 - 2 * H, "whatsapp"), // before range, answered inside it
  row("lead:1", "outbound", t0 + H, "whatsapp"),
  row("client:2", "inbound", t0 + H, "email"),
  row("client:2", "outbound", t0 + 3 * H, "email"),
  row("thread:x", "inbound", t0 + 2 * H, null),
];
// Range starts at t0: only inbound times in range count (client:2 -> 120 min), thread:x unanswered.
const rs = responseStats(rows, t0, t0 + 24 * H);
assert.deepEqual(rs, { medianMinutes: 120, conversations: 1, byChannel: [{ channel: "email", medianMinutes: 120 }] });
assert.deepEqual(responseStats([], t0, t0 + H), { medianMinutes: null, conversations: 0, byChannel: [] });

assert.deepEqual(
  countByChannel(rows, t0, t0 + 24 * H),
  [
    { channel: "email", inbound: 1, outbound: 1 },
    { channel: "whatsapp", inbound: 0, outbound: 1 },
    { channel: "other", inbound: 1, outbound: 0 },
  ],
  "sorted by total desc, ties by in-range order; null channel is other",
);

const pool = triagedPool([...rows, row("thread:y", "inbound", t0 + H, "email")], t0, t0 + 24 * H);
assert.deepEqual(pool.map((r) => r.convo).sort(), ["client:2"], "gmail and outbound excluded; pre-range excluded");
assert.equal(categoryLabel(pool[0].aiCategory), "Not triaged", "untriaged lead/client row counts as Not triaged");

console.log("communication.test.ts: ok");
