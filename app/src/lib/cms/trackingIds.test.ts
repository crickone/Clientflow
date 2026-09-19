// Run: npm test -- src/components/cms/trackingIds.test.ts
//
// The pixel id is interpolated into a <script> on a client's public website.
// A value that is not an id does not merely fail to track — a stray quote
// closes the string and takes every other script on the page with it,
// including the one that runs the navigation and the animations.
//
// So the id is validated rather than trusted, and this is that rule. The
// component itself is React and cannot load in this runner; the predicate it
// gates on is pure and is what actually decides.
import assert from "node:assert/strict";

import {
  consentStorageKey,
  extractVerificationToken,
  googleTagKind,
  isValidGoogleTagId,
  isValidPixelId,
  isValidSiteVerification,
  looksLikeMetaTag,
  mayTrack,
  parseConsent,
} from "./trackingIds";

// Real Meta pixel ids are long numeric strings.
for (const id of ["1234567890123456", "12345678", "12345678901234567890"]) {
  assert.equal(isValidPixelId(id), true, `${id} is a plausible pixel id`);
}
assert.equal(isValidPixelId("  1234567890123456  "), true, "surrounding whitespace is forgiven");

// Everything that is not one.
for (const bad of [
  "",
  "   ",
  "1234567", // too short to be real
  "123456789012345678901", // too long
  "abc1234567890123",
  "1234567890123456 ' + alert(1) + '", // the reason this check exists
  "1234567890123456';fbq('init','other",
  "<script>alert(1)</script>",
  "1234-5678-9012",
  "GTM-ABC123", // a Google container, pasted into the wrong box
]) {
  assert.equal(isValidPixelId(bad), false, `refused: ${JSON.stringify(bad)}`);
}

// The specific failure this prevents: nothing that could terminate the
// string literal or open a tag may pass.
for (const ch of ["'", '"', "`", "\\", "<", ">", "\n", ";"]) {
  assert.equal(
    isValidPixelId(`123456789012${ch}3456`),
    false,
    `a ${JSON.stringify(ch)} anywhere in the id is refused`,
  );
}

// ── the Google tag ──────────────────────────────────────────────────────────
//
// One field takes three different ids and they need DIFFERENT snippets: a
// container loads Tag Manager plus a noscript iframe, while G-/AW- load
// gtag.js and call config. Pick the wrong one and the tag silently never
// fires, which is the failure nobody notices for weeks.

assert.equal(googleTagKind("GTM-NHRBKKN4"), "gtm", "a container gets the Tag Manager snippet");
assert.equal(googleTagKind("G-YCVZ474X5H"), "gtag", "a GA4 tag gets gtag.js");
assert.equal(googleTagKind("AW-123456789"), "gtag", "…and so does a Google Ads id");
assert.equal(googleTagKind("  gtm-nhrbkkn4  "), "gtm", "case and whitespace are forgiven");

for (const bad of [
  "",
  "   ",
  "GTM-",
  "G-",
  "AW-",
  "AW-notdigits",
  "1234567890123456", // a Meta pixel, pasted into the wrong box
  "UA-12345-1", // Universal Analytics, dead since 2023
  "GTM-ABC';alert(1);'",
  "<script>alert(1)</script>",
  "GTM NHRBKKN4",
]) {
  assert.equal(isValidGoogleTagId(bad), false, `refused: ${JSON.stringify(bad)}`);
}

// Same reason as the pixel: this value goes inside a <script> on a live site.
for (const ch of ["'", '"', "`", "\\", "<", ">", "\n", ";", "/"]) {
  assert.equal(
    isValidGoogleTagId(`GTM-ABC${ch}DEF`),
    false,
    `a ${JSON.stringify(ch)} in a Google tag id is refused`,
  );
}

// The two boxes must not accept each other's ids, or an operator swaps them
// and both tags quietly do nothing.
assert.equal(isValidPixelId("GTM-NHRBKKN4"), false, "a container is not a Meta pixel");
assert.equal(isValidGoogleTagId("1234567890123456"), false, "a Meta pixel is not a Google tag");

