// Run: npm test -- src/lib/cms/enquiryToken.test.ts
//
// The site-enquiry token is the ONLY thing that names a tenant for
// POST /api/site/enquiry — the browser never sends a slug or id. Built on
// lib/signedToken (which owns the crypto tests); this file covers what THIS
// claim means: its shape, that a CAMPAIGN token ({t, c}) signed with the
// same secret never verifies as an enquiry claim, fail-closed behaviour, and
// the placeholder substitution the verbatim template performs at render.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  ENQUIRY_TOKEN_PLACEHOLDER,
  injectEnquiryToken,
  signSiteEnquiryToken,
  verifySiteEnquiryToken,
} from "./enquiryToken";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SECRET = "test-site-enquiry-secret-do-not-use";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;

function buildToken(payloadText: string, secret: string): string {
  const payload = Buffer.from(payloadText, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

try {
  process.env.EMAIL_TOKEN_SECRET = SECRET;

  // round trip
  const token = signSiteEnquiryToken({ tenantId: 1415, siteId: 7 });
  check("token is payload.signature", token.split(".").length === 2);
  const claim = verifySiteEnquiryToken(token);
  check("round-trip tenantId", claim?.tenantId === 1415);
  check("round-trip siteId", claim?.siteId === 7);
  check("different siteId -> different token", signSiteEnquiryToken({ tenantId: 1415, siteId: 8 }) !== token);

  // tamper: payload
  const [payload, sig] = token.split(".");
  const otherPayload = Buffer.from(JSON.stringify({ t: 1, s: 7, k: "enquiry" }), "utf8").toString("base64url");
  check("payload swapped to another tenant fails", verifySiteEnquiryToken(`${otherPayload}.${sig}`) === null);
  // tamper: signature
  const flipped = sig.endsWith("A") ? sig.slice(0, -1) + "B" : sig.slice(0, -1) + "A";
  check("one flipped signature char fails", verifySiteEnquiryToken(`${payload}.${flipped}`) === null);

  // shape
  check("empty string -> null", verifySiteEnquiryToken("") === null);
  check("no dot -> null", verifySiteEnquiryToken("abc") === null);
  check("two dots -> null", verifySiteEnquiryToken("a.b.c") === null);
  check("garbage payload, valid sig -> null", verifySiteEnquiryToken(buildToken("not json", SECRET)) === null);
  check("wrong kind -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 1, s: 7, k: "other" }), SECRET)) === null);
  check("campaign-shaped claim never verifies as enquiry",
    verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 1, c: 7 }), SECRET)) === null);
  check("non-integer ids -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: "1", s: 7, k: "enquiry" }), SECRET)) === null);
  check("zero id -> null", verifySiteEnquiryToken(buildToken(JSON.stringify({ t: 0, s: 7, k: "enquiry" }), SECRET)) === null);

  // sign guards
  assert.throws(() => signSiteEnquiryToken({ tenantId: 0, siteId: 7 }), /positive integers/);
  passed++; console.log("  ✓ sign refuses a non-positive tenantId");

  // injection
  const bodyNo = "<form><input name=\"token\" value=\"x\"></form>";
  check("no placeholder -> body byte-identical", injectEnquiryToken(bodyNo, () => "T") === bodyNo);
  let minted = 0;
  injectEnquiryToken(bodyNo, () => { minted++; return "T"; });
  check("no placeholder -> mint never called", minted === 0);
  const bodyYes = `<input value="${ENQUIRY_TOKEN_PLACEHOLDER}"><span>${ENQUIRY_TOKEN_PLACEHOLDER}</span>`;
  const out = injectEnquiryToken(bodyYes, () => "TOK");
  check("placeholder replaced everywhere", out === "<input value=\"TOK\"><span>TOK</span>");
  const outThrow = injectEnquiryToken(bodyYes, () => { throw new Error("no secret"); });
  check("mint failure -> empty token, page still renders", outThrow === "<input value=\"\"><span></span>");

  // fail closed without a secret
  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret -> verify null even for a previously valid token", verifySiteEnquiryToken(token) === null);
  assert.throws(() => signSiteEnquiryToken({ tenantId: 1, siteId: 1 }), /EMAIL_TOKEN_SECRET/);
  passed++; console.log("  ✓ no secret -> sign throws");

  console.log(`enquiryToken.test.ts: ${passed} checks passed`);
} finally {
  if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalSecret;
}
