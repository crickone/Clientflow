// Run: npm test -- src/lib/signedToken.test.ts
//
// The one HMAC primitive behind every server-minted browser token. Round
// trip, tamper detection on payload and signature, malformed shapes never
// throw, fail closed without EMAIL_TOKEN_SECRET, and non-object payloads
// (arrays, strings) come back null so callers can shape-check an object.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { getTokenSecret, readTokenPayload, signTokenPayload } from "./signedToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-signed-token-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

function buildToken(payloadText: string, secret: string): string {
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;
  check("secret is read", getTokenSecret() === SECRET);

  const token = signTokenPayload({ a: 1, b: "two" });
  check("sign returns payload.signature", typeof token === "string" && token.split(".").length === 2);
  const back = readTokenPayload(token!);
  check("round-trip object", back?.a === 1 && back?.b === "two");
  check("hand-built token with the same secret reads", readTokenPayload(buildToken(JSON.stringify({ x: 9 }), SECRET))?.x === 9);

  const [payload, sig] = token!.split(".");
  const other = Buffer.from(JSON.stringify({ a: 2, b: "two" }), "utf8").toString("base64url");
  check("payload swap fails", readTokenPayload(`${other}.${sig}`) === null);
  const flipped = sig!.endsWith("A") ? sig!.slice(0, -1) + "B" : sig!.slice(0, -1) + "A";
  check("flipped signature char fails", readTokenPayload(`${payload}.${flipped}`) === null);
  check("wrong secret fails", readTokenPayload(buildToken(JSON.stringify({ x: 1 }), "another-secret")) === null);

  check("empty -> null", readTokenPayload("") === null);
  check("no dot -> null", readTokenPayload("abc") === null);
  check("two dots -> null", readTokenPayload("a.b.c") === null);
  check("empty payload part -> null", readTokenPayload(`.${sig}`) === null);
  check("non-JSON payload -> null", readTokenPayload(buildToken("not json", SECRET)) === null);
  check("array payload -> null", readTokenPayload(buildToken("[1,2]", SECRET)) === null);
  check("string payload -> null", readTokenPayload(buildToken("\"str\"", SECRET)) === null);
  check("null payload -> null", readTokenPayload(buildToken("null", SECRET)) === null);
  check("non-string token -> null", readTokenPayload(undefined as unknown as string) === null);

  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret -> getTokenSecret null", getTokenSecret() === null);
  check("no secret -> sign null", signTokenPayload({ a: 1 }) === null);
  check("no secret -> read null even for a valid token", readTokenPayload(token!) === null);

  console.log(`signedToken.test.ts: ${passed} checks passed`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
