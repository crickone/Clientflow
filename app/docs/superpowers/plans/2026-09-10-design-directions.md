# Design Directions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant pick one of six authored *design directions* in Settings, apply their own brand palette to it, preview real rendered slides, and save — producing the per-tenant `DesignSystem` that AI-composed posts already read, without a developer hand-authoring a preset or seeding production over `railway ssh`.

**Architecture:** A `DesignDirection` is everything in a `DesignSystem` *except* the hexes: typeface, type scale, grid, ground rotation budgets, photo grade and contrast rules, plus a list of named palette *slots* each with a role and a default colour. `composeDesignSystem(direction, palette)` fills the slots with the tenant's hexes, derives which values can never carry type from the contrast maths, and returns an ordinary `DesignSystem` that is stored under the existing `design_system` key — so nothing downstream (the prompt, the audit, the renderer) changes. The renderer gains real font files for six families so the directions differ in typography, not just colour.

**Tech Stack:** Next.js 14 (App Router), TypeScript, satori + sharp (existing renderer), better-sqlite3 via the existing per-tenant `settings` key/value store, fontsource WOFF files (SIL OFL), the project's plain `node:assert` test runner (`npm test -- <path>`).

## Global Constraints

- **NO EMOJIS** anywhere: UI copy, code, comments, commit messages, docs. Use `lucide-react` icons where a glyph is needed. (House rule, CLAUDE.md.)
- Tests are plain `node:assert/strict` scripts run with `npm test -- <path>`; no vitest/jest. Modules that `import "server-only"` load under the runner's `--conditions=react-server`.
- `src/lib/design/parse.ts`, `validate.ts` and the new `direction.ts`, `directions.ts`, `sampleSlides.ts` must have **zero runtime imports** beyond each other (no `server-only`, no DB) so they load in the pure test runner and in the browser.
- A tenant with **no** design system keeps today's behaviour exactly (fixed templates). `parseDesignSystem` returning `null` is a first-class state; never substitute a default system.
- Optimal Health's stored system in production has no `font` field. It **must** keep parsing (defaulting to Inter) and **must not** be overwritten by anything in this plan.
- Applying a direction is a deliberate action with a button, **not** autosave: it changes every future post.
- Every new font file must ship in `public/fonts` (the Dockerfile copies `public/` into the runtime image) with its licence alongside.
- Commit after every task; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Finish by running `npm test`, `npx next build`, pushing `main`, and `cd app && railway up` (house rule: never stop at "typecheck passes").

---

## File Structure

**Create**
- `src/lib/design/direction.ts` — pure: `PaletteSlot`, `DesignDirection`, `BrandPalette`, `defaultPalette`, `deriveNeverType`, `composeDesignSystem`.
- `src/lib/design/direction.test.ts`
- `src/lib/design/directions.ts` — pure data: the six authored directions, `DESIGN_DIRECTIONS`, `getDirection`.
- `src/lib/design/directions.test.ts`
- `src/lib/design/directionStore.ts` — server-only: reads/writes the `design_direction` settings key and applies a composed system via `setDesignSystem`.
- `src/lib/design/directionStore.test.ts`
- `src/lib/design/sampleSlides.ts` — pure: three fixed sample slides (HTML) for a given system, for the preview.
- `src/lib/design/fonts.test.ts`
- `scripts/fetch-design-fonts.mjs` — downloads the five new families (WOFF, four weights each) plus licences into `public/fonts`.
- `public/fonts/*.woff`, `public/fonts/LICENSE-*.txt` — committed output of that script.
- `src/app/api/content-studio/design-direction/preview/route.ts` — POST: compose + render three sample slides, return PNG data URIs.
- `src/app/settings/design/page.tsx`, `src/app/settings/design/actions.ts`
- `src/components/settings/DesignDirectionView.tsx`

**Modify**
- `src/lib/design/parse.ts` — add `font` to `DesignSystem` (defaults to `"Inter"` when absent).
- `src/lib/design/parse.test.ts` — cover the default and the rejection.
- `src/lib/design/presets.ts` — add `font: "Inter"` to `OPTIMAL_HEALTH_DESIGN_SYSTEM`.
- `src/lib/design/fonts.ts` — six families, per-family file naming (Inter is TTF, the rest WOFF).
- `src/lib/ai/designPost.parse.ts` — the prompt names the system's typeface instead of hardcoding Inter.
- `src/lib/ai/designPost.parse.test.ts` — cover that.
- `src/lib/ai/designPost.ts:113` — `loadDesignFonts(system.font)`.
- `src/app/api/content-studio/carousels/[id]/slide-text/route.ts:73,154` — same.
- `src/lib/design/renderDesign.test.ts` — sample slides render.
- `src/app/settings/page.tsx` — add the "Design direction" section entry.

---

### Task 1: `font` becomes part of a DesignSystem

**Files:**
- Modify: `src/lib/design/parse.ts`
- Modify: `src/lib/design/presets.ts`
- Test: `src/lib/design/parse.test.ts`

