// Run: npm test -- src/lib/image/paintLayout.test.ts
//
// The composed-layout renderer, driven through the recording context (see
// ./recordingContext.ts) so what it actually DRAWS can be asserted — the
// ground it fills, the colour it sets type in, where the photograph goes,
// which text ends up on the canvas.
//
// The contract this file exists to protect is the content binding: a composed
// slide's STRUCTURE lives in the spec and its CONTENT lives in the slide row,
// so an operator editing the heading box edits the heading. If that ever
// inverts, composed slides stop being editable and the whole feature loses the
// property that made it acceptable.
import assert from "node:assert/strict";

import type { CarouselSlide } from "@/lib/db/schema";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "@/lib/design/presets";
import { serializeLayoutSpec, type LayoutSpec } from "@/lib/design/grammar";
import { COMPOSED_TEMPLATE_ID, paintSlide } from "@/lib/image/paintSlide";
import { bindSlots, paintLayout } from "@/lib/image/paintLayout";
import { fakeImage, makeContext } from "@/lib/image/recordingContext";
import type { DesignState } from "@/lib/image/templates";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const INK = "#24231f";
const PLASTER = "#f2f3ed";
const SAGE = "#c7d2bb";
const TIMBER = "#b0844f";

const PHOTO = fakeImage("photo", 1600, 1200);
const LOGO = fakeImage("logo", 512, 128);
const FONTS = { heading: "Inter", body: "Inter" };

function design(over: Partial<DesignState> = {}): DesignState {
  return {
    headingText: "Recovery is a practice, not an event",
    bodyText: "Three sessions a week.\nA plan built on your own numbers.",
    tagline: "where to start",
    accentColor: TIMBER,
    backgroundColor: null,
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.5,
    backgroundZoom: 1,
    headingScale: 1,
    ...over,
  };
}

function spec(over: Partial<LayoutSpec> = {}): LayoutSpec {
  return {
    archetype: "stack",
    ground: "plaster",
    photo: "none",
    align: "left",
    slots: [
      { level: "label", text: "SPEC LABEL", span: 3 },
      { level: "headline", text: "Spec heading", span: 4 },
      { level: "body", text: "Spec body", span: 4 },
    ],
    ...over,
  };
}

/** Render a spec and return the draw-call trace. */
function trace(
  s: LayoutSpec,
  d: DesignState = design(),
  bg: unknown = null,
  W = 1080,
  H = 1080,
): string[] {
  const { ctx, rec } = makeContext();
  paintLayout(ctx, W, H, s, SYSTEM, d, bg as HTMLImageElement | null, FONTS);
  return rec.ops;
}

const has = (ops: string[], needle: string) =>
  ops.some((o) => o.includes(needle));
/** Text of every fillText call, joined — what actually reached the canvas. */
const drawn = (ops: string[]) =>
  ops
    .filter((o) => o.startsWith("fillText("))
    .map((o) => o.slice(10, o.indexOf('", ')))
    .join(" ");

// -------------------------------------------------------------------------
//  1. Content comes from the ROW, not the spec
// -------------------------------------------------------------------------

const rowText = trace(spec());
check("the row's heading is drawn", drawn(rowText).includes("Recovery is a practice"));
check("the spec's heading is NOT drawn", !drawn(rowText).includes("Spec heading"));
check("the row's body is drawn", drawn(rowText).includes("Three sessions a week"));
check("the spec's body is NOT drawn", !drawn(rowText).includes("Spec body"));
check(
  "the row's tagline becomes the label, uppercased by the type scale",
  drawn(rowText).includes("WHERE TO START"),
);
check(
  "and is tracked, not drawn a character at a time",
  rowText.includes('letterSpacing = "3px"') &&
    !rowText.some((o) => o.startsWith('fillText("W", ')),
);

// The model's text stands in only where the row is empty, so a spec is still
// self-describing without ever overriding an operator.
const emptyRow = trace(
  spec(),
  design({ headingText: "", bodyText: "", tagline: "" }),
);
check(
  "the spec's own text stands in when the row has nothing",
  drawn(emptyRow).includes("Spec heading"),
);

// bindSlots is the binding, tested directly.
const bound = bindSlots(spec(), design());
check("the label slot binds to the tagline", bound[0].content === "where to start");
check(
  "the heading slot binds to headingText",
  bound[1].content === "Recovery is a practice, not an event",
);
check("the body slot binds to bodyText", bound[2].content.startsWith("Three sessions"));

