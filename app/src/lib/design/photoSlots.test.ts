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
  multiSlotImgTags,
  photoSlotBoxes,
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

// Finding 1: multiSlotImgTags is what the audit (checkDesigns, in
// lib/ai/designPost.parse.ts) calls to reject a two-token <img> -- it must not
// regress to the naive `<img[^>]*>` form that a quoted '>' inside an earlier
// attribute (legal HTML) used to defeat.
check(
  "multiSlotImgTags catches a two-token <img> even behind a quoted '>' in an earlier attribute",
  (() => {
    const html = `<div style="display:flex"><img alt="Before > After" src="${PHOTO_TOKEN}{{PHOTO:2}}"/></div>`;
    return multiSlotImgTags(html).length === 1;
  })(),
);
check(
  "a clean two-<img> slide, one token each, is not flagged",
  multiSlotImgTags(img(PHOTO_TOKEN) + img("{{PHOTO:2}}")).length === 0,
);
check(
  "the same slot repeated within one <img> is not flagged -- it fills once, same as fillPhotoSlots",
  multiSlotImgTags(img(PHOTO_TOKEN + PHOTO_TOKEN)).length === 0,
);

// {{PHOTO:1}} is slot 1's indexed spelling, not a distinct slot and not an
// unfilled token: a model that has just learned "{{PHOTO:2}}" reaches for
// "{{PHOTO:1}}" by the same symmetry (see the module doc comment and
// spellingsForSlot). photoSlotsUsed already read it as slot 1 before this
// fix -- the gap was that fillPhotoSlots only recognised the bare spelling
// when substituting, so "{{PHOTO:1}}" reached the renderer untouched.
check(
  "{{PHOTO:1}} alone reads as slot 1, same as the bare form",
  JSON.stringify(photoSlotsUsed(img("{{PHOTO:1}}"))) === "[1]",
);
check(
  "{{PHOTO:1}} alone is filled -- no raw token survives",
  (() => {
    const result = fillPhotoSlots(img("{{PHOTO:1}}"), () => "SRC1");
    return result.includes("SRC1") && !result.includes("{{PHOTO");
  })(),
);
check(
  "usesPhoto is true for the indexed spelling of slot 1",
  usesPhoto(img("{{PHOTO:1}}")) === true,
);

// {{PHOTO:1}} and {{PHOTO}} together, in the SAME <img>: both spellings
// resolve to slot 1, so this is the same case as one spelling repeated
// twice -- not two distinct slots sharing an element -- and both instances
// get slot 1's one value. That is the right call: nulling one occurrence
// but not the other would mean guessing which spelling the caller "meant",
// and leaving the tag untouched (the two-DISTINCT-slots behaviour) would
// let a raw token reach the renderer for no reason, since there is only
// one photograph in play either way.
check(
  "{{PHOTO:1}} and {{PHOTO}} in the SAME <img> collide onto slot 1, not two slots",
  photoSlotsUsed(`<img src="${PHOTO_TOKEN}" data-x="{{PHOTO:1}}">`).length === 1,
);
check(
  "{{PHOTO:1}} and {{PHOTO}} in the SAME <img> both get slot 1's value filled in",
  (() => {
    const html = `<img src="${PHOTO_TOKEN}" data-x="{{PHOTO:1}}">`;
    const result = fillPhotoSlots(html, () => "SRC1");
    return (result.match(/SRC1/g) ?? []).length === 2 && !result.includes("{{PHOTO");
  })(),
);

// {{PHOTO:1}} and {{PHOTO}} together, in DIFFERENT <img> elements of the same
// design: they are still the same slot (there is only one bare token), so the
// design is reported as using ONE slot, not two -- and both elements get
// filled with that slot's single value, i.e. the same photograph twice. That
// mirrors two separate <img>s each carrying the literal bare token, which
// already filled identically before this fix.
check(
  "{{PHOTO:1}} and {{PHOTO}} in DIFFERENT <img>s in one design still read as ONE slot",
  JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN) + img("{{PHOTO:1}}"))) === "[1]",
);
check(
  "{{PHOTO:1}} and {{PHOTO}} in DIFFERENT <img>s both fill with slot 1's value, and no raw token survives",
  (() => {
    const html = img(PHOTO_TOKEN) + img("{{PHOTO:1}}");
    const result = fillPhotoSlots(html, () => "SRC1");
    return (result.match(/SRC1/g) ?? []).length === 2 && !result.includes("{{PHOTO");
  })(),
);

