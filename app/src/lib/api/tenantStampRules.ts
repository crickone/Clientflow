/**
 * The two decisions behind the tenant stamp, as pure functions.
 *
 * No "server-only" and no imports: the server guard (./tenantStamp) and the
 * browser wrapper (@/components/layout/TenantTabGuard) both need these and must
 * agree exactly — a header the client sends on a URL the server doesn't check,
 * or vice versa, is a hole the size of the whole feature. One definition, two
 * callers, and tests that can reach it without a request or a DOM.
 */

/** The header carrying the tenant a page was RENDERED for. */
export const TENANT_STAMP_HEADER = "x-adonis-tenant";

/** Marks a 409 as "this tab is stale", so the client can tell it from any other conflict. */
export const TENANT_MISMATCH_CODE = "TENANT_MISMATCH";

/**
 * A stamp worth checking, or null.
 *
 * Anything malformed reads as ABSENT rather than as a mismatch. A stamp is a
 * narrowing device — it can only ever refuse a request that proves it meant a
 * different clinic — so garbage must fall back to the pre-existing behaviour,
 * never to a refusal that locks an operator out of their own account.
 */
export function parseStamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Is this a request to OUR api, on this origin?
 *
 * Only those carry the stamp. A third-party request must never be told which
 * clinic the operator is in, and a non-/api same-origin request (a page
 * navigation, a static asset) has no guard to read it.
 *
 * Unparseable input is not ours: the wrapper hands it to the original fetch
 * untouched rather than guessing at a URL it could not read.
 */
export function isOwnApiUrl(raw: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return false;
  }
  return url.origin === origin && url.pathname.startsWith("/api/");
}
