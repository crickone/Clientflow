import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCampaignScoreboard } from "./scoreboard";

const base = { leads: 20, converts: 4, adSpendCents: 10000, aiBuildCents: 15, upfrontCashCents: 18000, mrrCents: 9000 };

test("happy path: rates, CAC, CFA covered, ROAS", () => {
  const s = computeCampaignScoreboard(base);
  assert.equal(s.conversionRatePct, 20);      // 4/20*100
  assert.equal(s.cacCents, 2500);             // 10000/4
  assert.equal(s.cfaCovered, true);           // 18000 >= 10000
  assert.equal(s.roas, 1.8);                  // 18000/10000
  assert.equal(s.aiBuildCents, 15);           // informational, unchanged
});

test("CFA not covered when upfront < ad spend", () => {
  const s = computeCampaignScoreboard({ ...base, upfrontCashCents: 6000 });
  assert.equal(s.cfaCovered, false);
  assert.equal(s.roas, 0.6);
});

test("0 ad spend → ROAS null, CFA not covered (UI shows 'add ad spend')", () => {
  const s = computeCampaignScoreboard({ ...base, adSpendCents: 0 });
  assert.equal(s.roas, null);
  assert.equal(s.cfaCovered, false);
  assert.equal(s.cacCents, null);   // adSpend 0 → CAC also null
});

test("0 converts → CAC null; 0 leads → conversion rate null; never throws", () => {
  assert.equal(computeCampaignScoreboard({ ...base, converts: 0, adSpendCents: 10000 }).cacCents, null);
  assert.equal(computeCampaignScoreboard({ ...base, leads: 0, converts: 0 }).conversionRatePct, null);
});
