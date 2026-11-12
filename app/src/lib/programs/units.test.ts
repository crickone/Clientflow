// app/src/lib/programs/units.test.ts
// Run: npm test -- src/lib/programs/units.test.ts
import assert from "node:assert/strict";

import {
  STEP_5LB_KG,
  formatSetIn,
  formatWeight,
  keyFromStep,
  kgToUnit,
  maxFromSet,
  parseRpe,
  parseWeightIn,
  resolveMax,
  roundToStep,
  stepFromKey,
  trainingMax,
  unitToKg,
  weightForRpe,
} from "./units";

// Rounding to the smallest jump (nearest, half up).
assert.equal(roundToStep(101.3, 2.5), 102.5);
assert.equal(roundToStep(101.2, 2.5), 100);
assert.equal(roundToStep(101.25, 2.5), 102.5);
assert.equal(roundToStep(101.3, 1.25), 101.25);
assert.equal(roundToStep(102, STEP_5LB_KG), 102.058);
assert.equal(roundToStep(57.5, 0), 57.5);

// Units: everything is stored in kg.
assert.equal(STEP_5LB_KG, 2.26796);
assert.equal(formatWeight(102.5, "kg"), "102.5 kg");
assert.equal(formatWeight(102.058, "lb"), "225 lb");
assert.equal(kgToUnit(100, "lb"), 220.5);
assert.equal(unitToKg(225, "lb"), 102.058);
assert.equal(unitToKg(62.5, "kg"), 62.5);
assert.equal(parseWeightIn("225", "lb"), 102.058);
assert.equal(parseWeightIn("62,5", "kg"), 62.5);
assert.equal(parseWeightIn("", "lb"), null);
assert.equal(parseWeightIn("abc", "kg"), null);
assert.equal(formatSetIn({ weightKg: 102.058, reps: 5 }, "lb"), "225 lb x 5");
assert.equal(formatSetIn({ weightKg: null, reps: 8 }, "kg"), "8 reps");
assert.equal(stepFromKey("1.25kg"), 1.25);
assert.equal(stepFromKey("5lb"), STEP_5LB_KG);
assert.equal(keyFromStep(2.26796), "5lb");
assert.equal(keyFromStep(2.5), "2.5kg");

// RPE input.
assert.equal(parseRpe("8"), 8);
assert.equal(parseRpe("7,5"), 7.5);
assert.equal(parseRpe("8.3"), 8.5);
assert.equal(parseRpe("11"), null);
assert.equal(parseRpe(""), null);

// Maxes: Epley, only sets of 1 to 10 reps.
assert.equal(maxFromSet(100, 1), 100);
assert.equal(maxFromSet(100, 5), 116.67);
assert.equal(maxFromSet(100, 10), 133.33);
assert.equal(maxFromSet(100, 11), null);
assert.equal(maxFromSet(0, 5), null);
assert.equal(maxFromSet(100, 0), null);
assert.equal(resolveMax({ kind: "one_rm", kg: 140 }), 140);
assert.equal(resolveMax({ kind: "set", kg: 100, reps: 5 }), 116.67);
assert.equal(resolveMax({ kind: "set", kg: 100, reps: 12 }), null);
assert.equal(resolveMax({ kind: "one_rm", kg: -1 }), null);

// Training max.
assert.equal(trainingMax(200, 0.9), 180);
assert.equal(trainingMax(111.11, 0.9), 100);
assert.equal(trainingMax(116.67, 6 / 7), 100);

// RPE weight: the Epley estimate run backwards with reps in reserve.
assert.equal(weightForRpe(100, 1, 10), 100);
assert.equal(Math.round(weightForRpe(100, 3, 8) * 1000) / 1000, 85.714);

console.log("programs/units: ok");