// Several body slots share bodyText, a line each — this is what makes the
// body box in the editor edit a list slide's items.
const listSpec = spec({
  archetype: "list",
  slots: [
    { level: "headline", text: "H", span: 4 },
    { level: "body", text: "a", span: 4 },
    { level: "body", text: "b", span: 4 },
    { level: "body", text: "c", span: 4 },
  ],
});
const listBound = bindSlots(
  listSpec,
  design({ bodyText: "First thing\nSecond thing\nThird thing" }),
);
check("a list's first item is the first body line", listBound[1].content === "First thing");
check("its second item is the second line", listBound[2].content === "Second thing");
check("its third item is the third line", listBound[3].content === "Third thing");

// -------------------------------------------------------------------------
//  2. Ground and type colour
// -------------------------------------------------------------------------

check("a plaster ground is filled", has(trace(spec()), `fillStyle = "${PLASTER}"`));
check(
  "and the fill covers the slide",
  has(trace(spec()), "fillRect(0, 0, 1080, 1080)"),
);
check(
  "on plaster the system sets type in ink",
  has(trace(spec()), `fillStyle = "${INK}"`),
);
check(
  "on sage the system still sets type in ink",
  has(trace(spec({ ground: "sage" })), `fillStyle = "${INK}"`),
);
check(
  "on ink the system sets type in plaster",
  has(trace(spec({ ground: "ink" })), `fillStyle = "${PLASTER}"`),
);
check(
  "an operator's background override wins over the spec's ground",
  has(trace(spec({ ground: "plaster" }), design({ backgroundColor: SAGE })), `fillStyle = "${SAGE}"`),
);

// -------------------------------------------------------------------------
//  3. Photography
// -------------------------------------------------------------------------

const fullPhoto = trace(spec({ photo: "full" }), design(), PHOTO);
check("a full-bleed photograph is drawn", has(fullPhoto, "drawImage(photo"));
check(
  "with a scrim under the type",
  has(fullPhoto, "addColorStop(1, \"rgba(10,10,10,0.92)\")"),
);
check("and type goes white over it", has(fullPhoto, 'fillStyle = "#ffffff"'));
check(
  "a spec asking for a photograph with none supplied falls back to the ground",
  has(trace(spec({ photo: "full" }), design(), null), `fillStyle = "${PLASTER}"`),
);

const splitRight = trace(
  spec({ archetype: "split", photo: "half", photoSide: "right" }),
  design(),
  PHOTO,
);
check("a split slide clips its photo to one half", has(splitRight, "rect(540, 0, 540, 1080)"));
check("and sets its type in the ground's ink, not white", has(splitRight, `fillStyle = "${INK}"`));

const splitLeft = trace(
  spec({ archetype: "split", photo: "half", photoSide: "left" }),
  design(),
  PHOTO,
);
check("photoSide left puts the photo on the left", has(splitLeft, "rect(0, 0, 540, 1080)"));

// The text must sit in the half the photo does not.
const leftTextX = splitLeft
  .filter((o) => o.startsWith("fillText("))
  .map((o) => Number(o.split(", ")[1]));
check(
  "and the type in the other half",
  leftTextX.length > 0 && leftTextX.every((x) => x >= 540),
);

// -------------------------------------------------------------------------
//  4. The accent rule
// -------------------------------------------------------------------------

