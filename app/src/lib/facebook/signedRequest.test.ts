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

const NOW = 1700000000;
const good = sign({ algorithm: "HMAC-SHA256", user_id: "12345", issued_at: NOW - 30 });
check("a correctly signed request parses", parseSignedRequest(good, SECRET, NOW)?.user_id === "12345");
check("a request older than ten minutes is refused (replay)", parseSignedRequest(good, SECRET, NOW + 11 * 60) === null);
check("a future-dated request is refused", parseSignedRequest(sign({ user_id: "1", issued_at: NOW + 3600 }), SECRET, NOW) === null);
check("no issued_at still parses when the signature is right", parseSignedRequest(sign({ user_id: "7" }), SECRET, NOW)?.user_id === "7");
check("another secret is rejected", parseSignedRequest(sign({ user_id: "1" }, "other"), SECRET) === null);
check("a tampered payload is rejected", parseSignedRequest(good.split(".")[0] + "." + Buffer.from('{"user_id":"999"}').toString("base64url"), SECRET) === null);
check("no app secret fails closed", parseSignedRequest(good, undefined) === null);
check("missing input is null", parseSignedRequest(null, SECRET) === null && parseSignedRequest("", SECRET) === null);
check("malformed input is null", parseSignedRequest("nodot", SECRET) === null && parseSignedRequest("a.b", SECRET) === null);
check("a non-HMAC algorithm is rejected", parseSignedRequest(sign({ algorithm: "none", user_id: "1" }), SECRET) === null);

console.log(`signedRequest: ${passed} checks passed.`);
