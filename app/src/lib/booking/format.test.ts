// Run: npm test -- src/lib/booking/format.test.ts
import assert from "node:assert/strict";

import { addMinutes, chipTime, clock12, euro, fullDate, shortDate, weekdayIndex, weekdayLong, weekdayShort } from "./format";

assert.equal(weekdayIndex("2026-11-26"), 4, "26 Nov 2026 is a Thursday");
assert.equal(weekdayIndex("2026-11-29"), 0, "29 Nov 2026 is a Sunday");
assert.equal(weekdayShort("2026-11-25"), "Wed");
assert.equal(weekdayLong("2026-11-26"), "Thursday");
assert.equal(shortDate("2026-11-26"), "Thu 26 Nov");
assert.equal(shortDate("2026-12-01"), "Tue 1 Dec");
assert.equal(fullDate("2027-03-01"), "1 Mar 2027");

assert.equal(euro(80), "€80");
assert.equal(euro(64), "€64");
assert.equal(euro(64.5), "€64.50");
assert.equal(euro(26.666666), "€26.67");
assert.equal(euro(0), "€0");
assert.equal(euro(Number.NaN), "€0", "a missing price reads as zero, never NaN");

assert.equal(addMinutes("12:45", 60), "13:45");
assert.equal(addMinutes("09:00", 15), "09:15");
assert.equal(addMinutes("23:30", 45), "00:15", "wraps past midnight");

assert.equal(chipTime("09:00"), "9:00");
assert.equal(chipTime("12:45"), "12:45");
assert.equal(chipTime("00:15"), "0:15");

assert.equal(clock12("09:00"), "9am");
assert.equal(clock12("19:00"), "7pm");
assert.equal(clock12("19:30"), "7:30pm");
assert.equal(clock12("12:00"), "12pm");
assert.equal(clock12("00:00"), "12am");

console.log("booking format: all checks passed.");
