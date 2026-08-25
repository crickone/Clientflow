import { test } from "node:test";
import assert from "node:assert/strict";
import { computePanelMetrics } from "./panelMetrics";

const base = { leads: 13, converts: 4, adSpendCents: 10000, upfrontCashCents: 18000, landingViews: 200 };

test("normal case: exact cents + percentages", () => {
  const d = computePanelMetrics(base);
  assert.equal(d.costPerLeadCents, 769); // round(10000/13) = round(769.23...)
  assert.equal(d.revenuePerSaleCents, 4500); // 18000/4
  assert.equal(d.viewToLeadPct, 6.5); // 13/200*100
  assert.equal(d.cfaRatioPct, 180); // 18000/10000*100 — upfront can exceed spend
  assert.equal(d.totalUpfrontCents, 18000); // pass-through, labeled "cash collected"
});

test("0 leads → costPerLeadCents null; viewToLeadPct is a real 0%, not null (views still > 0)", () => {
  const d = computePanelMetrics({ ...base, leads: 0 });
  assert.equal(d.costPerLeadCents, null);
  assert.equal(d.viewToLeadPct, 0);
});

test("0 ad spend → costPerLeadCents AND cfaRatioPct null, even with leads/upfront present", () => {
  const d = computePanelMetrics({ ...base, adSpendCents: 0 });
  assert.equal(d.costPerLeadCents, null);
  assert.equal(d.cfaRatioPct, null);
});

test("0 converts → revenuePerSaleCents null regardless of upfront cash", () => {
  const d = computePanelMetrics({ ...base, converts: 0 });
  assert.equal(d.revenuePerSaleCents, null);
});

test("0 landing views → viewToLeadPct null regardless of leads", () => {
  const d = computePanelMetrics({ ...base, landingViews: 0 });
  assert.equal(d.viewToLeadPct, null);
});

test("0 upfront cash with real spend/converts → real zero values, not null", () => {
  const d = computePanelMetrics({ ...base, upfrontCashCents: 0 });
  assert.equal(d.revenuePerSaleCents, 0); // converts>0 guard only — upfront=0 is a genuine 0
  assert.equal(d.cfaRatioPct, 0); // adSpend>0 guard only — 0% of spend covered, not null
  assert.equal(d.totalUpfrontCents, 0);
});

test("everything zero → every derived metric is null or 0, never NaN/Infinity", () => {
  const d = computePanelMetrics({ leads: 0, converts: 0, adSpendCents: 0, upfrontCashCents: 0, landingViews: 0 });
  assert.equal(d.costPerLeadCents, null);
  assert.equal(d.revenuePerSaleCents, null);
  assert.equal(d.viewToLeadPct, null);
  assert.equal(d.cfaRatioPct, null);
  assert.equal(d.totalUpfrontCents, 0);
  for (const [key, v] of Object.entries(d)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${key} should be finite, got ${v}`);
  }
});
