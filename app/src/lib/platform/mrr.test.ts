// Run: npm test -- src/lib/platform/mrr.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { mrrMovements, mrrAnalysis } = requireLocal("./mrr") as typeof import("./mrr");
type MrrEvent = import("./mrr").MrrEvent;

const months = ["2026-09", "2026-10", "2026-11"];
let clock = 0;
const ev = (e: Omit<MrrEvent, "at">): MrrEvent => ({ ...e, at: ++clock });
const zero = (month: string) => ({ month, newCents: 0, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 0 });

// The base case: new, expansion, churn, reactivation, contraction.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 9, month: "2025-01", type: "activated", priceCents: 1 }),
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 3, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-10", type: "price_changed", priceCents: 25000, previousPriceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-10", type: "suspended", priceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-11", type: "reactivated", priceCents: 20000 }),
      ev({ tenantId: 3, month: "2026-11", type: "price_changed", priceCents: 15000, previousPriceCents: 20000 }),
    ],
    months,
  );
  assert.deepEqual(out, [
    { month: "2026-09", newCents: 60000, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 60000 },
    { month: "2026-10", newCents: 0, expansionCents: 5000, contractionCents: 0, churnCents: 20000, reactivationCents: 0, netCents: -15000 },
    { month: "2026-11", newCents: 0, expansionCents: 0, contractionCents: 5000, churnCents: 0, reactivationCents: 20000, netCents: 15000 },
  ]);
}

// Events are processed in time order, whatever order they arrive in.
{
  const out = mrrMovements(
    [
      { tenantId: 1, at: 2, month: "2026-10", type: "suspended" },
      { tenantId: 1, at: 1, month: "2026-09", type: "activated", priceCents: 20000 },
    ],
    months,
  );
  assert.equal(out[0].newCents, 20000);
  assert.equal(out[1].churnCents, 20000);
}

// Suspended then offboarded counts churn once.
{
  const r = mrrAnalysis(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-10", type: "suspended" }),
      ev({ tenantId: 1, month: "2026-10", type: "offboarded" }),
      ev({ tenantId: 2, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-10", type: "suspended" }),
      ev({ tenantId: 2, month: "2026-11", type: "cancelled" }),
    ],
    months,
  );
  assert.equal(r.movements[1].churnCents, 40000, "two businesses churn once each in October");
  assert.equal(r.movements[2].churnCents, 0, "a cancel after a suspend is not a second churn");
  assert.deepEqual(r.churnedByMonth, [{ month: "2026-09", count: 0 }, { month: "2026-10", count: 2 }, { month: "2026-11", count: 0 }]);
}

// Reactivated without a prior churn counts nothing.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-10", type: "reactivated", priceCents: 20000 }),
    ],
    months,
  );
  assert.deepEqual(out[1], zero("2026-10"));
}

// An exempt business never pays: its suspend and reactivate count nothing,
// and being exempted while paying is a churn.
{
  const r = mrrAnalysis(
    [
      ev({ tenantId: 1, month: "2026-09", type: "billing_exempted" }),
      ev({ tenantId: 1, month: "2026-10", type: "suspended", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-11", type: "reactivated", priceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 2, month: "2026-10", type: "billing_exempted" }),
      ev({ tenantId: 2, month: "2026-11", type: "billing_unexempted" }),
    ],
    months,
    () => 20000,
  );
  assert.deepEqual(r.movements, [
    { ...zero("2026-09"), newCents: 20000, netCents: 20000 },
    { ...zero("2026-10"), churnCents: 20000, netCents: -20000 },
    zero("2026-11"),
  ]);
  assert.deepEqual(r.churnedByMonth.map((c) => c.count), [0, 1, 0]);
}

// An event before the window sets state but is not counted.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-08", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-08", type: "suspended" }),
      ev({ tenantId: 1, month: "2026-09", type: "reactivated" }),
      ev({ tenantId: 2, month: "2026-08", type: "activated", priceCents: 30000 }),
      ev({ tenantId: 2, month: "2026-09", type: "suspended" }),
    ],
    months,
  );
  assert.deepEqual(out[0], { ...zero("2026-09"), reactivationCents: 20000, churnCents: 30000, netCents: -10000 });
}

// A price override at activation is the price that churns.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 15000 }),
      ev({ tenantId: 1, month: "2026-10", type: "suspended" }),
    ],
    months,
    () => 20000,
  );
  assert.equal(out[0].newCents, 15000);
  assert.equal(out[1].churnCents, 15000);
}

// A price change with no delta counts nothing.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-10", type: "price_changed", priceCents: 20000, previousPriceCents: 20000 }),
    ],
    months,
  );
  assert.deepEqual(out[1], zero("2026-10"));
}

// With no price on the event, the starting price resolver supplies it.
{
  const out = mrrMovements([ev({ tenantId: 7, month: "2026-09", type: "activated" })], months, (id) => (id === 7 ? 12000 : 0));
  assert.equal(out[0].newCents, 12000);
}

// A suspended business that pays up comes back as `reactivated` (mapped from
// charged), so its later suspend churns again.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-09", type: "suspended" }),
      ev({ tenantId: 1, month: "2026-10", type: "reactivated" }),
      ev({ tenantId: 1, month: "2026-11", type: "suspended" }),
    ],
    months,
  );
  assert.equal(out[0].newCents, 20000);
  assert.equal(out[0].churnCents, 20000);
  assert.equal(out[1].reactivationCents, 20000);
  assert.equal(out[2].churnCents, 20000);
}

// A business whose first event is a churn counts one churn at the resolved price.
{
  const out = mrrMovements([ev({ tenantId: 3, month: "2026-10", type: "suspended" })], months, () => 9000, () => true);
  assert.equal(out[1].churnCents, 9000);
  assert.equal(out[1].netCents, -9000);
}

// A first-event churn for a business that never paid counts nothing.
{
  const out = mrrMovements([ev({ tenantId: 3, month: "2026-10", type: "offboarded" })], months, () => 9000, () => false);
  assert.deepEqual(out[1], zero("2026-10"));
}

// A reactivated (charged) while already paying counts nothing.
{
  const out = mrrMovements(
    [
      ev({ tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 }),
      ev({ tenantId: 1, month: "2026-10", type: "reactivated" }),
    ],
    months,
  );
  assert.deepEqual(out[1], zero("2026-10"));
}

console.log("mrr.test.ts: ok");
