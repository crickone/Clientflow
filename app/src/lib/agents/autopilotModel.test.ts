// Run: npm test -- src/lib/agents/autopilotModel.test.ts
//
// "Approve and build everything" now runs on the server, so it keeps going
// when the operator leaves the chat. These are the rules it follows after
// each turn.
import assert from "node:assert/strict";

import { campaignIdFromResult, continuationMessage, decideAfterTurn } from "./autopilotModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const approve = (campaignId: unknown) => ({ name: "approve_campaign_asset", input: { campaignId, assetId: 4 } });

check(
  "an asset approval for this campaign is approved automatically",
  decideAfterTurn({ pending: [approve(7)], autopilot: true, campaignId: 7, nudges: 0 }) === "approve",
);
check(
  "a campaign id sent as a string still matches",
  decideAfterTurn({ pending: [approve("7")], autopilot: true, campaignId: 7, nudges: 0 }) === "approve",
);
check(
  "an asset approval for another campaign goes to the operator",
  decideAfterTurn({ pending: [approve(8)], autopilot: true, campaignId: 7, nudges: 0 }) === "ask",
);
check(
  "launching always goes to the operator",
  decideAfterTurn({ pending: [{ name: "launch_campaign", input: { campaignId: 7 } }], autopilot: true, campaignId: 7, nudges: 0 }) === "ask",
);
check(
  "a mix of an approval and anything else goes to the operator",
  decideAfterTurn({
    pending: [approve(7), { name: "schedule_social_post", input: {} }],
    autopilot: true,
    campaignId: 7,
    nudges: 0,
  }) === "ask",
);
check(
  "with autopilot off, an approval goes to the operator",
  decideAfterTurn({ pending: [approve(7)], autopilot: false, campaignId: 7, nudges: 0 }) === "ask",
);
check(
  "without a known campaign, nothing is approved automatically",
  decideAfterTurn({ pending: [approve(7)], autopilot: true, campaignId: null, nudges: 0 }) === "ask",
);
check(
  "a turn that proposes nothing is reminded once",
  decideAfterTurn({ pending: [], autopilot: true, campaignId: 7, nudges: 0 }) === "nudge",
);
check(
  "then it hands back",
  decideAfterTurn({ pending: [], autopilot: true, campaignId: 7, nudges: 1 }) === "finish",
);
check(
  "with autopilot off a quiet turn just finishes",
  decideAfterTurn({ pending: [], autopilot: false, campaignId: 7, nudges: 0 }) === "finish",
);

check("create_campaign result gives its id", campaignIdFromResult("create_campaign", JSON.stringify({ campaignId: 12, result: "x" })) === 12);
check("other tools give none", campaignIdFromResult("approve_campaign_asset", JSON.stringify({ campaignId: 12 })) === null);
check("prose gives none", campaignIdFromResult("create_campaign", "Created.") === null);

const msg = continuationMessage([{ name: "create_campaign", ok: true, text: "{}" }], { auto: false, autopilot: true });
check("the continuation tells it to carry on without asking", msg.includes("without stopping to ask"));
check("and never to launch on its own", msg.includes("never schedule, send or publish without them"));

console.log(`autopilotModel: ${passed} checks passed`);
