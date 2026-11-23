import "server-only";

import { siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";

/**
 * Signed by the /vouchers page at render time, verified by the public
 * checkout route: which business and site the Pay button is for, and the
 * site address Stripe returns the buyer to and emails link to. Nothing in
 * the request body can choose a tenant or an address (the offer checkout's
 * pattern, lib/offers/checkoutToken.ts).
 */
export interface VoucherStoreClaim {
  tenantId: number;
  siteId: number;
  /** The site's root, no trailing slash: "https://www.example.ie" or "http://localhost:3000/site/example". */
  siteUrl: string;
}

export function signVoucherStoreToken(c: VoucherStoreClaim): string | null {
  return signTokenPayload({ k: "voucher-store", t: c.tenantId, s: c.siteId, u: c.siteUrl });
}

export function verifyVoucherStoreToken(token: string): VoucherStoreClaim | null {
  const p = readTokenPayload(token);
  if (!p || p.k !== "voucher-store") return null;
  const tenantId = Number(p.t);
  const siteId = Number(p.s);
  const url = String(p.u ?? "");
  if (!Number.isInteger(tenantId) || tenantId <= 0 || !Number.isInteger(siteId) || siteId <= 0) return null;
  if (!/^https?:\/\/\S+$/.test(url) || url.endsWith("/")) return null;
  return { tenantId, siteId, siteUrl: url };
}

/**
 * The site's root for links. On a connected domain that's https://domain; on
 * the platform mount it keeps the request's port, which siteUrl drops (local
 * dev). Mirrors the campaign landing page's landingReturnUrl.
 */
export function siteRootUrl(site: PublicSite, host: string | null): string {
  if (!site.primaryHost && host && /:\d+$/.test(host)) {
    const proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https";
    return `${proto}://${host}/site/${site.site.slug}`;
  }
  return siteUrl(site, "/", host).replace(/\/$/, "");
}
