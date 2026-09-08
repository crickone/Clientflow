// Run: npm test -- src/lib/design/validate.test.ts
//
// The validator is the whole safety story for AI-composed design, so the
// maths is pinned FIRST and against an external source: every ratio Optimal
// Health's brand document publishes in its own contrast table. If those eight
// numbers come out right, the luminance implementation is right; if one comes
// out wrong, the bug is here and not in the design.
import assert from "node:assert/strict";

import type { LayoutSpec } from "./grammar";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "./presets";
import {
  contrastRatio,
  defaultTypeValue,
  formatRatio,
  groundBudget,
  relativeLuminance,
  validateCarousel,
  validateSet,
  validateSlide,
  valueKeyForHex,
  type Validation,
} from "./validate";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SAGE = "#c7d2bb";
const INK = "#24231f";
const PLASTER = "#f2f3ed";
const TIMBER = "#b0844f";
const DEEP_GREEN = "#5e6b4e";
const NAVY = "#26334e";

function violations(v: Validation): string[] {
  return v.ok ? [] : v.violations;
}
/** Assert a validation failed and that some violation mentions the given text
 *  — these strings are shown to the operator verbatim, so what they SAY is
 *  part of the contract, not just that they exist. */
function fails(name: string, v: Validation, mustMention: string) {
  check(
    name,
    !v.ok &&
      v.violations.some((s) =>
        s.toLowerCase().includes(mustMention.toLowerCase()),
      ),
  );
}

// -------------------------------------------------------------------------
//  1. The maths, pinned against the brand document's published table
// -------------------------------------------------------------------------

const PUBLISHED: [string, string, string, number][] = [
  // On sage (document section 4)
  ["ink", "sage", INK, 10.01],
  ["navy", "sage", NAVY, 8.02],
  ["deep green", "sage", DEEP_GREEN, 3.62],
  ["timber", "sage", TIMBER, 2.14],
  ["plaster", "sage", PLASTER, 1.41],
];
for (const [fg, , hex, published] of PUBLISHED) {
  const got = contrastRatio(hex, SAGE);
  check(
    `${fg} on sage is the document's ${published.toFixed(2)}:1`,
    Math.abs(got - published) < 0.005,
  );
}
for (const [fg, hex, published] of [
  ["ink", INK, 14.09],
  ["deep green", DEEP_GREEN, 5.1],
  ["timber", TIMBER, 3.01],
] as [string, string, number][]) {
  const got = contrastRatio(hex, PLASTER);
  check(
    `${fg} on plaster is the document's ${published.toFixed(2)}:1`,
    Math.abs(got - published) < 0.005,
  );
}

check("contrast is symmetric", contrastRatio(INK, SAGE) === contrastRatio(SAGE, INK));
check("a colour against itself is 1:1", contrastRatio(SAGE, SAGE) === 1);
check(
  "black on white is the maximum 21:1",
  Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.001,
);
check("white luminance is 1", Math.abs(relativeLuminance("#ffffff") - 1) < 1e-9);
check("black luminance is 0", relativeLuminance("#000000") === 0);
check("a non-hex has no luminance", Number.isNaN(relativeLuminance("sage")));
check(
  "an unmeasurable pair returns NaN rather than a wrong number",
  Number.isNaN(contrastRatio("sage", INK)),
);
check("ratios read the way the document prints them", formatRatio(10.0132) === "10.01:1");

// -------------------------------------------------------------------------
//  2. Resolving colours
// -------------------------------------------------------------------------

check("a system hex resolves to its key", valueKeyForHex(SYSTEM, "#C7D2BB") === "sage");
check("case does not matter", valueKeyForHex(SYSTEM, "#c7d2bb") === "sage");
check("an off-system hex resolves to nothing", valueKeyForHex(SYSTEM, "#ff00ff") === null);
check("null resolves to nothing", valueKeyForHex(SYSTEM, null) === null);

// The document's own rule -- "ink on sage and plaster, plaster on ink" --
// derived from the numbers rather than restated.
check("on sage the system reaches for ink", defaultTypeValue(SYSTEM, SAGE)!.key === "ink");
check("on plaster the system reaches for ink", defaultTypeValue(SYSTEM, PLASTER)!.key === "ink");
check("on ink the system reaches for plaster", defaultTypeValue(SYSTEM, INK)!.key === "plaster");
check(
  "it never reaches for the reserved value",
  defaultTypeValue(SYSTEM, SAGE)!.key !== "navy",
);
check(
  "nor for the one the system forbids as type",
  ["sage", "plaster", "ink"].every(
    (g) => defaultTypeValue(SYSTEM, g === "sage" ? SAGE : g === "ink" ? INK : PLASTER)!.key !== "timber",
  ),
);

