// Run: npm test -- src/lib/labels.test.ts
import assert from "node:assert/strict";

import { billingLabel, isReconnectAlert, relTime, riskShown, stageLabel } from "./labels";

assert.equal(stageLabel("active"), "Live");
assert.equal(stageLabel("onboarding"), "Setting up");
assert.equal(stageLabel("trial"), "Trial");
assert.equal(stageLabel("at_risk"), "At risk");
assert.equal(stageLabel("churned"), "Churned");
assert.equal(stageLabel("not_launched"), "Not launched");
assert.equal(stageLabel("internal"), "Internal");
assert.equal(stageLabel(null), "-");
assert.equal(stageLabel(undefined), "-");
assert.equal(stageLabel("whatever"), "-");

assert.equal(billingLabel({ exempt: false, status: "active", stage: "internal" }), "Internal");
assert.equal(billingLabel({ exempt: true, status: "active", stage: "internal" }), "Internal");
assert.equal(billingLabel({ exempt: true, status: null }), "Free · agency client");
assert.equal(billingLabel({ exempt: true, status: "active", stage: "active" }), "Free · agency client");
assert.equal(billingLabel({ exempt: false, status: "active" }), "Paying");
assert.equal(billingLabel({ exempt: false, status: "past_due" }), "Past due");
assert.equal(billingLabel({ exempt: false, status: "pending_payment" }), "Awaiting payment");
assert.equal(billingLabel({ exempt: false, status: "cancelled" }), "Cancelled");
assert.equal(billingLabel({ exempt: false, status: "suspended" }), "Suspended");
assert.equal(billingLabel({ exempt: false, status: null }), "No billing");
assert.equal(billingLabel({ exempt: false, status: "weird" }), "No billing");

assert.equal(riskShown("not_launched"), false);
assert.equal(riskShown("internal"), false);
assert.equal(riskShown("active"), true);
assert.equal(riskShown(null), true);
assert.equal(riskShown(undefined), true);

const now = 1_800_000_000_000;
const ago = (ms: number) => now - ms;
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
assert.equal(relTime(null, now), "-");
assert.equal(relTime(undefined, now), "-");
assert.equal(relTime(ago(30 * S), now), "just now");
assert.equal(relTime(ago(5 * M), now), "5m");
assert.equal(relTime(ago(2 * H), now), "2h");
assert.equal(relTime(ago(26 * H), now), "1d");
assert.equal(relTime(ago(9 * D), now), "9d");
assert.equal(relTime(ago(21 * D), now), "3w");
assert.equal(relTime(now + 5 * M, now), "just now");
console.log("labels.test.ts: ok");

assert.equal(isReconnectAlert("integration:facebook"), true);
assert.equal(isReconnectAlert("integration:meta"), true);
assert.equal(isReconnectAlert("billing:card_expiring"), false);
assert.equal(isReconnectAlert("health:queue_failed:posts"), false);
assert.equal(isReconnectAlert("churn:high"), false);
