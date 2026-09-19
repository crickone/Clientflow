/**
 * Validating the tracking ids an operator types, and deciding which Google
 * snippet an id needs.
 *
 * Pure and React-free on purpose: the same rules are needed by the server
 * action that saves them and by the client component that injects them after
 * consent, and neither should have to import the other's world.
 *
 * Strict character classes throughout. These values are interpolated into a
 * <script> on a client's live website, so a stray quote does not merely fail
 * to track — it closes the string and takes every other script on the page
 * with it, including the navigation and the animations.
 */

export type GoogleTagKind = "gtm" | "gtag";

/** Meta pixel ids are numeric. Anything else is a paste error, not an id. */
export function isValidPixelId(id: string): boolean {
  return /^\d{8,20}$/.test(id.trim());
}

/**
 * Which snippet a Google id needs, or null if it is not a Google tag.
 *
 *   GTM-…  a Tag Manager container: the GTM loader.
 *   G-…    a GA4 measurement id: gtag.js.
 *   AW-…   a Google Ads conversion id: gtag.js.
 *
 * The two are genuinely different, so the prefix picks the snippet rather
 * than the operator having to know. Guessing wrong means the tag silently
 * never fires.
 */
export function googleTagKind(raw: string): GoogleTagKind | null {
  const id = raw.trim().toUpperCase();
  if (/^GTM-[A-Z0-9]{4,12}$/.test(id)) return "gtm";
  if (/^G-[A-Z0-9]{6,14}$/.test(id)) return "gtag";
  if (/^AW-\d{6,14}$/.test(id)) return "gtag";
  return null;
}

export function isValidGoogleTagId(raw: string): boolean {
  return googleTagKind(raw) !== null;
}

// ── consent ─────────────────────────────────────────────────────────────────

export type ConsentChoice = "granted" | "denied";

/** Where a visitor's choice is remembered, per site. */
export const consentStorageKey = (siteSlug: string) => `cms-consent:${siteSlug}`;

/**
 * Read a stored choice.
 *
 * Anything unrecognised — a value from an older format, a half-written
 * entry, storage that throws in a private window — reads as NO DECISION, so
 * the visitor is asked again and nothing fires meanwhile. The failure
 * direction matters: an unreadable choice must never be treated as consent.
 */
export function parseConsent(raw: string | null | undefined): ConsentChoice | null {
  if (raw === "granted" || raw === "denied") return raw;
  return null;
}

/**
 * Whether tracking may run at all.
 *
 * A single place for the rule, so no caller can accidentally invert it: only
 * an explicit "granted" permits anything. No decision is not consent, and
 * neither is a broken one.
 */
export function mayTrack(choice: ConsentChoice | null): boolean {
  return choice === "granted";
}
