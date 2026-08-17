import assert from "node:assert/strict";
import {
  ASPECT_DIMS,
  buildImagePrompt,
  defaultImageStyle,
  fallbackScene,
} from "./prompt";

(async () => {
  // Exact dims — chosen to be multiples of 32 (fal constraint) and under
  // 1,000,000 px (fal bills $0.04 per rounded-up MP → always one 4¢ unit).
  assert.deepEqual(ASPECT_DIMS["1:1"], { width: 992, height: 992 });
  assert.deepEqual(ASPECT_DIMS["4:5"], { width: 864, height: 1088 });
  assert.deepEqual(ASPECT_DIMS["9:16"], { width: 736, height: 1312 });
  for (const [aspect, d] of Object.entries(ASPECT_DIMS)) {
    assert.equal(d.width % 32, 0, `${aspect} width multiple of 32`);
    assert.equal(d.height % 32, 0, `${aspect} height multiple of 32`);
    assert.ok(d.width * d.height < 1_000_000, `${aspect} under 1MP`);
  }

  // buildImagePrompt: scene first, then style, then the fixed suffixes.
  const p = buildImagePrompt({
    houseStyle: "Warm minimal wellness photography.",
    scene: "A sunlit treatment room with a linen-covered bed.",
  });
  assert.ok(p.startsWith("A sunlit treatment room with a linen-covered bed. "));
  assert.ok(p.includes("Warm minimal wellness photography. "), "style present, trailing dots deduped");
  assert.ok(p.includes("photorealistic"), "quality suffix present");
  assert.ok(
    p.includes("no text, no words, no lettering, no logos, no watermarks"),
    "no-text clause present verbatim",
  );
  assert.ok(!p.includes(".."), "no doubled dots after joining");

  // fallbackScene: heading + body joined; empty-safe.
  assert.equal(
    fallbackScene({ heading: "Recover faster", body: "Cold water therapy" }),
    "Recover faster — Cold water therapy",
  );
  assert.equal(fallbackScene({ heading: "Only heading", body: "" }), "Only heading");
  assert.equal(
    fallbackScene({ heading: null, body: null }),
    "an atmospheric scene that fits the brand",
  );

  // defaultImageStyle: uses tagline + location when present, generic otherwise.
  const s1 = defaultImageStyle({ tagline: "a recovery & wellness clinic", location: "Clonmel, Co. Tipperary" });
  assert.ok(s1.includes("a recovery & wellness clinic"));
  assert.ok(s1.includes("in Clonmel, Co. Tipperary"));
  const s2 = defaultImageStyle({});
  assert.ok(s2.includes("a premium local business"));
  assert.ok(!s2.includes(" in "), "no dangling location clause");

  console.log("prompt.test.ts: all assertions passed");
})();
