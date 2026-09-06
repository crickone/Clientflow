// Run: npm test -- src/lib/image/slots.test.ts
//
// These pin the slot-routing rules that a design's slides are filed under.
// The bug this exists to prevent (2026-09-06): the Start screen sent
// `seedTemplateId: "carousel-content"` believing it chose a SLOT, but the
// create route only ever passed a TEMPLATE and let the slot default to
// "default". A carousel started with "I'll write it myself" therefore opened
// on the Carousels tab with every slot reading EMPTY while the slide sat in
// the hidden single-image slot — indistinguishable, from the operator's seat,
// from having lost the work.
//
// The predicate had four copies in ImageDesigner plus a private constant in
// StartDesign, and the route knew about none of them. It lives in one module
// now; these assertions are what stops it drifting apart again.
import assert from "node:assert/strict";

import {
  DEFAULT_CAROUSEL_SLOT,
  DEFAULT_SLOT,
  isCarouselSlot,
  isValidSlotKey,
  templateForNewSlide,
} from "./slots";
import { TEMPLATES } from "./templates";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
function eq(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}

console.log("slots");

// --- the predicate ---------------------------------------------------------

ok("a carousel- prefixed key is a carousel slot", isCarouselSlot("carousel-content"));
ok("carousel-cover is a carousel slot", isCarouselSlot("carousel-cover"));
ok(
  "question-hook is a carousel slot despite lacking the prefix",
  isCarouselSlot("question-hook"),
);
ok("the default slot is NOT a carousel slot", !isCarouselSlot(DEFAULT_SLOT));
ok("a single-image template id is not a carousel slot", !isCarouselSlot("bold-headline"));

// The one that actually bit: the editor files a design under the Carousels tab
// on this predicate alone, so a slot it rejects is a slot the tab cannot show.
ok(
  "the slot a new carousel is seeded into passes the editor's own test",
  isCarouselSlot(DEFAULT_CAROUSEL_SLOT),
);

// --- what the create route will accept -------------------------------------

ok("the default slot is a valid slot key", isValidSlotKey(DEFAULT_SLOT));
ok("a carousel slot is a valid slot key", isValidSlotKey(DEFAULT_CAROUSEL_SLOT));
ok("an unknown key is rejected", !isValidSlotKey("nonsense"));
ok(
  "a real but non-carousel template id is NOT a slot key",
  !isValidSlotKey("bold-headline"),
);

// --- template choice for a newly added slide -------------------------------

eq(
  "the first slide of a carousel slot takes that slot's own template",
  templateForNewSlide("carousel-cover", 0, "ignored-fallback"),
  "carousel-cover",
);
eq(
  "every slide after the first is a content slide",
  templateForNewSlide("carousel-cover", 1, "ignored-fallback"),
  DEFAULT_CAROUSEL_SLOT,
);
eq(
  "outside a carousel the caller's fallback stands",
  templateForNewSlide(DEFAULT_SLOT, 0, "bold-headline"),
  "bold-headline",
);
eq(
  "a single post seeded into the default slot keeps its template",
  templateForNewSlide(DEFAULT_SLOT, 3, "star-rating"),
  "star-rating",
);

// --- the slots have to be real templates -----------------------------------

const templateIds = new Set(TEMPLATES.map((t) => t.id));
ok(
  `DEFAULT_CAROUSEL_SLOT ("${DEFAULT_CAROUSEL_SLOT}") is a real template id`,
  templateIds.has(DEFAULT_CAROUSEL_SLOT),
);

// Every carousel-category template doubles as a slot key, since clicking its
// card in the editor switches to a slot of that name. If one stopped passing
// isCarouselSlot, its card would silently start behaving like a single image.
for (const t of TEMPLATES.filter((x) => x.category === "carousels")) {
  ok(`carousel template "${t.id}" is usable as a slot key`, isValidSlotKey(t.id));
}

// And the converse: nothing outside the carousels category may claim a slot,
// or a single-image template would capture the Carousels tab.
for (const t of TEMPLATES.filter((x) => x.category !== "carousels")) {
  ok(
    `non-carousel template "${t.id}" is not mistaken for a carousel slot`,
    !isCarouselSlot(t.id),
  );
}

console.log(`\nslots: ${passed} checks passed.`);
