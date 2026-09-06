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
  applySlotOrder,
  isCarouselSlot,
  isValidSlotKey,
  templateForNewSlide,
} from "./slots";
import {
  TEMPLATES,
  carouselTemplateGroups,
  singleTemplateGroups,
} from "./templates";

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

// --- the picker's two lists --------------------------------------------------
//
// The six-tab row was replaced by a single Single-post / Carousel switch, so
// each kind now shows one scrolling, labelled list. The point of the change is
// that you only ever see templates for the kind you chose — if the two lists
// started overlapping, the naming collision the redesign removed would be back.

const carouselIds = carouselTemplateGroups().flatMap((g) =>
  g.templates.map((t) => t.id),
);
const singleIds = singleTemplateGroups().flatMap((g) =>
  g.templates.map((t) => t.id),
);

eq(
  "every carousel template is offered exactly once",
  carouselIds.length,
  new Set(carouselIds).size,
);
eq(
  "every single-post template is offered exactly once",
  singleIds.length,
  new Set(singleIds).size,
);
ok(
  "the carousel list is exactly the carousels category",
  carouselIds.length === TEMPLATES.filter((t) => t.category === "carousels").length,
);
ok(
  "no carousel template leaks into the single-post list",
  singleIds.every((id) => !isCarouselSlot(id)),
);
ok(
  "no single-post template leaks into the carousel list",
  carouselIds.every((id) => isCarouselSlot(id)),
);
eq(
  "between them the two lists offer every template — none is unreachable",
  [...carouselIds, ...singleIds].sort(),
  TEMPLATES.map((t) => t.id).sort(),
);
ok("every group is labelled", [
  ...carouselTemplateGroups(),
  ...singleTemplateGroups(),
].every((g) => g.label.trim().length > 0));
ok(
  "no group renders empty",
  [...carouselTemplateGroups(), ...singleTemplateGroups()].every(
    (g) => g.templates.length > 0,
  ),
);

// A carousel's groups are slide ROLES, so the opener has to come before the
// closer — the list doubles as the shape of the series.
const roleLabels = carouselTemplateGroups().map((g) => g.label);
eq(
  "carousel groups read in series order",
  roleLabels,
  ["Opening slide", "Middle slides", "Closing slide"],
);

// --- dragging a slide to reorder the series ---------------------------------
//
// The filmstrip lets you drag slides. Order is stored per-slot, so a drag may
// only ever move slides within the slot on screen.

const slide = (id: number, slotKey: string) => ({ id, slotKey });

{
  const one = [slide(1, "carousel-content"), slide(2, "carousel-content"), slide(3, "carousel-content")];
  eq(
    "a drag puts the slot's slides in the order asked for",
    applySlotOrder(one, "carousel-content", [3, 1, 2])?.map((s) => s.id),
    [3, 1, 2],
  );
  eq("the original list is not mutated", one.map((s) => s.id), [1, 2, 3]);
}

{
  // A legacy design with two slots. Dragging inside one must not disturb the
  // other — and must not disturb where the other sits in the flat list, which
  // is what a naive [...others, ...reordered] rebuild would silently do. The
  // head of this array feeds the topic offered to the generator, so a rotation
  // here changes behaviour nowhere near the drag.
  const mixed = [
    slide(10, DEFAULT_SLOT),
    slide(1, "carousel-content"),
    slide(2, "carousel-content"),
    slide(11, DEFAULT_SLOT),
    slide(3, "carousel-content"),
  ];
  const out = applySlotOrder(mixed, "carousel-content", [3, 2, 1]);
  eq(
    "slides in other slots keep their exact positions",
    out?.map((s) => s.id),
    [10, 3, 2, 11, 1],
  );
  ok(
    "the untouched slot's slides are the very same objects",
    out?.[0] === mixed[0] && out?.[3] === mixed[3],
  );
  eq(
    "the first slide of the design is unchanged by a drag in another slot",
    out?.[0].id,
    mixed[0].id,
  );
  eq(
    "no slide is lost or duplicated",
    out?.map((s) => s.id).sort((a, b) => a - b),
    [1, 2, 3, 10, 11],
  );
}

{
  // Every rejection path returns null so the caller leaves the list alone
  // rather than dropping slides.
  const three = [slide(1, "carousel-content"), slide(2, "carousel-content"), slide(3, "carousel-content")];
  eq(
    "a short order (a slide arrived mid-drag) is rejected",
    applySlotOrder(three, "carousel-content", [1, 2]),
    null,
  );
  eq(
    "a long order is rejected",
    applySlotOrder(three, "carousel-content", [1, 2, 3, 4]),
    null,
  );
  eq(
    "an ID from another design is rejected",
    applySlotOrder(three, "carousel-content", [1, 2, 99]),
    null,
  );
  eq(
    "a duplicated ID is rejected rather than cloning a slide",
    applySlotOrder(three, "carousel-content", [1, 1, 2]),
    null,
  );
  eq(
    "reordering a slot that holds nothing is a no-op, not a crash",
    applySlotOrder(three, "carousel-cover", []),
    three,
  );
}

console.log(`\nslots: ${passed} checks passed.`);
