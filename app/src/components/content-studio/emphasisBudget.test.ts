// Run: npm test -- src/components/content-studio/emphasisBudget.test.ts
//
// Emphasis only works when it is scarce (the Von Restorff effect): one
// primary action per view, and red reserved for the single thing that
// destroys. This reads the designer's SOURCE and asserts the budget, because
// the components cannot be rendered under the plain test runner and the rule
// is about what is written, not what happens. It fails the moment a second
// destructive button or a toggle that borrows the primary weight is added.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const here = join(process.cwd(), "src", "components", "content-studio");
const designer = readFileSync(join(here, "ImageDesigner.tsx"), "utf8");
const library = readFileSync(join(here, "SlidePhotoLibrary.tsx"), "utf8");
const home = readFileSync(join(here, "ContentStudioHome.tsx"), "utf8");

const count = (src: string, re: RegExp) => (src.match(re) ?? []).length;

check(
  "the designer has exactly one destructive button (Delete design)",
  count(designer, /variant="destructive"/g) === 1,
);
check(
  "no toggle in the designer borrows the primary weight",
  !/variant=\{[^}]*"primary"[^}]*\}/.test(designer),
);
check(
  "the photo library has no primary or destructive button of its own",
  count(library, /variant="(primary|destructive)"/g) === 0,
);
check(
  "the studio home has no buttons at all -- its tiles are links",
  count(home, /<Button\b/g) === 0,
);

console.log(`\nemphasisBudget: ${passed} checks passed`);
