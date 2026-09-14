// Run: npm test -- src/lib/content-studio/progressLabel.test.ts
//
// A long call must show that time is passing and what is happening in it
// (the Doherty threshold: past ~400ms, waiting needs feedback). These pin the
// label copy so the dialogs cannot drift into a bare spinner again.
import assert from "node:assert/strict";

import { progressLabel } from "./progressLabel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("designing, just started, names the work without a count", progressLabel("designing", 0) === "Designing…");
check("designing shows seconds once a few have passed", progressLabel("designing", 7) === "Designing… 7s");
check("a photo on its own", progressLabel("photo", 12) === "Making the photo… 12s");
check("the two-step path says which step it is on", progressLabel("photoThenDesign", 3) === "Making the photo (1 of 2)… 3s");
check("no seconds under three -- a flicker of '1s' reads as a glitch", progressLabel("photo", 2) === "Making the photo…");
check("seconds are whole", progressLabel("designing", 9.8) === "Designing… 9s");
check("applying an already-made photo is named for what it is, not still 'making' it", progressLabel("applyingPhoto", 5) === "Adding the photo to the slide… 5s");

console.log(`\nprogressLabel: ${passed} checks passed`);