const ruleAbove = trace(spec({ accentRule: { value: "timber", place: "above" } }));
check("the accent rule is painted in its value", has(ruleAbove, `fillStyle = "${TIMBER}"`));
check(
  "as a rule one column wide",
  ruleAbove.some((o) => /^fillRect\(76, [\d.]+, 131\.3+/.test(o)),
);

const ruleBelow = trace(spec({ accentRule: { value: "timber", place: "below" } }));
const yOf = (ops: string[]) => {
  const rule = ops.find((o) => /^fillRect\(76, [\d.]+, 131/.test(o))!;
  return Number(rule.split(", ")[1]);
};
check("a rule placed below sits under one placed above", yOf(ruleBelow) > yOf(ruleAbove));
check(
  "no rule is painted when the spec asks for none",
  !trace(spec()).some((o) => /^fillRect\(76, [\d.]+, 131/.test(o)),
);

// -------------------------------------------------------------------------
//  5. One system, every aspect ratio
// -------------------------------------------------------------------------

const fontSize = (ops: string[], weight: number) => {
  const f = ops.find((o) => o.startsWith(`font = "${weight} `))!;
  return Number(/(\d+)px/.exec(f)![1]);
};
const atFull = trace(spec({ archetype: "list", slots: [{ level: "body", text: "x", span: 4 }] }));
const atHalf = trace(
  spec({ archetype: "list", slots: [{ level: "body", text: "x", span: 4 }] }),
  design(),
  null,
  540,
  540,
);
check("body is the system's 21px on a 1080 field", fontSize(atFull, 400) === 21);
check("and half that on a 540 field", fontSize(atHalf, 400) === 11);
check(
  "a 9:16 slide scales off width, so body stays 21px",
  fontSize(
    trace(
      spec({ archetype: "list", slots: [{ level: "body", text: "x", span: 4 }] }),
      design(),
      null,
      1080,
      1920,
    ),
    400,
  ) === 21,
);

// -------------------------------------------------------------------------
//  6. Every archetype draws
// -------------------------------------------------------------------------

const ARCHETYPE_SPECS: LayoutSpec[] = [
  spec({ archetype: "statement", slots: [{ level: "display", text: "S", span: 5 }] }),
  spec({ archetype: "split", photo: "half", slots: [{ level: "headline", text: "S", span: 3 }] }),
  spec({ archetype: "stack" }),
  listSpec,
  spec({ archetype: "quote", slots: [{ level: "headline", text: "Q", span: 4 }] }),
  spec({ archetype: "stat", slots: [{ level: "display", text: "92%", span: 3 }] }),
];
for (const s of ARCHETYPE_SPECS) {
  const ops = trace(s, design(), PHOTO);
  check(
    `${s.archetype} draws text on a painted ground`,
    ops.length > 8 && ops.some((o) => o.startsWith("fillText(")),
  );
}

// A statement anchors low, a stack anchors high — the archetypes differ.
const firstBaseline = (ops: string[]) =>
  Number(ops.find((o) => o.startsWith("fillText("))!.split(", ")[2]);
check(
  "a statement sits lower on the slide than a stack",
  firstBaseline(trace(spec({ archetype: "statement", slots: [{ level: "display", text: "S", span: 5 }] }))) >
    firstBaseline(trace(spec({ archetype: "stack" }))),
);

// -------------------------------------------------------------------------
//  7. The fork in paintSlide
// -------------------------------------------------------------------------

function slide(over: Partial<CarouselSlide> = {}): CarouselSlide {
  return {
    templateId: COMPOSED_TEMPLATE_ID,
    headingText: "Recovery is a practice",
    bodyText: "Three sessions a week.",
    tagline: "where to start",
    accentColor: TIMBER,
    backgroundColor: null,
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.5,
    backgroundZoom: 1,
    headingScale: 1,
    layoutJson: serializeLayoutSpec(spec()),
    ...over,
  } as CarouselSlide;
}

function paint(s: CarouselSlide, system = SYSTEM): string[] {
  const { ctx, rec } = makeContext();
  paintSlide(
    ctx,
    1080,
    1080,
    s,
    0,
    1,
    undefined,
    FONTS,
    null,
    LOGO as unknown as HTMLImageElement,
    system,
  );
  return rec.ops;
}

check("a composed slide with a system draws", paint(slide()).length > 8);
check(
  "and its logo is stamped",
  has(paint(slide()), "drawImage(logo"),
);
check(
  "a composed slide with NO system draws nothing",
  paint(slide(), null as never).length === 0,
);
check(
  "a composed slide with no stored layout draws nothing",
  paint(slide({ layoutJson: null })).length === 0,
);
check(
  "a composed slide with corrupt JSON draws nothing, rather than throwing",
  paint(slide({ layoutJson: "{not json" })).length === 0,
);
check(
  "a composed slide whose spec no longer parses draws nothing",
  paint(slide({ layoutJson: '{"archetype":"collage"}' })).length === 0,
);
check(
  "an unknown template id still draws nothing, as it always has",
  paint(slide({ templateId: "no-such-template" })).length === 0,
);
check(
  "a real template still renders when a system is present",
  paint(slide({ templateId: "bold-headline" })).length > 8,
);

console.log(`\npaintLayout: ${passed} checks passed`);
