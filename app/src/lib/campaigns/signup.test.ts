/**
 * Pure tests for the public campaign-signup validation helpers
 * (Campaign Engine Slice 2, Task 2). signup.ts has zero runtime imports, so
 * this loads under the plain tsx test runner exactly like
 * src/lib/campaigns/assetBody.test.ts — no DB, no shim needed.
 *
 * "Fix wave 1" (see signup.ts's module doc + the Task 2 report's "Fix wave 1"
 * section) dropped `campaignSlug` from this module's accepted shape — the
 * route now resolves tenant+campaign from a separately verified signed token
 * (lib/campaigns/signupToken.ts, its own test file), not from anything
 * validateSignup shapes. The campaignSlug-specific tests that used to live
 * here were removed rather than repointed, since the field no longer exists.
 *
 * Run: npm test -- src/lib/campaigns/signup.test.ts
 */
import assert from "node:assert/strict";

import { isHoneypotTripped, validateSignup } from "./signup";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ── validateSignup: happy paths ─────────────────────────────────────────────

{
  const result = validateSignup({
    name: "Niamh Walsh",
    email: "niamh@example.com",
    phone: "",
    message: "Interested in the summer offer.",
  });
  check("validateSignup: valid submission (email only) → ok:true", result.ok === true);
  check(
    "validateSignup: name round-trips",
    result.ok === true && result.data.name === "Niamh Walsh",
  );
  check(
    "validateSignup: email round-trips",
    result.ok === true && result.data.email === "niamh@example.com",
  );
  check("validateSignup: blank phone normalises to null", result.ok === true && result.data.phone === null);
  check(
    "validateSignup: message round-trips",
    result.ok === true && result.data.message === "Interested in the summer offer.",
  );
}

check(
  "validateSignup: valid submission (phone only, no email) → ok:true",
  validateSignup({ name: "Sean", phone: "0871234567" }).ok === true,
);

check(
  "validateSignup: valid submission (both email + phone) → ok:true",
  validateSignup({
    name: "Sean",
    email: "sean@example.com",
    phone: "0871234567",
  }).ok === true,
);

{
  // message is optional — absent entirely still validates.
  const result = validateSignup({ name: "Sean", email: "sean@example.com" });
  check("validateSignup: missing message → ok:true", result.ok === true);
  check("validateSignup: missing message defaults to null", result.ok === true && result.data.message === null);
}

// ── validateSignup: trimming ────────────────────────────────────────────────

{
  const result = validateSignup({
    name: "  Niamh Walsh  ",
    email: "  niamh@example.com  ",
  });
  check(
    "validateSignup: trims surrounding whitespace on every field",
    result.ok === true &&
      result.data.name === "Niamh Walsh" &&
      result.data.email === "niamh@example.com",
  );
}

check(
  "validateSignup: whitespace-only name is treated as missing",
  validateSignup({ name: "   ", email: "a@b.com" }).ok === false,
);

// ── validateSignup: name required ───────────────────────────────────────────

check(
  "validateSignup: missing name → ok:false",
  validateSignup({ email: "a@b.com" }).ok === false,
);

check(
  "validateSignup: empty-string name → ok:false",
  validateSignup({ name: "", email: "a@b.com" }).ok === false,
);

check(
  "validateSignup: non-string name → ok:false",
  validateSignup({ name: 123, email: "a@b.com" }).ok === false,
);

// ── validateSignup: at least one of email/phone ─────────────────────────────

check(
  "validateSignup: neither email nor phone → ok:false",
  validateSignup({ name: "Sean" }).ok === false,
);

check(
  "validateSignup: both email and phone blank strings → ok:false",
  validateSignup({ name: "Sean", email: "", phone: "" }).ok === false,
);

{
  const result = validateSignup({ name: "Sean" });
  check(
    "validateSignup: the at-least-one-contact error is specific (not the generic 'invalid body' one)",
    result.ok === false && /email|phone/i.test(result.error),
  );
}

// ── validateSignup: email format ────────────────────────────────────────────

check(
  "validateSignup: malformed email (no @) → ok:false",
  validateSignup({ name: "Sean", email: "not-an-email" }).ok === false,
);

