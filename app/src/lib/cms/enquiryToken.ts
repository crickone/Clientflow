import "server-only";

import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";

/**
 * The site-enquiry token: how a bespoke site's contact form proves which
 * tenant it belongs to without the browser ever naming one.
 *
 * Same trust model as lib/campaigns/signupToken.ts (read its header for the
 * vulnerability this design closes): the verbatim page template mints a
 * token at render time, HMAC-signed with the server-only EMAIL_TOKEN_SECRET,
 * encoding {tenantId, siteId}. POST /api/site/enquiry verifies it and writes
 * the lead into THAT tenant. The claim carries `k: "enquiry"` and a campaign
 * token carries `c`, so neither shape verifies as the other even though they
 * share a secret and the primitive in lib/signedToken.ts.
 *
 * The placeholder is a literal string the site's HTML carries in its hidden
 * `token` field. Sites that never wrote it are untouched by injection.
 */
export const ENQUIRY_TOKEN_PLACEHOLDER = "__ADONIS_ENQUIRY_TOKEN__";

export interface SiteEnquiryClaim {
  tenantId: number;
  siteId: number;
}

/** Mint a signed, non-expiring token for (tenantId, siteId). Throws loudly when the secret is unset. */
export function signSiteEnquiryToken(input: { tenantId: number; siteId: number }): string {
  const { tenantId, siteId } = input;
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(siteId) || siteId <= 0) {
    throw new Error(
      `[cms] signSiteEnquiryToken: tenantId and siteId must be positive integers (got ${tenantId}, ${siteId}).`,
    );
  }
  const token = signTokenPayload({ t: tenantId, s: siteId, k: "enquiry" });
  if (!token) {
    throw new Error(
      "[cms] EMAIL_TOKEN_SECRET is not set — refusing to mint a site-enquiry token. Set EMAIL_TOKEN_SECRET before rendering a bespoke site.",
    );
  }
  return token;
}

/** Verify + decode. Fails CLOSED with `null` for every bad case (see readTokenPayload) plus the wrong claim kind or ids. */
export function verifySiteEnquiryToken(token: string): SiteEnquiryClaim | null {
  const obj = readTokenPayload(token);
  if (!obj) return null;
  if (obj.k !== "enquiry") return null;
  const t = obj.t;
  const s = obj.s;
  if (typeof t !== "number" || !Number.isSafeInteger(t) || t <= 0) return null;
  if (typeof s !== "number" || !Number.isSafeInteger(s) || s <= 0) return null;
  return { tenantId: t, siteId: s };
}

/**
 * Replace every placeholder in a page body with a freshly minted token. A body
 * without the placeholder is returned as-is and `mint` is never called, so
 * every other bespoke site renders byte-for-byte as before. If minting throws
 * (no secret on this machine) the placeholder becomes "" — the form then gets
 * a 400 on submit, which is visible, rather than the whole page failing.
 */
export function injectEnquiryToken(body: string, mint: () => string): string {
  if (!body.includes(ENQUIRY_TOKEN_PLACEHOLDER)) return body;
  let token = "";
  try {
    token = mint();
  } catch (err) {
    console.error("[cms] site enquiry token could not be minted:", err instanceof Error ? err.message : err);
  }
  return body.split(ENQUIRY_TOKEN_PLACEHOLDER).join(token);
}
