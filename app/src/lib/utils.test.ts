/**
 * Unit tests for the pure formatting/date helpers: money formatting, Monday-based
 * weeks, and the LOCAL 'today' (not UTC — the calendar day must round-trip).
 * Pure, no I/O. Run: npx tsx src/lib/utils.test.ts
 */
import assert from "node:assert/strict";

import {
  addDays,
  formatEur,
  genVoucherCode,
  initialsOf,
  startOfWeek,
  todayIso,
} from "./utils";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// formatEur — Intl en-IE EUR. Assert structure (robust to symbol/grouping variance).
ok("formatEur(0) shows 0.00", formatEur(0).includes("0.00"));
ok("formatEur is in euro", /€|EUR/.test(formatEur(5)));
ok("formatEur groups thousands", formatEur(1234.5).includes("1,234.50"));
ok("formatEur coerces null-ish → 0", formatEur(null as unknown as number).includes("0.00"));

// todayIso — must be the LOCAL calendar day (regression guard vs the UTC bug).
ok("todayIso is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayIso()));
ok(
  "todayIso matches local day",
  new Date(`${todayIso()}T00:00:00`).getDate() === new Date().getDate(),
);

// startOfWeek — Monday-based.
const wed = startOfWeek(new Date(2024, 0, 3)); // Wed 3 Jan 2024 → Mon 1 Jan
check(
  "startOfWeek(Wed) → that week's Monday",
  [wed.getFullYear(), wed.getMonth(), wed.getDate(), wed.getDay()],
  [2024, 0, 1, 1],
);
const sun = startOfWeek(new Date(2024, 0, 7)); // Sun 7 Jan 2024 → Mon 1 Jan (not next week)
check("startOfWeek(Sun) → prior Monday", [sun.getMonth(), sun.getDate()], [0, 1]);

// addDays — month boundary + leap-year rollover.
const feb1 = addDays(new Date(2024, 0, 31), 1);
check("addDays crosses month boundary", [feb1.getMonth(), feb1.getDate()], [1, 1]);
const leap = addDays(new Date(2024, 1, 28), 1);
check("addDays into leap-year Feb 29", [leap.getMonth(), leap.getDate()], [1, 29]);

check("initials uppercase both", initialsOf("jane", "doe"), "JD");
check("initials handle empty", initialsOf("", ""), "");

ok("voucher code format RCH-YYYY-XXXX", /^RCH-\d{4}-[A-Z0-9]{4}$/.test(genVoucherCode()));

console.log(`\nutils: ${passed} checks passed.`);
