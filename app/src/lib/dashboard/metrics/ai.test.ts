// Run: npm test -- src/lib/dashboard/metrics/ai.test.ts
import assert from "node:assert/strict";
import {
  agentLabel,
  dailySpendSeries,
  mediaKind,
  mediaBreakdown,
  projectedMonthEnd,
  shortModel,
  topPairs,
} from "./ai";

assert.equal(agentLabel("orchestrator"), "Adonis");
assert.equal(agentLabel("carousel"), "Post design");
assert.equal(agentLabel("triage"), "Inbox triage");
assert.equal(agentLabel("brief"), "Daily brief");
assert.equal(agentLabel("transcribe"), "Transcription");
assert.equal(agentLabel("lead_scorer"), "Lead Scorer");
assert.equal(agentLabel("market-research"), "Market Research");

assert.equal(shortModel("claude-sonnet-5-5"), "sonnet-5-5");
assert.equal(shortModel("claude-haiku-4-5-20251001"), "haiku-4-5");
assert.equal(shortModel("openrouter:deepseek/deepseek-v3.2"), "deepseek-v3.2");
assert.equal(shortModel("fal:fal-ai/flux-pro/v1.1"), "flux-pro");

assert.equal(mediaKind("fal:fal-ai/flux-2-pro", "carousel"), "Images");
assert.equal(mediaKind("fal:fal-ai/kling-video/v2", "video"), "Video");
assert.equal(mediaKind("fal:fal-ai/kling-video/v2", "carousel"), "Video");
assert.equal(mediaKind("openai:gpt-image-1", "carousel"), "Images");
assert.equal(mediaKind("runway:gen4", "x"), "Video");
assert.equal(mediaKind("whisper-1", "transcribe"), "Transcription");
assert.equal(mediaKind("anything", "video"), "Video");
assert.equal(mediaKind("claude-sonnet-5-5", "orchestrator"), null);

assert.deepEqual(
  mediaBreakdown([
    { agent: "carousel", model: "fal:flux", cents: 4 },
    { agent: "carousel", model: "fal:flux", cents: 4 },
    { agent: "orchestrator", model: "claude-sonnet-5-5", cents: 50 },
    { agent: "video", model: "fal:kling", cents: 35 },
  ]),
  [{ label: "Video", value: 35 }, { label: "Images", value: 8 }],
);
assert.deepEqual(mediaBreakdown([]), []);

// projected: Dublin day-of-month. 10 Oct, 31 days: 1000c spent over 10 days -> 3100
assert.equal(projectedMonthEnd(1000, Date.parse("2026-10-10T12:00:00Z")), 3100);
// 2026-10-01 00:30 Dublin (BST) is 2026-09-30 23:30 UTC: ledger month is September, so project on September's clock
assert.equal(projectedMonthEnd(3000, Date.parse("2026-09-30T23:30:00Z")), 3000);
assert.equal(projectedMonthEnd(0, Date.parse("2026-10-10T12:00:00Z")), 0);
// Feb non-leap, 14th: 28 days
assert.equal(projectedMonthEnd(700, Date.parse("2027-02-14T12:00:00Z")), 1400);

// dailySpendSeries: full month, Dublin-day grouping, fractional cents summed
const rows = [
  { ms: Date.parse("2026-10-01T10:00:00Z"), cents: 1.5 },
  { ms: Date.parse("2026-10-01T11:00:00Z"), cents: 2 },
  { ms: Date.parse("2026-10-03T11:00:00Z"), cents: 4 },
  // 23:30 UTC on 31 Oct (summer time ended 25 Oct: Dublin is UTC then) stays on 31 Oct
  { ms: Date.parse("2026-10-31T23:30:00Z"), cents: 1 },
];
const days = dailySpendSeries(rows, "2026-10");
assert.equal(days.length, 31);
assert.equal(days[0].cents, 3.5);
assert.equal(days[1].cents, 0);
assert.equal(days[2].cents, 4);
assert.equal(days[30].cents, 1);
// 30 Sep 23:30 UTC is 1 Oct 00:30 Dublin (IST): lands on day 1 of October's key
const edge = dailySpendSeries([{ ms: Date.parse("2026-09-30T23:30:00Z"), cents: 2 }], "2026-10");
assert.equal(edge[0].cents, 2);
assert.equal(days[0].label, "1 Oct");

// topPairs: grouped by agent+model, largest first, limited
const pairs = topPairs(
  [
    { agent: "orchestrator", model: "claude-sonnet-5-5", cents: 10 },
    { agent: "orchestrator", model: "claude-sonnet-5-5", cents: 15 },
    { agent: "carousel", model: "fal:flux", cents: 20 },
    { agent: "blog", model: "claude-haiku-4-5", cents: 1 },
  ],
  2,
);
assert.deepEqual(pairs, [
  { label: "Adonis", sub: "sonnet-5-5", value: 25 },
  { label: "Post design", sub: "flux", value: 20 },
]);
console.log("ai.test.ts: ok");
