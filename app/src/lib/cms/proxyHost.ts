/**
 * Client domains reach the platform through ONE Cloudflare entry point
 * (Cloudflare for SaaS + the Worker in infra/cloudflare/sites-proxy.js),
 * rather than as a custom domain each on Railway. Railway caps custom domains
 * per service and needs each one added by hand; a client with their own
 * domain must not cost a manual step or a slot.
 *
 * The Worker forwards every request to the Railway service with two headers:
 * the hostname the visitor actually typed, and a shared secret proving the
 * request came through the Worker. The app trusts the hostname ONLY when the
 * secret matches -- otherwise anyone could send the header straight to the
 * Railway URL and have the app serve any verified site as if on its domain
 * (and read its host-scoped data). An untrusted copy of the header is always
 * stripped before the request reaches a page.
 *
 * Pure and edge-safe: the middleware runs it.
 */
export const SITE_HOST_HEADER = "x-adonis-site-host";
export const PROXY_KEY_HEADER = "x-adonis-proxy-key";

/**
 * The slug a proxied request is rewritten under. The edge cannot read the
 * database, so it does not know which site a client domain serves; the page
 * resolves it from the (ownership-verified) domain instead, and the slug in
 * the path is never consulted for a verified host. A leading underscore keeps
 * it out of the space of real slugs, which are [a-z0-9-].
 */
export const PROXIED_SITE_SLUG = "_host";

/** Constant-time string compare, so the secret cannot be guessed byte by byte from timing. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A hostname as the app compares them: lowercase, no port, no trailing dot. */
export function cleanHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const h = raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9.-]+$/.test(h) && h.includes(".") ? h : null;
}

/**
 * The client domain a request came in on, when it came through the Worker;
 * null otherwise. `secret` is SITES_PROXY_SECRET; with no secret configured
 * nothing is trusted.
 */
export function trustedProxyHost(
  get: (name: string) => string | null,
  secret: string | undefined,
): string | null {
  if (!secret || secret.length < 16) return null;
  const key = get(PROXY_KEY_HEADER);
  if (!key || !sameSecret(key, secret)) return null;
  return cleanHost(get(SITE_HOST_HEADER));
}
