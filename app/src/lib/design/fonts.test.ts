// Run: npm test -- src/lib/design/fonts.test.ts
//
// satori needs real bytes per weight; a face that fails to load renders in a
// silent fallback and looks subtly wrong. So every family the design
// directions can name must actually be on disk, at every weight, and load.
import assert from "node:assert/strict";

import { AVAILABLE_FAMILIES, DEFAULT_FAMILY, loadDesignFonts, resolveFamily } from "./fonts";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

async function main() {
  check("six families are available", AVAILABLE_FAMILIES.length === 6);
  check("Inter is still the default", DEFAULT_FAMILY === "Inter");
  check("an unknown family resolves to the default", resolveFamily("Comic Sans") === "Inter");
  check("a blank family resolves to the default", resolveFamily("  ") === "Inter");

  for (const family of AVAILABLE_FAMILIES) {
    const fonts = await loadDesignFonts(family);
    check(`${family}: four weights load`, fonts.length === 4);
    check(
      `${family}: weights are 400/500/600/700`,
      fonts.map((f) => f.weight).join() === "400,500,600,700",
    );
    check(`${family}: every weight has real bytes`, fonts.every((f) => f.data.length > 10_000));
    check(`${family}: the face is named for satori`, fonts.every((f) => f.name === family));
  }

  console.log(`\nfonts: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
