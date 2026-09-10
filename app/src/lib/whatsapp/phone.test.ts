/**
 * Unit tests for phone normalization / matching — the logic that dedupes inbound
 * numbers to a lead/client. Pure, no I/O. Run: npx tsx src/lib/whatsapp/phone.test.ts
 */
import assert from "node:assert/strict";

import { normalizePhone, phonesMatch, toE164 } from "./phone";

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

// ── toE164: the telephony form, with the '+' ────────────────────────────────
// A separate function from normalizePhone on purpose — Twilio and the voice
// provider reject the bare-digit form the WhatsApp bridge wants, and this is
// the exact mismatch that would have failed the first real outbound call.
{
  assert.equal(toE164("083 867 2844"), "+353838672844", "Irish national form gets the country code AND the plus");
  assert.equal(toE164("+353 87 123 4567"), "+353871234567");
  assert.equal(toE164("00353871234567"), "+353871234567");
  assert.equal(toE164(null), "", "no number is not a number");
  assert.equal(toE164(""), "");
  assert.equal(toE164("12345"), "", "too short to be an international number — refused, not dialled");
  assert.equal(toE164("1234567890123456"), "", "past E.164's 15-digit maximum");
  assert.notEqual(
    toE164("+353871234567"),
    normalizePhone("+353871234567"),
    "the two forms are deliberately different — that difference is the point",
  );
  console.log("phone.test.ts: toE164 assertions passed");
}
