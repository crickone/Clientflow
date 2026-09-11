// Run: npm test -- src/lib/design/direction.test.ts
//
// A direction is a design system with the hexes taken out. Composing it with
// a tenant's palette must give back a system the parser accepts, with the
// tenant's colours in the tenant's slots, and with "never type" worked out
// from the contrast maths rather than trusted.
import assert from "node:assert/strict";

import { parseDesignSystem } from "./parse";
import {
  composeDesignSystem,
  defaultPalette,
  deriveNeverType,
  normalizeOverrides,
  withOverrides,
  type DesignDirection,
} from "./direction";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A minimal but complete direction. Every number is inside the parser's bounds. */
const FIXTURE: DesignDirection = {
  id: "fixture",
  name: "Fixture",
  blurb: "For tests.",
  font: "Inter",
  slots: [
    { key: "paper", label: "Paper", role: "ground", defaultHex: "#F4F1EA", ground: { share: 0.6, maxRun: 3 } },
    { key: "ink", label: "Ink", role: "type", defaultHex: "#6B6B6B", ground: { share: 0.4, maxRun: 2 } },
    { key: "accent", label: "Accent", role: "accent", defaultHex: "#B0844F" },
    { key: "ghost", label: "Ghost", role: "accent", defaultHex: "#9A9A9A" },
    { key: "reserved", label: "Reserved", role: "reserved", defaultHex: "#26334E" },
  ],
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.6, contrast: 1, brightness: 1, wash: { slot: "accent", alpha: 0.07 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["accent"] },
  motifs: ["A fixture motif, so the field is exercised."],
};

// -- defaultPalette --
const defaults = defaultPalette(FIXTURE);
check("the default palette has one entry per slot", Object.keys(defaults).length === 5);
check("and carries the slot's default hex, lower-cased", defaults.paper === "#f4f1ea");

// -- composeDesignSystem with defaults --
const composed = composeDesignSystem(FIXTURE, defaults);
check("a composed system parses", parseDesignSystem(composed) !== null);
check("it carries the direction's font", composed.font === "Inter");
check("and the direction's motifs", composed.motifs.length === 1);
check("values follow slot order", composed.values.map((v) => v.key).join() === "paper,ink,accent,ghost,reserved");
check("a slot's role becomes the value's role", composed.values.find((v) => v.key === "ink")?.role === "type");
check("only slots with a budget become grounds", composed.grounds.map((g) => g.value).join() === "paper,ink");
check("and the budget is copied", composed.grounds[0].share === 0.6 && composed.grounds[0].maxRun === 3);
check("the photo wash resolves its slot to a hex", composed.photo?.wash?.hex === "#b0844f");
check("type, grid and contrast floors come through untouched", composed.type.display.size === 84 && composed.grid.columns === 6 && composed.rules.minContrastBody === 4.5);

// -- the tenant's palette wins --
const mine = composeDesignSystem(FIXTURE, { ...defaults, paper: "#FFFFFF", accent: "#C0392B" });
check("a tenant hex replaces the default", mine.values.find((v) => v.key === "paper")?.hex === "#ffffff");
check("and is lower-cased", mine.values.find((v) => v.key === "accent")?.hex === "#c0392b");
check("the wash follows the tenant's accent", mine.photo?.wash?.hex === "#c0392b");
check("a slot the palette omits falls back to the default", composeDesignSystem(FIXTURE, { paper: "#ffffff" }).values.find((v) => v.key === "ink")?.hex === "#6b6b6b");

// -- neverType: explicit AND derived --
//
// The direction's own list is kept (a brand can forbid a colour as type for
// reasons the maths cannot see -- Optimal Health's timber passes on ink and
// is still forbidden). On top of it, any value that fails the LARGE floor
// against EVERY ground is added, because a colour that cannot be read on any
// background is not a type colour whatever anyone says.
check("the explicit never-type is kept", composed.rules.neverType.includes("accent"));
check("a mid-grey that fails on every ground is derived", composed.rules.neverType.includes("ghost"));
check("ink, which passes on paper, is not", !composed.rules.neverType.includes("ink"));
check("reserved values are never listed", !composed.rules.neverType.includes("reserved"));
check("nothing is listed twice", new Set(composed.rules.neverType).size === composed.rules.neverType.length);

check(
  "deriveNeverType alone: a colour readable on one ground is fine",
  !deriveNeverType(
    [{ key: "x", hex: "#1b1b1b", role: "type" }],
    ["#ffffff", "#1b1b1b"],
    3,
  ).includes("x"),
);
check(
  "deriveNeverType alone: a colour readable on no ground is out",
  deriveNeverType(
    [{ key: "x", hex: "#9a9a9a", role: "type" }],
    ["#f4f1ea", "#6b6b6b"],
    3,
  ).includes("x"),
);

// -- a direction with no photo grade composes to photo: null --
check("no photo grade stays null", composeDesignSystem({ ...FIXTURE, photo: null }, defaults).photo === null);

// -- overrides: the operator's edits on top of a direction --
//
// Clamped to the parser's bounds and applied at compose time; the authored
// direction is never mutated, so "Direction's own" is always one reset away.
const FONTS = ["Inter", "Fraunces"];

check("empty overrides change nothing", JSON.stringify(withOverrides(FIXTURE, {})) === JSON.stringify(FIXTURE));
check("a known font applies", withOverrides(FIXTURE, { font: "Fraunces" }).font === "Fraunces");
check("an unknown font is dropped at normalisation", normalizeOverrides({ font: "Comic Sans" }, FONTS).font === undefined);
check("a known font survives normalisation", normalizeOverrides({ font: " Fraunces " }, FONTS).font === "Fraunces");

const typed = normalizeOverrides(
  { type: { display: { size: 120, weight: 700, upper: true }, body: { size: 5000, leading: 9 }, nope: { size: 10 } } },
  FONTS,
);
check("in-range type fields are kept", typed.type?.display?.size === 120 && typed.type?.display?.weight === 700);
check("upper is kept as a boolean", typed.type?.display?.upper === true);
check("an out-of-range size is dropped, not clamped to a guess", typed.type?.body === undefined);
check("an unknown level is ignored", !("nope" in (typed.type ?? {})));

const applied = withOverrides(FIXTURE, typed);
check("the override merges over the direction's step", applied.type.display.size === 120 && applied.type.display.leading === FIXTURE.type.display.leading);
check("untouched levels are the direction's", applied.type.body.size === FIXTURE.type.body.size);
check("the direction itself is not mutated", FIXTURE.type.display.size === 84);
check("upper:false removes the flag rather than storing false", !("upper" in withOverrides(FIXTURE, { type: { label: { upper: false } } }).type.label));

check("photo null means no grade", withOverrides(FIXTURE, { photo: null }).photo === null);
const graded = withOverrides(FIXTURE, { photo: { saturate: 0.3, contrast: 1.2, brightness: 1 } });
check("a photo override replaces the numbers", graded.photo?.saturate === 0.3);
check("but keeps the direction's wash -- it is a slot, not a number", graded.photo?.wash?.slot === "accent");
check("a half-specified photo grade is dropped", normalizeOverrides({ photo: { saturate: 0.5 } }, FONTS).photo === undefined);
check("photo null survives normalisation", normalizeOverrides({ photo: null }, FONTS).photo === null);
check("junk normalises to nothing", Object.keys(normalizeOverrides("junk", FONTS)).length === 0);

check(
  "an overridden direction still composes to a system the parser accepts",
  parseDesignSystem(composeDesignSystem(withOverrides(FIXTURE, typed), defaults)) !== null,
);

console.log(`\ndirection: ${passed} checks passed`);
