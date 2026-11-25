// Run: npm test -- src/components/adonis/chat/approvalModel.test.ts
//
// What an Approve card can show as old and new, and which cards are campaign
// cards (they get "Go again" behind "Change it").
import assert from "node:assert/strict";

import { actionChanges, campaignAction } from "./approvalModel";

assert.deepEqual(
  actionChanges({ name: "edit_website_text", input: { path: "/", find: "Book a consult", replace: "Book online" }, summary: "Change wording" }),
  { changes: [{ from: "Book a consult", to: "Book online" }], more: 0 },
  "a website text edit shows old and new",
);
const page = actionChanges({
  name: "create_website_page",
  input: { textChanges: Array.from({ length: 6 }, (_, i) => ({ find: `old ${i}`, replace: `new ${i}` })) },
  summary: "Create page",
});
assert.equal(page.changes.length, 4, "at most four pairs");
assert.equal(page.more, 2, "and how many more");
assert.deepEqual(actionChanges({ name: "set_ad_budget", input: { dailyBudget: 7.5 }, summary: "Set budget" }), { changes: [], more: 0 }, "no old value, no pair");
assert.deepEqual(actionChanges({ name: "edit_website_text", input: { find: "x" }, summary: "" }), { changes: [], more: 0 }, "half a pair is no pair");
const clipped = actionChanges({ name: "edit_website_text", input: { find: "a".repeat(300), replace: "b" }, summary: "" }).changes[0];
assert.equal(clipped.from.length, 140);
assert.ok(clipped.from.endsWith("…"));

const plan = { name: "create_campaign", input: {}, summary: "Create BF" };
assert.equal(campaignAction([plan]), plan);
assert.equal(campaignAction([{ name: "approve_campaign_asset", input: {}, summary: "" }])?.name, "approve_campaign_asset");
assert.equal(campaignAction([plan, plan]), null, "a batch has no single thing to redo");
assert.equal(campaignAction([{ name: "send_whatsapp", input: {}, summary: "" }]), null);

console.log("approvalModel: all checks passed");
