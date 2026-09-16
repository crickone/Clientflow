// Run: npm test -- src/lib/content-studio/slideIntent.test.ts
//
// Which of the three things the dialog can do a typed sentence is asking for.
// The sentences here are the ones that actually get confused, plus the one a
// real operator typed -- "change the guy in the photo to a woman" -- which the
// three-button dialog answered by doing nothing to the photograph at all.
import assert from "node:assert/strict";

import {
  clampIntent,
  guessIntent,
  intentDescription,
  intentPrompt,
  parseIntent,
  type IntentContext,
} from "./slideIntent";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A slide with a photograph in its slot and both providers configured. */
const FULL: IntentContext = {
  hasPhotoSlot: true,
  hasPhotoInSlot: true,
  canGenerate: true,
  canEdit: true,
};

// ---------------------------------------------------------------------------
// clampIntent — a route the slide cannot take is not a route
// ---------------------------------------------------------------------------
check("everything is available on a full slide", clampIntent("editPhoto", FULL) === "editPhoto");
check(
  "an edit with no photograph in the slot becomes a generation, NOT a redesign -- both mean 'I want a different picture'",
  clampIntent("editPhoto", { ...FULL, hasPhotoInSlot: false }) === "newPhoto",
);
check(
  "an edit with editing unconfigured becomes a generation",
  clampIntent("editPhoto", { ...FULL, canEdit: false }) === "newPhoto",
);
check(
  "with no provider at all there is only the redesign left",
  clampIntent("editPhoto", { ...FULL, canEdit: false, canGenerate: false }) === "design",
);
check(
  "a generation with generation unconfigured falls back to the redesign",
  clampIntent("newPhoto", { ...FULL, canGenerate: false }) === "design",
);
check("a redesign is always possible", clampIntent("design", { hasPhotoSlot: false, hasPhotoInSlot: false, canGenerate: false, canEdit: false }) === "design");

// ---------------------------------------------------------------------------
// parseIntent — the model's word
// ---------------------------------------------------------------------------
check("the three labels are read", ["design", "newPhoto", "editPhoto"].every((l) => parseIntent(l, FULL) === l));
check("case and punctuation do not matter", parseIntent("  EditPhoto.\n", FULL) === "editPhoto");
// "design" is the cheapest of the three, changes nothing outside the slide,
// and its result can be seen and rejected at a glance.
check("an unrecognised answer becomes the cheapest, most reversible route", parseIntent("banana", FULL) === "design");
check("so does an empty one", parseIntent("", FULL) === "design");
check(
  "a parsed route is still clamped to what the slide can do",
  parseIntent("editPhoto", { ...FULL, hasPhotoInSlot: false }) === "newPhoto",
);

// ---------------------------------------------------------------------------
// guessIntent — the fallback, for when the classifier cannot be reached
// ---------------------------------------------------------------------------
check("nothing typed is a plain regenerate", guessIntent("", FULL) === "design");
check(
  "a sentence that never mentions the picture is about the slide",
  ["make the headline bigger", "try it on the dark ground", "the text is too cramped", "change the heading"].every(
    (s) => guessIntent(s, FULL) === "design",
  ),
);
// THE REPORTED SENTENCE. It names the photo and asks for something in it to
// be changed, which is an edit -- and the dialog it was typed into could not
// do one.
check(
  "\"change the guy in the photo to a woman\" is an edit",
  guessIntent("change the guy in the photo to a woman", FULL) === "editPhoto",
);
check(
  "so are other alterations of the picture that is there",
  ["remove the clutter behind him in the photo", "get rid of the sign in the image", "make the person in the photo smile"].every(
    (s) => guessIntent(s, FULL) === "editPhoto",
  ),
);
check(
  "asking for a different picture is a generation",
  ["use a different photo", "another image please", "a new photo of the infrared bed instead"].every(
    (s) => guessIntent(s, FULL) === "newPhoto",
  ),
);
// "replace the photo with a different one" reads as an edit by its verb and a
// generation by its intent. Wanting something fresh has to win.
check(
  "wanting a fresh one beats an edit-ish verb",
  guessIntent("replace the photo with a different one", FULL) === "newPhoto",
);
check(
  "the guess is clamped too -- an edit with nothing to edit becomes a generation",
  guessIntent("remove the sign in the photo", { ...FULL, hasPhotoInSlot: false }) === "newPhoto",
);
check(
  "and with no providers it can only redesign",
  guessIntent("use a different photo", { ...FULL, canGenerate: false, canEdit: false }) === "design",
);

// ---------------------------------------------------------------------------
// The prompt, and what the operator is told
// ---------------------------------------------------------------------------
{
  const p = intentPrompt("change the guy in the photo to a woman", FULL);
  check("the prompt carries the operator's sentence", p.includes("change the guy in the photo to a woman"));
  check("it offers exactly the three labels", ["design", "newPhoto", "editPhoto"].every((l) => p.includes(l)));
  check("it asks for one word, so the parse has one job", p.includes("exactly one word"));
  check("it says whether there is a photograph to edit", p.includes("is holding one"));
}
check(
  "an empty slot is described as empty, so the model does not route to an edit that cannot run",
  intentPrompt("x", { ...FULL, hasPhotoInSlot: false }).includes("is empty"),
);

// The routing is invisible until it is wrong, so it has to say what it did.
check(
  "each route says what it did, in the operator's terms",
  intentDescription("design") === "Redesigned the slide." &&
    intentDescription("newPhoto") === "Made a new photograph." &&
    intentDescription("editPhoto") === "Changed the photograph.",
);

console.log(`\nslideIntent: ${passed} checks passed`);
