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
  slotsOverCap,
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

// slotsOverCap: reporting is unfiltered (photoSlotsUsed), only this predicate
// (used by the audit) draws the line.
check("nothing over cap when within range", slotsOverCap(img(PHOTO_TOKEN) + img("{{PHOTO:2}}")).length === 0);
check(
  "a third slot is reported as over cap, not silently dropped",
  JSON.stringify(slotsOverCap(img("{{PHOTO:3}}"))) === "[3]",
);
check(
  "photoSlotsUsed itself still surfaces the out-of-range slot -- the audit needs to SEE it to reject it",
  JSON.stringify(photoSlotsUsed(img("{{PHOTO:99}}"))) === "[99]",
);

// A zero-padded index is a mistyped slot, not "slot 7" -- see the doc comment
// on photoSlotsUsed for why aliasing it would be worse than rejecting it.
check(
  "a leading-zero index ({{PHOTO:007}}) is not a slot at all",
  photoSlotsUsed(img("{{PHOTO:007}}")).length === 0 && usesPhoto(img("{{PHOTO:007}}")) === false,
);

// Finding 1: a quoted '>' before the token must not stop the tag scan early.
// The counter-example a reviewer proved against the old [^>]*-based regex:
// it truncated at the '>' inside the alt text and never reached the token,
// so the "remove this slot" path was a silent no-op and the raw placeholder
// reached the renderer.
check(
  "a '>' inside a DOUBLE-quoted attribute before the token does not defeat removal",
  (() => {
    const html = `<img alt="Before > After" src="${PHOTO_TOKEN}">`;
    const result = fillPhotoSlots(html, () => null);
    return !result.includes(PHOTO_TOKEN) && !result.includes("<img");
  })(),
);
check(
  "a '>' inside a SINGLE-quoted value before the token does not defeat removal",
  (() => {
    const html = `<img alt='Before > After' src="${PHOTO_TOKEN}">`;
    const result = fillPhotoSlots(html, () => null);
    return !result.includes(PHOTO_TOKEN) && !result.includes("<img");
  })(),
);
check(
  "an unquoted attribute value ahead of the token does not defeat removal",
  (() => {
    const html = `<img data-x=before src="${PHOTO_TOKEN}">`;
    const result = fillPhotoSlots(html, () => null);
    return !result.includes(PHOTO_TOKEN) && !result.includes("<img");
  })(),
);
check(
  "a self-closing <img ... /> is removed like any other",
  (() => {
    const html = `<img alt="Before > After" src="${PHOTO_TOKEN}" />`;
    const result = fillPhotoSlots(html, () => null);
    return !result.includes(PHOTO_TOKEN) && !result.includes("<img");
  })(),
);

// Finding 3: two tokens sharing one <img> is malformed (one element, one
// src). Chosen behaviour: leave that element completely untouched -- both
// raw tokens survive -- rather than remove it and silently discard whichever
// slot's value the caller believed was placed.
check(
  "nulling one slot in a two-token <img> leaves the whole element untouched, rather than silently discarding the other slot's filled value",
  (() => {
    const html = `<img src="${PHOTO_TOKEN}" data-x="{{PHOTO:2}}">`;
    const result = fillPhotoSlots(html, (slot) => (slot === 1 ? null : "SRC2"));
    return result === html;
  })(),
);

// Finding 4: each slot's own value is substituted exactly once. A value that
// happens to contain another slot's token text verbatim must not be rewritten
// by that slot's later pass -- otherwise the fill function would not be safe
// for the general `(slot) => string | null` contract it advertises.
check(
  "a slot's own substituted value is never re-scanned by a later slot's pass",
  (() => {
    const result = fillPhotoSlots(two, (slot) => (slot === 1 ? "xxx{{PHOTO:2}}yyy" : "SRC2"));
    return result.includes("xxx{{PHOTO:2}}yyy") && !result.includes("xxxSRC2yyy");
  })(),
);

console.log(`\nphotoSlots: ${passed} checks passed`);
