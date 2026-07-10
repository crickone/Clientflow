/**
 * Unit tests for phone normalization / matching — the logic that dedupes inbound
 * numbers to a lead/client. Pure, no I/O. Run: npx tsx src/lib/whatsapp/phone.test.ts
 */
import assert from "node:assert/strict";

import { normalizePhone, phonesMatch } from "./phone";

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

check("null → empty", normalizePhone(null), "");
check("undefined → empty", normalizePhone(undefined), "");
check("empty → empty", normalizePhone(""), "");
check("+CC form strips '+'", normalizePhone("+353851234567"), "353851234567");
check("00CC form strips '00'", normalizePhone("00353851234567"), "353851234567");
check("national 0-trunk → country code", normalizePhone("0851234567"), "353851234567");
check("strips spaces", normalizePhone("085 123 4567"), "353851234567");
check("strips punctuation", normalizePhone("(085) 123-4567"), "353851234567");
check("already country-code, untouched", normalizePhone("353851234567"), "353851234567");

check(
  "match across formats (national vs +CC)",
  phonesMatch("085 123 4567", "+353 85 123 4567"),
  true,
);
check("different lines don't match", phonesMatch("0851234567", "0861234567"), false);
check("null never matches", phonesMatch(null, null), false);
check("empty never matches", phonesMatch("", ""), false);

console.log(`\nphone: ${passed} checks passed.`);
