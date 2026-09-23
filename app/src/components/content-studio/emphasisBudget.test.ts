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

// The extractor moved to @/lib/ui/emphasis so the app-wide budget test
// (components/emphasisBudget.app.test.ts) shares one implementation — two
// copies of a character scanner is two places for the same bug to hide.
import { buttonTags, hasVariantProp, isExplicitPrimary, isPrimaryWeight } from "@/lib/ui/emphasis";
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
// A regex can't reliably find a JSX tag's real close: any "stop at the next
// '>'" rule -- even one that skips `=>` -- can still be fooled by a bare `>`
// that occurs earlier in an ordinary prop expression, e.g.
// `disabled={count > 5}`. So this walks the characters after `<Button`
// instead: it tracks `{}` nesting depth and skips over quoted strings
// (`"`, `'`, and backtick template literals) AND comments (`// ...` to end
// of line, `/* ... */` to the matching close), and the tag ends at the
// first `>` seen at brace depth zero, outside any string or comment. That
// is the actual JSX rule -- a `>` only closes the tag when it isn't nested
// inside `{...}`, a string, or a comment -- so it isn't fooled by a bare
// `>` comparison, a `>` inside a string prop like `title="a > b"`, a `>`
// inside a comment like `// arrow points a -> b, but also plain a > b`, or
// an arrow function's `=>`. A trailing `/` (self-closing tags) is stripped
// from the captured attrs.
// Verified against every `<Button` in ImageDesigner.tsx (18 usages): this
// extracts exactly 18 tags, matching a plain `/<Button\b/g` count.

// Primary-weight = declared primary, or no variant prop at all (Button's
// default). Order doesn't matter for the OR, but a Button can't be both.
const countPrimaryWeight = (src: string) => buttonTags(src).filter(isPrimaryWeight).length;

check(
  "the designer has exactly 2 primary-weight buttons -- \"Generate\"/" +
    "\"Regenerate\" in the per-slide AI background panel, and \"Do that\"/" +
    "\"Try a different design\" in the redesign-slide dialog -- one per " +
    "dialog/panel, so at most one is ever on screen at the same time as " +
    "another; adding a third means picking a non-primary variant or removing " +
    "one of these two. It was 3: the Generate-carousel dialog held the other, " +
    "and that whole control is gone -- the same call is what the hub's " +
    "\"New image\" already makes, non-destructively",
  countPrimaryWeight(designer) === 2,
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

// buttonTags() itself, exercised against inline sample strings rather than a
// real component -- this is what makes the extractor's tag-close logic
// verifiable on its own, without waiting for a component to trip it.
check(
  "buttonTags sees the real close of a tag with an earlier bare '>' comparison " +
    "(the exact counter-example that broke the old regex: it used to truncate " +
    "at the '>' inside `count > 5` and never see `variant=\"primary\"`)",
  (() => {
    const sample =
      '<Button disabled={count > 5} variant="primary" onClick={() => go()}>Go</Button>';
    const tags = buttonTags(sample);
    return tags.length === 1 && isExplicitPrimary(tags[0]);
  })(),
);
check(
  "buttonTags handles a self-closing tag",
  (() => {
    const tags = buttonTags('<Button variant="ghost" />');
    return tags.length === 1 && /variant\s*=\s*"ghost"/.test(tags[0]);
  })(),
);
check(
  "buttonTags does not let a '>' inside a string prop end the tag early",
  (() => {
    const tags = buttonTags('<Button title="a > b" variant="secondary">x</Button>');
    return (
      tags.length === 1 &&
      /title="a > b"/.test(tags[0]) &&
      /variant\s*=\s*"secondary"/.test(tags[0])
    );
  })(),
);
check(
  "buttonTags handles an arrow-function prop ('=>') without stopping early",
  (() => {
    const tags = buttonTags('<Button onClick={() => go()}>Go</Button>');
    return tags.length === 1 && /onClick=\{\(\) => go\(\)\}/.test(tags[0]);
  })(),
);
check(
  "buttonTags does not let a '//' line comment's bare '>' end the tag early " +
    "(the reviewer's exact counter-example: a line comment mentioning an " +
    "arrow '->' and a bare '>' sits between props, and used to truncate the " +
    "tag before `variant=\"primary\"` was ever seen)",
  (() => {
    const sample = [
      "<Button",
      '  type="button"',
      "  // migrated from <OldButton> usage, arrow points a -> b, but also plain a > b here",
      '  variant="primary"',
      "  onClick={() => go()}",
      ">",
    ].join("\n");
    const tags = buttonTags(sample);
    return tags.length === 1 && isExplicitPrimary(tags[0]);
  })(),
);
check(
  "buttonTags does not let a '/* */' block comment's bare '>' end the tag early",
  (() => {
    const sample =
      '<Button /* old: <OldButton> was used here, a > b */ variant="primary">Go</Button>';
    const tags = buttonTags(sample);
    return tags.length === 1 && isExplicitPrimary(tags[0]);
  })(),
);

console.log(`\nemphasisBudget: ${passed} checks passed`);
