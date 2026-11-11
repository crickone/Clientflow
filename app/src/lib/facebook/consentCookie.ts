/**
 * The first-party cookie SiteTracking sets while a visitor has accepted
 * advertising cookies on a site, read by the server before it sends a
 * Conversions API event (lib/facebook/capi.ts). Its own file because the
 * browser imports it, and capiModel.ts uses node:crypto.
 */
export const ADS_CONSENT_COOKIE = "aa_ads_consent";
