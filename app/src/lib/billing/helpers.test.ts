// Run: npx tsx src/lib/billing/helpers.test.ts
import assert from "node:assert/strict";
import { computeVat, formatCents } from "./money";
import { addMonthClamped, addDays, cmpDate, dublinDayOfMonth } from "./dates";

// VAT: 23% of €99.00 → €22.77; gross €121.77. Rounding is half-up per cent.
assert.deepEqual(computeVat(9900, 2300), { netCents: 9900, vatCents: 2277, grossCents: 12177 });
assert.deepEqual(computeVat(3333, 2300), { netCents: 3333, vatCents: 767, grossCents: 4100 }); // 766.59 → 767
assert.deepEqual(computeVat(9900, 0), { netCents: 9900, vatCents: 0, grossCents: 9900 });
assert.equal(formatCents(12177), "€121.77");
assert.equal(formatCents(9900), "€99.00");

// Month advance clamps to month length but RESTORES the anchor when possible.
assert.equal(addMonthClamped("2026-01-31", 31), "2026-02-28"); // clamp
assert.equal(addMonthClamped("2026-02-28", 31), "2026-03-31"); // restore anchor
assert.equal(addMonthClamped("2024-01-31", 31), "2024-02-29"); // leap year
assert.equal(addMonthClamped("2026-03-31", 31), "2026-04-30");
assert.equal(addMonthClamped("2026-07-15", 15), "2026-08-15"); // plain case
assert.equal(addMonthClamped("2026-12-15", 15), "2027-01-15"); // year wrap

assert.equal(addDays("2026-02-27", 3), "2026-03-02");
assert.equal(cmpDate("2026-07-01", "2026-07-02") < 0, true);
assert.equal(cmpDate("2026-07-02", "2026-07-02"), 0);
assert.equal(dublinDayOfMonth("2026-07-31"), 31);

console.log("helpers.test.ts: all assertions passed");
