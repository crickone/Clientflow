// Run: npm test -- src/lib/cashModel.test.ts
//
// Reports shows money taken (every payment, online sales included) by Irish
// calendar day, beside revenue earned from sessions done.
import assert from "node:assert/strict";

import { bucketByDay, dublinDay, rangeBoundsMs } from "./cashModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("half past midnight Irish summer time is that Irish day", dublinDay(Date.parse("2026-10-13T23:30:00Z")) === "2026-10-14");
check("winter time: UTC and Irish days match", dublinDay(Date.parse("2026-11-30T23:30:00Z")) === "2026-11-30");

const rows = [
  { at: Date.parse("2026-10-14T15:00:00Z"), amount: 64 },
  { at: Date.parse("2026-10-14T16:00:00Z"), amount: 40 },
  { at: Date.parse("2026-10-16T10:00:00Z"), amount: 80 },
  { at: Date.parse("2026-10-20T10:00:00Z"), amount: 999 },
];
const days = bucketByDay(rows, "2026-10-14", "2026-10-17");
check("every day in the range, zero-filled", days.length === 4 && days[1].total === 0 && days[3].total === 0);
check("payments on one day add up", days[0].day === "2026-10-14" && days[0].total === 104);
check("days outside the range are left out", days.reduce((s, d) => s + d.total, 0) === 184);
check("cents don't drift", bucketByDay([{ at: Date.parse("2026-10-14T10:00:00Z"), amount: 0.1 }, { at: Date.parse("2026-10-14T11:00:00Z"), amount: 0.2 }], "2026-10-14", "2026-10-14")[0].total === 0.3);
check("a range across the clocks going back still has one entry per day", bucketByDay([], "2026-10-24", "2026-10-26").map((d) => d.day).join() === "2026-10-24,2026-10-25,2026-10-26");

const b = rangeBoundsMs("2026-10-14", "2026-10-14");
check("the query window covers the whole Irish day", b.from <= Date.parse("2026-10-13T23:00:00Z") && b.to >= Date.parse("2026-10-14T22:59:59Z"));

console.log(`cashModel: ${passed} checks passed`);
