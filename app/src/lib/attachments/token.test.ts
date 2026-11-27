// Run: npm test -- src/lib/attachments/token.test.ts
//
// Attachment tickets: a round trip gives the media back; another business,
// an expired ticket, a tampered body or signature, junk and a missing secret
// all give null.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import type { MessageMedia } from "@/lib/inbox/mediaModel";

// The secret is read on every call, so setting it after the import is fine.
import { attachmentTokensConfigured, signAttachment, verifyAttachment } from "./token";

const originalSocial = process.env.SOCIAL_TOKEN_SECRET;
const originalEmail = process.env.EMAIL_TOKEN_SECRET;
delete process.env.SOCIAL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = "test-attachment-token-secret";


let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

try {
  const media: MessageMedia = {
    kind: "file",
    file: `${crypto.randomBytes(16).toString("hex")}.pdf`,
    mime: "application/pdf",
    name: "Treatment plan.pdf",
    size: 12345,
  };

  check("configured", attachmentTokensConfigured());
  const token = signAttachment(7, media);
  check("token has a body and a signature", /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
  assert.deepEqual(verifyAttachment(token, 7), media);
  passed++;

  const noName = signAttachment(7, { kind: "image", file: `${"a".repeat(32)}.jpg`, mime: "image/jpeg", size: 5 });
  assert.deepEqual(verifyAttachment(noName, 7), { kind: "image", file: `${"a".repeat(32)}.jpg`, mime: "image/jpeg", size: 5 });
  passed++;

  check("another business: null", verifyAttachment(token, 8) === null);
  check("expired: null", verifyAttachment(signAttachment(7, media, -1), 7) === null);

  const [body, sig] = token.split(".");
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  const swappedTenant = b64url(Buffer.from(JSON.stringify({ ...payload, t: 8 }), "utf8"));
  check("tampered tenant: null", verifyAttachment(`${swappedTenant}.${sig}`, 8) === null);
  const swappedFile = b64url(Buffer.from(JSON.stringify({ ...payload, m: { ...payload.m, file: `${"b".repeat(32)}.pdf` } }), "utf8"));
  check("tampered file: null", verifyAttachment(`${swappedFile}.${sig}`, 7) === null);
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  check("tampered signature: null", verifyAttachment(`${body}.${flipped}`, 7) === null);
  check("no dot: null", verifyAttachment(body, 7) === null);
  check("junk: null", verifyAttachment("not-a-token", 7) === null);
  check("empty: null", verifyAttachment("", 7) === null);

  // A ticket signed with the right key but naming a path is refused.
  const key = process.env.EMAIL_TOKEN_SECRET as string;
  const evilBody = b64url(Buffer.from(JSON.stringify({ t: 7, m: { ...media, file: "../../other/x.pdf" }, x: Date.now() + 60_000 }), "utf8"));
  const evilSig = b64url(crypto.createHmac("sha256", key).update(evilBody).digest());
  check("signed but unsafe file name: null", verifyAttachment(`${evilBody}.${evilSig}`, 7) === null);

  // A different secret does not verify.
  process.env.SOCIAL_TOKEN_SECRET = "a-different-secret";
  check("signed with another secret: null", verifyAttachment(token, 7) === null);
  delete process.env.SOCIAL_TOKEN_SECRET;

  // No secret at all: nothing verifies, and signing refuses.
  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret: not configured", !attachmentTokensConfigured());
  check("no secret: verify null", verifyAttachment(token, 7) === null);
  assert.throws(() => signAttachment(7, media));
  passed++;
} finally {
  if (originalSocial === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
  else process.env.SOCIAL_TOKEN_SECRET = originalSocial;
  if (originalEmail === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalEmail;
}

console.log(`attachment tokens: ${passed} checks passed.`);
