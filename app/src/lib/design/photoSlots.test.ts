// Run: npm test -- src/lib/design/photoSlots.test.ts
//
// The placeholder used to be a bare string declared in designPost.parse.ts and
// then spelled out AGAIN as a literal in three other modules -- the client used
// one to decide which of two routes to call. This module is the one place that
// knows what a photo slot looks like, so an indexed form can be added here
// rather than hunted for across seven files.
import assert from "node:assert/strict";

import {
  MAX_PHOTO_SLOTS,
  PHOTO_TOKEN,
  fillPhotoSlots,
  photoSlotsUsed,
  tokenForSlot,
  usesPhoto,
} from "./photoSlots";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const img = (src: string) => `<img src="${src}" style="width:1080px;height:540px"/>`;

check("the bare token is unchanged -- every stored slide contains it", PHOTO_TOKEN === "{{PHOTO}}");
check("two slots, no more", MAX_PHOTO_SLOTS === 2);

check("slot 1 is the bare token, not an indexed one", tokenForSlot(1) === "{{PHOTO}}");
check("slot 2 is indexed", tokenForSlot(2) === "{{PHOTO:2}}");

check("markup with no photograph uses no slots", photoSlotsUsed("<div>hello</div>").length === 0);
check("the bare token reads as slot 1", JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN))) === "[1]");
check(
  "an indexed token reads as its own slot",
  JSON.stringify(photoSlotsUsed(img("{{PHOTO:2}}"))) === "[2]",
);
check(
  "both forms together read as two slots, ascending",
  JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN) + img("{{PHOTO:2}}"))) === "[1,2]",
);
check(
  "the same slot twice is one slot",
  JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN) + img(PHOTO_TOKEN))) === "[1]",
);
check("usesPhoto is true for the bare form", usesPhoto(img(PHOTO_TOKEN)) === true);
check("usesPhoto is true for an indexed form alone", usesPhoto(img("{{PHOTO:2}}")) === true);
check("usesPhoto is false for a flat ground", usesPhoto("<div>no pictures</div>") === false);

// Substitution
const two = img(PHOTO_TOKEN) + img("{{PHOTO:2}}");
const filled = fillPhotoSlots(two, (slot) => `SRC${slot}`);
check("each slot gets its OWN value", filled.includes("SRC1") && filled.includes("SRC2"));
check("no token survives substitution", !filled.includes("{{PHOTO"));

check(
  "the same slot appearing twice gets the same value both times",
  fillPhotoSlots(img(PHOTO_TOKEN) + img(PHOTO_TOKEN), () => "X").split("X").length - 1 === 2,
);

// A slot with no photograph loses its whole <img>: a broken src draws an empty box.
const oneMissing = fillPhotoSlots(two, (slot) => (slot === 1 ? "SRC1" : null));
check("a null slot loses its whole img tag", !oneMissing.includes("{{PHOTO:2}}") && !oneMissing.includes("SRC2"));
check("the img element itself is gone, not just its src", (oneMissing.match(/<img/g) ?? []).length === 1);
check("the surviving slot is untouched", oneMissing.includes("SRC1"));

check(
  "markup with no slots comes back identical",
  fillPhotoSlots("<div>plain</div>", () => "X") === "<div>plain</div>",
);

console.log(`\nphotoSlots: ${passed} checks passed`);
