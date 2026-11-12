// Run: npm test -- src/lib/platform/churnRisk.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { churnRisk } = requireLocal("./churnRisk") as typeof import("./churnRisk");

const healthy = { daysSinceLastLogin: 1, hits30: 200, hitsPrev30: 180, billingStatus: "active", exempt: false, failedAttempts: 0, reconnectsNeeded: 0, openBadAlerts: 0, setupRequiredDone: 4, setupRequiredTotal: 4, ageDays: 200 };
assert.deepEqual(churnRisk(healthy), { score: 0, level: "low", reasons: [] });

const quiet = churnRisk({ ...healthy, daysSinceLastLogin: 20 });
assert.equal(quiet.score, 25);
assert.equal(quiet.level, "low");
assert.match(quiet.reasons[0], /20 days/);

assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: 45 }).score, 40);
assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: null, ageDays: 30 }).score, 40, "never logged in counts as 30+");
assert.equal(churnRisk({ ...healthy, hits30: 40, hitsPrev30: 100 }).score, 20);
assert.equal(churnRisk({ ...healthy, hits30: 0, hitsPrev30: 0 }).score, 0, "no usage either side is not a drop");
assert.equal(churnRisk({ ...healthy, billingStatus: "past_due", failedAttempts: 1 }).score, 20);
assert.equal(churnRisk({ ...healthy, billingStatus: "past_due", failedAttempts: 3 }).score, 30);
assert.equal(churnRisk({ ...healthy, billingStatus: "suspended" }).score, 40);
assert.equal(churnRisk({ ...healthy, exempt: true, billingStatus: "past_due" }).score, 0, "exempt accounts have no billing risk");
assert.equal(churnRisk({ ...healthy, reconnectsNeeded: 3 }).score, 20);
assert.equal(churnRisk({ ...healthy, openBadAlerts: 1 }).score, 10);
assert.equal(churnRisk({ ...healthy, setupRequiredDone: 1, ageDays: 30 }).score, 15);
assert.equal(churnRisk({ ...healthy, setupRequiredDone: 1, ageDays: 3 }).score, 0, "a new account is allowed to be unfinished");

const bad = churnRisk({ ...healthy, daysSinceLastLogin: 40, billingStatus: "suspended", reconnectsNeeded: 2, openBadAlerts: 2 });
assert.equal(bad.score, 100);
assert.equal(bad.level, "high");
assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: 20, hits30: 1, hitsPrev30: 100 }).level, "medium");
console.log("churnRisk.test.ts: ok");
