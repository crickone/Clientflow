import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed unsubscribe token (Task 6) — deliberately NOT a DB row, unlike
 * lib/platform/openToken.ts's one-time handoff token. That divergence is the
 * whole point of this module:
 *
 *  - A recipient may click "unsubscribe" at any time — hours, weeks, even
 *    years after a send — so there is no TTL, and no expiry check.
 *  - Clicking twice (a re-opened email, a link-scanning security proxy that
 *    pre-fetches links, a double click) must be harmless, so the token is
 *    NOT single-use — parsing it never consumes/invalidates it.
 *  - The (tenantId, contactId) pair is embedded IN the token and verified by
 *    HMAC-SHA256 (keyed on EMAIL_TOKEN_SECRET — the same var
 *    lib/google/tokenCrypto.ts uses for token-at-rest encryption), so
 *    `parseUnsubscribeToken` never needs a DB round-trip to resolve who a
 *    token belongs to. That matters twice over: it keeps `/u/[token]` cheap
 *    and DB-free for the (very common, e.g. link-scanner) case of an invalid
 *    token, and it keeps `createUnsubscribeToken` cheap enough to mint fresh,
 *    per-recipient, at send time for every email in a campaign (Task 5)
 *    without a write.
 *
 * Token shape: `<base64url(payload)>.<base64url(HMAC-SHA256(secret, payload))>`
 * where `payload` is the literal string `"<tenantId>.<contactId>"`. The HMAC
 * is computed over the base64url PAYLOAD TEXT (not the raw pre-encoded
 * string) — an implementation detail that only has to be self-consistent
 * between mint and parse, which it is (both go through `sign()` below).
 */

/** Compute the base64url HMAC-SHA256 signature over a (base64url) payload string. */
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Reads EMAIL_TOKEN_SECRET fresh on every call (no module-level caching, same
 * choice as tokenCrypto.ts's deriveKey) — mutating it between calls (e.g. in
 * a test) takes effect immediately, and a secret rotated at deploy time is
 * picked up without a process restart of anything that re-reads env lazily.
 *
 * Unlike tokenCrypto.ts, there is NO dev-constant fallback here, in any
 * environment: createUnsubscribeToken and parseUnsubscribeToken MUST always
 * agree on whether a secret exists, in the SAME process, or a token minted
 * with a silent fallback could never be verified by parseUnsubscribeToken's
 * unconditional fail-closed check below — a worse failure mode (a
 * mysteriously-always-invalid link) than simply refusing to mint at all.
 */
function getSecret(): string | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  return secret ? secret : null;
}

/**
 * Mint a signed, non-expiring, non-single-use unsubscribe token for a
 * (tenantId, contactId) pair. Throws if EMAIL_TOKEN_SECRET is unset — a
 * mint-time failure is loud and easy to catch (dev/CI), rather than silently
 * producing a token that can never later verify. Never includes the secret
 * itself in the error.
 */
export function createUnsubscribeToken(tenantId: number, contactId: number): string {
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(contactId) || contactId <= 0) {
    throw new Error(
      `[marketing] createUnsubscribeToken: tenantId and contactId must be positive integers (got ${tenantId}, ${contactId}).`,
    );
  }
  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "[marketing] EMAIL_TOKEN_SECRET is not set — refusing to mint an unsubscribe token. " +
        "Set EMAIL_TOKEN_SECRET before sending any campaign.",
    );
  }
  const payload = Buffer.from(`${tenantId}.${contactId}`, "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export interface UnsubscribeClaim {
  tenantId: number;
  contactId: number;
}

/**
 * Verify + decode an unsubscribe token. Fails CLOSED, returning `null`
 * (never throws) for every invalid case — unset secret, malformed shape,
 * unparsable payload, or a signature that doesn't match — so a public,
 * unauthenticated caller (the `/u/[token]` route) can never distinguish
 * "unconfigured deployment" from "someone guessed a token" from "bit-flipped
 * garbage": they all just fail.
 *
 * Constant-time signature compare (length-check first, then
 * `timingSafeEqual`, NEVER `===`) mirrors WhapiBridge.verifyWebhook
 * (lib/whatsapp/whapi.ts) and verifyMailgunSignature
 * (lib/marketing/sender/mailgun.ts) exactly: a naive `===` short-circuits on
 * the first mismatched byte, letting a remote attacker time their way to a
 * valid signature.
 */
export function parseUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const secret = getSecret();
  if (!secret) return null; // fail closed: unconfigured deployment can never accept a token

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

  const m = /^(\d+)\.(\d+)$/.exec(decoded);
  if (!m) return null;
  const tenantId = Number(m[1]);
  const contactId = Number(m[2]);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) return null;
  if (!Number.isSafeInteger(contactId) || contactId <= 0) return null;

  return { tenantId, contactId };
}
