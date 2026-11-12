// app/src/lib/programs/preview.test.ts
// Run: npm test -- src/lib/programs/preview.test.ts
import assert from "node:assert/strict";

import { previewProgram } from "./preview";
import { platformProgram } from "./registry";

const smolov = previewProgram(platformProgram("smolov-base")!);
assert.equal(smolov.length, 4);
assert.equal(smolov[0].label, "Week 1 of 4: Base");
assert.deepEqual(smolov[0].rows[0], { day: "Day 1", test: false, exercise: "Back squat", rx: "4 x 9 at 70%", example: "4 x 9 at 70 kg" });
assert.deepEqual(smolov[1].rows[0], { day: "Day 1", test: false, exercise: "Back squat", rx: "4 x 9 at 70% + 10 kg", example: "4 x 9 at 80 kg" });
assert.equal(smolov[3].rows[0].test, true);

// 5/3/1: percentages of a 90 kg training max (90% of 100 kg)
const bbb = previewProgram(platformProgram("531-bbb")!);
assert.equal(bbb[0].rows[0].rx, "1 x 5 at 65%, then 1 x 5 at 75%, then 1 x 5+ at 85%");
assert.equal(bbb[0].rows[0].example, "1 x 5 at 57.5 kg, then 1 x 5 at 67.5 kg, then 1 x 5+ at 77.5 kg");

// linear programs show starting weights; rep-range programs leave the weight to the member
assert.equal(previewProgram(platformProgram("stronglifts-5x5")!)[0].rows[0].example, "5 x 5 at 50 kg");
assert.equal(previewProgram(platformProgram("phul")!)[0].rows[0].example, "Member picks the weight");
assert.equal(previewProgram(platformProgram("german-volume-training")!)[0].rows[1].example, "Bodyweight");

console.log("programs/preview: ok");