// -------------------------------------------------------------------------
//  3. Per-slide validation
// -------------------------------------------------------------------------

function spec(over: Partial<LayoutSpec> = {}): LayoutSpec {
  return {
    archetype: "stack",
    ground: "plaster",
    photo: "none",
    align: "left",
    slots: [
      { level: "label", text: "WHERE TO START", span: 3 },
      { level: "headline", text: "Recovery is a practice", span: 4 },
      { level: "body", text: "Three sessions a week.", span: 4 },
    ],
    ...over,
  };
}

check("the system's own default composition passes", validateSlide(spec(), SYSTEM).ok);
check("so does the same on sage", validateSlide(spec({ ground: "sage" }), SYSTEM).ok);
check("and on ink", validateSlide(spec({ ground: "ink" }), SYSTEM).ok);

// The case the spec document names: an operator picks a timber heading.
fails(
  "timber as type is refused whatever the maths says",
  validateSlide(spec({ ground: "sage" }), SYSTEM, { accent: TIMBER }),
  "never sets type in timber",
);

// Deep green: legal at headline size on sage (3.62 >= 3.0), illegal as body
// copy (3.62 < 4.5). This is exactly the large-vs-body distinction.
const deepGreenOnSage = validateSlide(
  spec({
    ground: "sage",
    slots: [{ level: "headline", text: "Large enough", span: 4 }],
  }),
  SYSTEM,
  { accent: DEEP_GREEN },
);
check("deep green passes as a headline on sage", deepGreenOnSage.ok);

const deepGreenBody = validateSlide(
  spec({
    ground: "sage",
    slots: [{ level: "body", text: "Too small for this", span: 4 }],
  }),
  SYSTEM,
  { accent: DEEP_GREEN },
);
fails("deep green fails as body copy on sage", deepGreenBody, "3.62:1");
check(
  "and the violation quotes the floor it missed",
  violations(deepGreenBody)[0].includes("4.5:1"),
);
check(
  "and names both colours",
  violations(deepGreenBody)[0].includes("deep-green") &&
    violations(deepGreenBody)[0].includes("sage"),
);

// An off-system colour is the drift the system exists to prevent.
fails(
  "an off-palette background is flagged",
  validateSlide(spec(), SYSTEM, { background: "#ff00ff" }),
  "not a value in this design system",
);
check(
  "and the message says the palette is closed",
  violations(validateSlide(spec(), SYSTEM, { background: "#ff00ff" }))[0].includes(
    "deliberately closed",
  ),
);

// A background override wins over the spec's ground, because colour lives on
// the row -- so a legal spec plus an illegal edit still fails.
fails(
  "an operator's background override is what gets measured",
  validateSlide(spec({ ground: "plaster" }), SYSTEM, {
    background: SAGE,
    accent: DEEP_GREEN,
  }),
  "on sage",
);

// Structure that no longer resolves.
fails(
  "a ground that is not a value",
  validateSlide(spec({ ground: "moss" }), SYSTEM),
  "not a value in this design system",
);
fails(
  "a value that is not a ground",
  validateSlide(spec({ ground: "timber" }), SYSTEM),
  "not one of this system's grounds",
);
fails(
  "a span wider than the grid",
  validateSlide(
    spec({ slots: [{ level: "body", text: "x", span: 9 }] }),
    SYSTEM,
  ),
  "9 columns",
);
fails(
  "an accent rule in a colour the system does not own",
  validateSlide(spec({ accentRule: { value: "gold", place: "above" } }), SYSTEM),
  "not a value",
);
check(
  "but a legal accent rule in the forbidden-as-TYPE value is fine — that is what an accent is for",
  validateSlide(spec({ accentRule: { value: "timber", place: "above" } }), SYSTEM).ok,
);

// Over a photograph there is no flat ground to measure against.
check(
  "contrast is not measured over a full-bleed photograph",
  validateSlide(
    spec({ photo: "full", slots: [{ level: "body", text: "x", span: 4 }] }),
    SYSTEM,
    { accent: DEEP_GREEN, hasPhoto: true },
  ).ok,
);
fails(
  "but the ban on timber as type still holds over a photograph",
  validateSlide(spec({ photo: "full" }), SYSTEM, {
    accent: TIMBER,
    hasPhoto: true,
  }),
  "never sets type in timber",
);
fails(
  "and a split slide's panel IS measured, because it sits on the ground",
  validateSlide(
    spec({
      archetype: "split",
      photo: "half",
      photoSide: "right",
      ground: "sage",
      slots: [{ level: "body", text: "x", span: 3 }],
    }),
    SYSTEM,
    { accent: DEEP_GREEN, hasPhoto: true },
  ),
  "3.62:1",
);

