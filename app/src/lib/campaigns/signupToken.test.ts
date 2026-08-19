// Run: npm test -- src/lib/campaigns/signupToken.test.ts
//
// Pure crypto tests for the HMAC-signed campaign-signup token (Fix wave 1 —
// closes the cross-tenant lead-injection hole in POST /api/campaigns/signup,
// commit 89c08ad). Mirrors src/lib/marketing/unsubscribeToken.test.ts almost
// line for line: mint/verify round-trip, tamper detection (payload and
// signature separately), malformed shapes never throw, fail-closed behaviour
// when EMAIL_TOKEN_SECRET is unset/wrong — plus the one property that matters
// most for THIS token: a token signed for one (tenantId, campaignId) pair
// must never verify as a claim for a different pair. That's the actual fix —
// without the secret, an attacker cannot mint (or mutate) a token that claims
// someone else's tenant/campaign. No DB, no tenant context — this module
// never touches SQLite.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { signCampaignSignupToken, verifyCampaignSignupToken } from "./signupToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-campaign-signup-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

/**
 * Hand-rolled token builder — mirrors signupToken.ts's own sign() exactly, so
 * tests can construct a VALIDLY-SIGNED token carrying a payload the module
 * itself would never mint (bad JSON, wrong field types, missing fields).
 * That's distinct from the tamper tests below (which corrupt an
 * already-minted token and expect the signature check to catch it) — this
 * exercises verifyCampaignSignupToken's own parsing/shape checks, which only
 * run once the signature has already passed.
 */
