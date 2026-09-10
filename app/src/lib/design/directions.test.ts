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

check("there are six directions", DESIGN_DIRECTIONS.length === 6);
check("ids are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.id)).size === 6);
check("names are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.name)).size === 6);
check("no two directions share a typeface", new Set(DESIGN_DIRECTIONS.map((d) => d.font)).size === 6);
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
