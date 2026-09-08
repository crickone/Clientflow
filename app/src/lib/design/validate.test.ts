// Run: npm test -- src/lib/design/validate.test.ts
//
// The colour primitives. The maths is pinned against an EXTERNAL source rather
// than against itself: every ratio Optimal Health's brand document publishes in
// its own contrast table. If those eight numbers come out right the luminance
// implementation is right, and a future mismatch says which of the two is wrong.
//
// The slide-shaped validators that used to live here went with the archetype
// grammar. lib/design/htmlAudit.ts checks a design now.
import assert from "node:assert/strict";

import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "./presets";
import {
  contrastRatio,
  defaultTypeValue,
  formatRatio,
  relativeLuminance,
  valueKeyForHex,
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

// -- The maths, against the document's published table --------------------

for (const [fg, hex, published] of [
  ["ink", INK, 10.01],
  ["navy", NAVY, 8.02],
  ["deep green", DEEP_GREEN, 3.62],
  ["timber", TIMBER, 2.14],
  ["plaster", PLASTER, 1.41],
] as [string, string, number][]) {
  check(
    `${fg} on sage is the document's ${published.toFixed(2)}:1`,
    Math.abs(contrastRatio(hex, SAGE) - published) < 0.005,
  );
}
for (const [fg, hex, published] of [
  ["ink", INK, 14.09],
  ["deep green", DEEP_GREEN, 5.1],
  ["timber", TIMBER, 3.01],
] as [string, string, number][]) {
  check(
    `${fg} on plaster is the document's ${published.toFixed(2)}:1`,
    Math.abs(contrastRatio(hex, PLASTER) - published) < 0.005,
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

// -- Resolving colours ----------------------------------------------------

check("a system hex resolves to its key", valueKeyForHex(SYSTEM, "#C7D2BB") === "sage");
check("case does not matter", valueKeyForHex(SYSTEM, "#c7d2bb") === "sage");
check("an off-system hex resolves to nothing", valueKeyForHex(SYSTEM, "#ff00ff") === null);
check("null resolves to nothing", valueKeyForHex(SYSTEM, null) === null);

// The document's own rule -- "ink on sage and plaster, plaster on ink" --
// derived from the numbers rather than restated, so a system that changes a
// value gets the right answer with no edit here.
check("on sage the system reaches for ink", defaultTypeValue(SYSTEM, SAGE)!.key === "ink");
check("on plaster the system reaches for ink", defaultTypeValue(SYSTEM, PLASTER)!.key === "ink");
check("on ink the system reaches for plaster", defaultTypeValue(SYSTEM, INK)!.key === "plaster");
check(
  "it never reaches for the reserved value",
  defaultTypeValue(SYSTEM, SAGE)!.key !== "navy",
);
check(
  "nor for the one the system forbids as type",
  [SAGE, PLASTER, INK].every((g) => defaultTypeValue(SYSTEM, g)!.key !== "timber"),
);

console.log(`\nvalidate: ${passed} checks passed`);
