// Run: npm test -- src/lib/agents/backgroundWorkModel.test.ts
import assert from "node:assert/strict";

import { adIdsFromResults, adsFinishedMessage } from "./backgroundWorkModel";

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  passed++;
};

const results = [
  { name: "create_ad", ok: true, text: JSON.stringify({ result: "Making it", adId: 7 }) },
  { name: "create_ad", ok: true, text: JSON.stringify({ result: "Making it", adId: 8 }) },
  { name: "create_ad", ok: true, text: JSON.stringify({ result: "Making it", adId: 7 }) },
  { name: "create_ad", ok: false, text: JSON.stringify({ adId: 9 }) },
  { name: "create_ad", ok: true, text: JSON.stringify({ error: "AI is not available" }) },
  { name: "draft_ad_campaign", ok: true, text: JSON.stringify({ adId: 10 }) },
  { name: "create_ad", ok: true, text: "not json" },
];
check("only approved create_ad calls that started an ad, once each", JSON.stringify(adIdsFromResults(results)) === "[7,8]");
check("nothing started, nothing watched", adIdsFromResults([]).length === 0);

const ready = adsFinishedMessage([7, 8], [
  { id: 7, name: "Admin time", status: null, error: null, versions: 4 },
  { id: 8, name: "Leads", status: "failed", error: "No design style", versions: 0 },
]);
check("says it was not typed by the operator", ready.includes("not typed by the operator"));
check("names each ad and its outcome", ready.includes('Ad #7 "Admin time" is ready with 4 versions') && ready.includes("could not be made: No design style"));
check("hands Adonis the next step and forbids asking to check", ready.includes("draft_ad_campaign or add_ad_to_campaign") && ready.includes("Do not ask them to check"));
const failed = adsFinishedMessage([8], [{ id: 8, name: "Leads", status: "failed", error: "x", versions: 0 }]);
check("all failed: no preview step, offer to try again", !failed.includes("draft_ad_campaign") && failed.includes("try again"));
check("a deleted ad is reported", adsFinishedMessage([3], [null]).includes("Ad #3 was deleted"));
check("one version reads singular", adsFinishedMessage([1], [{ id: 1, name: "A", status: null, error: null, versions: 1 }]).includes("1 version."));

check("an ad that finished empty is not offered as ready", !adsFinishedMessage([5], [{ id: 5, name: "E", status: null, error: null, versions: 0 }]).includes("draft_ad_campaign"));

console.log(`backgroundWorkModel: ${passed} checks passed`);