// {{PHOTO:1}} and {{PHOTO:2}} together: two DISTINCT slots, so this is the
// ordinary two-photograph case (same shape as the bare form + {{PHOTO:2}}
// already covered above) -- each slot keeps its own value.
check(
  "{{PHOTO:1}} and {{PHOTO:2}} together read as two distinct slots, ascending",
  JSON.stringify(photoSlotsUsed(img("{{PHOTO:1}}") + img("{{PHOTO:2}}"))) === "[1,2]",
);
check(
  "{{PHOTO:1}} and {{PHOTO:2}} each fill with their OWN value, and no raw token survives",
  (() => {
    const html = img("{{PHOTO:1}}") + img("{{PHOTO:2}}");
    const result = fillPhotoSlots(html, (slot) => `SRC${slot}`);
    return result.includes("SRC1") && result.includes("SRC2") && !result.includes("{{PHOTO");
  })(),
);

// ── photoSlotBoxes: what each slot's <img> declares for itself ───────────
//
// The renderer grades each slot at its own box rather than at the whole
// canvas, which is a ~5x saving on a two-slot slide (measured: 14.2s -> 3.2s
// at 1:1, 46.8s -> 9.8s at 9:16). Everything here is about the boundary
// between "this box is known in px" and "fall back to the canvas" -- getting
// that wrong grades a photograph at a size satori never lays out, and the
// overflow measurement then measures a layout that never rendered.
check(
  "a slot's px box is read off its own <img>",
  (() => {
    const boxes = photoSlotBoxes(img(PHOTO_TOKEN) + img("{{PHOTO:2}}"));
    const one = boxes.get(1);
    const two = boxes.get(2);
    return one?.width === 1080 && one.height === 540 && two?.width === 1080 && two.height === 540;
  })(),
);
check(
  "two slots with DIFFERENT boxes each get their own, not the first one's",
  (() => {
    const html =
      '<img src="{{PHOTO}}" style="width:1080px;height:720px"/>' +
      '<img src="{{PHOTO:2}}" style="width:540px;height:360px"/>';
    const boxes = photoSlotBoxes(html);
    return boxes.get(1)?.height === 720 && boxes.get(2)?.width === 540;
  })(),
);
check(
  "a percentage box is NOT a box -- the caller falls back to the canvas, as before",
  photoSlotBoxes('<img src="{{PHOTO}}" style="width:100%;height:100%"/>').size === 0,
);
check(
  "one axis in px and one missing is not a box either -- satori would infer the other",
  photoSlotBoxes('<img src="{{PHOTO}}" style="width:1080px"/>').size === 0,
);
check(
  "max-width does not masquerade as width -- a declaration is matched whole",
  photoSlotBoxes('<img src="{{PHOTO}}" style="max-width:600px;height:540px"/>').size === 0,
);
check(
  "a quoted > in an earlier attribute cannot hide the style -- the scan is quote-aware",
  photoSlotBoxes(
    '<img alt="Before > After" src="{{PHOTO}}" style="width:1080px;height:540px"/>',
  ).get(1)?.height === 540,
);
check(
  "single-quoted styles are read too",
  photoSlotBoxes("<img src='{{PHOTO}}' style='width:1080px;height:540px'/>").get(1)?.width === 1080,
);
check(
  "an <img> carrying two DISTINCT slots sizes neither -- that markup is the audit's to reject",
  photoSlotBoxes('<img src="{{PHOTO}}{{PHOTO:2}}" style="width:1080px;height:540px"/>').size === 0,
);
check(
  "both spellings of slot 1 report the one slot's box",
  photoSlotBoxes('<img src="{{PHOTO:1}}" style="width:1080px;height:540px"/>').get(1)?.height ===
    540,
);
check(
  "a fractional px box rounds to a whole pixel -- sharp cannot resize to half of one",
  photoSlotBoxes('<img src="{{PHOTO}}" style="width:1080px;height:539.6px"/>').get(1)?.height ===
    540,
);
check(
  "a slot in two <img> tags takes the FIRST deterministically, rather than whichever came last",
  photoSlotBoxes(
    '<img src="{{PHOTO}}" style="width:1080px;height:540px"/>' +
      '<img src="{{PHOTO}}" style="width:300px;height:200px"/>',
  ).get(1)?.height === 540,
);
check(
  "markup with no photo slot declares no boxes",
  photoSlotBoxes('<img src="logo.png" style="width:200px;height:100px"/>').size === 0,
);

console.log(`\nphotoSlots: ${passed} checks passed`);