// An accent that only fills a rule is exempt from the type rules -- that is
// what an accent is for. Checking it unconditionally would flag every composed
// slide in a palette whose accent is forbidden as type, which is most of them.
check(
  "an accent that carries no text is not held to the type rules",
  validateSlide(spec({ ground: "sage" }), SYSTEM, {
    accent: TIMBER,
    accentCarriesText: false,
  }).ok,
);
fails(
  "but the same accent set in type is caught",
  validateSlide(spec({ ground: "sage" }), SYSTEM, {
    accent: TIMBER,
    accentCarriesText: true,
  }),
  "never sets type in timber",
);
check(
  "and a caller that says nothing gets the strict answer",
  !validateSlide(spec({ ground: "sage" }), SYSTEM, { accent: TIMBER }).ok,
);

// -------------------------------------------------------------------------
//  4. The rotation rule
// -------------------------------------------------------------------------

const g = (ground: string) => spec({ ground });

// The document's own reference rotation, section 3. If this does not pass,
// the budget maths disagrees with the brand it was written from.
const REFERENCE = ["sage", "plaster", "plaster", "sage", "ink", "plaster"].map(g);
check("the document's reference rotation passes", validateCarousel(REFERENCE, SYSTEM).ok);

check("a budget of a third of six is two", groundBudget(0.33, 6) === 2);
check("a budget of a half of six is three", groundBudget(0.5, 6) === 3);
check("a budget of a sixth of six is one", groundBudget(0.17, 6) === 1);
check("a single-slide post is always legal", groundBudget(0.17, 1) === 1);

fails(
  "sage on more than a third of the set",
  validateCarousel(["sage", "sage", "plaster", "sage", "ink", "plaster"].map(g), SYSTEM),
  "3 of 6",
);
check(
  "and the violation quotes the ceiling as a percentage",
  violations(
    validateCarousel(["sage", "sage", "plaster", "sage", "ink", "plaster"].map(g), SYSTEM),
  ).some((v) => v.includes("33%")),
);

fails(
  "sage on two consecutive slides — the document's rotation rule",
  validateCarousel(["plaster", "sage", "sage", "ink"].map(g), SYSTEM),
  "2 consecutive slides",
);
check(
  "and the violation says which slides",
  violations(validateCarousel(["plaster", "sage", "sage", "ink"].map(g), SYSTEM))
    .some((v) => v.includes("2-3")),
);
check(
  "plaster may run exactly three, which is its limit",
  validateCarousel(["plaster", "plaster", "plaster", "sage", "ink", "sage"].map(g), SYSTEM).ok,
);
fails(
  "a fourth plaster puts it over its share as well as its run",
  validateCarousel(["plaster", "plaster", "plaster", "plaster", "sage", "ink"].map(g), SYSTEM),
  "4 of 6",
);
fails(
  "four plaster in a row exceeds its run",
  validateCarousel(
    ["plaster", "plaster", "plaster", "plaster", "sage", "ink", "plaster", "sage"].map(g),
    SYSTEM,
  ),
  "4 consecutive slides",
);
check("an empty set is vacuously fine", validateCarousel([], SYSTEM).ok);
check("a single slide is fine", validateCarousel([g("sage")], SYSTEM).ok);

// A run that ends at the last slide must still be reported — the classic
// off-by-one in this shape of loop.
fails(
  "a run ending on the final slide is still caught",
  validateCarousel(["ink", "plaster", "sage", "sage"].map(g), SYSTEM),
  "consecutive",
);

// -------------------------------------------------------------------------
//  5. Both levels together
// -------------------------------------------------------------------------

const set = validateSet(
  [
    { spec: g("sage") },
    { spec: g("sage"), colours: { accent: TIMBER } },
    { spec: g("plaster") },
  ],
  SYSTEM,
);
check("validateSet reports slide and set violations together", !set.ok);
check(
  "and numbers the slide a violation came from",
  violations(set).some((v) => v.startsWith("Slide 2:")),
);
check(
  "including the rotation violation, unnumbered",
  violations(set).some((v) => v.includes("consecutive")),
);
check(
  "a clean set passes both levels",
  validateSet(REFERENCE.map((s) => ({ spec: s })), SYSTEM).ok,
);

console.log(`\nvalidate: ${passed} checks passed`);