// ── Google site verification ────────────────────────────────────────────────
//
// This one is not a script, it is a meta tag's content. The risk is
// different: a value with a quote in it would break OUT of the attribute, so
// the character class is what matters more than the length.

const REAL_TOKEN = "googleXYZ_abc-123defGHIjklMNOpqrstuvWX";
assert.equal(isValidSiteVerification(REAL_TOKEN), true, "a Search Console token");
assert.equal(isValidSiteVerification(`  ${REAL_TOKEN}  `), true, "pasted with whitespace");

for (const bad of [
  "",
  "short",
  'abc" /><script>alert(1)</script>',
  `${REAL_TOKEN} ${REAL_TOKEN}`,
  "token with spaces in the middle aaaaaaaaaa",
  "tok<en>aaaaaaaaaaaaaaaaaaaaa",
]) {
  assert.equal(
    isValidSiteVerification(bad),
    false,
    `${JSON.stringify(bad)} is not a verification token`,
  );
}

// What an operator ACTUALLY copies out of Search Console is the whole tag.
// Reading the token out of it is the difference between the field working
// first time and the operator being told they are wrong when they are not.
const PASTED = `<meta name="google-site-verification" content="${REAL_TOKEN}" />`;
assert.equal(extractVerificationToken(PASTED), REAL_TOKEN, "the token comes out of the tag");
assert.equal(isValidSiteVerification(extractVerificationToken(PASTED)), true);
assert.equal(
  extractVerificationToken(`<meta content='${REAL_TOKEN}' name="google-site-verification">`),
  REAL_TOKEN,
  "single quotes too",
);
assert.equal(extractVerificationToken(REAL_TOKEN), REAL_TOKEN, "a bare token passes through");
assert.equal(extractVerificationToken(`  ${REAL_TOKEN} `), REAL_TOKEN);

// A tag with nothing to read must still be REJECTED, not stored as markup.
assert.equal(looksLikeMetaTag('<meta name="google-site-verification">'), true);
assert.equal(
  isValidSiteVerification(extractVerificationToken('<meta name="google-site-verification">')),
  false,
  "a tag with no content attribute is not a token",
);
assert.equal(looksLikeMetaTag(REAL_TOKEN), false, "a bare token is not a tag");

// ── consent ─────────────────────────────────────────────────────────────────
//
// These tags fire on Irish businesses' sites serving EU visitors, so nothing
// may load before the visitor agrees. The direction of every failure here is
// the whole point: anything that is not an explicit yes must read as no.

assert.equal(parseConsent("granted"), "granted");
assert.equal(parseConsent("denied"), "denied");

for (const junk of [null, undefined, "", "true", "yes", "1", "GRANTED", "accepted", "{}"]) {
  assert.equal(
    parseConsent(junk as string | null),
    null,
    `${JSON.stringify(junk)} is NOT a decision — the visitor gets asked again`,
  );
}

assert.equal(mayTrack("granted"), true, "an explicit yes permits tracking");
assert.equal(mayTrack("denied"), false, "an explicit no does not");
assert.equal(mayTrack(null), false, "AND NEITHER DOES NO ANSWER — silence is not consent");

// Junk in storage must never become permission. This is the one that would
// hurt: a half-written or foreign value read as a yes would track everybody.
for (const junk of ["", "true", "yes", "1", "accepted", "GRANTED"]) {
  assert.equal(
    mayTrack(parseConsent(junk)),
    false,
    `a stored value of ${JSON.stringify(junk)} does not permit tracking`,
  );
}

// One decision per site: an agency runs several clients' websites from the
// same platform, and agreeing on one is not agreeing on another.
assert.notEqual(consentStorageKey("inspire"), consentStorageKey("other-gym"));
assert.match(consentStorageKey("inspire"), /inspire/);

console.log("trackingIds.test.ts: all assertions passed");
