// Run: npm test -- src/lib/facebook/signedRequest.test.ts
//
// Pure tests for parseSignedRequest (Meta's data deletion callback payload):
// a correctly signed request parses; a tampered, foreign-secret, malformed or
// missing one is null; it fails closed without an app secret and never throws.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { parseSignedRequest } from "./signedRequest";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-fb-app-secret";
function sign(payload: object, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}

const good = sign({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: 1700000000 });
check("a correctly signed request parses", parseSignedRequest(good, SECRET)?.user_id === "12345");
check("another secret is rejected", parseSignedRequest(sign({ user_id: "1" }, "other"), SECRET) === null);
check("a tampered payload is rejected", parseSignedRequest(good.split(".")[0] + "." + Buffer.from('{"user_id":"999"}').toString("base64url"), SECRET) === null);
check("no app secret fails closed", parseSignedRequest(good, undefined) === null);
check("missing input is null", parseSignedRequest(null, SECRET) === null && parseSignedRequest("", SECRET) === null);
check("malformed input is null", parseSignedRequest("nodot", SECRET) === null && parseSignedRequest("a.b", SECRET) === null);
check("a non-HMAC algorithm is rejected", parseSignedRequest(sign({ algorithm: "none", user_id: "1" }), SECRET) === null);

console.log(`signedRequest: ${passed} checks passed.`);
