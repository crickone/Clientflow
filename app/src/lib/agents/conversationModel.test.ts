// Run: npm test -- src/lib/agents/conversationModel.test.ts
//
// Adonis's conversations now live on the server. Chats an older page saved
// in the browser are imported once; these check that import and the history
// Adonis is given.
import assert from "node:assert/strict";

import { agentErrorText, modelHistory, normalizeImported, type ConvMessage } from "./conversationModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const old = {
  id: "c-1",
  title: "Black Friday",
  updatedAt: 1700000000000,
  autopilot: true,
  activeRunId: "r-9",
  campaignEvents: [{ type: "progress", campaignId: 2, nextAsset: null }],
  messages: [
    { role: "user", content: "Build it", steps: [], artifacts: [] },
    {
      role: "assistant",
      content: "Here's the plan.",
      steps: [{ label: "Planning the campaign", done: true }],
      artifacts: [{ url: "/x.zip", filename: "x.zip", label: "Download" }, { nope: 1 }],
      pending: { status: "approving", actions: [{ name: "create_campaign", input: { name: "BF" }, summary: "Create BF" }] },
    },
    { role: "user", hidden: true, content: "[carry on]", steps: [], artifacts: [] },
    { role: "system", content: "dropped" },
  ],
};
const n = normalizeImported(old)!;
check("an old chat imports", n !== null && n.id === "c-1" && n.title === "Black Friday");
check("unknown roles are dropped", n.messages.length === 3);
check("step labels become the tools list", n.messages[1].tools[0] === "Planning the campaign");
check("broken artifacts are dropped", n.messages[1].artifacts.length === 1);
check("a card caught mid-approval comes back waiting", n.messages[1].pending?.status === "awaiting");
check("hidden hand-back messages stay hidden", n.messages[2].hidden === true);
check("the campaign log comes across", n.campaignEvents.length === 1);
check("a chat with no messages is skipped", normalizeImported({ id: "c-2", messages: [] }) === null);
check("a chat with no id is skipped", normalizeImported({ messages: [{ role: "user", content: "x" }] }) === null);
check("junk is skipped", normalizeImported("nope") === null);

const msgs: ConvMessage[] = [
  { role: "user", content: "hi", tools: [], artifacts: [] },
  { role: "assistant", content: "", tools: [], artifacts: [] },
  { role: "user", hidden: true, content: "[carry on]", tools: [], artifacts: [] },
];
const h = modelHistory(msgs);
check("empty replies are left out of the history", h.length === 2);
check("hidden hand-backs are part of what Adonis reads", h[1].content === "[carry on]");
check("history is capped at 24", modelHistory(Array.from({ length: 30 }, () => msgs[0])).length === 24);

const credit = Object.assign(new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 });
check("out of credit says so", agentErrorText(credit).includes("out of credit"));
check("overloaded says busy", agentErrorText(Object.assign(new Error("Overloaded"), { status: 529 })).includes("busy"));
check("rate limited says wait", agentErrorText(Object.assign(new Error("rate_limit_error"), { status: 429 })).includes("Wait a minute"));
check("anything else stays generic", agentErrorText(new Error("ENOENT /app/secret/path")) === 'Something went wrong. Say "carry on" to try again.');

console.log(`conversationModel: ${passed} checks passed`);
