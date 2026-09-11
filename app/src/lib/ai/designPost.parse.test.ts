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
  checkSet,
  describeSystemForDesign,
  extractDesignPayload,
  logoReserveRule,
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
check("the description names the typeface", d.includes("- Inter, for everything"));
check("and tells the model to set it on every text element, unquoted", d.includes("font-family:Inter"));
check("and never shows the model a quoted font-family", !d.includes('font-family:"'));
// A display/body PAIR must be named separately, and by LEVEL -- a model told
// only "here are two faces" has no way to know which is which.
{
  const paired = describeSystemForDesign({ ...SYSTEM, font: "Playfair Display", bodyFont: "Inter" });
  check("a pair names the display face for display and headline", paired.includes("- Playfair Display for display and headline levels: font-family:Playfair Display"));
  check("and the body face for the smaller levels", paired.includes("- Inter for subhead, body and label levels: font-family:Inter"));
  check("a pair never shows a quoted family either", !paired.includes('font-family:"'));
}

// The motifs are what stop two systems with different palettes producing the
// same shapes. A system that has them gets ITS moves; one that does not gets
// the generic list, which is exactly today's behaviour for a stored blob.
{
  const withMotifs = describeSystemForDesign({
    ...SYSTEM,
    motifs: ["A running head with a slide counter and a hard rule beneath it."],
  });
  check("a system's own motifs reach the designer", withMotifs.includes("A running head with a slide counter"));
  check("and are framed as the brand's signature", withMotifs.includes("THE MOVES THIS BRAND MAKES"));
  check("the generic list is not also sent", !withMotifs.includes("A list as cards on the signature ground"));
  check(
    "a motif may override the flush-left default",
    withMotifs.includes("unless a move above says otherwise"),
  );

  const noMotifs = describeSystemForDesign({ ...SYSTEM, motifs: [] });
  check("a system with no motifs falls back to the generic moves", noMotifs.includes("A list as cards on the signature ground"));
  check("and keeps the strict setting rule", noMotifs.includes("No centred type"));
}

check(
  "the rules no longer hardcode Inter",
  !DESIGN_RULES.includes('font-family is exactly "Inter"'),
);
check(
  "a system in another face is described in that face",
  describeSystemForDesign({ ...SYSTEM, font: "Fraunces" }).includes("- Fraunces, for everything"),
);

