// Run: npm test -- src/lib/ai/composeDesign.test.ts
//
// The pure half of the composed-generation pass: what the model is TOLD about
// the tenant's system, what is made of what it returns, and which of its
// mistakes survive to the operator. The model call itself is not exercised
// here — checkSlides is the seam, taking raw layouts and giving back slides
// plus the problems that go into the repair call.
import assert from "node:assert/strict";

import {
  checkSlides,
  describeDesignSystem,
  extractComposedPayload,
  type RawSlide,
} from "@/lib/ai/composeDesign.parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "@/lib/design/presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const TIMBER = "#b0844f";

// -------------------------------------------------------------------------
//  What the model is told
// -------------------------------------------------------------------------

const described = describeDesignSystem(SYSTEM);
check("the palette is named", described.includes("sage #c7d2bb"));
check("every value appears", SYSTEM.values.every((v) => described.includes(v.key)));
check(
  "the forbidden-as-type value is called out",
  described.includes("NEVER set type in this"),
);
check("the grounds carry their budgets", described.includes("at most 33%"));
check(
  "and their run limits, in words that scan",
  described.includes("never more than 1 slide in a row"),
);
check("the type scale is listed", described.includes("display — 84px"));
check("the label's uppercase is mentioned", described.includes("uppercase"));
check("the grid is stated in columns", described.includes("6 columns of 131px"));
check("the contrast floor is stated as a rule", described.includes("4.5:1"));
check(
  "the model is told its layout will be checked",
  described.includes("checked against this before anyone sees it"),
);

// -------------------------------------------------------------------------
//  Reading the reply
// -------------------------------------------------------------------------

const wrapped = `Here you go.
<slides>
{"caption":"A caption.","slides":[{"image":"a quiet room","layout":{"archetype":"statement","ground":"ink","photo":"full","slots":[{"level":"display","text":"Recovery is a practice","span":5}]}}]}
</slides>
Hope that helps.`;
const read = extractComposedPayload(wrapped);
check("the payload is found inside the tags", read.slides.length === 1);
check("the caption comes back", read.caption === "A caption.");
check("the scene comes back", read.slides[0].image === "a quiet room");

check(
  "a fenced payload is unwrapped",
  extractComposedPayload(
    '<slides>\n```json\n{"caption":"c","slides":[]}\n```\n</slides>',
  ).caption === "c",
);
check(
  "a bare payload with no tags still parses",
  extractComposedPayload('{"caption":"c","slides":[]}').caption === "c",
);

let threw = false;
try {
  extractComposedPayload('{"caption":"c"}');
} catch {
  threw = true;
}
check("a reply with no slides array is an error", threw);

// TRUNCATION. This is the production failure: a composed reply is far bigger
// than the copy-only format, so at too low a max_tokens the model stops before
// the closing tag. The old code then parsed the WHOLE string -- which starts
// "<slides>" -- and surfaced `SyntaxError: Unexpected token '<'`, telling the
// operator nothing. It has to name itself.
function errorFor(text: string): string {
  try {
    extractComposedPayload(text);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
const truncated = errorFor(
  '<slides>\n{"caption":"A caption.","slides":[{"image":"a room","layout":{"archetype":"stat',
);
check("a truncated reply is an error", truncated !== "");
check(
  "and it says it was cut off, not that JSON is malformed",
  truncated.toLowerCase().includes("cut off"),
);
check(
  "and it tells the operator what to change",
  truncated.toLowerCase().includes("fewer slides"),
);
check(
  "it does NOT leak a raw parser message",
  !truncated.includes("Unexpected token"),
);

// -------------------------------------------------------------------------
//  Checking what came back
// -------------------------------------------------------------------------

function raw(layout: unknown, image = "a quiet room"): RawSlide {
  return { layout, image };
}
const statement = (ground: string, photo = "full") => ({
  archetype: "statement",
  ground,
  photo,
  slots: [{ level: "display", text: "Recovery is a practice", span: 5 }],
});

const good = checkSlides(
  [raw(statement("ink")), raw(statement("plaster", "none"), "unused")],
  SYSTEM,
  TIMBER,
);
check("well-formed layouts produce slides", good.slides.length === 2);
check("with no problems to repair", good.problems.length === 0);
check("each carries its serialized spec", good.slides[0].layoutJson.includes("statement"));

// The row columns are derived from the spec's own slots, so the two cannot
// disagree at the moment a slide is created.
check(
  "the heading is pulled out of the display slot",
  good.slides[0].headingText === "Recovery is a practice",
);
check("the ground becomes the row's background", good.slides[0].backgroundColor === "#24231f");
check("the system's accent becomes the row's accent", good.slides[0].accentColor === TIMBER);

// Money: a flat slide never carries a scene, so nothing is spent on it.
check("a slide with a photograph keeps its scene", good.slides[0].image === "a quiet room");
check("a flat slide's scene is dropped", good.slides[1].image === "");

// A grammar error is a problem the repair call names, and the slide is not
// invented in its place.
const badArchetype = checkSlides([raw({ ...statement("ink"), archetype: "collage" })], SYSTEM, TIMBER);
check("an unknown archetype yields no slide", badArchetype.slides.length === 0);
check(
  "and a problem naming it, numbered by slide",
  badArchetype.problems.some((p) => p.startsWith("Slide 1:") && p.includes("collage")),
);

const badGround = checkSlides([raw(statement("timber"))], SYSTEM, TIMBER);
check(
  "a value that is not a ground is named as a problem",
  badGround.problems.some((p) => p.includes("not a ground")),
);

// The rotation rule is a SET-level problem, and it reaches both the repair
// call and the caller.
const sageTwice = checkSlides(
  [raw(statement("sage", "none")), raw(statement("sage", "none"))],
  SYSTEM,
  TIMBER,
);
check("both slides are still produced", sageTwice.slides.length === 2);
check(
  "the consecutive-sage rule is a set violation",
  sageTwice.setViolations.some((v) => v.includes("consecutive")),
);
check(
  "which also goes to the repair call",
  sageTwice.problems.some((v) => v.includes("consecutive")),
);

// The accent fills rules, so it is not held to the type rules -- otherwise
// every composed slide in this palette would be flagged for its own accent.
check(
  "a composed slide is not flagged for its accent",
  good.slides.every((s) => s.violations.length === 0),
);

console.log(`\ncomposeDesign: ${passed} checks passed`);
