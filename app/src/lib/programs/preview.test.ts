// app/src/lib/programs/preview.test.ts
// Run: npm test -- src/lib/programs/preview.test.ts
import assert from "node:assert/strict";

import { previewProgram } from "./preview";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";

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

// Every platform program previews without throwing, gives rows each week,
// never prints NaN or undefined, and leaves the registry template untouched.
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
for (const t of PLATFORM_PROGRAMS) {
  const before = JSON.stringify(t);
  const weeks = previewProgram(deepFreeze(structuredClone(t)));
  assert.ok(weeks.length > 0, `${t.key}: has weeks`);
  for (const w of weeks) {
    assert.ok(w.rows.length > 0, `${t.key} ${w.label}: has rows`);
    for (const r of w.rows) {
      const text = `${w.label} ${r.rx} ${r.example}`;
      assert.ok(!/NaN|undefined|null/.test(text), `${t.key}: ${text}`);
    }
  }
  previewProgram(t);
  assert.equal(JSON.stringify(t), before, `${t.key}: template unchanged`);
}

console.log("programs/preview: ok");