check(
  "validateSignup: malformed email (no domain) → ok:false",
  validateSignup({ name: "Sean", email: "sean@" }).ok === false,
);

check(
  "validateSignup: malformed email (space) → ok:false",
  validateSignup({ name: "Sean", email: "sean @example.com" }).ok === false,
);

check(
  "validateSignup: well-formed email → ok:true",
  validateSignup({ name: "Sean", email: "sean.oreilly+tag@sub.example.co.uk" }).ok === true,
);

// ── validateSignup: length caps (~200 for short fields, 2000 for message) ──

check(
  "validateSignup: name over 200 chars → ok:false",
  validateSignup({ name: "a".repeat(201), email: "a@b.com" }).ok === false,
);

check(
  "validateSignup: name at exactly 200 chars → ok:true (boundary)",
  validateSignup({ name: "a".repeat(200), email: "a@b.com" }).ok === true,
);

check(
  "validateSignup: email over 200 chars → ok:false",
  validateSignup({
    name: "Sean",
    email: `${"a".repeat(195)}@b.com`, // > 200 chars total, still email-shaped
  }).ok === false,
);

check(
  "validateSignup: phone over 200 chars → ok:false",
  validateSignup({ name: "Sean", phone: "1".repeat(201) }).ok === false,
);

check(
  "validateSignup: message over 2000 chars → ok:false",
  validateSignup({
    name: "Sean",
    email: "a@b.com",
    message: "a".repeat(2001),
  }).ok === false,
);

check(
  "validateSignup: message at exactly 2000 chars → ok:true (boundary)",
  validateSignup({
    name: "Sean",
    email: "a@b.com",
    message: "a".repeat(2000),
  }).ok === true,
);

// ── validateSignup: malformed body shapes ───────────────────────────────────

check("validateSignup: null body → ok:false", validateSignup(null).ok === false);
check("validateSignup: undefined body → ok:false", validateSignup(undefined).ok === false);
check("validateSignup: array body → ok:false", validateSignup(["not", "an", "object"]).ok === false);
check("validateSignup: string body → ok:false", validateSignup("just a string").ok === false);
check("validateSignup: empty object body → ok:false", validateSignup({}).ok === false);

// ── validateSignup: no campaign identifier in the accepted shape ───────────
// "Fix wave 1": a stray `campaignSlug`/`token`/tenant-ish field in the body
// is simply ignored by this module — it's not part of ValidSignup and never
// echoed back. The route reads `token` directly off the raw body and
// verifies it with signupToken.ts, entirely separately from this function.

check(
  "validateSignup: a submission with NO campaignSlug at all → ok:true (no longer required)",
  validateSignup({ name: "Sean", email: "a@b.com" }).ok === true,
);

{
  const result = validateSignup({ name: "Sean", email: "a@b.com", campaignSlug: "some-other-tenant" });
  check(
    "validateSignup: a stray campaignSlug field is accepted but not surfaced in the result",
    result.ok === true && !("campaignSlug" in result.data),
  );
}

// ── isHoneypotTripped ────────────────────────────────────────────────────────

check(
  "isHoneypotTripped: filled honeypot field → true",
  isHoneypotTripped({ name: "Bot", website: "http://spam.example" }) === true,
);

check(
  "isHoneypotTripped: absent honeypot field → false",
  isHoneypotTripped({ name: "Real Person", email: "a@b.com" }) === false,
);

check(
  "isHoneypotTripped: empty-string honeypot field → false",
  isHoneypotTripped({ name: "Real Person", website: "" }) === false,
);

check(
  "isHoneypotTripped: whitespace-only honeypot field → false (trimmed)",
  isHoneypotTripped({ name: "Real Person", website: "   " }) === false,
);

check(
  "isHoneypotTripped: a real submission (no honeypot fill) never trips",
  isHoneypotTripped({
    name: "Niamh Walsh",
    email: "niamh@example.com",
    phone: "",
    message: "",
  }) === false,
);

check("isHoneypotTripped: null body → false (safe default)", isHoneypotTripped(null) === false);
check("isHoneypotTripped: non-object body → false (safe default)", isHoneypotTripped("string") === false);

console.log(`\n${passed} passed`);