function buildToken(payloadText: string, secret: string): string {
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;

  // ── shape + round-trip ──
  const token = signCampaignSignupToken({ tenantId: 1, campaignId: 2 });
  check("token is a non-empty string", typeof token === "string" && token.length > 0);
  check("token has exactly one '.' (payload.signature)", token.split(".").length === 2);

  const claim = verifyCampaignSignupToken(token);
  check("round-trip: not null", claim !== null);
  check("round-trip: tenantId", claim?.tenantId === 1);
  check("round-trip: campaignId", claim?.campaignId === 2);

  // Different ids -> a different token (sanity: not a constant/degenerate output).
  const token2 = signCampaignSignupToken({ tenantId: 1, campaignId: 3 });
  check("different campaignId -> different token", token2 !== token);

  // ── the property this token exists for: never verifies as a DIFFERENT claim ──
  {
    const claimFor2 = verifyCampaignSignupToken(token);
    check("token signed for {t:1,c:2} verifies with campaignId 2", claimFor2?.campaignId === 2);
    check(
      "token signed for {t:1,c:2} does not verify as campaignId 3",
      claimFor2 !== null && claimFor2.campaignId !== 3,
    );
    const claimFor3 = verifyCampaignSignupToken(token2);
    check(
      "token signed for {t:1,c:3} verifies as c:3, not c:2 (the other campaign's token)",
      claimFor3?.campaignId === 3 && claimFor3?.tenantId === 1,
    );
  }
  {
    const tokenForTenant2 = signCampaignSignupToken({ tenantId: 2, campaignId: 2 });
    const claimT2 = verifyCampaignSignupToken(tokenForTenant2);
    check(
      "token signed for {t:2,c:2} verifies with tenantId:2, and differs from the {t:1,c:2} token",
      claimT2?.tenantId === 2 && tokenForTenant2 !== token,
    );
  }

  // ── invalid inputs never throw + always fail closed ──
  check(
    "signCampaignSignupToken rejects a non-positive tenantId",
    (() => {
      try {
        signCampaignSignupToken({ tenantId: 0, campaignId: 1 });
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    "signCampaignSignupToken rejects a non-integer campaignId",
    (() => {
      try {
        signCampaignSignupToken({ tenantId: 1, campaignId: 1.5 });
        return false;
      } catch {
        return true;
      }
    })(),
  );

  check("empty string -> null", verifyCampaignSignupToken("") === null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  check("non-string input -> null", verifyCampaignSignupToken(undefined as any) === null);
  check("no '.' at all -> null", verifyCampaignSignupToken("nodothere") === null);
  check("too many parts -> null", verifyCampaignSignupToken("a.b.c") === null);
  check("empty payload -> null", verifyCampaignSignupToken(".sig") === null);
  check("empty signature -> null", verifyCampaignSignupToken("payload.") === null);
  assert.doesNotThrow(
    () => verifyCampaignSignupToken("%%%not-valid-base64%%%.also-not-a-real-signature"),
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
      verifyCampaignSignupToken(`${tamperedPayload}.${sig}`) === null,
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
      verifyCampaignSignupToken(`${payload}.${tamperedSig}`) === null,
    );
  }

  // Length-mismatched signature must fail WITHOUT throwing (the whole point
  // of the length-check-before-timingSafeEqual guard: timingSafeEqual itself
  // throws on a Buffer length mismatch rather than returning false).
  {
    const [payload, sig] = token.split(".");
    assert.doesNotThrow(
      () => verifyCampaignSignupToken(`${payload}.${sig.slice(0, -4)}`),
      "a shorter signature guess must not throw",
    );
    passed++;
    console.log("  ✓ length-mismatched signature does not throw");
    check(
      "length-mismatched signature -> null",
      verifyCampaignSignupToken(`${payload}.${sig.slice(0, -4)}`) === null,
    );
  }

  // ── valid signature, but a payload the module itself would never mint ──
  check(
    "valid signature, non-JSON payload -> null",
    verifyCampaignSignupToken(buildToken("not json", SECRET)) === null,
  );
  check(
    "valid signature, JSON array payload -> null",
    verifyCampaignSignupToken(buildToken("[1,2]", SECRET)) === null,
  );
  check(
    "valid signature, missing 'c' field -> null",
    verifyCampaignSignupToken(buildToken(JSON.stringify({ t: 1 }), SECRET)) === null,
  );
  check(
    "valid signature, string-typed 't' -> null (no coercion)",
    verifyCampaignSignupToken(buildToken(JSON.stringify({ t: "1", c: 2 }), SECRET)) === null,
  );
  check(
    "valid signature, zero campaignId -> null",
    verifyCampaignSignupToken(buildToken(JSON.stringify({ t: 1, c: 0 }), SECRET)) === null,
  );
  check(
    "valid signature, negative tenantId -> null",
    verifyCampaignSignupToken(buildToken(JSON.stringify({ t: -1, c: 2 }), SECRET)) === null,
  );
  check(
    "valid signature, non-integer campaignId -> null",
    verifyCampaignSignupToken(buildToken(JSON.stringify({ t: 1, c: 2.5 }), SECRET)) === null,
  );

  // ── wrong secret -> null (a token minted under one secret doesn't verify under another) ──
  {
    const mintedUnderSecret = signCampaignSignupToken({ tenantId: 1, campaignId: 1 });
    process.env.EMAIL_TOKEN_SECRET = "a-completely-different-secret";
    check("wrong secret -> null", verifyCampaignSignupToken(mintedUnderSecret) === null);
    process.env.EMAIL_TOKEN_SECRET = SECRET;
  }

  // ── fail closed when EMAIL_TOKEN_SECRET is unset entirely ──
  delete process.env.EMAIL_TOKEN_SECRET;
  check(
    "unset secret -> verifyCampaignSignupToken returns null",
    verifyCampaignSignupToken(token) === null,
  );
  assert.throws(
    () => signCampaignSignupToken({ tenantId: 1, campaignId: 1 }),
    /EMAIL_TOKEN_SECRET/,
    "unset secret -> signCampaignSignupToken throws (a loud mint-time failure, not a silently-broken token)",
  );
  passed++;
  console.log("  ✓ unset secret -> signCampaignSignupToken throws");

  console.log(`\nsignupToken.test.ts: ${passed} checks passed.`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
