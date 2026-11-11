/**
 * The one Graph API version every Meta call in the app uses. Meta retires a
 * version about two years after release (v21.0 dies 2027-01-21), so bump it
 * here, not per call site. No `server-only`: tests import it.
 */
export const GRAPH_VERSION = "v26.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * An error Meta's Graph API returned, with its codes kept. Every Graph call
 * site throws this (not a bare Error) so callers can tell "Meta refused this
 * connection" from a one-off failure. No `server-only`: tests import it.
 */
export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly status: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** Build a MetaApiError from a Graph response body (`{ error: {...} }`). */
export function metaApiError(json: unknown, status: number, fallback: string): MetaApiError {
  const e = (json as { error?: { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } } | null)?.error;
  return new MetaApiError(e?.error_user_msg || e?.message || fallback, e?.code ?? null, e?.error_subcode ?? null, status);
}

/**
 * Whether Meta refused the CONNECTION itself, which only a reconnect fixes:
 * the token is invalid or expired (190, 102: the person removed the app,
 * changed their password, or lost admin on the Page), or the app lacks a
 * permission the call needs (10, 200-299). Anything else (a bad image, a
 * rate limit, a closed messaging window) is about that one call.
 */
export function isConnectionRefused(err: unknown): boolean {
  if (!(err instanceof MetaApiError) || err.code === null) return false;
  return err.code === 190 || err.code === 102 || err.code === 10 || (err.code >= 200 && err.code <= 299);
}