**Interfaces:**
- Produces: `DesignSystem.font: string`; `export const DEFAULT_DESIGN_FONT = "Inter"` from `parse.ts`. Every later task reads `system.font`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/lib/design/parse.test.ts`, before the final `console.log`:

```ts
// -- font ------------------------------------------------------------------
//
// The stored Optimal Health blob in production predates `font`. It MUST keep
// parsing, defaulting to Inter, or the tenant loses composed posts on deploy.
{
  const noFont = valid();
  delete noFont.font;
  const p = parseDesignSystem(noFont);
  check("a system with no font field still parses", p !== null);
  check("and defaults to Inter", p?.font === "Inter");

  const withFont = valid();
  withFont.font = "Playfair Display";
  check("an explicit font is kept", parseDesignSystem(withFont)?.font === "Playfair Display");

  rejects("font that is not a string", (s) => {
    s.font = 42;
  });
  rejects("font that is blank", (s) => {
    s.font = "   ";
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/parse.test.ts`
Expected: FAIL — `and defaults to Inter` (parsed object has no `font` property).

- [ ] **Step 3: Add `font` to the type and the parser**

In `src/lib/design/parse.ts`, add above `export interface DesignSystem`:

```ts
/** The face a system renders in when it names none. Inter is what every
 *  system authored before `font` existed rendered in, so defaulting to it is
 *  what keeps those stored blobs meaning what they meant. */
export const DEFAULT_DESIGN_FONT = "Inter";
```

In `export interface DesignSystem`, add after `version: 1;`:

```ts
  /** satori font family. Must be one the renderer has bytes for
   *  (lib/design/fonts.ts AVAILABLE_FAMILIES); an unknown name falls back to
   *  Inter at load time rather than rendering in a silent default. */
  font: string;
```

In `parseDesignSystem`, after the `// Rules` block and before `return {`:

```ts
  // Font — absent means "authored before fonts existed", which is Inter.
  // Present but not a usable string is malformed, same as any other field.
  let font: string;
  if (input.font === undefined) {
    font = DEFAULT_DESIGN_FONT;
  } else if (typeof input.font === "string" && input.font.trim()) {
    font = input.font.trim();
  } else {
    return null;
  }
```

And in the `return {` object, after `version: 1,`:

```ts
    font,
```

In `src/lib/design/presets.ts`, in `OPTIMAL_HEALTH_DESIGN_SYSTEM`, add after `version: 1,`:

```ts
  font: "Inter",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/design/parse.test.ts`
Expected: PASS, including the existing `it round-trips value-for-value` check (the preset now carries `font` too, so the JSON comparison still holds).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. (Nothing constructs a `DesignSystem` literal outside the preset; if something does, add `font: "Inter"` to it.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/design/parse.ts src/lib/design/parse.test.ts src/lib/design/presets.ts
git commit -m "feat(design): a design system names its typeface

Absent means Inter — every system authored before this rendered in Inter, and
the stored Optimal Health blob has no font field, so the default is what keeps
it meaning what it meant.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Five more font families on disk

**Files:**
- Create: `scripts/fetch-design-fonts.mjs`
- Create: `public/fonts/{playfair-display,space-grotesk,manrope,archivo,fraunces}-latin-{400,500,600,700}-normal.woff` and `public/fonts/LICENSE-<pkg>.txt` (script output, committed)
- Modify: `src/lib/design/fonts.ts`
- Test: `src/lib/design/fonts.test.ts`

**Interfaces:**
- Produces: `AVAILABLE_FAMILIES` = `["Inter","Playfair Display","Space Grotesk","Manrope","Archivo","Fraunces"]`, `type DesignFamily`, `loadDesignFonts(family?)` unchanged in signature.

Background the implementer needs: satori accepts TTF, OTF and **WOFF** (not WOFF2). fontsource v5 packages ship one `.woff` per weight named `<pkg>-latin-<weight>-normal.woff`. The registry tarball URLs below were verified (version 5.3.0). Nebula and ClashDisplay already in `public/fonts` are variable/single-file and stay unusable here.

- [ ] **Step 1: Write the failing test**

Create `src/lib/design/fonts.test.ts`:

```ts
// Run: npm test -- src/lib/design/fonts.test.ts
//
// satori needs real bytes per weight; a face that fails to load renders in a
// silent fallback and looks subtly wrong. So every family the design
// directions can name must actually be on disk, at every weight, and load.
import assert from "node:assert/strict";

import { AVAILABLE_FAMILIES, DEFAULT_FAMILY, loadDesignFonts, resolveFamily } from "./fonts";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

async function main() {
  check("six families are available", AVAILABLE_FAMILIES.length === 6);
  check("Inter is still the default", DEFAULT_FAMILY === "Inter");
  check("an unknown family resolves to the default", resolveFamily("Comic Sans") === "Inter");
  check("a blank family resolves to the default", resolveFamily("  ") === "Inter");

  for (const family of AVAILABLE_FAMILIES) {
    const fonts = await loadDesignFonts(family);
    check(`${family}: four weights load`, fonts.length === 4);
    check(
      `${family}: weights are 400/500/600/700`,
      fonts.map((f) => f.weight).join() === "400,500,600,700",
    );
    check(`${family}: every weight has real bytes`, fonts.every((f) => f.data.length > 10_000));
    check(`${family}: the face is named for satori`, fonts.every((f) => f.name === family));
  }

  console.log(`\nfonts: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/fonts.test.ts`
Expected: FAIL — `six families are available` (there is one).

- [ ] **Step 3: Write the fetch script**

Create `scripts/fetch-design-fonts.mjs`:

```js
// Fetch the WOFF faces the design renderer needs, from fontsource's npm
// tarballs, into public/fonts -- with each family's licence beside it.
//
//   node scripts/fetch-design-fonts.mjs
//
// Run once and COMMIT the output: public/fonts ships in the runtime image
// (Dockerfile copies public/), so the files must be in the repo, not fetched
// at boot. Pinned versions, so a re-run produces identical bytes.
//
// WOFF rather than WOFF2 because satori's font parser reads TTF/OTF/WOFF and
// not WOFF2. fontsource ships both; only the .woff is taken.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const FAMILIES = [
  { pkg: "playfair-display", version: "5.3.0" },
  { pkg: "space-grotesk", version: "5.3.0" },
  { pkg: "manrope", version: "5.3.0" },
  { pkg: "archivo", version: "5.3.0" },
  { pkg: "fraunces", version: "5.3.0" },
];
const WEIGHTS = [400, 500, 600, 700];

const dest = path.join(process.cwd(), "public", "fonts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "design-fonts-"));

for (const { pkg, version } of FAMILIES) {
  const url = `https://registry.npmjs.org/@fontsource/${pkg}/-/${pkg}-${version}.tgz`;
  const tgz = path.join(tmp, `${pkg}.tgz`);
  execFileSync("curl", ["-sSL", "--fail", "-o", tgz, url]);
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  const files = path.join(tmp, "package", "files");
  for (const weight of WEIGHTS) {
    const name = `${pkg}-latin-${weight}-normal.woff`;
    const src = path.join(files, name);
    if (!existsSync(src)) throw new Error(`${pkg}@${version} has no ${name}`);
    copyFileSync(src, path.join(dest, name));
  }
  const licence = path.join(tmp, "package", "LICENSE");
  if (existsSync(licence)) copyFileSync(licence, path.join(dest, `LICENSE-${pkg}.txt`));
  rmSync(path.join(tmp, "package"), { recursive: true, force: true });
  console.log(`fetched ${pkg} ${version}`);
}
rmSync(tmp, { recursive: true, force: true });
```

- [ ] **Step 4: Run it**

Run: `node scripts/fetch-design-fonts.mjs && ls public/fonts | grep -c "normal.woff"`
Expected: five `fetched …` lines, then `20`.

- [ ] **Step 5: Teach fonts.ts the families and their file names**

Replace the block in `src/lib/design/fonts.ts` from `/**\n * Families with real per-weight bytes on disk.` through the end of `loadDesignFonts` with:

```ts
/**
 * Families with real per-weight bytes on disk. Inter ships as the four TTFs
 * it always did; the rest are fontsource WOFFs fetched by
 * scripts/fetch-design-fonts.mjs (satori reads TTF/OTF/WOFF, not WOFF2).
 * Nebula and ClashDisplay also sit in public/fonts but ship as a single file
 * each (a variable axis and two styles), which satori cannot weight-match --
 * adding either means splitting it into static instances first. A design
 * system naming anything not listed here falls back to Inter rather than
 * rendering in a silent default.
 */
export const AVAILABLE_FAMILIES = [
  "Inter",
  "Playfair Display",
  "Space Grotesk",
  "Manrope",
  "Archivo",
  "Fraunces",
] as const;
export type DesignFamily = (typeof AVAILABLE_FAMILIES)[number];

export const DEFAULT_FAMILY: DesignFamily = "Inter";

/** File on disk for a family at a weight. Inter predates the fontsource
 *  naming; everything after it follows fontsource's exactly. */
const FILE: Record<DesignFamily, (weight: number) => string> = {
  Inter: (w) => `Inter-${w}.ttf`,
  "Playfair Display": (w) => `playfair-display-latin-${w}-normal.woff`,
  "Space Grotesk": (w) => `space-grotesk-latin-${w}-normal.woff`,
  Manrope: (w) => `manrope-latin-${w}-normal.woff`,
  Archivo: (w) => `archivo-latin-${w}-normal.woff`,
  Fraunces: (w) => `fraunces-latin-${w}-normal.woff`,
};

export function resolveFamily(family: string | null | undefined): DesignFamily {
  const name = (family ?? "").trim();
  return (AVAILABLE_FAMILIES as readonly string[]).includes(name)
    ? (name as DesignFamily)
    : DEFAULT_FAMILY;
}

export async function loadDesignFonts(
  family: string = DEFAULT_FAMILY,
): Promise<DesignFont[]> {
  const name = resolveFamily(family);
  const hit = cache.get(name);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "public", "fonts");
  const fonts = await Promise.all(
    WEIGHTS.map(async (weight) => ({
      name,
      data: await readFile(path.join(dir, FILE[name](weight))),
      weight,
      style: "normal" as const,
    })),
  );
  cache.set(name, fonts);
  return fonts;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- src/lib/design/fonts.test.ts`
Expected: PASS, `fonts: 28 checks passed`.

Run: `npm test -- src/lib/design/renderDesign.test.ts`
Expected: PASS (Inter still loads through the new map).

- [ ] **Step 7: Commit (fonts included)**

```bash
git add scripts/fetch-design-fonts.mjs public/fonts src/lib/design/fonts.ts src/lib/design/fonts.test.ts
git commit -m "feat(design): five more typefaces for the renderer

Six directions in one typeface would be six colour schemes. Playfair Display,
Space Grotesk, Manrope, Archivo and Fraunces ship as fontsource WOFFs (satori
reads WOFF, not WOFF2), four weights each, licences alongside, fetched by a
pinned script and committed because public/ ships in the image.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The prompt and the renderers use the system's typeface

**Files:**
- Modify: `src/lib/ai/designPost.parse.ts` (`describeSystemForDesign`, `DESIGN_RULES`)
- Modify: `src/lib/ai/designPost.ts:113`
- Modify: `src/app/api/content-studio/carousels/[id]/slide-text/route.ts:73,154`
- Test: `src/lib/ai/designPost.parse.test.ts`

**Interfaces:**
- Consumes: `DesignSystem.font` (Task 1), `loadDesignFonts(family)` (Task 2).

- [ ] **Step 1: Write the failing tests**

In `src/lib/ai/designPost.parse.test.ts`, after the existing `const d = describeSystemForDesign(SYSTEM);` line and its checks, add:

```ts
check("the description names the typeface", d.includes("Typeface: Inter"));
check(
  "and tells the model to set it on every text element",
  d.includes('font-family:"Inter"'),
);
check(
  "the rules no longer hardcode Inter",
  !DESIGN_RULES.includes('font-family is exactly "Inter"'),
);
check(
  "a system in another face is described in that face",
  describeSystemForDesign({ ...SYSTEM, font: "Fraunces" }).includes("Typeface: Fraunces"),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/ai/designPost.parse.test.ts`
Expected: FAIL — `the description names the typeface`.

- [ ] **Step 3: Change the prompt**

In `src/lib/ai/designPost.parse.ts`, inside `describeSystemForDesign`, replace:

```ts
  lines.push(
    "",
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px, margins ${system.grid.margin}px, gutters ${system.grid.gutter}px. Text sits in three or four columns. The empty columns are the calm and are not there to be filled.`,
```

with:

```ts
  lines.push(
    "",
    `Typeface: ${system.font}. Every text element sets font-family:"${system.font}" -- it is the only face the renderer has, and any other name renders in a fallback.`,
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px, margins ${system.grid.margin}px, gutters ${system.grid.gutter}px. Text sits in three or four columns. The empty columns are the calm and are not there to be filled.`,
```

In `DESIGN_RULES`, replace the line:

```
- font-family is exactly "Inter".
```

with:

```
- font-family is exactly the typeface named in the design system above. No other face exists in the renderer.
```

- [ ] **Step 4: Load the right font at every render site**

`src/lib/ai/designPost.ts` line 113 — change `loadDesignFonts("Inter")` to:

```ts
    const fonts = await loadDesignFonts(system.font);
```

`src/app/api/content-studio/carousels/[id]/slide-text/route.ts` — both occurrences of `loadDesignFonts("Inter")` (in GET, ~line 73, and in POST, ~line 154). In GET there is no `system` in scope; use:

```ts
    const fonts = await loadDesignFonts(getDesignSystem()?.font);
```

(`getDesignSystem` is already imported in that file; `loadDesignFonts(undefined)` resolves to Inter.) In POST, `system` is already resolved above the render; use:

```ts
    const fonts = await loadDesignFonts(system.font);
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npm test -- src/lib/ai/designPost.parse.test.ts && npx tsc --noEmit`
Expected: PASS, then no typecheck output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/designPost.parse.ts src/lib/ai/designPost.parse.test.ts src/lib/ai/designPost.ts "src/app/api/content-studio/carousels/[id]/slide-text/route.ts"
git commit -m "feat(design): the prompt and every render use the system's typeface

The rules hardcoded Inter and every render site loaded it. Now the system
names its face, the description tells the model to set it, and the three
places that render a designed slide load that family.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The direction model and `composeDesignSystem`

**Files:**
- Create: `src/lib/design/direction.ts`
- Test: `src/lib/design/direction.test.ts`

**Interfaces:**
- Consumes: `DesignSystem`, `TypeStep`, `TypeLevel`, `ValueRole`, `parseDesignSystem` from `./parse`; `contrastRatio` from `./validate`.
- Produces (exact):
  ```ts
  export interface PaletteSlot { key: string; label: string; role: ValueRole; defaultHex: string; ground?: { share: number; maxRun: number } }
  export interface DesignDirection { id: string; name: string; blurb: string; font: string; slots: PaletteSlot[]; type: Record<TypeLevel, TypeStep>; grid: DesignSystem["grid"]; photo: { saturate: number; contrast: number; brightness: number; wash?: { slot: string; alpha: number } } | null; rules: { minContrastBody: number; minContrastLarge: number; neverType: string[] } }
  export type BrandPalette = Record<string, string>
  export function defaultPalette(direction: DesignDirection): BrandPalette
  export function deriveNeverType(values: { key: string; hex: string; role: ValueRole }[], groundHexes: string[], minContrastLarge: number): string[]
  export function composeDesignSystem(direction: DesignDirection, palette: BrandPalette): DesignSystem
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/design/direction.test.ts`:

```ts
// Run: npm test -- src/lib/design/direction.test.ts
//
// A direction is a design system with the hexes taken out. Composing it with
// a tenant's palette must give back a system the parser accepts, with the
// tenant's colours in the tenant's slots, and with "never type" worked out
// from the contrast maths rather than trusted.
import assert from "node:assert/strict";

import { parseDesignSystem } from "./parse";
import {
  composeDesignSystem,
  defaultPalette,
  deriveNeverType,
  type DesignDirection,
} from "./direction";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A minimal but complete direction. Every number is inside the parser's bounds. */
const FIXTURE: DesignDirection = {
  id: "fixture",
  name: "Fixture",
  blurb: "For tests.",
  font: "Inter",
  slots: [
    { key: "paper", label: "Paper", role: "ground", defaultHex: "#F4F1EA", ground: { share: 0.6, maxRun: 3 } },
    { key: "ink", label: "Ink", role: "type", defaultHex: "#1B1B1B", ground: { share: 0.4, maxRun: 2 } },
    { key: "accent", label: "Accent", role: "accent", defaultHex: "#B0844F" },
    { key: "ghost", label: "Ghost", role: "accent", defaultHex: "#9A9A9A" },
    { key: "reserved", label: "Reserved", role: "reserved", defaultHex: "#26334E" },
  ],
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.6, contrast: 1, brightness: 1, wash: { slot: "accent", alpha: 0.07 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["accent"] },
};

// -- defaultPalette --
const defaults = defaultPalette(FIXTURE);
check("the default palette has one entry per slot", Object.keys(defaults).length === 5);
check("and carries the slot's default hex, lower-cased", defaults.paper === "#f4f1ea");

// -- composeDesignSystem with defaults --
const composed = composeDesignSystem(FIXTURE, defaults);
check("a composed system parses", parseDesignSystem(composed) !== null);
check("it carries the direction's font", composed.font === "Inter");
check("values follow slot order", composed.values.map((v) => v.key).join() === "paper,ink,accent,ghost,reserved");
check("a slot's role becomes the value's role", composed.values.find((v) => v.key === "ink")?.role === "type");
check("only slots with a budget become grounds", composed.grounds.map((g) => g.value).join() === "paper,ink");
check("and the budget is copied", composed.grounds[0].share === 0.6 && composed.grounds[0].maxRun === 3);
check("the photo wash resolves its slot to a hex", composed.photo?.wash?.hex === "#b0844f");
check("type, grid and contrast floors come through untouched", composed.type.display.size === 84 && composed.grid.columns === 6 && composed.rules.minContrastBody === 4.5);

// -- the tenant's palette wins --
const mine = composeDesignSystem(FIXTURE, { ...defaults, paper: "#FFFFFF", accent: "#C0392B" });
check("a tenant hex replaces the default", mine.values.find((v) => v.key === "paper")?.hex === "#ffffff");
check("and is lower-cased", mine.values.find((v) => v.key === "accent")?.hex === "#c0392b");
check("the wash follows the tenant's accent", mine.photo?.wash?.hex === "#c0392b");
check("a slot the palette omits falls back to the default", composeDesignSystem(FIXTURE, { paper: "#ffffff" }).values.find((v) => v.key === "ink")?.hex === "#1b1b1b");

// -- neverType: explicit AND derived --
//
// The direction's own list is kept (a brand can forbid a colour as type for
// reasons the maths cannot see -- Optimal Health's timber passes on ink and
// is still forbidden). On top of it, any value that fails the LARGE floor
// against EVERY ground is added, because a colour that cannot be read on any
// background is not a type colour whatever anyone says.
check("the explicit never-type is kept", composed.rules.neverType.includes("accent"));
check("a mid-grey that fails on every ground is derived", composed.rules.neverType.includes("ghost"));
check("ink, which passes on paper, is not", !composed.rules.neverType.includes("ink"));
check("reserved values are never listed", !composed.rules.neverType.includes("reserved"));
check("nothing is listed twice", new Set(composed.rules.neverType).size === composed.rules.neverType.length);

check(
  "deriveNeverType alone: a colour readable on one ground is fine",
  !deriveNeverType(
    [{ key: "x", hex: "#1b1b1b", role: "type" }],
    ["#ffffff", "#1b1b1b"],
    3,
  ).includes("x"),
);
check(
  "deriveNeverType alone: a colour readable on no ground is out",
  deriveNeverType(
    [{ key: "x", hex: "#9a9a9a", role: "type" }],
    ["#f4f1ea", "#1b1b1b"],
    3,
  ).includes("x"),
);

// -- a direction with no photo grade composes to photo: null --
check("no photo grade stays null", composeDesignSystem({ ...FIXTURE, photo: null }, defaults).photo === null);

console.log(`\ndirection: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/direction.test.ts`
Expected: FAIL — cannot find module `./direction`.

- [ ] **Step 3: Write the module**

Create `src/lib/design/direction.ts`:

```ts
/**
 * A design DIRECTION is a design system with the hexes taken out.
 *
 * Everything that makes "Sage Field" feel like Sage Field -- its typeface, its
 * type scale, its grid, how often each ground may appear, its photo grade, its
 * contrast floors -- is structural, and none of it is a colour. The colours
 * are the one part that has to be the tenant's own, or every client on the
 * same direction looks identical, which is the templated look the composed
 * post work exists to escape, moved up a level from layout to brand.
 *
 * So a direction declares named palette SLOTS, each with a role and a default,
 * and the tenant supplies a hex per slot. `composeDesignSystem` fills the
 * slots and returns an ordinary DesignSystem -- the thing the prompt, the
 * audit and the renderer already read. Nothing downstream knows directions
 * exist.
 *
 * ZERO RUNTIME IMPORTS beyond the sibling pure modules (see ./parse.ts): this
 * runs in the pure test runner and in the browser.
 */
import type { DesignSystem, TypeLevel, TypeStep, ValueRole } from "./parse";
import { contrastRatio } from "./validate";

export interface PaletteSlot {
  /** Becomes the value key in the composed system. */
  key: string;
  /** Shown to the operator beside the swatch. Says what the slot is FOR. */
  label: string;
  role: ValueRole;
  /** The hex used until the tenant chooses one -- the direction's own look. */
  defaultHex: string;
  /** Present on slots that may be a slide's background, with the budget. */
  ground?: { share: number; maxRun: number };
}

export interface DesignDirection {
  id: string;
  name: string;
  /** One sentence for the picker. */
  blurb: string;
  /** Must be a family in lib/design/fonts.ts AVAILABLE_FAMILIES. */
  font: string;
  slots: PaletteSlot[];
  type: Record<TypeLevel, TypeStep>;
  grid: DesignSystem["grid"];
  photo: {
    saturate: number;
    contrast: number;
    brightness: number;
    /** A wash in a SLOT's colour, resolved to that tenant's hex at compose time. */
    wash?: { slot: string; alpha: number };
  } | null;
  rules: {
    minContrastBody: number;
    minContrastLarge: number;
    /** Slot keys forbidden as type whatever the maths says. The derived list
     *  (see deriveNeverType) is added on top of this, never instead of it. */
    neverType: string[];
  };
}

/** Slot key -> hex. What the tenant chose. */
export type BrandPalette = Record<string, string>;

/** The direction's own look: every slot at its default. */
export function defaultPalette(direction: DesignDirection): BrandPalette {
  const out: BrandPalette = {};
  for (const s of direction.slots) out[s.key] = s.defaultHex.toLowerCase();
  return out;
}

/**
 * Values that cannot be read on ANY ground: below the large-text floor
 * against every one. A colour like that is not a type colour whatever the
 * author intended, and finding it by arithmetic is what lets a tenant swap in
 * a palette without a designer re-checking every pairing by hand.
 *
 * Reserved values are skipped: they are never type by definition and listing
 * them would be noise.
 */
export function deriveNeverType(
  values: { key: string; hex: string; role: ValueRole }[],
  groundHexes: string[],
  minContrastLarge: number,
): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v.role === "reserved") continue;
    const readableSomewhere = groundHexes.some((g) => {
      const r = contrastRatio(v.hex, g);
      return !Number.isNaN(r) && r >= minContrastLarge;
    });
    if (!readableSomewhere) out.push(v.key);
  }
  return out;
}

/**
 * Fill a direction's slots with a palette and return the DesignSystem.
 *
 * Any slot the palette does not name takes the direction's default, so a
 * partial palette is always a complete system. Hexes are lower-cased to
 * match what the parser stores.
 */
export function composeDesignSystem(
  direction: DesignDirection,
  palette: BrandPalette,
): DesignSystem {
  const hexFor = (slot: PaletteSlot): string =>
    (palette[slot.key] ?? slot.defaultHex).trim().toLowerCase();

  const values = direction.slots.map((s) => ({ key: s.key, hex: hexFor(s), role: s.role }));
  const grounds = direction.slots
    .filter((s) => s.ground)
    .map((s) => ({ value: s.key, share: s.ground!.share, maxRun: s.ground!.maxRun }));
  const groundHexes = grounds.map((g) => values.find((v) => v.key === g.value)!.hex);

  let photo: DesignSystem["photo"] = null;
  if (direction.photo) {
    photo = {
      saturate: direction.photo.saturate,
      contrast: direction.photo.contrast,
      brightness: direction.photo.brightness,
    };
    if (direction.photo.wash) {
      const slot = direction.slots.find((s) => s.key === direction.photo!.wash!.slot);
      if (slot) photo.wash = { hex: hexFor(slot), alpha: direction.photo.wash.alpha };
    }
  }

  const derived = deriveNeverType(values, groundHexes, direction.rules.minContrastLarge);
  const neverType = [...direction.rules.neverType];
  for (const key of derived) if (!neverType.includes(key)) neverType.push(key);

  return {
    version: 1,
    font: direction.font,
    values,
    grounds,
    type: direction.type,
    grid: direction.grid,
    photo,
    rules: {
      minContrastBody: direction.rules.minContrastBody,
      minContrastLarge: direction.rules.minContrastLarge,
      neverType,
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/design/direction.test.ts`
Expected: PASS, `direction: 22 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/direction.ts src/lib/design/direction.test.ts
git commit -m "feat(design): a direction is a design system with the hexes taken out

Typeface, scale, grid, rotation budgets, photo grade and contrast floors are
structural; the colours are the one part that must be the tenant's own, or
every client on a direction looks identical. Slots with roles and defaults,
composed with a palette into an ordinary DesignSystem, and never-type worked
out from the contrast maths on top of what the direction declares.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The six directions

**Files:**
- Create: `src/lib/design/directions.ts`
- Test: `src/lib/design/directions.test.ts`

**Interfaces:**
- Consumes: `DesignDirection`, `composeDesignSystem`, `defaultPalette` (Task 4); `OPTIMAL_HEALTH_DESIGN_SYSTEM` (presets); `defaultTypeValue` (validate); `AVAILABLE_FAMILIES` (fonts, test only).
- Produces: `export const DESIGN_DIRECTIONS: DesignDirection[]`, `export function getDirection(id: string): DesignDirection | null`, `export const SAGE_FIELD: DesignDirection`.

The hexes below were checked by hand against the WCAG maths for the one pairing that matters per direction (the darkest ground vs its best type value ≥ 4.5:1); the test re-checks every ground of every direction so a transcription slip fails loudly and names the direction and ground.

- [ ] **Step 1: Write the failing test**

Create `src/lib/design/directions.test.ts`:

```ts
// Run: npm test -- src/lib/design/directions.test.ts
//
// The six authored directions. Each must compose, at its own defaults, to a
// system the parser accepts and that can actually set readable type on every
// ground it declares -- a direction that fails that is a direction nobody
// should be able to pick. And Sage Field must reproduce Optimal Health's
// hand-authored system exactly: it IS that system, with the hexes lifted out.
import assert from "node:assert/strict";

import { AVAILABLE_FAMILIES } from "./fonts";
import { parseDesignSystem } from "./parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM } from "./presets";
import { defaultTypeValue } from "./validate";
import { composeDesignSystem, defaultPalette } from "./direction";
import { DESIGN_DIRECTIONS, SAGE_FIELD, getDirection } from "./directions";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check("there are six directions", DESIGN_DIRECTIONS.length === 6);
check("ids are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.id)).size === 6);
check("names are unique", new Set(DESIGN_DIRECTIONS.map((d) => d.name)).size === 6);
check("no two directions share a typeface", new Set(DESIGN_DIRECTIONS.map((d) => d.font)).size === 6);
check("getDirection finds by id", getDirection("sage-field") === SAGE_FIELD);
check("getDirection is null for an unknown id", getDirection("nope") === null);

for (const d of DESIGN_DIRECTIONS) {
  check(`${d.name}: font is one the renderer has`, (AVAILABLE_FAMILIES as readonly string[]).includes(d.font));
  check(`${d.name}: at least two grounds`, d.slots.filter((s) => s.ground).length >= 2);
  check(`${d.name}: every wash names a real slot`, !d.photo?.wash || d.slots.some((s) => s.key === d.photo!.wash!.slot));
  check(`${d.name}: every explicit never-type names a real slot`, d.rules.neverType.every((k) => d.slots.some((s) => s.key === k)));

  const system = composeDesignSystem(d, defaultPalette(d));
  const parsed = parseDesignSystem(system);
  check(`${d.name}: composes to a system the parser accepts`, parsed !== null);

  for (const g of system.grounds) {
    const hex = system.values.find((v) => v.key === g.value)!.hex;
    const type = defaultTypeValue(system, hex);
    assert.ok(type, `${d.name}: no type value at all for ground ${g.value}`);
    assert.ok(
      type.ratio >= system.rules.minContrastBody,
      `${d.name}: ground ${g.value} (${hex}) has no body-legible type -- best is ${type.key} at ${type.ratio.toFixed(2)}:1`,
    );
  }
  check(`${d.name}: every ground can carry body text`, true);
}

// Sage Field IS Optimal Health's system. Compared in a canonical form: the
// composed system lists values and grounds in SLOT order, the hand-authored
// preset in the order the brand document happened to state them, and order
// carries no meaning in either (the parser and every consumer look things up
// by key). Same data, so sort before comparing.
function canonical(system: ReturnType<typeof parseDesignSystem>) {
  assert.ok(system, "system must parse");
  return JSON.stringify({
    ...system,
    values: [...system.values].sort((a, b) => a.key.localeCompare(b.key)),
    grounds: [...system.grounds].sort((a, b) => a.value.localeCompare(b.value)),
    rules: { ...system.rules, neverType: [...system.rules.neverType].sort() },
  });
}
const sage = composeDesignSystem(SAGE_FIELD, defaultPalette(SAGE_FIELD));
check(
  "Sage Field at its defaults reproduces Optimal Health exactly",
  canonical(parseDesignSystem(sage)) === canonical(parseDesignSystem(OPTIMAL_HEALTH_DESIGN_SYSTEM)),
);

console.log(`\ndirections: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/directions.test.ts`
Expected: FAIL — cannot find module `./directions`.

- [ ] **Step 3: Author the directions**

Create `src/lib/design/directions.ts`:

```ts
/**
 * The six authored design directions. Data only, zero runtime imports.
 *
 * Each is a transcription of a set of decisions someone made and then LOOKED
 * AT as rendered slides -- not a palette with a name on it. The defaults are
 * the direction's own look for the picker; a tenant replaces them slot by
 * slot with their brand colours and the structure stays.
 *
 * SAGE_FIELD is Optimal Health's system with the hexes lifted into slots, and
 * directions.test.ts pins that it composes back to the hand-authored preset
 * byte for byte. The other five are distinct in TYPEFACE and STRUCTURE, not
 * just colour -- six directions in one face would be six colour schemes.
 *
 * Shares are ceilings (fraction of a set) and need not sum to 1; maxRun is
 * how many consecutive slides may carry that ground.
 */
import type { DesignDirection } from "./direction";

export const SAGE_FIELD: DesignDirection = {
  id: "sage-field",
  name: "Sage Field",
  blurb: "Calm, clinical warmth. Plaster and sage grounds, ink type, a timber accent that is never text.",
  font: "Inter",
  slots: [
    { key: "sage", label: "Signature ground", role: "ground", defaultHex: "#c7d2bb", ground: { share: 0.33, maxRun: 1 } },
    { key: "ink", label: "Type, and the anchor ground", role: "type", defaultHex: "#24231f", ground: { share: 0.17, maxRun: 2 } },
    { key: "plaster", label: "Main ground", role: "ground", defaultHex: "#f2f3ed", ground: { share: 0.5, maxRun: 3 } },
    { key: "timber", label: "Accent (rules and fills, never text)", role: "accent", defaultHex: "#b0844f" },
    { key: "deep-green", label: "Secondary type", role: "type", defaultHex: "#5e6b4e" },
    { key: "navy", label: "Reserved (signage only)", role: "reserved", defaultHex: "#26334e" },
  ],
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.52, contrast: 0.9, brightness: 1.06, wash: { slot: "timber", alpha: 0.07 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["timber"] },
};

export const EDITORIAL: DesignDirection = {
  id: "editorial",
  name: "Editorial",
  blurb: "Magazine serif at scale. Paper and a warm tint, ink type, a deep red accent used sparingly.",
  font: "Playfair Display",
  slots: [
    { key: "paper", label: "Main ground", role: "ground", defaultHex: "#f5f1e8", ground: { share: 0.55, maxRun: 4 } },
    { key: "tint", label: "Second ground", role: "ground", defaultHex: "#e6dccb", ground: { share: 0.25, maxRun: 2 } },
    { key: "ink", label: "Type, and the dark ground", role: "type", defaultHex: "#1a1a1a", ground: { share: 0.2, maxRun: 1 } },
    { key: "accent", label: "Accent", role: "accent", defaultHex: "#8b2c2c" },
  ],
  type: {
    display: { size: 96, leading: 0.94, tracking: -0.02, weight: 600 },
    headline: { size: 68, leading: 1.0, tracking: -0.015, weight: 500 },
    subhead: { size: 32, leading: 1.25, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.12, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 80, gutter: 24, field: 1080 },
  photo: { saturate: 0.7, contrast: 1.0, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const BOLD: DesignDirection = {
  id: "bold",
  name: "Bold",
  blurb: "Oversized grotesk, black and white, one signal colour. Loud at thumbnail size.",
  font: "Archivo",
  slots: [
    { key: "black", label: "Main ground, and type on light", role: "ground", defaultHex: "#0a0a0a", ground: { share: 0.5, maxRun: 3 } },
    { key: "white", label: "Light ground, and type on dark", role: "ground", defaultHex: "#ffffff", ground: { share: 0.35, maxRun: 2 } },
    { key: "signal", label: "Signal colour (accent, and an occasional ground)", role: "accent", defaultHex: "#ffd400", ground: { share: 0.15, maxRun: 1 } },
  ],
  type: {
    display: { size: 120, leading: 0.9, tracking: -0.04, weight: 700 },
    headline: { size: 76, leading: 0.96, tracking: -0.03, weight: 700 },
    subhead: { size: 32, leading: 1.2, tracking: -0.01, weight: 600 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 500 },
    label: { size: 16, leading: 1, tracking: 0.16, weight: 700, upper: true },
  },
  grid: { columns: 4, margin: 64, gutter: 24, field: 1080 },
  photo: { saturate: 0.3, contrast: 1.15, brightness: 0.95, wash: { slot: "black", alpha: 0.1 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const CLINICAL: DesignDirection = {
  id: "clinical",
  name: "Clinical",
  blurb: "Soft, precise, medical without being cold. Cloud and mist grounds, slate type, a teal signal.",
  font: "Manrope",
  slots: [
    { key: "cloud", label: "Main ground", role: "ground", defaultHex: "#f4f6f5", ground: { share: 0.6, maxRun: 4 } },
    { key: "mist", label: "Second ground", role: "ground", defaultHex: "#dfe7e4", ground: { share: 0.25, maxRun: 2 } },
    { key: "slate", label: "Type, and the dark ground", role: "type", defaultHex: "#1f2a2e", ground: { share: 0.15, maxRun: 1 } },
    { key: "deep", label: "Secondary type", role: "type", defaultHex: "#0f3b3a" },
    { key: "signal", label: "Accent", role: "accent", defaultHex: "#2f7f6f" },
  ],
  type: {
    display: { size: 80, leading: 0.98, tracking: -0.03, weight: 600 },
    headline: { size: 60, leading: 1.04, tracking: -0.02, weight: 600 },
    subhead: { size: 28, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 21, leading: 1.55, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.18, weight: 600, upper: true },
  },
  grid: { columns: 8, margin: 72, gutter: 24, field: 1080 },
  photo: { saturate: 0.6, contrast: 0.95, brightness: 1.08, wash: { slot: "mist", alpha: 0.06 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const SWISS: DesignDirection = {
  id: "swiss",
  name: "Swiss",
  blurb: "Grid, grotesk, red. Monochrome photography, black type, white ground, one hard accent.",
  font: "Space Grotesk",
  slots: [
    { key: "white", label: "Main ground", role: "ground", defaultHex: "#ffffff", ground: { share: 0.5, maxRun: 3 } },
    { key: "black", label: "Type, and the dark ground", role: "type", defaultHex: "#111111", ground: { share: 0.3, maxRun: 2 } },
    { key: "red", label: "Accent, and an occasional ground", role: "accent", defaultHex: "#c8001a", ground: { share: 0.2, maxRun: 1 } },
    { key: "grey", label: "Secondary type", role: "type", defaultHex: "#6b6b6b" },
  ],
  type: {
    display: { size: 100, leading: 0.92, tracking: -0.04, weight: 500 },
    headline: { size: 64, leading: 1.0, tracking: -0.03, weight: 500 },
    subhead: { size: 30, leading: 1.25, tracking: -0.01, weight: 500 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.1, weight: 500, upper: true },
  },
  grid: { columns: 12, margin: 60, gutter: 20, field: 1080 },
  photo: { saturate: 0, contrast: 1.1, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const WARM: DesignDirection = {
  id: "warm",
  name: "Warm",
  blurb: "Soft serif, cream and cocoa, terracotta. Feels like a good kitchen.",
  font: "Fraunces",
  slots: [
    { key: "cream", label: "Main ground", role: "ground", defaultHex: "#f7efe4", ground: { share: 0.5, maxRun: 3 } },
    { key: "terracotta", label: "Accent, and a warm ground", role: "accent", defaultHex: "#a34a2a", ground: { share: 0.3, maxRun: 1 } },
    { key: "cocoa", label: "Type, and the dark ground", role: "type", defaultHex: "#3b2a22", ground: { share: 0.2, maxRun: 2 } },
    { key: "olive", label: "Secondary type", role: "type", defaultHex: "#5c6b3a" },
  ],
  type: {
    display: { size: 88, leading: 0.96, tracking: -0.02, weight: 500 },
    headline: { size: 62, leading: 1.04, tracking: -0.01, weight: 500 },
    subhead: { size: 30, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.14, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.8, contrast: 0.95, brightness: 1.05, wash: { slot: "terracotta", alpha: 0.08 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

export const DESIGN_DIRECTIONS: DesignDirection[] = [SAGE_FIELD, EDITORIAL, BOLD, CLINICAL, SWISS, WARM];

export function getDirection(id: string): DesignDirection | null {
  return DESIGN_DIRECTIONS.find((d) => d.id === id) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/design/directions.test.ts`
Expected: PASS. If a `ground … has no body-legible type` assertion fires, the message names the direction, the ground and the best ratio: darken that ground's `defaultHex` (or lighten it, if its type is light) until the ratio clears 4.5, re-run, and keep the new hex.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/directions.ts src/lib/design/directions.test.ts
git commit -m "feat(design): six authored directions

Sage Field is Optimal Health's system with the hexes lifted into slots, and
the test pins that it composes back to the preset exactly. Editorial, Bold,
Clinical, Swiss and Warm differ in typeface and structure, not just colour.
Every ground of every direction is checked for body-legible type at its
defaults, so a slip fails naming the direction and the ground.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Storing a tenant's choice and applying it

**Files:**
- Create: `src/lib/design/directionStore.ts`
- Test: `src/lib/design/directionStore.test.ts`

**Interfaces:**
- Consumes: `readKey`, `setKey`, `deleteKey` from `@/lib/settings`; `getDesignSystem`, `setDesignSystem` from `./system`; `getDirection` (Task 5); `composeDesignSystem`, `BrandPalette` (Task 4); `parseDesignSystem`.
- Produces (exact):
  ```ts
  export const DESIGN_DIRECTION_KEY = "design_direction"
  export interface StoredDirection { directionId: string; palette: BrandPalette }
  export type DesignStatus = { kind: "none" } | { kind: "custom" } | { kind: "direction"; directionId: string; palette: BrandPalette }
  export function getStoredDirection(): StoredDirection | null
  export function designStatus(): DesignStatus
  export function applyDesignDirection(directionId: string, palette: BrandPalette): { ok: true } | { ok: false; error: string }
  export function clearDesignDirection(): void
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/design/directionStore.test.ts`:

```ts
// Run: npm test -- src/lib/design/directionStore.test.ts
//
// Applying a direction writes TWO things: the choice (direction + palette, so
// the page can show it and the operator can adjust it) and the composed
// system under the key every consumer already reads. Clearing removes both.
// A hand-authored system with no recorded choice reads as "custom" and is
// never touched -- that is Optimal Health in production today.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { getDesignSystem, setDesignSystem } = requireLocal("./system") as typeof import("./system");
  const { OPTIMAL_HEALTH_DESIGN_SYSTEM } = requireLocal("./presets") as typeof import("./presets");
  const { applyDesignDirection, clearDesignDirection, designStatus, getStoredDirection } =
    requireLocal("./directionStore") as typeof import("./directionStore");

  const slug = "direction-store-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const abs = path.join(process.cwd(), "data", dbFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Direction Store Test", dbFile) as { id: number };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  };

  try {
    runWithTenant(t.id, () => {
      assert.deepEqual(designStatus(), { kind: "none" }, "a fresh tenant has no design");
      assert.equal(getStoredDirection(), null);

      // A hand-authored system with no choice recorded is CUSTOM, and stays.
      setDesignSystem(OPTIMAL_HEALTH_DESIGN_SYSTEM);
      assert.deepEqual(designStatus(), { kind: "custom" }, "a hand-authored system reads as custom");

      // Apply a direction with a tenant palette.
      const r = applyDesignDirection("swiss", { red: "#B00020" });
      assert.deepEqual(r, { ok: true });
      const status = designStatus();
      assert.equal(status.kind, "direction");
      assert.equal((status as { directionId: string }).directionId, "swiss");
      assert.equal((status as { palette: Record<string, string> }).palette.red, "#b00020", "the palette is stored lower-cased");

      const system = getDesignSystem();
      assert.ok(system, "the composed system is stored where every consumer reads it");
      assert.equal(system!.font, "Space Grotesk");
      assert.equal(system!.values.find((v) => v.key === "red")?.hex, "#b00020", "the tenant's hex is in the system");
      assert.equal(system!.values.find((v) => v.key === "white")?.hex, "#ffffff", "unnamed slots took the default");

      // Bad input is refused, and nothing changes.
      assert.deepEqual(applyDesignDirection("nope", {}), { ok: false, error: "Unknown design direction." });
      assert.equal(applyDesignDirection("swiss", { red: "not a colour" }).ok, false, "a bad hex is refused");
      assert.equal(getDesignSystem()!.values.find((v) => v.key === "red")?.hex, "#b00020", "a refused apply changed nothing");

      // Clearing removes both.
      clearDesignDirection();
      assert.deepEqual(designStatus(), { kind: "none" });
      assert.equal(getDesignSystem(), null, "the system is gone too -- back to templates");
    });
    console.log("directionStore.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/directionStore.test.ts`
Expected: FAIL — cannot find module `./directionStore`.

- [ ] **Step 3: Write the store**

Create `src/lib/design/directionStore.ts`:

```ts
import "server-only";

import { deleteKey, readKey, setKey } from "@/lib/settings";
import { composeDesignSystem, type BrandPalette } from "./direction";
import { getDirection } from "./directions";
import { parseDesignSystem } from "./parse";
import { getDesignSystem, setDesignSystem } from "./system";

/**
 * A tenant's chosen direction and palette, and the act of applying them.
 *
 * Two keys, on purpose. `design_direction` holds the CHOICE -- which direction
 * and which hexes -- so the settings page can show it back and the operator
 * can adjust one swatch without re-choosing everything. `design_system` holds
 * the COMPOSED result, under the key the prompt, the audit and the renderer
 * already read; nothing downstream knows directions exist. Applying writes
 * both, atomically enough for a settings page: the composed system is written
 * last, so a failure part-way leaves the old system in place.
 *
 * A stored system with NO recorded choice is a hand-authored one (Optimal
 * Health today) and reads as "custom". This module never writes over it
 * unless an operator explicitly applies a direction.
 */

export const DESIGN_DIRECTION_KEY = "design_direction";

export interface StoredDirection {
  directionId: string;
  palette: BrandPalette;
}

export type DesignStatus =
  | { kind: "none" }
  | { kind: "custom" }
  | { kind: "direction"; directionId: string; palette: BrandPalette };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function getStoredDirection(): StoredDirection | null {
  const raw = readKey<unknown>(DESIGN_DIRECTION_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { directionId?: unknown; palette?: unknown };
  if (typeof o.directionId !== "string" || !getDirection(o.directionId)) return null;
  const palette: BrandPalette = {};
  if (o.palette && typeof o.palette === "object") {
    for (const [k, v] of Object.entries(o.palette as Record<string, unknown>)) {
      if (typeof v === "string" && HEX.test(v)) palette[k] = v.toLowerCase();
    }
  }
  return { directionId: o.directionId, palette };
}

export function designStatus(): DesignStatus {
  const stored = getStoredDirection();
  if (stored) return { kind: "direction", ...stored };
  return getDesignSystem() ? { kind: "custom" } : { kind: "none" };
}

/**
 * Compose and store. Refuses an unknown direction or a malformed hex and, on
 * refusal, changes nothing. Bounds-checked here, not in the route or the
 * action, so every caller gets the same guarantee.
 */
export function applyDesignDirection(
  directionId: string,
  palette: BrandPalette,
): { ok: true } | { ok: false; error: string } {
  const direction = getDirection(directionId);
  if (!direction) return { ok: false, error: "Unknown design direction." };

  const clean: BrandPalette = {};
  for (const slot of direction.slots) {
    const v = palette[slot.key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !HEX.test(v.trim())) {
      return { ok: false, error: `"${slot.label}" needs a six-digit hex colour.` };
    }
    clean[slot.key] = v.trim().toLowerCase();
  }

  const system = parseDesignSystem(composeDesignSystem(direction, clean));
  if (!system) return { ok: false, error: "That combination doesn't compose to a valid design system." };

  setKey(DESIGN_DIRECTION_KEY, { directionId, palette: clean });
  setDesignSystem(system);
  return { ok: true };
}

/** Back to fixed templates: both the choice and the composed system go. */
export function clearDesignDirection(): void {
  deleteKey(DESIGN_DIRECTION_KEY);
  setDesignSystem(null);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/design/directionStore.test.ts`
Expected: PASS, `directionStore.test.ts: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/directionStore.ts src/lib/design/directionStore.test.ts
git commit -m "feat(design): store a tenant's direction and apply it

Two keys: the choice, so the page can show it back and one swatch can be
adjusted; and the composed system under the key every consumer already reads.
A hand-authored system with no recorded choice reads as custom and is never
written over unless an operator applies a direction.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Sample slides and the preview route

**Files:**
- Create: `src/lib/design/sampleSlides.ts`
- Create: `src/app/api/content-studio/design-direction/preview/route.ts`
- Test: `src/lib/design/renderDesign.test.ts` (append)

**Interfaces:**
- Consumes: `DesignSystem`, `defaultTypeValue` (validate), `composeDesignSystem`, `getDirection`, `loadDesignFonts`, `renderDesignToPng`, `guard`.
- Produces: `export function sampleSlides(system: DesignSystem): string[]` (three HTML strings for a 1080x1080 canvas); `POST /api/content-studio/design-direction/preview` with body `{ directionId: string; palette: Record<string,string> }` returning `{ ok: true; slides: string[] }` (PNG data URIs, 540px) or `{ ok: false; error: string }`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/design/renderDesign.test.ts`, before the final `console.log`:

```ts
  // ── sample slides: the preview a tenant judges a direction by ──
  //
  // Three fixed compositions, no model call, rendered with the system's own
  // font, grounds and type. They must render for the hand-authored system
  // (fonts and rules known-good) so that a direction that fails to preview is
  // the direction's fault, not the sample's.
  const samples = sampleSlides(OPTIMAL_HEALTH_DESIGN_SYSTEM);
  check("three sample slides", samples.length === 3);
  check("every sample names the system's font", samples.every((s) => s.includes(`font-family:${OPTIMAL_HEALTH_DESIGN_SYSTEM.font}`)));
  check("the samples use the system's grounds", samples.some((s) => s.includes("#c7d2bb")) && samples.some((s) => s.includes("#f2f3ed")));
  for (const [i, html] of samples.entries()) {
    const png = await renderDesignToPng(html, 1080, 1080, fonts);
    check(`sample ${i + 1} renders`, png.length > 0);
    check(`sample ${i + 1} fits the canvas`, (await measureOverflowPx(html, 1080, 1080, fonts)) === 0);
  }
```

And add to the imports at the top of that file:

```ts
import { OPTIMAL_HEALTH_DESIGN_SYSTEM } from "./presets";
import { sampleSlides } from "./sampleSlides";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/renderDesign.test.ts`
Expected: FAIL — cannot find module `./sampleSlides`.

- [ ] **Step 3: Write the sample slides**

Create `src/lib/design/sampleSlides.ts`:

```ts
/**
 * Three fixed sample slides for previewing a design system. Pure: no model
 * call, no DB. The point of a preview is that the operator judges the
 * direction with THEIR colours, as rendered slides, before it starts shaping
 * every post -- numbers on a settings page tell nobody what a headline will
 * look like at feed size.
 *
 * The compositions are deliberately plain so what varies between directions
 * is the direction: the typeface, the scale, the grounds, the accent. They
 * follow the same satori rules the prompt enforces (containers flex, text
 * leaves not, explicit widths, nothing in the top-right logo corner).
 */
import type { DesignSystem, TypeLevel } from "./parse";
import { defaultTypeValue } from "./validate";

const W = 1080;
const H = 1080;

function css(system: DesignSystem, level: TypeLevel, colour: string): string {
  const t = system.type[level];
  return (
    `font-family:${system.font};font-size:${t.size}px;line-height:${t.leading};` +
    `letter-spacing:${t.tracking}em;font-weight:${t.weight};color:${colour};` +
    (t.upper ? "text-transform:uppercase;" : "")
  );
}

function groundHex(system: DesignSystem, i: number): string {
  const g = system.grounds[i % system.grounds.length];
  return system.values.find((v) => v.key === g.value)!.hex;
}

function typeOn(system: DesignSystem, ground: string): string {
  return defaultTypeValue(system, ground)?.hex ?? "#000000";
}

function accentHex(system: DesignSystem): string {
  return (
    system.values.find((v) => v.role === "accent")?.hex ??
    system.values.find((v) => v.role === "type")?.hex ??
    "#000000"
  );
}

export function sampleSlides(system: DesignSystem): string[] {
  const m = system.grid.margin;
  const textWidth = W - m * 2 - 200; // keeps the top-right corner clear
  const g0 = groundHex(system, 0);
  const g1 = groundHex(system, 1);
  const g2 = groundHex(system, 2);
  const accent = accentHex(system);

  // 1. Display heading anchored low, quiet space above.
  const one =
    `<div style="display:flex;flex-direction:column;justify-content:flex-end;position:relative;width:${W}px;height:${H}px;background:${g0};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "label", accent)}">Recovery</span>` +
    `<span style="width:${textWidth}px;margin-top:20px;${css(system, "display", typeOn(system, g0))}">The pressure does the work, not the oxygen.</span>` +
    `</div>`;

  // 2. Headline with a rule and body on the second ground.
  const two =
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${g1};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "headline", typeOn(system, g1))}">Three sessions a week is not better than two.</span>` +
    `<div style="display:flex;width:120px;height:6px;margin-top:36px;background:${accent};"></div>` +
    `<span style="width:${textWidth}px;margin-top:36px;${css(system, "body", typeOn(system, g1))}">Adaptation needs the gap between sessions. Stack them and the body never gets the chance to respond to the first one before the second arrives.</span>` +
    `</div>`;

  // 3. Subhead list on the third ground (or the first again for a two-ground system).
  const three =
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${g2};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "label", typeOn(system, g2))}">What changes</span>` +
    `<span style="width:${textWidth}px;margin-top:32px;${css(system, "subhead", typeOn(system, g2))}">Blood flow to tissue that red cells struggle to reach</span>` +
    `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", typeOn(system, g2))}">Muscle tension, through the nervous system's response to touch</span>` +
    `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", typeOn(system, g2))}">Sleep, which is where most of the recovery actually happens</span>` +
    `</div>`;

  return [one, two, three];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/design/renderDesign.test.ts`
Expected: PASS, six new checks green (`renderDesign: 19 checks passed`).

- [ ] **Step 5: Write the preview route**

Create `src/app/api/content-studio/design-direction/preview/route.ts`:

```ts
import { NextResponse } from "next/server";
import sharp from "sharp";

import { guard } from "@/lib/api/guard";
import { composeDesignSystem, type BrandPalette } from "@/lib/design/direction";
import { getDirection } from "@/lib/design/directions";
import { loadDesignFonts } from "@/lib/design/fonts";
import { parseDesignSystem } from "@/lib/design/parse";
import { renderDesignToPng } from "@/lib/design/renderDesign";
import { sampleSlides } from "@/lib/design/sampleSlides";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Preview a direction with a palette: three sample slides, rendered through
 * the real renderer with the real fonts, returned as small PNGs. Not metered
 * and no model call -- this is what the operator looks at BEFORE anything is
 * saved, and it must be free to look as many times as it takes.
 */
export async function POST(req: Request) {
  const denied = await guard("admin");
  if (denied) return denied;

  let body: { directionId?: unknown; palette?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const direction = typeof body.directionId === "string" ? getDirection(body.directionId) : null;
  if (!direction) return NextResponse.json({ ok: false, error: "Unknown design direction." }, { status: 400 });

  const palette: BrandPalette = {};
  if (body.palette && typeof body.palette === "object") {
    for (const [k, v] of Object.entries(body.palette as Record<string, unknown>)) {
      if (typeof v === "string" && HEX.test(v.trim())) palette[k] = v.trim().toLowerCase();
    }
  }

  const system = parseDesignSystem(composeDesignSystem(direction, palette));
  if (!system) return NextResponse.json({ ok: false, error: "That combination doesn't compose." }, { status: 400 });

  try {
    const fonts = await loadDesignFonts(system.font);
    const slides = await Promise.all(
      sampleSlides(system).map(async (html) => {
        const png = await renderDesignToPng(html, 1080, 1080, fonts);
        const small = await sharp(png).resize(540, 540).png().toBuffer();
        return `data:image/png;base64,${small.toString("base64")}`;
      }),
    );
    return NextResponse.json({ ok: true, slides });
  } catch (err) {
    console.error("[design-direction preview] render failed:", err);
    return NextResponse.json({ ok: false, error: "The preview couldn't be rendered." }, { status: 500 });
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/sampleSlides.ts src/lib/design/renderDesign.test.ts src/app/api/content-studio/design-direction/preview/route.ts
git commit -m "feat(design): preview a direction as rendered slides

Three fixed compositions, no model call, rendered through the real renderer
with the real fonts and the tenant's colours. Numbers on a settings page tell
nobody what a headline looks like at feed size; this does, before anything is
saved, and it is free to look as many times as it takes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The settings page

**Files:**
- Create: `src/app/settings/design/actions.ts`
- Create: `src/app/settings/design/page.tsx`
- Create: `src/components/settings/DesignDirectionView.tsx`
- Modify: `src/app/settings/page.tsx` (section list)

**Interfaces:**
- Consumes: `DESIGN_DIRECTIONS`, `getDirection` (Task 5); `defaultPalette`, `composeDesignSystem` (Task 4); `designStatus`, `applyDesignDirection`, `clearDesignDirection` (Task 6); the preview route (Task 7); `requireAdmin`/`requireAdminPage` from `@/lib/auth`; `PageHeader`, `Card`, `CardLabel`, `Button`, `Label`, `Input` UI components; `useConfirm` from `@/components/ui/ConfirmDialog`; `toast` from `sonner`.
- Produces: page at `/settings/design`; server actions `applyDesignDirectionAction(input)` and `clearDesignDirectionAction()`.

Applying is a **button with a confirm**, not autosave — it reshapes every future post, and a misclick must not silently reskin a brand. This is the deliberate-action case the user's visible-save preference covers.

- [ ] **Step 1: Write the server actions**

Create `src/app/settings/design/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { applyDesignDirection, clearDesignDirection } from "@/lib/design/directionStore";

export type DesignActionResult = { ok: true } | { ok: false; error: string };

/**
 * Apply a direction with a palette. Deliberately NOT autosaved: this reshapes
 * every post the account generates from now on, and a misclick must not
 * silently reskin a brand. Validation lives in applyDesignDirection so a
 * script or a test gets the same guarantee as this button.
 */
export async function applyDesignDirectionAction(input: {
  directionId: string;
  palette: Record<string, string>;
}): Promise<DesignActionResult> {
  await requireAdmin();
  const r = applyDesignDirection(input.directionId, input.palette);
  if (r.ok) {
    revalidatePath("/settings/design");
    revalidatePath("/content-studio", "layout");
  }
  return r;
}

/** Back to fixed templates. */
export async function clearDesignDirectionAction(): Promise<DesignActionResult> {
  await requireAdmin();
  clearDesignDirection();
  revalidatePath("/settings/design");
  revalidatePath("/content-studio", "layout");
  return { ok: true };
}
```

- [ ] **Step 2: Write the page**

Create `src/app/settings/design/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { DESIGN_DIRECTIONS } from "@/lib/design/directions";
import { designStatus } from "@/lib/design/directionStore";
import { DesignDirectionView } from "@/components/settings/DesignDirectionView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Design direction — AdonisAgent" };

export default async function DesignDirectionPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Settings"
        title="Design direction"
        subtitle="The look Adonis composes your posts in: a typeface, a scale, a grid and a rotation of grounds, in your own colours."
        actions={
          <Link href="/settings">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All settings
            </Button>
          </Link>
        }
      />
      <DesignDirectionView
        directions={DESIGN_DIRECTIONS.map((d) => ({
          id: d.id,
          name: d.name,
          blurb: d.blurb,
          font: d.font,
          slots: d.slots.map((s) => ({ key: s.key, label: s.label, defaultHex: s.defaultHex.toLowerCase() })),
        }))}
        status={designStatus()}
      />
    </div>
  );
}
```

- [ ] **Step 3: Write the view**

Create `src/components/settings/DesignDirectionView.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { applyDesignDirectionAction, clearDesignDirectionAction } from "@/app/settings/design/actions";

/**
 * Pick a direction, put your colours into its slots, look at three real
 * slides, then apply. Applying is a button with a confirm and NOT autosave:
 * it reshapes every post from now on.
 *
 * The preview is the whole point of the page. A direction is a set of
 * decisions about type and grounds that only mean anything rendered, and
 * rendered in the tenant's own colours -- a picker showing stock swatches has
 * them choosing something they will never see.
 */

interface DirectionSummary {
  id: string;
  name: string;
  blurb: string;
  font: string;
  slots: { key: string; label: string; defaultHex: string }[];
}

type Status =
  | { kind: "none" }
  | { kind: "custom" }
  | { kind: "direction"; directionId: string; palette: Record<string, string> };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function DesignDirectionView({
  directions,
  status,
}: {
  directions: DirectionSummary[];
  status: Status;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  const current = status.kind === "direction" ? status.directionId : null;
  const [selectedId, setSelectedId] = useState<string | null>(current);
  const selected = directions.find((d) => d.id === selectedId) ?? null;

  // Palette state per direction, seeded from the stored choice for the current
  // one and from defaults for the rest, so switching back and forth never loses
  // colours already typed.
  const [palettes, setPalettes] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const d of directions) {
      const base: Record<string, string> = {};
      for (const s of d.slots) base[s.key] = s.defaultHex;
      if (status.kind === "direction" && status.directionId === d.id) Object.assign(base, status.palette);
      init[d.id] = base;
    }
    return init;
  });
  const palette = selected ? palettes[selected.id] : {};
  const paletteValid = selected ? selected.slots.every((s) => HEX.test(palette[s.key] ?? "")) : false;

  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  function setSlot(key: string, hex: string) {
    if (!selected) return;
    setPalettes((p) => ({ ...p, [selected.id]: { ...p[selected.id], [key]: hex } }));
    setPreview(null);
  }

  async function runPreview() {
    if (!selected || !paletteValid) return;
    setPreviewing(true);
    try {
      const res = await fetch("/api/content-studio/design-direction/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directionId: selected.id, palette }),
      });
      if (!res.ok) {
        toast.error(res.status >= 502 && res.status <= 504 ? "The app was restarting. Try again in a moment." : `Preview failed (${res.status}).`);
        return;
      }
      const d = await res.json();
      if (!d.ok) {
        toast.error(d.error ?? "Preview failed.");
        return;
      }
      setPreview(d.slides as string[]);
    } catch {
      toast.error("Couldn't reach the app.");
    } finally {
      setPreviewing(false);
    }
  }

  async function apply() {
    if (!selected || !paletteValid) return;
    const ok = await confirm({
      title: `Use ${selected.name} for every post?`,
      body: "Adonis will compose every new post in this direction, in these colours. Existing posts are untouched. You can change it again here at any time.",
      confirmLabel: "Apply",
    });
    if (!ok) return;
    start(async () => {
      const r = await applyDesignDirectionAction({ directionId: selected.id, palette });
      if (r.ok) {
        toast.success(`${selected.name} is now your design direction.`);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  async function clear() {
    const ok = await confirm({
      title: "Go back to templates?",
      body: "Adonis will stop composing layouts and use the fixed templates instead. Your colours here are kept until you leave the page.",
      confirmLabel: "Use templates",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await clearDesignDirectionAction();
      if (r.ok) {
        toast.success("Back to templates.");
        setSelectedId(null);
        setPreview(null);
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Current state, plainly */}
      <Card style={{ padding: 20 }}>
        <CardLabel>In use</CardLabel>
        <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "6px 0 0", lineHeight: 1.55 }}>
          {status.kind === "none" && "No direction. Adonis uses the fixed templates."}
          {status.kind === "custom" &&
            "A hand-authored design system. Applying a direction below replaces it; nothing changes until you do."}
          {status.kind === "direction" &&
            `${directions.find((d) => d.id === status.directionId)?.name ?? status.directionId}, in your colours.`}
        </p>
      </Card>

      {/* The six */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {directions.map((d) => {
          const isSelected = d.id === selectedId;
          const isCurrent = d.id === current;
          return (
            <Card
              key={d.id}
              style={{
                padding: 16,
                cursor: "pointer",
                border: isSelected ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                background: isSelected ? "var(--accent-soft)" : undefined,
              }}
              onClick={() => {
                setSelectedId(d.id);
                setPreview(null);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{d.name}</span>
                {isCurrent && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--accent)" }}>
                    <Check size={12} />
                    in use
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "6px 0 10px", lineHeight: 1.5 }}>{d.blurb}</p>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {d.slots.map((s) => (
                  <span
                    key={s.key}
                    title={s.label}
                    style={{ width: 18, height: 18, borderRadius: 4, background: palettes[d.id]?.[s.key] ?? s.defaultHex, border: "1px solid var(--hairline)" }}
                  />
                ))}
                <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>{d.font}</span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Palette + preview + apply, for the selected direction */}
      {selected && (
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <CardLabel>Your colours in {selected.name}</CardLabel>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "4px 0 0", lineHeight: 1.5 }}>
              Each slot has a job. Put your brand colour in the slot that does that job, and the structure -- which
              grounds, how often, what may carry text -- stays the direction&apos;s. Colours that can&apos;t be read on
              any ground are kept off text automatically.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {selected.slots.map((s) => {
              const value = palette[s.key] ?? s.defaultHex;
              const valid = HEX.test(value);
              return (
                <div key={s.key}>
                  <Label htmlFor={`slot-${s.key}`}>{s.label}</Label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="color"
                      aria-label={`${s.label} colour`}
                      value={valid ? value : s.defaultHex}
                      onChange={(e) => setSlot(s.key, e.target.value)}
                      style={{ width: 40, height: 36, padding: 0, border: "1px solid var(--hairline)", borderRadius: "var(--radius-sm)", background: "transparent", cursor: "pointer" }}
                    />
                    <Input
                      id={`slot-${s.key}`}
                      value={value}
                      onChange={(e) => setSlot(s.key, e.target.value)}
                      placeholder={s.defaultHex}
                      style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}
                    />
                  </div>
                  {!valid && (
                    <p style={{ fontSize: 12, color: "var(--danger)", margin: "4px 0 0" }}>Six-digit hex, like #1a1a1a.</p>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Button variant="outline" onClick={runPreview} disabled={previewing || !paletteValid}>
              {previewing ? <Loader2 size={14} className="spin" /> : <Eye size={14} />}
              {previewing ? "Rendering…" : "Preview three slides"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const base: Record<string, string> = {};
                for (const s of selected.slots) base[s.key] = s.defaultHex;
                setPalettes((p) => ({ ...p, [selected.id]: base }));
                setPreview(null);
              }}
            >
              <RotateCcw size={14} />
              Direction&apos;s own colours
            </Button>
            <span style={{ flex: 1 }} />
            <Button variant="primary" onClick={apply} disabled={pending || !paletteValid || !preview}>
              {pending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {current === selected.id ? "Apply changes" : `Use ${selected.name}`}
            </Button>
          </div>
          {!preview && (
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0 }}>
              Preview first. You apply what you have seen, not what you hope it looks like.
            </p>
          )}

          {preview && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {preview.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={src} alt={`${selected.name} sample slide ${i + 1}`} style={{ width: "100%", height: "auto", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }} />
              ))}
            </div>
          )}
        </Card>
      )}

      {status.kind !== "none" && (
        <Card style={{ padding: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Back to templates</div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "4px 0 0" }}>
              Stop composing layouts and use the fixed templates only.
            </p>
          </div>
          <Button variant="outline" onClick={clear} disabled={pending}>
            Use templates only
          </Button>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the settings-index entry**

In `src/app/settings/page.tsx`, add `Palette` is already imported from `lucide-react` (it is — check the import block; if a `LayoutTemplate` icon reads better, import that instead). Insert this object into the array returned by `buildSections`, immediately **after** the `/settings/branding` entry:

```ts
  {
    href: "/settings/design",
    icon: Palette,
    title: "Design direction",
    desc: "The look Adonis composes your posts in: a typeface, a grid and a rotation of grounds, in your own colours.",
  },
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx next build 2>&1 | grep -E "settings/design|error"`
Expected: no typecheck output; the build lists `ƒ /settings/design` and no errors.

- [ ] **Step 6: Try it in the running app**

Run: `npm run dev`, sign in as an admin, open `http://localhost:3000/settings/design`.
Expected: six cards; clicking one shows its slots with the direction's own colours; **Preview three slides** returns three images in that typeface; the Apply button is disabled until a preview has been rendered; applying shows the toast and the "In use" card updates. Then open Content Studio → New design and generate one post: the slides should render in the chosen face and colours.

- [ ] **Step 7: Commit**

```bash
git add src/app/settings/design src/components/settings/DesignDirectionView.tsx src/app/settings/page.tsx
git commit -m "feat(settings): choose a design direction, in your own colours

Six authored directions, each a set of decisions about typeface, scale, grid
and grounds. The operator puts their brand colours into the direction's
slots, previews three real rendered slides in that face and those colours,
then applies. A button with a confirm, not autosave: it reshapes every post
from now on. Apply is disabled until a preview has been seen -- you apply
what you have looked at.

Replaces hand-authoring a preset and seeding production over railway ssh.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Verify everything and deploy

**Files:** none new.

- [ ] **Step 1: Full suite**

Run: `npm test 2>&1 | tail -3`
Expected: `✓ N/N test file(s) passed` where N is the previous count plus 4 (`fonts`, `direction`, `directions`, `directionStore`).

- [ ] **Step 2: Production build**

Run: `npx next build 2>&1 | grep -E "Compiled|error"`
Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Confirm Optimal Health is untouched**

Read the stored system's font through the app rather than trusting the migration reasoning: with the dev server running as the Optimal Health tenant, open `/settings/design`.
Expected: the "In use" card says **A hand-authored design system** — not "No direction" and not one of the six. Nothing has been written to that tenant.

- [ ] **Step 4: Push and deploy**

```bash
git push origin main
cd app && railway up --detach
```

Then wait for health and confirm the page is served:

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' https://app.adonisagent.ie/api/health)" = "200" ]; do sleep 10; done
curl -s -o /dev/null -w "%{http_code}\n" https://app.adonisagent.ie/settings/design
```

Expected: `200` then `307` (the page exists and redirects to login when unauthenticated).

- [ ] **Step 5: Retire the seeding ritual note**

In `scripts/seed-design-system.ts`, replace the header comment's production-seeding instructions (the block from `// LOCAL DEV ONLY.` through the `railway ssh` example) with:

```ts
// LOCAL DEV ONLY. It reads ./data/control.db, so it cannot reach production.
// Production no longer needs it: an admin picks a direction and palette at
// /settings/design, which composes and stores the system through the app.
// This script remains for seeding a HAND-AUTHORED preset (one not expressible
// as a direction) into a local tenant.
```

```bash
git add scripts/seed-design-system.ts
git commit -m "docs(design): the seeding script is no longer how production gets a system

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

---

## Self-review notes

**Spec coverage.** Preset structural systems → Tasks 4–5. Chosen in Settings → Task 8. Tenant palette applied → Task 4 (`composeDesignSystem`) + Task 6 (store). Contrast rules recomputed → `deriveNeverType` (Task 4), pinned in Task 5 for every ground. Multi-font in the renderer → Tasks 1–3. Preview with the client's own colours before saving → Task 7 (route) + Task 8 (Apply disabled until previewed). Production seeding ritual retired → Task 9 step 5.

**Type consistency.** `DesignDirection.slots[].ground` is `{ share, maxRun }` in Task 4 and used identically in Task 5 and Task 8's summary mapping. `BrandPalette` is `Record<string, string>` everywhere. `designStatus()` shape in Task 6 matches the `Status` type in Task 8's view. `loadDesignFonts` keeps its `(family?: string)` signature so Task 3's call sites and Task 7's route agree. `sampleSlides(system)` returns `string[]` in both Task 7 uses.

**Known limits, stated rather than hidden.** One typeface per direction (a display/body pair is a follow-up: satori accepts several families in one `fonts` array, so it is additive). Horizontal text overflow in samples is not measured (vertical is, via `measureOverflowPx`). Directions are authored data — adding a seventh is a new object in `directions.ts` plus its font in `fonts.ts`, and the tests check it for free.
