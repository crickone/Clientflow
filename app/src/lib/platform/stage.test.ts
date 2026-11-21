// Run: cd app && npx tsx src/lib/platform/stage.test.ts
import assert from "node:assert/strict";

import { defaultStage, STAGES, type StageFacts } from "./tenantMeta";

const base: StageFacts = { archived: false, billingStatus: null, exempt: true, setupRequiredDone: 6, setupRequiredTotal: 7, riskScore: 20, members: 48 };

// A business in real use reads Live even with a setup step open.
assert.equal(defaultStage(base), "active");
// New, incomplete and nobody using it: setting up.
assert.equal(defaultStage({ ...base, members: 0, setupRequiredDone: 3 }), "onboarding");
// Complete setup and no members is still live (an agency business before launch is set by hand).
assert.equal(defaultStage({ ...base, members: 0, setupRequiredDone: 7 }), "active");
// Existing rules keep their order.
assert.equal(defaultStage({ ...base, archived: true }), "churned");
assert.equal(defaultStage({ ...base, exempt: false, billingStatus: "pending_payment" }), "trial");
assert.equal(defaultStage({ ...base, riskScore: 70 }), "at_risk");
// The two hand-set stages exist but are never chosen automatically.
assert.ok(STAGES.includes("not_launched") && STAGES.includes("internal"));
for (const f of [base, { ...base, members: 0 }, { ...base, exempt: false, billingStatus: "active" }]) {
  assert.ok(!["not_launched", "internal"].includes(defaultStage(f)));
}
console.log("stage: ok");
