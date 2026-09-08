// Run: npm test -- src/lib/design/parse.test.ts
//
// The design-system parser is the boundary between a stored JSON blob and
// every layout decision downstream, so its contract is narrow and absolute:
// a well-formed system parses to exactly what was authored, and ANY malformed
// input returns null rather than throwing. Null is a first-class state — a
// tenant whose stored blob is junk falls through to today's template-only
// behaviour instead of losing their Content Studio.
import assert from "node:assert/strict";

import {
  LARGE_TYPE_LEVELS,
  TYPE_LEVELS,
  columnWidth,
  fieldScale,
  isGround,
  parseDesignSystem,
  valueHex,
} from "./parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM } from "./presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A structurally-valid system, deliberately minimal, so each rejection test
 *  can break exactly one thing and nothing else. */
function valid(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(OPTIMAL_HEALTH_DESIGN_SYSTEM));
}

/** Mutate a deep-cloned valid system and assert it no longer parses. */
function rejects(name: string, mutate: (s: Record<string, any>) => void) {
  const s = valid();
  mutate(s);
  check(`rejects: ${name}`, parseDesignSystem(s) === null);
}

// -- The authored system round-trips -------------------------------------

const parsed = parseDesignSystem(valid());
check("the authored Optimal Health system parses", parsed !== null);
check(
  "it round-trips value-for-value",
  JSON.stringify(parsed) === JSON.stringify(OPTIMAL_HEALTH_DESIGN_SYSTEM),
);
check("all five type levels survive", TYPE_LEVELS.every((l) => !!parsed?.type[l]));

// The numbers that matter, checked against the brand document itself rather
// than against the preset — a transcription error is exactly what this catches.
check("sage is #c7d2bb", valueHex(parsed!, "sage") === "#c7d2bb");
check("ink is #24231f", valueHex(parsed!, "ink") === "#24231f");
check("plaster is #f2f3ed", valueHex(parsed!, "plaster") === "#f2f3ed");
check("timber is #b0844f", valueHex(parsed!, "timber") === "#b0844f");
check("deep green is #5e6b4e", valueHex(parsed!, "deep-green") === "#5e6b4e");
check("navy is #26334e", valueHex(parsed!, "navy") === "#26334e");
check("no sixth value beyond the reserved navy", parsed!.values.length === 6);
check("timber may never carry type", parsed!.rules.neverType.includes("timber"));
check("display is 84px", parsed!.type.display.size === 84);
check("label is uppercase", parsed!.type.label.upper === true);
check("body tracking is zero", parsed!.type.body.tracking === 0);

// -- Grounds -------------------------------------------------------------

check("plaster is a ground", isGround(parsed!, "plaster"));
check("sage is a ground", isGround(parsed!, "sage"));
check(
  "ink is a ground despite its role being type",
  isGround(parsed!, "ink") &&
    parsed!.values.find((v) => v.key === "ink")!.role === "type",
);
check("timber is not a ground", !isGround(parsed!, "timber"));
check("navy is not a ground", !isGround(parsed!, "navy"));
check(
  "sage may never run twice — the document's rotation rule, as a number",
  parsed!.grounds.find((g) => g.value === "sage")!.maxRun === 1,
);
check(
  "sage is capped at a third of a set",
  parsed!.grounds.find((g) => g.value === "sage")!.share === 0.33,
);

// -- Grid ----------------------------------------------------------------

// Section 7: six columns, 76 margins, 28 gutters -> 131px columns.
check(
  "columns come out at the document's 131px",
  Math.round(columnWidth(parsed!)) === 131,
);
check("field scale is 1 at the authored width", fieldScale(parsed!, 1080) === 1);
check("a half-width render scales by half", fieldScale(parsed!, 540) === 0.5);
check("a 4:5 slide scales off WIDTH, not height", fieldScale(parsed!, 810) === 0.75);

// -- Large vs body type --------------------------------------------------