// -- What the model is told about the RENDERER ----------------------------
// These are not style advice. satori implements a subset of CSS, and markup
// that ignores it renders wrong or not at all.
check("it is told it is designing, not filling a template", DESIGN_RULES.includes("DESIGNING"));
check("flexbox-only is stated", DESIGN_RULES.includes("display:flex"));
check("no CSS filter is stated", DESIGN_RULES.includes("filter"));
check("img sizing in style is stated", DESIGN_RULES.includes("object-fit"));
check("the entity trap is stated", DESIGN_RULES.toLowerCase().includes("entit"));
check("the photo placeholder is specified", DESIGN_RULES.includes("{{PHOTO}}"));
// The compositional vocabulary MOVED: it belongs with the system description
// (where a brand's own motifs can replace it), not with the renderer's rules.
// DESIGN_RULES is now purely what satori can and cannot draw.
check("the rules no longer carry a compositional vocabulary", !DESIGN_RULES.includes("cropped by the canvas edge"));
check(
  "the vocabulary lives with the system description instead",
  describeSystemForDesign({ ...SYSTEM, motifs: [] }).includes("cropped by the canvas edge"),
);

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
// The seven-slide carousel that prompted this: every light slide filled its
// top two thirds and then stopped, leaving a dead band above the footer. The
// old rule ("Open space is fine") read as a licence for exactly that.
check(
  "quiet space is a band at an edge, not a hole in the middle",
  DESIGN_RULES.includes("ANCHOR THE COMPOSITION") &&
    DESIGN_RULES.includes("band of nothing between the last paragraph and the footer"),
);
check(
  "and the slide is told how to close itself instead",
  DESIGN_RULES.includes("close the slide with something that belongs there"),
);
check(
  "a slide type is used at most once in a set, not merely never twice in a row",
  describeSystemForDesign({
    ...SYSTEM,
    templates: [{ name: "Dossier page", structure: "Light ground." }],
  }).includes("AT MOST ONCE in a set"),
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

// -- Set-level problems ---------------------------------------------------
// A palette with two accents, to exercise both halves.
const TWO_ACCENTS = {
  ...SYSTEM,
  values: [
    ...SYSTEM.values,
    { key: "volt", hex: "#d4f000", role: "accent" as const },
    { key: "azure", hex: "#4a9eff", role: "accent" as const },
  ],
};
{
  const d = describeSystemForDesign(TWO_ACCENTS);
  check("a multi-accent palette is told to commit to one", d.includes("A SET COMMITS TO ONE"));
  check("and names the accents it is choosing between", d.includes("volt, azure"));
  check(
    "a single-accent palette is not told to choose",
    !describeSystemForDesign(SYSTEM).includes("A SET COMMITS TO ONE"),
  );
}

// The same shape twice in one set. Same ground, same sizes, same block count --
// slides 2 and 6 of the real carousel, down to the same kicker.
{
  const shape = (words: string) =>
    `<div style="display:flex;background:#f2f3ed"><span style="font-size:84px;color:#24231f">${words}</span><span style="font-size:28px;color:#24231f">${words} again</span></div>`;
  const repeated = checkSet(
    [
      { html: shape("One"), photo: "" },
      { html: `<div style="display:flex;background:#24231f"><span style="font-size:180px;color:#f2f3ed">2</span></div>`, photo: "" },
      { html: shape("Two"), photo: "" },
    ],
    SYSTEM,
  );
  check("the same composition twice is a set-level problem", repeated.length === 1);
  check("named by slide, so the repair call knows which", repeated[0].includes("Slides 1 and 3"));
  check("and told which one to rebuild", repeated[0].includes("Rebuild slide 3"));

  const varied = checkSet(
    [
      { html: shape("One"), photo: "" },
      { html: `<div style="display:flex;background:#24231f"><span style="font-size:180px;color:#f2f3ed">2</span></div>`, photo: "" },
    ],
    SYSTEM,
  );
  check("a set that moves between types has no such problem", varied.length === 0);
}

// Two accents on the same set.
{
  const both = checkSet(
    [
      { html: `<div style="display:flex;background:#f2f3ed"><span style="font-size:84px;color:#d4f000">a</span></div>`, photo: "" },
      { html: `<div style="display:flex;background:#24231f"><span style="font-size:40px;color:#4a9eff">b</span></div>`, photo: "" },
    ],
    TWO_ACCENTS,
  );
  check("two accents in one set is a problem", both.some((p) => p.includes("two accents")));
  check("and both are named with the slides they are on", both.some((p) => p.includes("volt #d4f000") && p.includes("azure #4a9eff")));

  const one = checkSet(
    [
      { html: `<div style="display:flex;background:#f2f3ed"><span style="font-size:84px;color:#d4f000">a</span></div>`, photo: "" },
      { html: `<div style="display:flex;background:#24231f"><span style="font-size:40px;color:#d4f000">b</span></div>`, photo: "" },
    ],
    TWO_ACCENTS,
  );
  check("one accent used throughout is not", one.length === 0);
}

// Set problems reach the repair call WITHOUT badging an individual slide --
// neither slide is wrong on its own terms, and a warning on one would be a lie.
{
  const same = `<div style="display:flex;background:#f2f3ed"><span style="font-size:84px;color:#24231f">x</span></div>`;
  const r = checkDesigns([{ html: same, photo: "" }, { html: same, photo: "" }], SYSTEM);
  check("a set problem is in problems", r.problems.some((p) => p.includes("same composition")));
  check("and on no slide's violations", r.designs.every((d) => d.violations.length === 0));
}

// -- The logo's box -------------------------------------------------------
// A real 1080 canvas with a squarish mark: 7% margin, 19% width, so the box is
// 205px wide at x=799, and 205px TALL -- reaching 281px down the canvas, not
// the 108px the old "a tenth of the height" wording promised.
{
  const r = logoReserveRule({ left: 799, top: 76, width: 205, height: 205 }, 1080, 1080);
  check("the box is given in exact pixels, not a fraction", r.includes("205px wide and 205px tall"));
  check("with its origin on the canvas", r.includes("x=799, y=76"));
  check("and how far down it actually reaches", r.includes("281px down from the top"));
  check("a running head is told where it may go instead", r.includes("entirely LEFT of x=777") && r.includes("entirely BELOW y=303"));
  check("a full-width rule is told the same", r.includes("belongs below y=303"));
  check("a photograph may still pass under it", r.includes("MAY pass under the box"));
  check("and the model still never draws the mark itself", r.includes("Do not draw a logo, a wordmark or the business name yourself"));

  // A tall mark reserves more height than a wide one -- the whole point of
  // computing this from the file rather than stating a fraction.
  const wide = logoReserveRule({ left: 799, top: 76, width: 205, height: 60 }, 1080, 1080);
  check("a wide mark reserves less height", wide.includes("205px wide and 60px tall") && wide.includes("136px down from the top"));

  const none = logoReserveRule(null, 1080, 1080);
  check("with no logo the corner is released", none.includes("NO LOGO IS STAMPED"));
  check("and the model is still told not to draw one", none.includes("Do not draw a logo"));
}

// The rule left DESIGN_RULES when it stopped being a constant -- it is computed
// per tenant now, so a fixed sentence there would contradict it.
check(
  "the old fixed corner sentence is gone from the rules",
  !DESIGN_RULES.includes("KEEP THE TOP-RIGHT CORNER CLEAR"),
);

console.log(`\ndesignPost.parse: ${passed} checks passed`);
