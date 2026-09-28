import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The one HMAC token primitive behind every server-minted claim the platform
 * hands to a browser — the campaign signup token (lib/campaigns/signupToken)
 * and the site enquiry token (lib/cms/enquiryToken). It signs a JSON claim,
 * verifies a signature in constant time, and returns the parsed payload for
 * the caller to shape-check; what a claim MEANS stays with each token kind.
 *
 * Wire format: `<base64url(payload)>.<base64url(HMAC-SHA256(secret, payloadB64))>`
 * where the HMAC is computed over the base64url payload text. The secret is
 * EMAIL_TOKEN_SECRET, read fresh on every call with no dev fallback, so sign
 * and read always agree on whether one exists (see signupToken.ts's header
 * for why a silent fallback is the worse failure). Reading fails closed:
 * every bad case is `null`, never a throw, so a public route answers one 400.
 *
 * Extracted from signupToken.ts (2026-09-28) when a second token kind
 * needed the same primitive; the wire format did not change.
 */
export function getTokenSecret(): string | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  return secret ? secret : null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Mint a token for a JSON-serialisable claim. Null when the secret is unset — the caller decides whether that throws. */
export function signTokenPayload(claim: object): string | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(claim), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify a token's signature and return its parsed object payload, or null
 * for every failure: unset secret, wrong shape, bad signature, undecodable
 * payload, or a payload that is not a plain object. Constant-time compare
 * (length check, then timingSafeEqual, never `===`).
 */
export function readTokenPayload(token: string): Record<string, unknown> | null {
  const secret = getTokenSecret();
  if (!secret) return null;
  if (typeof token !== "string" || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
