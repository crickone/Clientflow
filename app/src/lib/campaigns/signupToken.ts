import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed campaign-signup token — closes the cross-tenant lead-injection hole
 * in `POST /api/campaigns/signup` (commit 89c08ad; see route.ts's doc + the
 * Task 2 report's "Fix wave 1" section for the full writeup). The old design
 * resolved tenancy from `resolvePublicSite({host, siteParam: body.siteSlug})`
 * — but that function's dev/unmapped-host fallback searches EVERY tenant's DB
 * for a site matching `siteParam`, and hitting an unmapped host in prod is
 * trivial. So a client-supplied `siteSlug` (paired with a guessed
 * `campaignSlug`) was silently acting as a tenant selector: the "tenant comes
 * only from the host, never client input" invariant the route's own comments
 * claimed was simply false.
 *
 * The fix: the public landing page (Task 3, a server component) is the ONLY
 * place that mints a token, at render time, embedding it in the form as a
 * hidden field; the signup route's only job is to verify it. An attacker
 * without EMAIL_TOKEN_SECRET cannot forge a token for someone else's
 * (tenantId, campaignId) — cross-tenant writes become cryptographically
 * impossible rather than merely inconvenient. This also means the write path
 * no longer needs to trust the Host header OR any client-supplied slug at
 * all, on any host (platform default or a verified custom domain).
 *
 * Same shape + security posture as lib/marketing/unsubscribeToken.ts,
 * deliberately:
 *  - Minted fresh, per render, by a server component — cheap enough
 *    (HMAC over a few bytes) to not need caching.
 *  - No TTL: a visitor may sit on an open landing-page tab for a while
 *    before submitting the form; expiring the token would just be a
 *    confusing extra failure mode with no security benefit — the token only
 *    ever asserts "this submission is for tenant X's campaign Y", not a
 *    session or a one-time action.
 *  - NOT single-use: verifying never consumes it, so a double submit
 *    (double-click, retry after a flaky network) is harmless — the route's
 *    own `upsertLead` dedupe (source + sourceLeadId) is what makes a
 *    resubmission idempotent, the same division of labour unsubscribeToken.ts
 *    has with its route.
 *  - Reuses the SAME secret var, `EMAIL_TOKEN_SECRET`, rather than minting a
 *    new one — one secret to provision (already required for email sending),
 *    and the same fail-closed, never-throws-on-verify posture. Sharing the
 *    key across the two token kinds doesn't weaken either: they're both
 *    server-minted HMAC claims (not encryption keys), with disjoint payload
 *    shapes and call sites — nothing about one becomes forgeable from
 *    knowing the other exists.
 *
 * Token shape: `<base64url(payload)>.<base64url(HMAC-SHA256(secret, payload))>`
 * where `payload` is `JSON.stringify({t: tenantId, c: campaignId})`. The HMAC
 * is computed over the base64url PAYLOAD TEXT (not the raw pre-encoded
 * JSON) — an implementation detail that only has to be self-consistent
 * between sign and verify, which it is (both go through `sign()` below).
 */

/** Compute the base64url HMAC-SHA256 signature over a (base64url) payload string. */
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Reads EMAIL_TOKEN_SECRET fresh on every call (no module-level caching, same
 * choice as unsubscribeToken.ts's getSecret() / tokenCrypto.ts's deriveKey).
 *
 * No dev-constant fallback, in any environment: signCampaignSignupToken and
 * verifyCampaignSignupToken MUST always agree on whether a secret exists, in
 * the SAME process, or a token minted with a silent fallback could never be
 * verified by verifyCampaignSignupToken's unconditional fail-closed check
 * below — a worse failure mode (every landing-page submission mysteriously
 * rejected) than simply refusing to mint at all.
 */
function getSecret(): string | null {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  return secret ? secret : null;
}

export interface CampaignSignupClaim {
  tenantId: number;
  campaignId: number;
}

/**
 * Mint a signed, non-expiring, non-single-use campaign-signup token for a
 * (tenantId, campaignId) pair. Throws if EMAIL_TOKEN_SECRET is unset — a
 * mint-time failure (at landing-page render time) is loud and easy to catch
 * (dev/CI), rather than silently shipping a form whose token can never later
 * verify. Never includes the secret itself in the error.
 */
export function signCampaignSignupToken(input: { tenantId: number; campaignId: number }): string {
  const { tenantId, campaignId } = input;
  if (
    !Number.isInteger(tenantId) ||
    tenantId <= 0 ||
    !Number.isInteger(campaignId) ||
    campaignId <= 0
  ) {
    throw new Error(
      `[campaigns] signCampaignSignupToken: tenantId and campaignId must be positive integers (got ${tenantId}, ${campaignId}).`,
    );
  }
  const secret = getSecret();
  if (!secret) {
    throw new Error(
      "[campaigns] EMAIL_TOKEN_SECRET is not set — refusing to mint a campaign-signup token. " +
        "Set EMAIL_TOKEN_SECRET before rendering a campaign landing page.",
    );
  }
  const payload = Buffer.from(JSON.stringify({ t: tenantId, c: campaignId }), "utf8").toString(
    "base64url",
  );
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * Verify + decode a campaign-signup token. Fails CLOSED, returning `null`
 * (never throws) for every invalid case — unset secret, malformed shape,
 * unparsable JSON payload, wrong field types/values, or a signature that
 * doesn't match — so the public, unauthenticated signup route can never
 * distinguish "unconfigured deployment" from "someone tampered with the
 * token" from "bit-flipped garbage": they all just fail the same 400.
 *
 * Constant-time signature compare (length-check first, then
 * `timingSafeEqual`, NEVER `===`) mirrors parseUnsubscribeToken
 * (lib/marketing/unsubscribeToken.ts) exactly: a naive `===` short-circuits
 * on the first mismatched byte, letting a remote attacker time their way to
 * a valid signature.
 */
export function verifyCampaignSignupToken(token: string): CampaignSignupClaim | null {
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

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const tenantId = obj.t;
  const campaignId = obj.c;
  if (typeof tenantId !== "number" || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    return null;
  }
  if (typeof campaignId !== "number" || !Number.isSafeInteger(campaignId) || campaignId <= 0) {
    return null;
  }

  return { tenantId, campaignId };
}
