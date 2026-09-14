// Run: npm test -- src/components/content-studio/emphasisBudget.test.ts
//
// Emphasis only works when it is scarce (the Von Restorff effect): one
// primary action per view, and red reserved for the single thing that
// destroys. This reads the designer's SOURCE and asserts the budget, because
// the components cannot be rendered under the plain test runner and the rule
// is about what is written, not what happens.
//
// "Primary-weight" here means what actually renders as the `.btn--primary`
// look: an explicit `variant="primary"`, OR a `<Button ...>` with NO variant
// prop at all -- `Button`'s own default is `variant = "primary"`
// (src/components/ui/Button.tsx), so an unadorned `<Button>` is a primary
// button. Counting only the literal string `variant="primary"` would miss
// every default-variant button, which is most of them, and would pass a
// second primary dropped into the top bar silently -- the exact regression
// this file exists to catch.
//
// This is a budget, not a syntax check: the designer's primary-weight count
// is pinned below to the number verified by hand (see the check for the
// name and location of each). It does not know which buttons are visible
// together at once -- that judgment call ("one per dialog/panel, so at most
// one is ever on screen with another") was made once, by a human, reading
// the file. Adding another default-variant `<Button>` anywhere in the file
// changes the count and fails the test, forcing the next person to make
// that same judgment call deliberately instead of inheriting a silent
// regression.
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

// Pulls out the attribute text of every `<Button ...>` opening tag so a
// variant can be looked for across a multi-line prop list, not just on the
// line `<Button` itself appears on.
//
// The naive "match up to the next '>'" reads wrong on a JSX arrow-function
// prop: `onClick={() => foo()}` contains a `>` (inside `=>`) long before the
// tag's real close. A lookbehind that refuses to stop at a `>` immediately
// preceded by `=` skips every `=>` and lands on the tag's actual close --
// which is always preceded by whitespace, a quote, `}`, or `/`, never `=`.
// Verified against every `<Button` in ImageDesigner.tsx (18 usages): this
// extracts exactly 18 tags, matching a plain `/<Button\b/g` count.
function buttonTags(src: string): string[] {
  const re = /<Button\b([\s\S]*?)(?<!=)>/g;
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) tags.push(m[1]);
  return tags;
}

const hasVariantProp = (attrs: string) => /\bvariant\s*=/.test(attrs);
const isExplicitPrimary = (attrs: string) => /variant\s*=\s*"primary"/.test(attrs);
// Primary-weight = declared primary, or no variant prop at all (Button's
// default). Order doesn't matter for the OR, but a Button can't be both.
const isPrimaryWeight = (attrs: string) => isExplicitPrimary(attrs) || !hasVariantProp(attrs);
const countPrimaryWeight = (src: string) => buttonTags(src).filter(isPrimaryWeight).length;

check(
  "the designer has exactly 3 primary-weight buttons -- \"Generate\" in the " +
    "Generate-carousel dialog, \"Generate\"/\"Regenerate\" in the per-slide AI " +
    "background panel, and \"Redesign with that\"/\"Try a different design\" " +
    "in the redesign-slide dialog -- one per dialog/panel, so at most one is " +
    "ever on screen at the same time as another; adding a fourth means " +
    "picking a non-primary variant or removing one of these three",
  countPrimaryWeight(designer) === 3,
);
check(
  "no toggle in the designer borrows the primary weight (variant must not resolve to \"primary\")",
  !/variant=\{[^}]*"primary"[^}]*\}/.test(designer),
);
check(
  "the designer has exactly one destructive button (Delete design)",
  count(designer, /variant="destructive"/g) === 1,
);
check(
  "the photo library has no primary-weight button and no destructive button of its own (Clear/Upload are ghost/outline)",
  countPrimaryWeight(library) === 0 && count(library, /variant="destructive"/g) === 0,
);
check(
  "the studio home has no primary-weight button and no destructive button -- its tiles are links, not actions competing for emphasis",
  countPrimaryWeight(home) === 0 && count(home, /variant="destructive"/g) === 0,
);

console.log(`\nemphasisBudget: ${passed} checks passed`);
