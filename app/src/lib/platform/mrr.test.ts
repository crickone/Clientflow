// Run: npm test -- src/lib/platform/mrr.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { mrrMovements } = requireLocal("./mrr") as typeof import("./mrr");

const months = ["2026-09", "2026-10", "2026-11"];
const out = mrrMovements(
  [
    { tenantId: 1, month: "2026-09", type: "activated", priceCents: 20000 },
    { tenantId: 2, month: "2026-09", type: "activated", priceCents: 20000 },
    { tenantId: 1, month: "2026-10", type: "price_changed", priceCents: 25000, previousPriceCents: 20000 },
    { tenantId: 2, month: "2026-10", type: "suspended", priceCents: 20000 },
    { tenantId: 2, month: "2026-11", type: "reactivated", priceCents: 20000 },
    { tenantId: 3, month: "2026-11", type: "price_changed", priceCents: 15000, previousPriceCents: 20000 },
    { tenantId: 9, month: "2025-01", type: "activated", priceCents: 1 },
  ],
  months,
);
assert.deepEqual(out, [
  { month: "2026-09", newCents: 40000, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 40000 },
  { month: "2026-10", newCents: 0, expansionCents: 5000, contractionCents: 0, churnCents: 20000, reactivationCents: 0, netCents: -15000 },
  { month: "2026-11", newCents: 0, expansionCents: 0, contractionCents: 5000, churnCents: 0, reactivationCents: 20000, netCents: 15000 },
]);
console.log("mrr.test.ts: ok");
