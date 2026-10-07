// Run: npx tsx src/lib/ai/postTreatments.test.ts
//
// The per-post treatment rotation and the checks that hold the model to it.
import assert from "node:assert/strict";

import { OPENING_MOVES } from "./openingMoves";
import {
  POST_TREATMENTS,
  POST_TREATMENT_KEYS,
  RECENT_TREATMENTS,
  directionProblems,
  pickTreatment,
} from "./postTreatments";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("enough treatments to rotate through", POST_TREATMENTS.length >= RECENT_TREATMENTS + 3);
check("keys are unique", new Set(POST_TREATMENT_KEYS).size === POST_TREATMENTS.length);

const recent = POST_TREATMENT_KEYS.slice(0, RECENT_TREATMENTS);
for (let r = 0; r < 1; r += 0.009) {
  const t = pickTreatment(recent, true, () => r);
  assert.ok(!recent.includes(t.key), `r=${r} reused ${t.key}`);
}
check(`none of the last ${RECENT_TREATMENTS} treatments comes back`, true);

for (let r = 0; r < 1; r += 0.013) {
  assert.notEqual(pickTreatment([], false, () => r).photos, "inset");
}
check("a tenant with no photography never gets the inset-photo treatment", true);
check("every treatment is reachable", new Set(Array.from({ length: 300 }, (_, i) => pickTreatment([], true, () => i / 300).key)).size === POST_TREATMENTS.length);

const photo = '<div style="display:flex"><img src="{{PHOTO}}" style="width:1080px;height:600px" /></div>';
const flat = '<div style="display:flex"><div style="width:800px">Heading</div></div>';
const typeOnlyCover = OPENING_MOVES.find((m) => m.key === "type-only")!;
const photoCover = OPENING_MOVES.find((m) => m.key === "photo-overlap")!;
const anyPhotos = POST_TREATMENTS.find((t) => t.photos === "any")!;
const noPhotos = POST_TREATMENTS.find((t) => t.photos === "none")!;
const onePhoto = POST_TREATMENTS.find((t) => t.photos === "one")!;

check("a photo cover where none was asked for is a problem", directionProblems([photo, flat], typeOnlyCover, anyPhotos).length === 1);
check("a photo cover that was asked for is fine", directionProblems([photo, flat], photoCover, anyPhotos).length === 0);
check("photographs in a no-photo set are a problem", directionProblems([flat, photo], typeOnlyCover, noPhotos).some((p) => p.includes("no photographs")));
check("two photographs in a one-photo set are a problem", directionProblems([photo, flat, photo], photoCover, onePhoto).some((p) => p.includes("at most one")));
check("one photograph in a one-photo set is fine", directionProblems([photo, flat, flat], photoCover, onePhoto).length === 0);

console.log(`\npostTreatments: ${passed} checks passed`);
