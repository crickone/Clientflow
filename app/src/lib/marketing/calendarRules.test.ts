import assert from "node:assert/strict";

import { LEAD_DAYS, monthsToShow, schoolDatesForYear, startBy, statusLabel } from "./calendarRules";

// School dates land on the days the standardised calendar uses.
const s2026 = Object.fromEntries(schoolDatesForYear(2026).map((d) => [d.id, d.iso]));
assert.equal(s2026["school-feb-midterm"], "2026-02-16", "February mid-term starts the third Monday");
assert.equal(s2026["school-leaving-cert"], "2026-06-03", "Leaving Cert starts the first Wednesday in June");
assert.equal(s2026["school-oct-midterm"], "2026-10-26", "October mid-term is the bank holiday week");
assert.equal(s2026["school-easter"], "2026-03-29", "Easter holidays start a week before Easter Sunday");
assert.equal(schoolDatesForYear(2025).find((d) => d.id === "school-jan-return")!.iso, "2025-01-06");
assert.equal(schoolDatesForYear(2029).find((d) => d.id === "school-jan-return")!.iso, "2029-01-08", "a Saturday moves to Monday");

// Start-by: LEAD_DAYS before, and how urgent that is.
assert.equal(LEAD_DAYS, 21);
assert.deepEqual(startBy("2026-10-26", "2026-09-01"), { iso: "2026-10-05", tone: "ok" });
assert.deepEqual(startBy("2026-10-26", "2026-09-30"), { iso: "2026-10-05", tone: "soon" });
assert.deepEqual(startBy("2026-10-26", "2026-10-06"), { iso: "2026-10-05", tone: "late" });
assert.equal(startBy("2026-10-26", "2026-10-27"), null, "nothing to start once the day has passed");

assert.equal(statusLabel("active")!.label, "Live");
assert.equal(statusLabel("archived"), null);

// A rolling window crosses the year.
const roll = monthsToShow({ rollingFrom: "2026-10-06" });
assert.equal(roll.length, 12);
assert.deepEqual(roll[0], { year: 2026, month: 10 });
assert.deepEqual(roll[3], { year: 2027, month: 1 });
assert.deepEqual(roll[11], { year: 2027, month: 9 });
assert.deepEqual(monthsToShow({ year: 2027 })[0], { year: 2027, month: 1 });

console.log("calendarRules.test.ts: ok");
