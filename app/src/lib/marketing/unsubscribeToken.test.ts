// Run: npm test -- src/lib/marketing/unsubscribeToken.test.ts
//
// Pure crypto tests for the HMAC-signed unsubscribe token (Task 6): mint/
// verify round-trip, tamper detection (payload and signature separately),
// malformed shapes never throw, and the fail-closed behaviour when
// EMAIL_TOKEN_SECRET is unset or wrong. Mirrors sender/mailgun.test.ts's
// verifyMailgunSignature tests — same HMAC + timingSafeEqual shape (length-
// mismatch must not throw, wrong content -> false), just applied to a
// `payload.signature` token instead of a bare (timestamp, token, signature)
// triple. No DB, no tenant context — this module never touches SQLite.
import assert from "node:assert/strict";

import { createUnsubscribeToken, parseUnsubscribeToken } from "./unsubscribeToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-unsubscribe-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;

  // ── shape + round-trip ──
  const token = createUnsubscribeToken(42, 7);
  check("token is a non-empty string", typeof token === "string" && token.length > 0);
  check("token has exactly one '.' (payload.signature)", token.split(".").length === 2);

  const parsed = parseUnsubscribeToken(token);
  check("round-trip: not null", parsed !== null);
  check("round-trip: tenantId", parsed?.tenantId === 42);
  check("round-trip: contactId", parsed?.contactId === 7);

  // Different ids -> a different token (sanity: not a constant/degenerate output).
  const token2 = createUnsubscribeToken(42, 8);
  check("different contactId -> different token", token2 !== token);
  const parsed2 = parseUnsubscribeToken(token2);
  check("round-trip #2: contactId", parsed2?.contactId === 8);

  // ── invalid inputs never throw + always fail closed ──
  check("createUnsubscribeToken rejects a non-positive tenantId", (() => {
    try {
      createUnsubscribeToken(0, 1);
      return false;
    } catch {
      return true;
    }
  })());
  check("createUnsubscribeToken rejects a non-integer contactId", (() => {
    try {
      createUnsubscribeToken(1, 1.5);
      return false;
    } catch {
      return true;
    }
  })());

  check("empty string -> null", parseUnsubscribeToken("") === null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check("non-string input -> null", parseUnsubscribeToken(undefined as any) === null);
  check("no '.' at all -> null", parseUnsubscribeToken("nodothere") === null);
  check("too many parts -> null", parseUnsubscribeToken("a.b.c") === null);
  check("empty payload -> null", parseUnsubscribeToken(".sig") === null);
  check("empty signature -> null", parseUnsubscribeToken("payload.") === null);
  assert.doesNotThrow(
    () => parseUnsubscribeToken("%%%not-valid-base64%%%.also-not-a-real-signature"),
    "malformed base64url payload must not throw",
  );
  passed++;
  console.log("  ✓ malformed base64url payload does not throw");

  // ── tampered payload -> null (signature no longer matches the new payload) ──
  {
    const [payload, sig] = token.split(".");
    const lastChar = payload.at(-1)!;
    const flipped = lastChar === "0" ? "1" : "0";
    const tamperedPayload = payload.slice(0, -1) + flipped;
    check(
      "tampered payload -> null",
      parseUnsubscribeToken(`${tamperedPayload}.${sig}`) === null,
    );
  }

  // ── tampered signature -> null (same length, different content) ──
  {
    const [payload, sig] = token.split(".");
    const lastChar = sig.at(-1)!;
    const flipped = lastChar === "0" ? "1" : "0";
    const tamperedSig = sig.slice(0, -1) + flipped;
    check(
      "tampered signature (same length) -> null",
      parseUnsubscribeToken(`${payload}.${tamperedSig}`) === null,
    );
  }

  // Length-mismatched signature must fail WITHOUT throwing (the whole point
  // of the length-check-before-timingSafeEqual guard: timingSafeEqual itself
  // throws on a Buffer length mismatch rather than returning false).
  {
    const [payload, sig] = token.split(".");
    assert.doesNotThrow(
      () => parseUnsubscribeToken(`${payload}.${sig.slice(0, -4)}`),
      "a shorter signature guess must not throw",
    );
    passed++;
    console.log("  ✓ length-mismatched signature does not throw");
    check(
      "length-mismatched signature -> null",
      parseUnsubscribeToken(`${payload}.${sig.slice(0, -4)}`) === null,
    );
  }

  // ── wrong secret -> null (a token minted under one secret doesn't verify under another) ──
  {
    const mintedUnderSecret = createUnsubscribeToken(1, 1);
    process.env.EMAIL_TOKEN_SECRET = "a-completely-different-secret";
    check("wrong secret -> null", parseUnsubscribeToken(mintedUnderSecret) === null);
    process.env.EMAIL_TOKEN_SECRET = SECRET;
  }

  // ── fail closed when EMAIL_TOKEN_SECRET is unset entirely ──
  delete process.env.EMAIL_TOKEN_SECRET;
  check("unset secret -> parseUnsubscribeToken returns null", parseUnsubscribeToken(token) === null);
  assert.throws(
    () => createUnsubscribeToken(1, 1),
    /EMAIL_TOKEN_SECRET/,
    "unset secret -> createUnsubscribeToken throws (a loud mint-time failure, not a silently-broken token)",
  );
  passed++;
  console.log("  ✓ unset secret -> createUnsubscribeToken throws");

  console.log(`\nunsubscribeToken.test.ts: ${passed} checks passed.`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
