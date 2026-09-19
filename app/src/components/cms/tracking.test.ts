// Run: npm test -- src/components/cms/tracking.test.ts
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

import { isValidPixelId } from "./MetaPixel";
import { googleTagKind, isValidGoogleTagId } from "./GoogleTag";

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

console.log("tracking.test.ts: all assertions passed");
