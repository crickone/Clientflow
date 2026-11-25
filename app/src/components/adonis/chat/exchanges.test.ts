// Run: npm test -- src/components/adonis/chat/exchanges.test.ts
//
// A conversation shown as exchanges: each question with every reply until
// the next question (hidden hand-backs after an approval do not start a new
// one), its steps, files, follow-ups and timing.
import assert from "node:assert/strict";

import type { ConvMessage } from "@/lib/agents/conversationModel";
import { firstSentence, formatDuration, groupExchanges, showFollowUps, stepRows, stepsSummary } from "./exchanges";
import { toolLabel } from "./toolLabels";

const msgs: ConvMessage[] = [
  { role: "user", content: "Which offer is selling better?", tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Massage is ahead, 6 sold to 2. The bundle is behind.\n<followups>\nMove budget to the bundle\n</followups>",
    tools: ["get_ad_results", "business_overview"],
    artifacts: [],
    startedAt: 1000,
    durationMs: 6200,
  },
  { role: "user", content: 'Move €5 a day\n\n[Attached to the library: "plan.pdf" — document #12]', tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Here's the change.",
    tools: ["list_ad_campaigns"],
    artifacts: [],
    pending: { status: "approved", actions: [{ name: "set_ad_budget", input: {}, summary: "Set budget" }] },
    startedAt: 9000,
    durationMs: 2000,
  },
  { role: "user", hidden: true, content: "[The operator approved that]", tools: [], artifacts: [] },
  {
    role: "assistant",
    content: "Done. Budgets moved.",
    tools: [],
    artifacts: [{ url: "/a.zip", filename: "a.zip", label: "Report" }],
    startedAt: 20000,
    durationMs: 1000,
  },
];

const xs = groupExchanges(msgs);
assert.equal(xs.length, 2, "two questions, two exchanges");
assert.deepEqual(xs.map((x) => x.key), ["q0", "q2"], "keys follow the question's message index");
assert.equal(xs[0].question, "Which offer is selling better?");
assert.equal(xs[0].replies[0].body, "Massage is ahead, 6 sold to 2. The bundle is behind.", "the follow-up block is not in the answer");
assert.deepEqual(xs[0].followups, ["Move budget to the bundle"]);
assert.deepEqual(xs[0].tools, ["get_ad_results", "business_overview"]);
assert.equal(xs[0].durationMs, 6200);
assert.equal(xs[1].question, "Move €5 a day", "the attachment line is not in the question");
assert.deepEqual(xs[1].attached, [{ name: "plan.pdf", kind: "document", id: "12" }]);
assert.equal(xs[1].replies.length, 2, "a hidden hand-back does not start a new exchange");
assert.equal(xs[1].startedAt, 9000);
assert.equal(xs[1].durationMs, 3000, "durations add up across replies");
assert.equal(xs[1].artifacts.length, 1);
assert.deepEqual(xs[1].followups, [], "the latest reply without a block clears follow-ups");

const lone = groupExchanges([{ role: "assistant", content: "_Adonis was interrupted._", tools: [], artifacts: [] }]);
assert.equal(lone.length, 1);
assert.equal(lone[0].key, "a0");
assert.equal(lone[0].questionIndex, null, "a reply before any question gets an exchange without a headline");
assert.deepEqual(groupExchanges([]), []);
assert.equal(groupExchanges([{ role: "user", content: "x", tools: [], artifacts: [] }, { role: "assistant", content: "y", tools: [], artifacts: [] }])[0].durationMs, null, "old replies have no timing");

assert.equal(firstSentence("**Massage** is ahead, 6 sold to 2. The bundle..."), "Massage is ahead, 6 sold to 2.");
assert.equal(firstSentence("## Heading\nIt costs €12.50 today. More."), "It costs €12.50 today.", "headings are skipped, prices are not sentence ends");
assert.equal(firstSentence("- [Open](/x) the ads now"), "Open the ads now");
const longOne = firstSentence("x".repeat(200));
assert.equal(longOne.length, 140);
assert.ok(longOne.endsWith("…"));
assert.equal(firstSentence(""), "");

assert.deepEqual(stepRows(["get_ad_results", "list_leads"], false, null).map((r) => r.state), ["done", "done"]);
assert.deepEqual(stepRows(["list_leads"], true, "tool").map((r) => r.state), ["running"]);
assert.deepEqual(stepRows(["list_leads"], true, null).map((r) => r.state), ["running"], "a tool with no word after it is still running");
assert.deepEqual(
  stepRows(["list_leads"], true, "writing").map((r) => [r.label, r.state]),
  [["Checking the pipeline", "done"], ["Writing the answer", "running"]],
);
assert.deepEqual(stepRows([], true, "writing"), [], "no steps for an answer that used no tools");

assert.equal(formatDuration(6200), "6.2s");
assert.equal(formatDuration(0), "0.0s");
assert.equal(formatDuration(72_000), "1m 12s");
assert.equal(stepsSummary(6200, 4), "Done in 6.2s, 4 steps");
assert.equal(stepsSummary(6200, 1), "Done in 6.2s, 1 step");
assert.equal(stepsSummary(null, 2), "Done, 2 steps");
assert.equal(stepsSummary(1000, 0), "Done in 1.0s");
assert.equal(stepsSummary(null, 0), "Done");

assert.equal(toolLabel("list_leads"), "Checking the pipeline");
assert.equal(toolLabel("some_new_tool"), "Some new tool", "unknown tools are shown in words");
assert.equal(toolLabel("Reading business overview"), "Reading business overview", "old chats saved the label itself");
assert.equal(toolLabel("constructor"), "constructor", "a name that is also an Object.prototype key comes back as a string");
assert.equal(toolLabel("__proto__"), "Proto", "and so does __proto__");
assert.equal(typeof toolLabel("toString"), "string");

assert.equal(showFollowUps({ isLast: true, live: false, openCards: 0 }), true, "follow-ups show under the latest finished answer");
assert.equal(showFollowUps({ isLast: true, live: false, openCards: 1 }), false, "not while an Approve card is open in it");
assert.equal(showFollowUps({ isLast: true, live: true, openCards: 0 }), false, "not while it is still being written");
assert.equal(showFollowUps({ isLast: false, live: false, openCards: 0 }), false, "not under older answers");

console.log("exchanges: all checks passed");
