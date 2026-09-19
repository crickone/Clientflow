// Run: npm test -- src/components/cms/metaPixel.test.ts
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

console.log("metaPixel.test.ts: all assertions passed");
