// Run: npm test -- src/lib/whatsapp/whapi.test.ts
//
// Batch 2d (timing-safe whapi webhook compare, improvement-plan-2026-08.md
// Theme B5): verifyWebhook() used to do `providedSecret === this.webhookSecret`,
// a timing-variant comparison. Now uses a length check + crypto.timingSafeEqual
// (mirrors the cron routes' secretMatches helper). Covers: equal -> true,
// unequal (same length and different lengths) -> false, and — since
// timingSafeEqual itself throws on a length mismatch — that the length guard
// means no input ever throws.
import assert from "node:assert/strict";
import { WhapiBridge } from "./whapi";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "s3cr3t-webhook-value";
const bridge = new WhapiBridge({ token: "tok", webhookSecret: SECRET });

check("equal secret -> true", bridge.verifyWebhook(SECRET) === true);
check(
  "unequal, same length -> false",
  bridge.verifyWebhook("X3cr3t-webhook-value") === false,
);
check("unequal, shorter -> false", bridge.verifyWebhook("short") === false);
check(
  "unequal, longer -> false",
  bridge.verifyWebhook(`${SECRET}-and-then-some-more`) === false,
);
check("null provided -> false", bridge.verifyWebhook(null) === false);
check("empty string provided -> false", bridge.verifyWebhook("") === false);

// The whole point of the length guard: a mismatched-length compare must not
// throw (crypto.timingSafeEqual throws directly on a Buffer length mismatch).
assert.doesNotThrow(
  () => bridge.verifyWebhook("a-totally-different-length-guess"),
  "longer guess must not throw",
);
passed++;
console.log("  ✓ longer guess does not throw");
assert.doesNotThrow(() => bridge.verifyWebhook(""), "empty guess must not throw");
passed++;
console.log("  ✓ empty guess does not throw");

// Fail closed if unconfigured — never reaches the compare at all.
const unconfigured = new WhapiBridge({ token: "tok" });
check("unconfigured secret -> always false", unconfigured.verifyWebhook("") === false);
check(
  "unconfigured secret vs non-empty -> false",
  unconfigured.verifyWebhook("whatever") === false,
);

console.log(`\nwhapi: ${passed} checks passed.`);
