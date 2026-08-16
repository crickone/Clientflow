// Run: npm test -- src/lib/facebook/webhook.test.ts
//
// Pure tests for the Facebook leadgen webhook helpers (verifyFacebookSignature,
// parseLeadgenEvents). No env/DB/server-only, so they import cleanly under the
// plain-tsx runner (same reasoning as humanName.test.ts). The HMAC shape mirrors
// the Mailgun signature tests: correct sig -> true; tampered/short/missing ->
// false; fail-closed when the app secret is missing; malformed inputs never throw.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { verifyFacebookSignature, parseLeadgenEvents } from "./webhook";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-fb-app-secret";
const body = JSON.stringify({ object: "page", entry: [] });
const goodSig = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

// ── verifyFacebookSignature ──
check("correct signature -> true", verifyFacebookSignature(body, goodSig, SECRET) === true);
check("tampered body -> false", verifyFacebookSignature(body + "x", goodSig, SECRET) === false);
check("wrong secret -> false", verifyFacebookSignature(body, goodSig, "other-secret") === false);
check("missing signature header -> false", verifyFacebookSignature(body, null, SECRET) === false);
check("missing app secret -> false (fail closed)", verifyFacebookSignature(body, goodSig, undefined) === false);
check("short/garbage signature -> false", verifyFacebookSignature(body, "sha256=deadbeef", SECRET) === false);
assert.doesNotThrow(
  () => verifyFacebookSignature(body, "not-even-prefixed", SECRET),
  "malformed signature must not throw",
);
passed++;
console.log("  ✓ malformed signature does not throw");

// ── parseLeadgenEvents ──
{
  const payload = {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: 1700000000,
        changes: [
          { field: "leadgen", value: { leadgen_id: "L1", page_id: "PAGE1", form_id: "F1", created_time: 1700000001 } },
          { field: "feed", value: { something: "ignore me" } },
        ],
      },
      { id: "PAGE2", changes: [{ field: "leadgen", value: { leadgen_id: "L2", page_id: "PAGE2" } }] },
    ],
  };
  const events = parseLeadgenEvents(payload);
  check("parses both leadgen events, ignores the feed change", events.length === 2);
  check("first: leadgenId", events[0].leadgenId === "L1");
  check("first: pageId", events[0].pageId === "PAGE1");
  check("first: formId", events[0].formId === "F1");
  check("second (no form) still parses", events[1].leadgenId === "L2" && events[1].pageId === "PAGE2");
}

// missing leadgen_id or page_id -> skipped
check(
  "change missing leadgen_id -> skipped",
  parseLeadgenEvents({ entry: [{ changes: [{ field: "leadgen", value: { page_id: "P" } }] }] }).length === 0,
);

// malformed shapes -> [] (never throws)
check("null payload -> []", parseLeadgenEvents(null).length === 0);
check("no entry array -> []", parseLeadgenEvents({}).length === 0);
check("entry not an array -> []", parseLeadgenEvents({ entry: "nope" }).length === 0);

console.log(`\nfacebook/webhook.test.ts: ${passed} checks passed.`);
