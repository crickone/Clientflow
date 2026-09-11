// Run: npm test -- src/lib/design/directions.test.ts
//
// The six authored directions. Each must compose, at its own defaults, to a
// system the parser accepts and that can actually set readable type on every
// ground it declares -- a direction that fails that is a direction nobody
// should be able to pick. And Sage Field must reproduce Optimal Health's
// hand-authored system exactly: it IS that system, with the hexes lifted out.
import assert from "node:assert/strict";

import { AVAILABLE_FAMILIES } from "./fonts";
import { parseDesignSystem } from "./parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM } from "./presets";
import { defaultTypeValue } from "./validate";
import { composeDesignSystem, defaultPalette } from "./direction";
import { DESIGN_DIRECTIONS, SAGE_FIELD, getDirection } from "./directions";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("there are seven directions", DESIGN_DIRECTIONS.length === 7);
check("ids are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.id)).size === DESIGN_DIRECTIONS.length);
check("names are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.name)).size === DESIGN_DIRECTIONS.length);
// Anton is deliberately shared by Poster and Signal: both are built on the
// same ultra-condensed cut and differ in ground, colour and motif instead. What
// must stay true is that a direction is not just another palette, so the check
// is on the MOTIFS being its own -- that is the field that carries the
// difference the typeface used to be asked to carry alone.
check("at least five distinct typefaces across the set", new Set(DESIGN_DIRECTIONS.map((d) => d.font)).size >= 5);
check("every direction has its own motifs", DESIGN_DIRECTIONS.every((d) => d.motifs.length >= 4));
check(
  "no two directions share a motif list",
  new Set(DESIGN_DIRECTIONS.map((d) => d.motifs.join("|"))).size === DESIGN_DIRECTIONS.length,
);
check(
  "every motif is a real instruction, not a label",
  DESIGN_DIRECTIONS.every((d) => d.motifs.every((m) => m.trim().length > 30)),
);

// A style built from named slide types must describe each one well enough that
// a designer could build it without seeing the reference. A name with a
// one-liner beside it is a label, not a template.
for (const d of DESIGN_DIRECTIONS.filter((x) => x.templates?.length)) {
  check(`${d.name}: template names are unique`, new Set(d.templates!.map((t) => t.name)).size === d.templates!.length);
  check(
    `${d.name}: every template describes a real structure`,
    d.templates!.every((t) => t.name.trim().length > 2 && t.structure.trim().length > 80),
  );
  check(`${d.name}: enough slide types to fill a carousel without repeating`, d.templates!.length >= 5);
}

// A second display face has to be a face the renderer actually has, or every
// element naming it renders in a silent fallback.
check(
  "a second display face is one the renderer has",
  DESIGN_DIRECTIONS.every((d) => !d.altFont || (AVAILABLE_FAMILIES as readonly string[]).includes(d.altFont)),
);
check(
  "and so is every body face",
  DESIGN_DIRECTIONS.every((d) => !d.bodyFont || (AVAILABLE_FAMILIES as readonly string[]).includes(d.bodyFont)),
);
check("getDirection finds by id", getDirection("sage-field") === SAGE_FIELD);
check("getDirection is null for an unknown id", getDirection("nope") === null);

for (const d of DESIGN_DIRECTIONS) {
  check(`${d.name}: font is one the renderer has`, (AVAILABLE_FAMILIES as readonly string[]).includes(d.font));
  check(`${d.name}: at least two grounds`, d.slots.filter((s) => s.ground).length >= 2);
  check(`${d.name}: every wash names a real slot`, !d.photo?.wash || d.slots.some((s) => s.key === d.photo!.wash!.slot));
  check(`${d.name}: every explicit never-type names a real slot`, d.rules.neverType.every((k) => d.slots.some((s) => s.key === k)));

  const system = composeDesignSystem(d, defaultPalette(d));
  const parsed = parseDesignSystem(system);
  check(`${d.name}: composes to a system the parser accepts`, parsed !== null);

  for (const g of system.grounds) {
    const hex = system.values.find((v) => v.key === g.value)!.hex;
    const type = defaultTypeValue(system, hex);
    assert.ok(type, `${d.name}: no type value at all for ground ${g.value}`);
    assert.ok(
      type.ratio >= system.rules.minContrastBody,
      `${d.name}: ground ${g.value} (${hex}) has no body-legible type -- best is ${type.key} at ${type.ratio.toFixed(2)}:1`,
    );
  }
  check(`${d.name}: every ground can carry body text`, true);
}

// Sage Field IS Optimal Health's system. Compared in a canonical form: the
// composed system lists values and grounds in SLOT order, the hand-authored
// preset in the order the brand document happened to state them, and order
// carries no meaning in either (the parser and every consumer look things up
// by key). Same data, so sort before comparing.
function canonical(system: ReturnType<typeof parseDesignSystem>) {
  assert.ok(system, "system must parse");
  return JSON.stringify({
    ...system,
    values: [...system.values].sort((a, b) => a.key.localeCompare(b.key)),
    grounds: [...system.grounds].sort((a, b) => a.value.localeCompare(b.value)),
    rules: { ...system.rules, neverType: [...system.rules.neverType].sort() },
  });
}
const sage = composeDesignSystem(SAGE_FIELD, defaultPalette(SAGE_FIELD));
check(
  "Sage Field at its defaults reproduces Optimal Health exactly",
  canonical(parseDesignSystem(sage)) === canonical(parseDesignSystem(OPTIMAL_HEALTH_DESIGN_SYSTEM)),
);

console.log(`\ndirections: ${passed} checks passed`);
