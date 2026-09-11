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
  check("seven families are available", AVAILABLE_FAMILIES.length === 7);
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

  // A display/body PAIR: satori matches on the font-family each element names,
  // so both families must be present in one array for a serif headline over a
  // sans body to render as two faces rather than one.
  const pair = await loadDesignFonts("Playfair Display", "Inter");
  check("a pair loads both families", pair.length === 8);
  check("the display family is present", pair.some((f) => f.name === "Playfair Display"));
  check("the body family is present", pair.some((f) => f.name === "Inter"));
  check("asking for the same family twice loads it once", (await loadDesignFonts("Inter", "Inter")).length === 4);
  check("no body family behaves as before", (await loadDesignFonts("Inter")).length === 4);
  check("an unknown body family falls back to the default", (await loadDesignFonts("Anton", "Nope")).some((f) => f.name === "Inter"));

  // Anton has no weight axis. Every weight must still resolve to real bytes,
  // or a heading asking for 700 silently renders in a fallback face.
  const anton = await loadDesignFonts("Anton");
  check("a single-cut face still serves every weight", anton.length === 4 && anton.every((f) => f.data.length > 10_000));
  check("and every weight is the same cut", new Set(anton.map((f) => f.data.length)).size === 1);

  console.log(`\nfonts: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
