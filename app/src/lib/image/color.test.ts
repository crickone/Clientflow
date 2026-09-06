// Run: npm test -- src/lib/image/color.test.ts
//
// The colour picker drags in HSV and stores hex, so every open/adjust/close
// cycle is a hex -> HSV -> hex round trip. A conversion that's a shade off
// loses a little colour each time and nobody notices until a brand orange has
// quietly drifted, so the round trip is pinned exactly.
import assert from "node:assert/strict";

import {
  hexToHsv,
  hsvToHex,
  normaliseHex,
  parseHex,
  readableTextOn,
  rgbToHex,
} from "./color";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
function eq(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}

console.log("color");

// --- parsing ---------------------------------------------------------------

eq("a full hex parses", parseHex("#2c6ce0"), { r: 0x2c, g: 0x6c, b: 0xe0 });
eq("the hash is optional", parseHex("2c6ce0"), { r: 0x2c, g: 0x6c, b: 0xe0 });
eq("shorthand expands by doubling", parseHex("#f0a"), { r: 255, g: 0, b: 170 });
eq("uppercase parses", parseHex("#FFAA00"), { r: 255, g: 170, b: 0 });
eq("surrounding space is tolerated", parseHex("  #ffffff "), {
  r: 255,
  g: 255,
  b: 255,
});

// A half-typed hex field must not resolve to a colour, or the slide's colour
// would change on every keystroke of "#2c6..." as the user types.
eq("a partial hex is not a colour", parseHex("#2c6"), {
  r: 0x22,
  g: 0xcc,
  b: 0x66,
}); // 3 chars IS valid shorthand
eq("four characters is not a colour", parseHex("#2c6c"), null);
eq("five characters is not a colour", parseHex("#2c6ce"), null);
eq("non-hex characters are rejected", parseHex("#gggggg"), null);
eq("an empty string is not a colour", parseHex(""), null);
eq("a css colour name is not a hex", parseHex("rebeccapurple"), null);

// --- formatting ------------------------------------------------------------

eq("channels format lowercase and padded", rgbToHex(0, 10, 255), "#000aff");
eq("out-of-range channels clamp rather than wrap", rgbToHex(-5, 300, 128), "#00ff80");
eq("fractional channels round", rgbToHex(0.6, 127.5, 254.4), "#0180fe");
eq("normaliseHex canonicalises shorthand", normaliseHex("#F0A"), "#ff00aa");
eq("normaliseHex rejects nonsense", normaliseHex("nope"), null);

// --- the round trip, which is the whole point ------------------------------

const ROUND_TRIP = [
  "#000000",
  "#ffffff",
  "#2c6ce0", // the default accent
  "#ff6a32", // brand orange
  "#0a0a0a",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#0000ff",
  "#ffff00",
  "#00ffff",
  "#ff00ff",
  "#123456",
  "#fedcba",
];
for (const hex of ROUND_TRIP) {
  const hsv = hexToHsv(hex);
  ok(`${hex} survives hex -> HSV -> hex exactly`, !!hsv && hsvToHex(hsv) === hex);
}

// Every hue, so no sector of the picker's wheel is off by one.
{
  let worst = "";
  for (let h = 0; h < 360; h += 1) {
    const hex = hsvToHex({ h, s: 1, v: 1 });
    const back = hexToHsv(hex);
    if (!back || hsvToHex(back) !== hex) worst = `h=${h}`;
  }
  eq("every hue at full saturation round-trips", worst, "");
}
{
  let worst = "";
  for (let s = 0; s <= 100; s += 1) {
    for (const v of [0.25, 0.5, 0.75, 1]) {
      const hex = hsvToHex({ h: 217, s: s / 100, v });
      const back = hexToHsv(hex);
      if (!back || hsvToHex(back) !== hex) worst = `s=${s} v=${v}`;
    }
  }
  eq("the saturation/brightness square round-trips at every step", worst, "");
}

// --- known HSV values ------------------------------------------------------

{
  const red = hexToHsv("#ff0000")!;
  ok("red is hue 0, fully saturated, full brightness", red.h === 0 && red.s === 1 && red.v === 1);
  const green = hexToHsv("#00ff00")!;
  eq("green is hue 120", green.h, 120);
  const blue = hexToHsv("#0000ff")!;
  eq("blue is hue 240", blue.h, 240);
}
{
  // Grey has no hue to speak of; the picker must not jump the handle when a
  // user drags saturation to zero and back.
  const grey = hexToHsv("#808080")!;
  eq("grey has zero saturation", grey.s, 0);
  eq("grey keeps hue 0 rather than NaN", grey.h, 0);
  const black = hexToHsv("#000000")!;
  eq("black has zero saturation, not a division by zero", black.s, 0);
  eq("black has zero brightness", black.v, 0);
}

// --- guards ----------------------------------------------------------------

eq("hue wraps past 360", hsvToHex({ h: 360, s: 1, v: 1 }), hsvToHex({ h: 0, s: 1, v: 1 }));
eq("negative hue wraps too", hsvToHex({ h: -60, s: 1, v: 1 }), hsvToHex({ h: 300, s: 1, v: 1 }));
eq("saturation above 1 clamps", hsvToHex({ h: 0, s: 5, v: 1 }), "#ff0000");
eq("brightness below 0 clamps to black", hsvToHex({ h: 0, s: 1, v: -1 }), "#000000");
eq("an unparseable hex has no HSV", hexToHsv("zzz"), null);

// --- label contrast --------------------------------------------------------

eq("dark colours take white text", readableTextOn("#0a0a0a"), "#ffffff");
eq("pale colours take black text", readableTextOn("#ffe8b0"), "#000000");
eq("white takes black text", readableTextOn("#ffffff"), "#000000");
eq("black takes white text", readableTextOn("#000000"), "#ffffff");
// A naive (r+g+b)/3 average calls saturated blue "mid" and picks black, which
// is unreadable. The luminance curve weights blue at 7%.
eq("saturated blue takes white text, not black", readableTextOn("#0000ff"), "#ffffff");
eq("saturated yellow takes black text", readableTextOn("#ffff00"), "#000000");

console.log(`\ncolor: ${passed} checks passed.`);
