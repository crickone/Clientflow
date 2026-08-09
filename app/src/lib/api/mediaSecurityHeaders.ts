/**
 * Shared response headers for every media/file-serve route (CMS library +
 * site media, content-studio assets, nutrition/workout uploads, branding
 * logo) — Batch 2a (XSS core defense).
 *
 * Some of these routes serve user-uploaded `image/svg+xml` files straight
 * from disk. An SVG is a full XML document that can carry its own
 * `<script>`/event handlers, and a browser executes that script when the SVG
 * is loaded as a top-level document (i.e. the file is fetched/opened
 * directly) — not only when it's inert content inside an `<img>`. Rejecting
 * SVG uploads would break legitimate SVG logos/icons, so instead these
 * headers make the SERVED RESPONSE unable to execute anything:
 *
 * - `Content-Security-Policy: ...; sandbox` — when the response is rendered
 *   as its own document, `sandbox` disables script execution (and
 *   `default-src 'none'` blocks it from loading anything else); `style-src
 *   'unsafe-inline'` and `img-src 'self' data:` keep the SVG's own inline
 *   styles/embedded raster images rendering. This CSP describes the media
 *   response itself — it does not apply when the same bytes are referenced
 *   from an `<img>` or inlined `<svg>` on an ordinary page, so normal
 *   rendering elsewhere is unaffected.
 * - `X-Content-Type-Options: nosniff` — stops a browser from MIME-sniffing
 *   a response into something it wasn't served as (e.g. treating it as
 *   HTML).
 *
 * Apply on every response from a media/file-serve route (merge into that
 * route's existing headers — this does not set `Content-Type` or
 * `Content-Disposition` itself, so non-SVG media keeps rendering/downloading
 * exactly as before).
 */
export function mediaSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
}
