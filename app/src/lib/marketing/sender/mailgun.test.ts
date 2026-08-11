// Run: npm test -- src/lib/marketing/sender/mailgun.test.ts
//
// Pure-function tests only — verifyMailgunSignature (HMAC-SHA256 +
// timingSafeEqual, mirrors WhapiBridge.verifyWebhook / the cron routes'
// secretMatches) and parseMailgunEvent (defensive parse of Mailgun's webhook
// JSON). send/registerDomain/getDomainStatus hit the network and need a live
// Mailgun key — not covered here; see task-3-report.md.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { parseMailgunEvent, verifyMailgunSignature } from "./mailgun";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ── verifyMailgunSignature ──────────────────────────────────────────────

const SIGNING_KEY = "test-signing-key-do-not-use";
const originalKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;

try {
  process.env.MAILGUN_WEBHOOK_SIGNING_KEY = SIGNING_KEY;

  const timestamp = "1234567890";
  const token = "a-random-token-value";
  const correctSig = createHmac("sha256", SIGNING_KEY).update(timestamp + token).digest("hex");

  check("correct signature -> true", verifyMailgunSignature(timestamp, token, correctSig) === true);

  // Same length, wrong content: flip the last hex character.
  const lastChar = correctSig.at(-1)!;
  const flipped = lastChar === "0" ? "1" : "0";
  const wrongSameLength = correctSig.slice(0, -1) + flipped;
  check("wrong signature, same length -> false", verifyMailgunSignature(timestamp, token, wrongSameLength) === false);

  check(
    "length-mismatch signature -> false",
    verifyMailgunSignature(timestamp, token, correctSig.slice(0, -4)) === false,
  );
  check("empty signature -> false", verifyMailgunSignature(timestamp, token, "") === false);

  // The whole point of the length guard: a mismatched-length compare must
  // never throw (crypto.timingSafeEqual throws directly on a Buffer length
  // mismatch).
  assert.doesNotThrow(() => verifyMailgunSignature(timestamp, token, "short"), "shorter guess must not throw");
  passed++;
  console.log("  ✓ shorter guess does not throw");

  // Fail CLOSED when unconfigured — never reaches the compare at all, even
  // against a signature that would otherwise be correct.
  delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  check("unset signing key -> always false", verifyMailgunSignature(timestamp, token, correctSig) === false);
} finally {
  if (originalKey === undefined) delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  else process.env.MAILGUN_WEBHOOK_SIGNING_KEY = originalKey;
}

// ── parseMailgunEvent ───────────────────────────────────────────────────

/** Mailgun's real webhook shape: {signature:{...}, "event-data":{...}}. */
function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    signature: { timestamp: "123", token: "abc", signature: "deadbeef" },
    "event-data": {
      event: "delivered",
      recipient: "person@example.com",
      message: { headers: { "message-id": "20260101.abc@mail.example.com" } },
      "user-variables": { campaignId: "5", tenantId: "2" },
      ...overrides,
    },
  };
}

const delivered = parseMailgunEvent(eventPayload());
check("delivered -> parsed (not null)", delivered !== null);
check("delivered -> event", delivered?.event === "delivered");
check("delivered -> recipient", delivered?.recipient === "person@example.com");
check("delivered -> messageId", delivered?.messageId === "20260101.abc@mail.example.com");
check("delivered -> campaignId coerced to number", delivered?.campaignId === 5);
check("delivered -> tenantId coerced to number", delivered?.tenantId === 2);
check("delivered -> no severity", delivered?.severity === undefined);

const permanentBounce = parseMailgunEvent(eventPayload({ event: "failed", severity: "permanent" }));
check("permanent bounce -> parsed", permanentBounce !== null);
check("permanent bounce -> event is 'failed'", permanentBounce?.event === "failed");
check("permanent bounce -> severity 'permanent'", permanentBounce?.severity === "permanent");

const temporaryBounce = parseMailgunEvent(eventPayload({ event: "failed", severity: "temporary" }));
check("temporary bounce -> severity 'temporary'", temporaryBounce?.severity === "temporary");

const complained = parseMailgunEvent(eventPayload({ event: "complained" }));
check("complained -> parsed", complained !== null);
check("complained -> event", complained?.event === "complained");

const unsubscribed = parseMailgunEvent(eventPayload({ event: "unsubscribed" }));
check("unsubscribed -> parsed", unsubscribed !== null);
check("unsubscribed -> event", unsubscribed?.event === "unsubscribed");

// ── missing/unrecognized essential fields -> null ──
check("missing event -> null", parseMailgunEvent(eventPayload({ event: undefined })) === null);
check("unrecognized event -> null", parseMailgunEvent(eventPayload({ event: "stored" })) === null);
check("missing recipient -> null", parseMailgunEvent(eventPayload({ recipient: undefined })) === null);
check("blank recipient -> null", parseMailgunEvent(eventPayload({ recipient: "  " })) === null);
check("missing message id -> null", parseMailgunEvent(eventPayload({ message: { headers: {} } })) === null);
check("null payload -> null", parseMailgunEvent(null) === null);
check("non-object payload -> null", parseMailgunEvent("not an object") === null);
check("empty object payload -> null", parseMailgunEvent({}) === null);

// Top-level "message-id" fallback (no message.headers wrapper).
const flatMessageId = parseMailgunEvent(eventPayload({ message: undefined, "message-id": "flat-id@example.com" }));
check("top-level message-id fallback -> parsed", flatMessageId !== null);
check("top-level message-id fallback -> messageId", flatMessageId?.messageId === "flat-id@example.com");

// Missing user-variables entirely -> event still parses, just without campaignId/tenantId.
const noUserVars = parseMailgunEvent(eventPayload({ "user-variables": undefined }));
check("missing user-variables -> still parses", noUserVars !== null);
check("missing user-variables -> no campaignId", noUserVars?.campaignId === undefined);
check("missing user-variables -> no tenantId", noUserVars?.tenantId === undefined);

// Simulated/flattened payload with no "event-data" wrapper still parses.
const flattened = parseMailgunEvent({
  event: "opened",
  recipient: "flat@example.com",
  message: { headers: { "message-id": "flat-wrapper@example.com" } },
});
check("flattened (no event-data wrapper) -> parsed", flattened !== null);
check("flattened -> event", flattened?.event === "opened");

console.log(`\nmailgun: ${passed} checks passed.`);
