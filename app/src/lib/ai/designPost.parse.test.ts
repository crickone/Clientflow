// Run: npm test -- src/lib/ai/designPost.parse.test.ts
//
// The pure half of the design pass. It imports designPost.parse rather than
// designPost for the reason that split exists: the server-only chain
// (businessContext, the settings store) pulls React in transitively and will
// not load under the plain tsx runner.
import assert from "node:assert/strict";

import {
  DESIGN_RULES,
  NO_PHOTOGRAPHY_RULE,
  checkDesigns,
  describeSystemForDesign,
  extractDesignPayload,
} from "./designPost.parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "@/lib/design/presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// -- What the model is told about the brand -------------------------------
const d = describeSystemForDesign(SYSTEM);
check("the palette is named with real hexes", d.includes("sage #c7d2bb"));
check("every value appears", SYSTEM.values.every((v) => d.includes(v.key)));
check("the forbidden-as-type value is called out", d.includes("NEVER set type"));
check("the grounds carry their share budget", d.includes("at most 33%"));
check("and their run limit, in words that scan", d.includes("never more than 1 slide in a row"));
check("the type scale is given in real numbers", d.includes("84px"));
check("the grid is given in real numbers", d.includes("76px") && d.includes("131px"));
check("the contrast floor is stated", d.includes("4.5:1"));
check("the setting rule is stated", d.toLowerCase().includes("flush left"));

// -- What the model is told about the RENDERER ----------------------------
// These are not style advice. satori implements a subset of CSS, and markup
// that ignores it renders wrong or not at all.
check("it is told it is designing, not filling a template", DESIGN_RULES.includes("DESIGNING"));
check("flexbox-only is stated", DESIGN_RULES.includes("display:flex"));
check("no CSS filter is stated", DESIGN_RULES.includes("filter"));
check("img sizing in style is stated", DESIGN_RULES.includes("object-fit"));
check("the entity trap is stated", DESIGN_RULES.toLowerCase().includes("entit"));
check("the photo placeholder is specified", DESIGN_RULES.includes("{{PHOTO}}"));
check("moves a template cannot make are suggested", DESIGN_RULES.includes("cropped by the canvas edge"));

// -- Reading the reply ----------------------------------------------------
const reply = `Here you go.
<design>
{"caption":"A caption.","slides":[{"photo":"a quiet room","html":"<div style=\\"display:flex\\"></div>"}]}
</design>`;
const read = extractDesignPayload(reply);
check("the payload is found inside the tags", read.slides.length === 1);
check("the caption comes back", read.caption === "A caption.");
check("the scene comes back", read.slides[0].photo === "a quiet room");
check("the markup comes back", read.slides[0].html.includes("display:flex"));

check(
  "a fenced payload is unwrapped",
  extractDesignPayload('<design>\n```json\n{"caption":"c","slides":[]}\n```\n</design>').caption === "c",
);

function errorFor(text: string): string {
  try {
    extractDesignPayload(text);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
// The production failure from the archetype build, guarded here from the start:
// an opening tag with no closing tag is a TRUNCATION, and must say so rather
// than surfacing as a JSON parser error.
const truncated = errorFor('<design>\n{"caption":"c","slides":[{"html":"<div style=');
check("a truncated reply is an error", truncated !== "");
check("and says it was cut off", truncated.toLowerCase().includes("cut off"));
check("and says what to change", truncated.toLowerCase().includes("fewer slides"));
check("and never leaks a raw parser message", !truncated.includes("Unexpected token"));
check("a reply with no slides array is an error", errorFor('{"caption":"c"}') !== "");

// -- Checking what came back ----------------------------------------------
const clean = `<div style="display:flex;background:#f2f3ed"><span style="color:#24231f">x</span></div>`;
const good = checkDesigns([{ html: clean, photo: "" }], SYSTEM);
check("a clean design has no problems", good.problems.length === 0);
check("and is returned", good.designs.length === 1);

const bad = checkDesigns([{ html: `<div style="display:flex;background:#ff00ff"></div>`, photo: "" }], SYSTEM);
check("an off-palette design is a problem", bad.problems.length > 0);
check("numbered by slide, so the repair call can name it", bad.problems[0].startsWith("Slide 1:"));
check(
  "and the design is STILL returned -- a violation is shown, never discarded",
  bad.designs.length === 1 && bad.designs[0].violations.length > 0,
);

const noFlex = checkDesigns([{ html: `<div style="background:#f2f3ed">x</div>`, photo: "" }], SYSTEM);
check(
  "markup that will not render is caught before it is rendered",
  noFlex.problems.some((p) => p.includes("display:flex")),
);

// The failure a real generation produced: <br> inside a display:flex text
// element put "It's not the oxygen." and "It's the pressure." side by side on
// one line, which then ran off the canvas.
const withBr = checkDesigns(
  [{ html: `<div style="display:flex"><span style="width:786px">a<br/>b</span></div>`, photo: "" }],
  SYSTEM,
);
check("a <br> is caught", withBr.problems.some((p) => p.includes("<br>")));
check(
  "and the message explains what it actually does",
  withBr.problems.some((p) => p.includes("side by side")),
);
check("the text-wrap rule is in the prompt", DESIGN_RULES.includes("must NOT set"));
check("and the no-br rule", DESIGN_RULES.includes("NEVER write <br>"));
// Operator feedback on the first real carousel: the open compositions are the
// house look and headings want to be larger, and a comparison reads better
// stacked than as two columns at feed size.
check("headings are pushed to the top of the scale", DESIGN_RULES.includes("SET HEADINGS LARGE"));
check("and ties are broken upwards", DESIGN_RULES.includes("take the larger one"));
check("comparisons stack rather than sitting side by side", DESIGN_RULES.includes("SIDE BY SIDE"));
check("and are not boxed into cards", DESIGN_RULES.includes("shut inside cards"));
check(
  "the main heading is display size, not headline",
  DESIGN_RULES.includes("is DISPLAY size") &&
    DESIGN_RULES.includes("never for the thing the slide is about"),
);
// A real generation asked for a full-bleed photo the tenant does not have; the
// <img> was stripped and the scrim built for it was left as a muddy wash on a
// flat ground. A design that never expected a photograph is coherent.
check(
  "a tenant with no photography is told so, not left to have it stripped",
  NO_PHOTOGRAPHY_RULE.includes("NO PHOTOGRAPHY IS AVAILABLE") &&
    NO_PHOTOGRAPHY_RULE.includes("scrim"),
);
check(
  "open space is allowed, not called unfinished",
  DESIGN_RULES.includes("Open space is fine") &&
    !DESIGN_RULES.includes("USE THE WHOLE CANVAS"),
);
// A real generation put "HBOT - 60 minutes - EUR 95" on a closing slide for a
// tenant with no services, no pricing and no business profile. "Never invent a
// statistic" did not cover a price, and a plausible-looking one on a health
// clinic's post brings someone through the door expecting it.
check(
  "inventing a fact is forbidden in the terms that actually get broken",
  DESIGN_RULES.includes("NEVER INVENT A FACT") &&
    DESIGN_RULES.includes("prices") &&
    DESIGN_RULES.includes("session lengths"),
);

const empty = checkDesigns([{ html: "   ", photo: "" }], SYSTEM);
check("an empty design is a problem", empty.problems.some((p) => p.includes("no markup")));

console.log(`\ndesignPost.parse: ${passed} checks passed`);
