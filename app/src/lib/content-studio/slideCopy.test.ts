// Run: npm test -- src/lib/content-studio/slideCopy.test.ts
//
// Reading a slide's words when the two kinds of slide keep them in different
// places. A designed slide's heading and body columns are EMPTY by design --
// its copy is text nodes inside designHtml -- and code that read the columns
// got "" back and carried on. That is how a caption came to be written from
// "(empty)" five times over.
import assert from "node:assert/strict";

import { copyOf } from "./slideCopy";

const DESIGNED = "designed";
let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const templateSlide = {
  templateId: "carousel-cover",
  headingText: "HBOT or infrared?",
  bodyText: "Two sessions that feel nothing alike.",
  designHtml: null,
};
{
  const c = copyOf(templateSlide, DESIGNED);
  check("a template slide's copy comes from its columns", c.heading === "HBOT or infrared?" && c.body.startsWith("Two sessions"));
  check("and it carries its own template id", c.template === "carousel-cover");
}
check(
  "null columns read as empty strings, not null",
  (() => {
    const c = copyOf({ templateId: "x", headingText: null, bodyText: null, designHtml: null }, DESIGNED);
    return c.heading === "" && c.body === "";
  })(),
);

const designed = {
  templateId: DESIGNED,
  headingText: "",
  bodyText: "",
  designHtml:
    '<div style="display:flex">' +
    '<div style="font-size:15px">INFRARED THERAPY</div>' +
    '<div style="font-size:50px">Radiant warmth, nothing enclosing you</div>' +
    '<div style="font-size:21px">You lie on a bed that radiates gentle heat.</div>' +
    "</div>",
};
{
  const c = copyOf(designed, DESIGNED);
  check("a designed slide's copy comes out of its markup, not its empty columns", c.heading !== "" && c.body !== "");
  check("the first run is the heading", c.heading === "INFRARED THERAPY");
  check(
    "everything after it is the body, in order",
    c.body === "Radiant warmth, nothing enclosing you\nYou lie on a bed that radiates gentle heat.",
  );
}
check(
  "whitespace in the markup does not reach the prompt",
  copyOf(
    { ...designed, designHtml: '<div style="a">  HBOT\n   or\tinfrared?  </div>' },
    DESIGNED,
  ).heading === "HBOT or infrared?",
);
check(
  "a designed slide with no markup falls back to its columns rather than throwing",
  copyOf({ ...designed, headingText: "kept", designHtml: null }, DESIGNED).heading === "kept",
);
check(
  "a designed slide with no text at all is empty, not undefined",
  (() => {
    const c = copyOf({ ...designed, designHtml: '<div style="a"></div>' }, DESIGNED);
    return c.heading === "" && c.body === "";
  })(),
);
// A single-run design has a heading and nothing else -- `slice(1)` on a
// one-item list is [], and joining [] must give "" rather than undefined.
check(
  "one run means a heading and an empty body",
  (() => {
    const c = copyOf({ ...designed, designHtml: '<div style="a">Just the one</div>' }, DESIGNED);
    return c.heading === "Just the one" && c.body === "";
  })(),
);

console.log(`\nslideCopy: ${passed} checks passed`);