check(
  "display and headline are the large levels",
  LARGE_TYPE_LEVELS.has("display") &&
    LARGE_TYPE_LEVELS.has("headline") &&
    !LARGE_TYPE_LEVELS.has("subhead") &&
    !LARGE_TYPE_LEVELS.has("body") &&
    !LARGE_TYPE_LEVELS.has("label"),
);

// -- Rejections ----------------------------------------------------------

check("rejects: null", parseDesignSystem(null) === null);
check("rejects: undefined", parseDesignSystem(undefined) === null);
check("rejects: a string", parseDesignSystem("nope") === null);
check("rejects: a number", parseDesignSystem(7) === null);
check("rejects: an array", parseDesignSystem([]) === null);
check("rejects: an empty object", parseDesignSystem({}) === null);

rejects("a future version", (s) => {
  s.version = 2;
});
rejects("no values", (s) => {
  s.values = [];
});
rejects("a three-digit hex", (s) => {
  s.values[0].hex = "#abc";
});
rejects("a named colour", (s) => {
  s.values[0].hex = "sage";
});
rejects("an unknown role", (s) => {
  s.values[0].role = "background";
});
rejects("a duplicate value key", (s) => {
  s.values[1].key = s.values[0].key;
});
rejects("a ground naming a value that does not exist", (s) => {
  s.grounds[0].value = "moss";
});
rejects("a ground share above 1", (s) => {
  s.grounds[0].share = 1.5;
});
rejects("a fractional maxRun", (s) => {
  s.grounds[0].maxRun = 1.5;
});
rejects("a maxRun of zero", (s) => {
  s.grounds[0].maxRun = 0;
});
rejects("a missing type level", (s) => {
  delete s.type.subhead;
});
rejects("a type step with no weight", (s) => {
  delete s.type.body.weight;
});
rejects("a non-numeric size", (s) => {
  s.type.body.size = "21px";
});
rejects("a fractional column count", (s) => {
  s.grid.columns = 6.5;
});
rejects("a grid whose margins and gutters exceed the field", (s) => {
  s.grid.margin = 600;
});
rejects("a photo wash with a bad hex", (s) => {
  s.photo.wash.hex = "timber";
});
rejects("a photo wash alpha above 1", (s) => {
  s.photo.wash.alpha = 7;
});
rejects("neverType naming a value that does not exist", (s) => {
  s.rules.neverType = ["moss"];
});
rejects("a missing contrast floor", (s) => {
  delete s.rules.minContrastBody;
});
rejects("a contrast floor above the maximum possible ratio", (s) => {
  s.rules.minContrastBody = 22;
});

// A null photo grade is legitimate — a system that does not grade photography.
const noPhoto = valid();
noPhoto.photo = null;
check("accepts a system with no photo grade", parseDesignSystem(noPhoto) !== null);

// So is a wash-less grade.
const noWash = valid();
delete (noWash.photo as Record<string, unknown>).wash;
check("accepts a photo grade with no wash", parseDesignSystem(noWash) !== null);

// And an empty neverType list.
const noNeverType = valid();
(noNeverType.rules as Record<string, unknown>).neverType = [];
check("accepts an empty neverType list", parseDesignSystem(noNeverType) !== null);

// Hex is normalised, so downstream comparison never has to case-fold.
const upper = valid();
(upper.values as Record<string, unknown>[])[0].hex = "#C7D2BB";
check(
  "normalises hex to lowercase",
  parseDesignSystem(upper)!.values[0].hex === "#c7d2bb",
);

// Parsing is total: no input throws.
let threw = false;
for (const input of [
  NaN,
  Infinity,
  () => {},
  Symbol("x"),
  new Date(),
  { version: 1, values: null },
  { version: 1, values: [{ key: 1, hex: 2, role: 3 }] },
]) {
  try {
    parseDesignSystem(input as unknown);
  } catch {
    threw = true;
  }
}
check("parsing never throws, whatever it is handed", !threw);

console.log(`\nparse: ${passed} checks passed`);
