// Run: npm test -- src/lib/attachments/publicLink.test.ts
//
// Public file links for Instagram: a round trip gives the business and file
// back and lasts 15 minutes; an expired, tampered or junk link, a file name
// we would never store and a missing secret all give null. Tokens signed for
// other purposes with the same secret (render links, attachment tickets) do
// not verify here, and a public link does not verify as either of them.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PUBLIC_LINK_TTL_MS, publicFileUrl, publicLinksConfigured, signPublicFile, verifyPublicFile } from "./publicLink";
import { signAttachment, verifyAttachment } from "./token";
import { signRenderToken, verifyRenderToken } from "@/lib/social/renderToken";

const originalSocial = process.env.SOCIAL_TOKEN_SECRET;
const originalEmail = process.env.EMAIL_TOKEN_SECRET;
delete process.env.SOCIAL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = "test-public-link-secret";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

try {
  const file = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  check("configured", publicLinksConfigured());
  check("ttl is 15 minutes", PUBLIC_LINK_TTL_MS === 15 * 60 * 1000);

  const now = Date.now();
  const token = signPublicFile({ tenantId: 7, file }, undefined, now);
  check("signed", typeof token === "string" && token!.includes("."));
  const claim = verifyPublicFile(token!, now);
  check("round trip", !!claim && claim.tenantId === 7 && claim.file === file && claim.expiresAt === now + PUBLIC_LINK_TTL_MS);
  check("still good at 14 minutes", verifyPublicFile(token!, now + 14 * 60 * 1000) !== null);
  check("expired at 16 minutes", verifyPublicFile(token!, now + 16 * 60 * 1000) === null);
  check("expired with a past ttl", verifyPublicFile(signPublicFile({ tenantId: 7, file }, -1)!) === null);

  const [body, sig] = token!.split(".");
  const forged = b64url(Buffer.from(JSON.stringify({ pt: 8, pf: file, px: now + 60_000 })));
  check("tampered body", verifyPublicFile(`${forged}.${sig}`) === null);
  check("tampered signature", verifyPublicFile(`${body}.${sig.slice(0, -2)}xx`) === null);
  check("junk", verifyPublicFile("nope") === null && verifyPublicFile("") === null && verifyPublicFile(".abc") === null);
  check("unsafe file name not signed", signPublicFile({ tenantId: 7, file: "../../control.db" }) === null && signPublicFile({ tenantId: 7, file: "x.jpg" }) === null);

  // Other tokens on the same secret stay apart.
  const render = signRenderToken({ tenantId: 7, filename: file })!;
  check("render link is not a public file link", verifyPublicFile(render) === null);
  check("public file link is not a render link", verifyRenderToken(token!) === null);
  const ticket = signAttachment(7, { kind: "image", file, mime: "image/jpeg", size: 10 });
  check("attachment ticket is not a public file link", verifyPublicFile(ticket) === null);
  check("public file link is not an attachment ticket", verifyAttachment(token!, 7) === null);

  const url = publicFileUrl("https://app.example.test/", { tenantId: 7, file });
  const prefix = "https://app.example.test/api/messages/attachments/public/";
  check("url on the base", !!url && url.startsWith(prefix));
  check("url carries a valid link", verifyPublicFile(decodeURIComponent(url!.slice(prefix.length)))?.file === file);

  delete process.env.EMAIL_TOKEN_SECRET;
  check("no secret: not configured", !publicLinksConfigured());
  check("no secret: nothing signed", signPublicFile({ tenantId: 7, file }) === null && publicFileUrl("https://x.test", { tenantId: 7, file }) === null);
  check("no secret: nothing verifies", verifyPublicFile(token!) === null);
} finally {
  if (originalSocial === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
  else process.env.SOCIAL_TOKEN_SECRET = originalSocial;
  if (originalEmail === undefined) delete process.env.EMAIL_TOKEN_SECRET;
  else process.env.EMAIL_TOKEN_SECRET = originalEmail;
}

console.log(`publicLink: ${passed} checks passed.`);
