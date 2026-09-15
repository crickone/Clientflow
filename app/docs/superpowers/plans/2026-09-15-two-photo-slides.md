# Two-Photograph Designed Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one designed slide carry two different photographs, so the model can compose a comparison ("infrared on top, HBOT below") that today it is structurally unable to make.

**Architecture:** Today the placeholder `{{PHOTO}}` is referenced in seven modules, three of them as bare string literals, and substitution is `html.split(PHOTO_TOKEN).join(uri)` — the SAME picture everywhere the token appears. So a slide can only ever hold one photograph, and the prompt says so outright ("Use it at most once per slide"). Task 1 gives the placeholder one owning module; Task 2 teaches that module an indexed form `{{PHOTO:2}}`; Tasks 3-5 carry a per-slot photograph through the schema, the renderer and the hit map; Task 6 lets the operator target a slot. The bare `{{PHOTO}}` keeps meaning slot 1 forever — every existing slide depends on it.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, better-sqlite3 + Drizzle, satori + sharp (HTML to PNG), plain `node:assert/strict` tests run by `scripts/test.mjs` with tsx.

## Global Constraints

- **NO EMOJIS** anywhere: UI copy, code, comments, commit messages, docs, tests. Use a `lucide-react` icon where a glyph is needed. (The `✓` in a test's `console.log` is the repo's existing convention and stays.)
- Tests are plain assertion scripts named `*.test.ts` under `src/`, discovered by `scripts/test.mjs`, run with `npm test -- <path>`. Pattern: `import assert from "node:assert/strict"`, a local `check(name, cond)` helper incrementing `passed`, `console.log("  ✓", name)` per check, a final summary line. No framework. A `*.test.ts` cannot import React or anything importing `server-only`… except that the runner passes `--conditions=react-server`, so `server-only` modules DO load (`renderDesign.test.ts` renders real satori PNGs). What cannot load is anything needing an ambient tenant DB.
- `npm run typecheck`, `npm test` and `npx next build` must all pass before any deploy. Deploy is `railway up` from inside `app/`.
- Node lives at `/usr/local/bin` — prefix commands with `PATH=/usr/local/bin:$PATH` if `npm` is not found.
- Every commit message ends with: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Back-compat is load-bearing.** Every existing designed slide's markup contains the bare `{{PHOTO}}` and one photo in `background_asset_id`. The bare token must keep meaning "slot 1" permanently — it is not a deprecated form.
- Hard limit of TWO photographs per slide. Three-plus is a collage and unreadable at feed size.
- All paths are relative to `app/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/design/photoSlots.ts` (create) | **The placeholder's owning module.** What it looks like (bare and indexed), how to find every occurrence in markup, how many slots a design uses, how to substitute a value per slot, and how to strip the `<img>` of a slot with no photograph. Pure, no React, no `server-only`. |
| `src/lib/design/photoSlots.test.ts` (create) | Tests for the above. |
| `src/lib/ai/designPost.parse.ts` (modify) | Re-export the token from `photoSlots` so existing importers keep working; teach `DESIGN_RULES` the indexed form and the two-slot limit; extend the parsed design's `photo` field to carry a scene per slot; audit "at most two, each with a scene". |
| `src/lib/db/schema.ts` (modify) | `photo_asset_ids` JSON text column on `carousel_slides`. |
| `src/lib/db/tenant.ts` (modify) | The `ALTER TABLE carousel_slides ADD COLUMN` guard for it. |
| `src/lib/image/carousels.ts` (modify) | Read and write the new column through the slide row. |
| `src/lib/design/renderDesignedSlide.ts` (modify) | Take a LIST of photographs; substitute each slot with its own; stand in for each slot when measuring. |
| `src/lib/design/buildHitMap.ts` (modify) | Stand in for every slot, not just the bare token. |
| `src/lib/ai/designPost.ts` (modify) | Hand the model's per-slot scenes through; assign a distinct photograph to each slot. |
| `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts` (modify) | Accept a slot index on a pick and on a generate. |
| `src/components/content-studio/SlidePhotoLibrary.tsx` (modify) | A slot chooser when the slide has two. |
| `src/components/content-studio/ImageDesigner.tsx` (modify) | Carry the slot through the swap and through "Make a new photo"; stop grepping for a bare literal. |

---

### Task 1: The placeholder gets an owning module

**Files:**
- Create: `src/lib/design/photoSlots.ts`
- Test: `src/lib/design/photoSlots.test.ts`
- Modify: `src/lib/ai/designPost.parse.ts` (the `PHOTO_TOKEN` declaration, around line 26)

**Interfaces:**
- Produces:
  ```ts
  export const PHOTO_TOKEN = "{{PHOTO}}";
  export const MAX_PHOTO_SLOTS = 2;
  /** Slot numbers a design's markup actually uses, ascending, deduplicated. Bare {{PHOTO}} is slot 1. */
  export function photoSlotsUsed(html: string): number[];
  /** True when the markup asks for at least one photograph. */
  export function usesPhoto(html: string): boolean;
  /** The token text for a slot: slot 1 is the bare form, 2+ the indexed form. */
  export function tokenForSlot(slot: number): string;
  /** Replace each slot's token with the value `valueFor` returns for it. A slot whose
   *  value is null has its whole <img> removed instead. */
  export function fillPhotoSlots(html: string, valueFor: (slot: number) => string | null): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/design/photoSlots.test.ts
//
// The placeholder used to be a bare string declared in designPost.parse.ts and
// then spelled out AGAIN as a literal in three other modules -- the client used
// one to decide which of two routes to call. This module is the one place that
// knows what a photo slot looks like, so an indexed form can be added here
// rather than hunted for across seven files.
import assert from "node:assert/strict";

import {
  MAX_PHOTO_SLOTS,
  PHOTO_TOKEN,
  fillPhotoSlots,
  photoSlotsUsed,
  tokenForSlot,
  usesPhoto,
} from "./photoSlots";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const img = (src: string) => `<img src="${src}" style="width:1080px;height:540px"/>`;

check("the bare token is unchanged -- every stored slide contains it", PHOTO_TOKEN === "{{PHOTO}}");
check("two slots, no more", MAX_PHOTO_SLOTS === 2);

check("slot 1 is the bare token, not an indexed one", tokenForSlot(1) === "{{PHOTO}}");
check("slot 2 is indexed", tokenForSlot(2) === "{{PHOTO:2}}");

check("markup with no photograph uses no slots", photoSlotsUsed("<div>hello</div>").length === 0);
check("the bare token reads as slot 1", JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN))) === "[1]");
check(
  "an indexed token reads as its own slot",
  JSON.stringify(photoSlotsUsed(img("{{PHOTO:2}}"))) === "[2]",
);
check(
  "both forms together read as two slots, ascending",
  JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN) + img("{{PHOTO:2}}"))) === "[1,2]",
);
check(
  "the same slot twice is one slot",
  JSON.stringify(photoSlotsUsed(img(PHOTO_TOKEN) + img(PHOTO_TOKEN))) === "[1]",
);
check("usesPhoto is true for the bare form", usesPhoto(img(PHOTO_TOKEN)) === true);
check("usesPhoto is true for an indexed form alone", usesPhoto(img("{{PHOTO:2}}")) === true);
check("usesPhoto is false for a flat ground", usesPhoto("<div>no pictures</div>") === false);

// Substitution
const two = img(PHOTO_TOKEN) + img("{{PHOTO:2}}");
const filled = fillPhotoSlots(two, (slot) => `SRC${slot}`);
check("each slot gets its OWN value", filled.includes("SRC1") && filled.includes("SRC2"));
check("no token survives substitution", !filled.includes("{{PHOTO"));

check(
  "the same slot appearing twice gets the same value both times",
  fillPhotoSlots(img(PHOTO_TOKEN) + img(PHOTO_TOKEN), () => "X").split("X").length - 1 === 2,
);

// A slot with no photograph loses its whole <img>: a broken src draws an empty box.
const oneMissing = fillPhotoSlots(two, (slot) => (slot === 1 ? "SRC1" : null));
check("a null slot loses its whole img tag", !oneMissing.includes("{{PHOTO:2}}") && !oneMissing.includes("SRC2"));
check("the img element itself is gone, not just its src", (oneMissing.match(/<img/g) ?? []).length === 1);
check("the surviving slot is untouched", oneMissing.includes("SRC1"));

check(
  "markup with no slots comes back identical",
  fillPhotoSlots("<div>plain</div>", () => "X") === "<div>plain</div>",
);

console.log(`\nphotoSlots: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/photoSlots.test.ts`
Expected: FAIL — `Cannot find module './photoSlots'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * What a photograph's place in a designed slide looks like, and how to fill it.
 *
 * This used to be a bare string constant in lib/ai/designPost.parse.ts, spelled
 * out AGAIN as a literal in three other modules -- the photo route gated on it,
 * the hit map substituted it, and the editor grepped for it to decide which of
 * two routes to call. Adding a second slot in that shape would have meant
 * finding literals that a grep for PHOTO_TOKEN never surfaces.
 *
 * Slot 1 is the BARE token, permanently. Every designed slide already stored
 * contains it, and this is not a deprecated form: a one-photograph slide is
 * still the common case and should not have to say "1".
 *
 * Pure and dependency-free: it runs in the browser (the editor asks whether a
 * slide has a photo slot) and on the server (the renderer fills them).
 */

export const PHOTO_TOKEN = "{{PHOTO}}";

/**
 * Two, and the limit is a design decision rather than a technical one: a
 * comparison is the real use case, and three pictures at feed size is a
 * collage nobody reads.
 */
export const MAX_PHOTO_SLOTS = 2;

/** Matches the bare form and the indexed form, capturing the number when present. */
const SLOT_RE = /\{\{PHOTO(?::(\d+))?\}\}/g;

/** The token text for a slot. Slot 1 is bare so existing markup keeps parsing. */
export function tokenForSlot(slot: number): string {
  return slot <= 1 ? PHOTO_TOKEN : `{{PHOTO:${slot}}}`;
}

/** Slot numbers this markup uses, ascending and deduplicated. */
export function photoSlotsUsed(html: string): number[] {
  const seen = new Set<number>();
  for (const m of html.matchAll(SLOT_RE)) {
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n >= 1) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

export function usesPhoto(html: string): boolean {
  return photoSlotsUsed(html).length > 0;
}

/**
 * The whole <img> for a slot, so a slot with no photograph can be removed
 * rather than left with a broken src -- satori draws that as an empty box.
 * Built from the token so the two spellings cannot drift apart.
 */
function imgTagFor(slot: number): RegExp {
  const token = tokenForSlot(slot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<img[^>]*${token}[^>]*>`, "gi");
}

/**
 * Fill every slot with the value `valueFor` gives for it. A slot whose value is
 * null loses its <img> entirely.
 */
export function fillPhotoSlots(
  html: string,
  valueFor: (slot: number) => string | null,
): string {
  let out = html;
  for (const slot of photoSlotsUsed(html)) {
    const value = valueFor(slot);
    if (value == null) {
      out = out.replace(imgTagFor(slot), "");
      continue;
    }
    out = out.split(tokenForSlot(slot)).join(value);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/design/photoSlots.test.ts`
Expected: `photoSlots: 18 checks passed`

- [ ] **Step 5: Make the old home re-export, so nothing breaks yet**

In `src/lib/ai/designPost.parse.ts`, find the declaration around line 26:

```ts
export const PHOTO_TOKEN = "{{PHOTO}}";
```

Replace it with a re-export, keeping the existing doc comment above it:

```ts
// The placeholder now lives in lib/design/photoSlots, which also knows the
// indexed form and how to fill each slot. Re-exported here because the prompt
// text below interpolates it and several modules already import it from this
// file; the constant itself must have exactly one definition.
export { PHOTO_TOKEN } from "@/lib/design/photoSlots";
```

- [ ] **Step 6: Verify nothing broke**

Run: `npm run typecheck`
Expected: clean.

Run: `npm test`
Expected: all files pass (179 after this task's new file).

- [ ] **Step 7: Commit**

```bash
git add src/lib/design/photoSlots.ts src/lib/design/photoSlots.test.ts src/lib/ai/designPost.parse.ts
git commit -m "refactor(design): one module owns the photo placeholder

It was a bare string in designPost.parse.ts and a literal in three other
modules -- the photo route gated on it, the hit map substituted it, and the
editor grepped for it to pick a route. lib/design/photoSlots now owns what a
slot looks like, which slots a design uses, and how to fill each one, so a
second slot is a change in one place rather than a hunt through seven.

Slot 1 stays the BARE token permanently: every stored slide contains it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The three bare literals die

**Files:**
- Modify: `src/lib/design/buildHitMap.ts:1,84`
- Modify: `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts:12,172,207`
- Modify: `src/components/content-studio/ImageDesigner.tsx:3170`

**Interfaces:**
- Consumes: `usesPhoto`, `fillPhotoSlots`, `PHOTO_TOKEN` from Task 1.

No new test: this task changes which module a constant comes from and swaps two hand-rolled substitutions for the shared one. Task 1's tests cover the behaviour, and the existing `renderDesign.test.ts`, `textRuns.test.ts` and `renderDesignedSlide.test.ts` cover the call sites. Do not write a test that only re-asserts an import path.

- [ ] **Step 1: The hit map fills slots instead of splitting one token**

In `src/lib/design/buildHitMap.ts`, change the import on line 1:

```ts
import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";
```

to:

```ts
import { fillPhotoSlots } from "@/lib/design/photoSlots";
```

Then replace the substitution around line 84:

```ts
  out = out.split(PHOTO_TOKEN).join(standIn);
```

with:

```ts
  // Every slot, not just the bare one: a two-photograph slide whose second
  // token survived here would hit-test a layout with a missing image, and the
  // click boxes would land in the wrong place -- the same class of bug the
  // 1x1 stand-in caused before it was replaced with a same-size one.
  out = fillPhotoSlots(out, () => standIn);
```

- [ ] **Step 2: The photo route asks the module, not the string**

In `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts`, change the import on line 12:

```ts
import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";
```

to:

```ts
import { usesPhoto } from "@/lib/design/photoSlots";
```

Then replace BOTH gates. Around line 172:

```ts
    if (!slide.designHtml.includes(PHOTO_TOKEN)) {
```

and around line 207:

```ts
  if (!slide.designHtml.includes(PHOTO_TOKEN)) {
```

each become:

```ts
    if (!usesPhoto(slide.designHtml)) {
```

(keeping each one's existing indentation and the block that follows it).

- [ ] **Step 3: The editor stops grepping for a literal**

In `src/components/content-studio/ImageDesigner.tsx`, add to the import block near the other `@/lib/design` imports:

```ts
import { usesPhoto } from "@/lib/design/photoSlots";
```

Then replace line 3170:

```ts
  const hasPhotoSlot = (slide.designHtml ?? "").includes("{{PHOTO}}");
```

with:

```ts
  // Asks the module that owns the placeholder rather than matching a literal:
  // a slide using only the indexed form has a photo slot too, and a bare
  // `.includes("{{PHOTO}}")` would have said it did not and sent the operator
  // down the redesign-around-a-new-photo path for no reason.
  const hasPhotoSlot = usesPhoto(slide.designHtml ?? "");
```

- [ ] **Step 4: Verify no bare literal survives on a render path**

Run: `grep -rn '"{{PHOTO}}"' src --include=*.ts --include=*.tsx | grep -v test | grep -v photoSlots.ts`
Expected: no output.

Run: `npm run typecheck && npm test`
Expected: clean typecheck; all test files pass.

Run: `npx next build`
Expected: `✓ Compiled successfully`. (This matters: `photoSlots.ts` must stay client-safe, and `ImageDesigner.tsx` is a client component. If the build complains about `server-only`, `photoSlots.ts` has picked up a server import it must not have.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/buildHitMap.ts "src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts" src/components/content-studio/ImageDesigner.tsx
git commit -m "refactor(design): the three bare photo-token literals go through the module

The hit map, the photo route's two gates and the editor's route-picking check
each spelled the placeholder out themselves. They now ask photoSlots, so an
indexed slot is understood everywhere at once -- including the hit map, which
would otherwise hit-test a layout with one image missing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The model can ask for a second photograph

**Files:**
- Modify: `src/lib/ai/designPost.parse.ts` — `RawDesign` (around line 16), `DESIGN_RULES` (the photo paragraphs, around lines 162-164), the output-format block (around line 175), `coerce` (around line 263), `checkDesigns` (the per-design audit)
- Test: `src/lib/ai/designPost.parse.test.ts` (extend)

**Interfaces:**
- Consumes: `MAX_PHOTO_SLOTS`, `photoSlotsUsed` from Task 1.
- Produces: `RawDesign.photos: string[]` — the scene for each slot, index 0 being slot 1. `RawDesign.photo` stays as the slot-1 scene so existing readers keep working.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ai/designPost.parse.test.ts`, before its final `console.log` summary line:

```ts
// Two photographs on one slide. The model could not ask for this before: the
// prompt said "at most once per slide" and substitution put the SAME picture
// everywhere the token appeared, so a comparison slide was impossible to
// express -- which is what an operator hit asking for "infrared on top".
check(
  "the rules teach the indexed form",
  DESIGN_RULES.includes("{{PHOTO:2}}"),
);
check(
  "the rules cap it at two",
  DESIGN_RULES.includes("at most TWO photographs"),
);
check(
  "the rules ask for a scene per photograph",
  DESIGN_RULES.includes('"photos"'),
);

const twoPhotoPayload = `<design>${JSON.stringify({
  caption: "c",
  slides: [
    {
      photos: ["an infrared bed, warm light", "a hyperbaric chamber, cool light"],
      html: '<div style="display:flex"><img src="{{PHOTO}}"/><img src="{{PHOTO:2}}"/></div>',
    },
  ],
})}</design>`;
const twoRead = extractDesignPayload(twoPhotoPayload);
check(
  "both scenes survive the parse",
  twoRead.slides[0].photos.length === 2 &&
    twoRead.slides[0].photos[1] === "a hyperbaric chamber, cool light",
);
check(
  "the slot-1 scene is still on `photo` for readers that never learned about slots",
  twoRead.slides[0].photo === "an infrared bed, warm light",
);

const onePhotoPayload = `<design>${JSON.stringify({
  caption: "c",
  slides: [{ photo: "a quiet room", html: '<div style="display:flex"><img src="{{PHOTO}}"/></div>' }],
})}</design>`;
const oneRead = extractDesignPayload(onePhotoPayload);
check(
  "a single-scene reply still parses, and becomes a one-entry list",
  oneRead.slides[0].photos.length === 1 && oneRead.slides[0].photos[0] === "a quiet room",
);

const threeSlots = checkDesigns(
  [
    {
      html: '<div style="display:flex"><img src="{{PHOTO}}"/><img src="{{PHOTO:2}}"/><img src="{{PHOTO:3}}"/></div>',
      photo: "a",
      photos: ["a", "b", "c"],
    },
  ],
  SYSTEM,
);
check(
  "a third slot is a violation the repair call can act on",
  threeSlots.designs[0].violations.some((v) => /two photographs/i.test(v)),
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/ai/designPost.parse.test.ts`
Expected: FAIL on the first new check — `DESIGN_RULES` does not contain `{{PHOTO:2}}`.

- [ ] **Step 3: Extend the parsed shape**

In `src/lib/ai/designPost.parse.ts`, change the `RawDesign` interface around line 16:

```ts
export interface RawDesign {
  html: string;
  /** A photographic scene for this slide, or "" when the design uses none. */
  photo: string;
}
```

to:

```ts
export interface RawDesign {
  html: string;
  /**
   * The scene for SLOT 1, or "" when the design uses none.
   *
   * Kept alongside `photos` because several readers only ever want the one
   * scene -- the editor's "This slide asked for:" hint, and the photo route's
   * fallback brief -- and making them all index into a list would be churn for
   * nothing.
   */
  photo: string;
  /** A scene per slot, index 0 being slot 1. One entry for a one-photograph slide. */
  photos: string[];
}
```

- [ ] **Step 4: Teach the rules the indexed form**

In the same file, replace the photo paragraph around line 162:

```
Where a slide uses a photograph, write the src EXACTLY as ${PHOTO_TOKEN} -- that placeholder is replaced with the real image. Use it at most once per slide.
```

with:

```
Where a slide uses a photograph, write the src EXACTLY as ${PHOTO_TOKEN} -- that placeholder is replaced with the real image.

A slide may carry at most TWO photographs. For a SECOND one, write its src as {{PHOTO:2}}. Two is for a genuine comparison -- two therapies, before and after, two ways of doing a thing -- where the pictures carry the point between them. It is not for decoration: one photograph well placed beats two fighting each other. Never write {{PHOTO:3}} or higher.
```

Then replace the `EVERY slide gets a "photo" field` paragraph around line 164 with:

```
EVERY slide gets a "photos" field: a LIST of scenes, one per photograph the design uses, in slot order. A slide with one photograph has one entry; a slide with two has two, the first describing {{PHOTO}} and the second describing {{PHOTO:2}}. A slide you designed on a flat ground still gives one entry, naming the photograph that WOULD suit it -- that is how the operator gets the picture that is missing. Each entry names subject, setting, mood, composition. Never describe text, signage or lettering in shot. Never leave the list empty.
```

And in the output-format block around line 175, replace the sample slide line:

```
    { "photo": "a quiet treatment room, daylight", "html": "<div style=\\"display:flex;position:relative;width:1080px;height:1080px;...\\">...</div>" }
```

with:

```
    { "photos": ["a quiet treatment room, daylight"], "html": "<div style=\\"display:flex;position:relative;width:1080px;height:1080px;...\\">...</div>" }
```

- [ ] **Step 5: Accept both shapes when parsing**

In `coerce` around line 263, replace:

```ts
        photo: typeof o.photo === "string" ? o.photo.trim() : "",
```

with:

```ts
        // Both shapes: `photos` is what the rules now ask for, `photo` is what
        // a model that ignored them (or an older stored reply) sends. Neither
        // is an error -- one photograph is the common slide.
        photos: readScenes(o),
        photo: readScenes(o)[0] ?? "",
```

and add this helper just above `coerce`:

```ts
/**
 * The scenes a reply carries, from either shape. Trimmed, empties dropped, and
 * capped at the slot limit so a model that ignored the cap cannot make the
 * renderer look for photographs that the audit is about to reject anyway.
 */
function readScenes(o: Record<string, unknown>): string[] {
  const list = Array.isArray(o.photos)
    ? o.photos
    : typeof o.photo === "string"
      ? [o.photo]
      : [];
  return list
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_PHOTO_SLOTS);
}
```

Add `MAX_PHOTO_SLOTS` and `photoSlotsUsed` to this file's import from `@/lib/design/photoSlots` (it already imports `PHOTO_TOKEN` from there after Task 1; extend that import rather than adding a second).

- [ ] **Step 6: Audit the cap**

In `checkDesigns`, inside the per-design loop where other violations are pushed, add:

```ts
    // A third slot would render as a broken box: nothing assigns a photograph
    // to it. Cheaper to let the repair call redesign the slide than to drop the
    // extra image and leave a composition built around a picture that is gone.
    const slots = photoSlotsUsed(design.html);
    if (slots.length > MAX_PHOTO_SLOTS || slots.some((s) => s > MAX_PHOTO_SLOTS)) {
      violations.push(
        `A slide may carry at most two photographs; this one asks for ${slots.length}.`,
      );
    }
```

Match the surrounding code's name for the array being pushed to — read the function first; if it collects into something other than `violations`, use that name.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- src/lib/ai/designPost.parse.test.ts`
Expected: all checks pass, including the seven new ones.

Run: `npm run typecheck`
Expected: this will FAIL where `designPost.ts` constructs a `RawDesign` without `photos`. Fix each site by giving it `photos: [<the existing scene>]` — do not widen the type to make the error go away.

Run: `npm test`
Expected: all files pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ai/designPost.parse.ts src/lib/ai/designPost.parse.test.ts src/lib/ai/designPost.ts
git commit -m "feat(design): a slide may ask for two photographs

The rules said 'use it at most once per slide' and substitution put the SAME
picture everywhere the token appeared, so a comparison slide -- two therapies,
before and after -- could not be expressed at all. The model can now write
{{PHOTO:2}} for a second photograph and name a scene for each slot.

Both reply shapes parse: `photos` is what the rules now ask for, `photo` is
what an older reply sends, and a one-photograph slide is still the common case.
A third slot is a violation the repair call can act on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A slide records which photographs it used

**Files:**
- Modify: `src/lib/db/schema.ts` (the `carouselSlides` table, near `backgroundAssetId` around line 950)
- Modify: `src/lib/db/tenant.ts` (the `carousel_slides` ALTER block, around lines 1590-1600)
- Modify: `src/lib/image/carousels.ts` (the slide row read/write)
- Test: `src/lib/image/photoAssetIds.test.ts` (create)

**Interfaces:**
- Produces:
  ```ts
  // src/lib/image/photoAssetIds.ts
  /** Asset id per slot, index 0 being slot 1. */
  export function parsePhotoAssetIds(stored: string | null, backgroundAssetId: number | null): (number | null)[];
  export function serialisePhotoAssetIds(ids: (number | null)[]): string | null;
  ```

**Why a separate pure module:** `carousels.ts` imports the ambient tenant `db`, so a test of the JSON round-trip could not run. The parsing is pure; keep it where it can be tested.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/image/photoAssetIds.test.ts
//
// A slide's photographs have to survive a reload, or a re-render comes back
// with different pictures than the operator chose. background_asset_id holds
// one integer; this is the second slot's home, and the bridge for the tens of
// thousands of rows that predate it.
import assert from "node:assert/strict";

import { parsePhotoAssetIds, serialisePhotoAssetIds } from "./photoAssetIds";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check(
  "an old row with no JSON reads as its background asset in slot 1",
  eq(parsePhotoAssetIds(null, 7), [7]),
);
check(
  "an old row with no photograph at all reads as empty",
  eq(parsePhotoAssetIds(null, null), []),
);
check(
  "a stored pair reads back in order",
  eq(parsePhotoAssetIds("[7,9]", 7), [7, 9]),
);
check(
  "a slot with no photograph round-trips as null",
  eq(parsePhotoAssetIds("[7,null]", 7), [7, null]),
);
check(
  "malformed JSON falls back to the background asset rather than throwing",
  eq(parsePhotoAssetIds("not json", 7), [7]),
);
check(
  "a JSON value that is not an array falls back too",
  eq(parsePhotoAssetIds('{"a":1}', 7), [7]),
);
check(
  "non-numeric entries become null rather than poisoning the render",
  eq(parsePhotoAssetIds('["x",9]', null), [null, 9]),
);
check(
  "more slots than the cap are dropped",
  eq(parsePhotoAssetIds("[1,2,3]", 1), [1, 2]),
);

check("serialising a pair gives compact JSON", serialisePhotoAssetIds([7, 9]) === "[7,9]");
check(
  "a single photograph stores null -- background_asset_id already says it",
  serialisePhotoAssetIds([7]) === null,
);
check("no photographs stores null", serialisePhotoAssetIds([]) === null);
check("a null second slot is still worth storing", serialisePhotoAssetIds([7, null]) === "[7,null]");

console.log(`\nphotoAssetIds: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/image/photoAssetIds.test.ts`
Expected: FAIL — `Cannot find module './photoAssetIds'`

- [ ] **Step 3: Write the module**

Create `src/lib/image/photoAssetIds.ts`:

```ts
import { MAX_PHOTO_SLOTS } from "@/lib/design/photoSlots";

/**
 * Which photograph sits in which slot, as a slide row stores it.
 *
 * `background_asset_id` is one integer column and every designed slide written
 * before two-photograph slides existed uses it. It stays the home of slot 1 --
 * so an old row needs no migration and still renders -- and `photo_asset_ids`
 * carries the whole list once there is more than one.
 *
 * Every malformed case resolves to something renderable rather than throwing:
 * a slide that will not parse is a slide the operator cannot open.
 */
export function parsePhotoAssetIds(
  stored: string | null,
  backgroundAssetId: number | null,
): (number | null)[] {
  const fallback = backgroundAssetId == null ? [] : [backgroundAssetId];
  if (!stored) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;
  return parsed
    .slice(0, MAX_PHOTO_SLOTS)
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
}

/**
 * The value to store, or null when the list says nothing background_asset_id
 * does not already say. Keeping the single-photograph case out of the column
 * means the rows that predate this look identical to the ones written after it.
 */
export function serialisePhotoAssetIds(ids: (number | null)[]): string | null {
  if (ids.length <= 1) return null;
  return JSON.stringify(ids.slice(0, MAX_PHOTO_SLOTS));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/image/photoAssetIds.test.ts`
Expected: `photoAssetIds: 12 checks passed`

- [ ] **Step 5: Add the column to the schema**

In `src/lib/db/schema.ts`, immediately after the `backgroundAssetId` column definition (around lines 950-953), add:

```ts
  /**
   * Asset id per photo slot as a JSON array, index 0 being slot 1. Null when
   * the slide has at most one photograph -- background_asset_id above already
   * says which, and leaving it null keeps every row written before
   * two-photograph slides indistinguishable from one written after.
   * See lib/image/photoAssetIds.ts.
   */
  photoAssetIds: text("photo_asset_ids"),
```

- [ ] **Step 6: Add the migration guard**

In `src/lib/db/tenant.ts`, inside the existing `carousel_slides` ALTER block (the one around lines 1590-1600 that adds `design_html` and `render_filename`), add a third guard in the same shape:

```ts
    if (designCols.length > 0 && !designCols.some((c) => c.name === "photo_asset_ids")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN photo_asset_ids TEXT");
    }
```

- [ ] **Step 7: Carry it through the slide row**

In `src/lib/image/carousels.ts`, find where a slide is written (`addSlide`) and where it is updated (`updateSlide`) and allow `photoAssetIds` through, exactly as `designHtml` and `renderFilename` are handled. Read those functions first and follow their existing shape — if they take a typed patch object, add the field to that type; if they spread an input, ensure the field is in the allowed set.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test`
Expected: clean.

Run: `npx next build`
Expected: `✓ Compiled successfully`.

Verify the migration applies to a real database:

```bash
PATH=/usr/local/bin:$PATH node -e "
const D=require('better-sqlite3');
const db=new D('data/tenants/inspire/inspire.db',{readonly:true});
console.log(db.prepare('PRAGMA table_info(carousel_slides)').all().map(c=>c.name).join(','));
db.close();
"
```
Expected: the list does NOT yet contain `photo_asset_ids` (the guard runs at boot, not from this script). Then run `npm run dev`, load any page, stop it, and run the command again — expected: `photo_asset_ids` is now present, and every existing row still has its `design_html`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/image/photoAssetIds.ts src/lib/image/photoAssetIds.test.ts src/lib/db/schema.ts src/lib/db/tenant.ts src/lib/image/carousels.ts
git commit -m "feat(design): a slide records a photograph per slot

background_asset_id is one integer and stays the home of slot 1, so every
designed slide written before this needs no migration and still renders.
photo_asset_ids carries the list once there is more than one, and is null
otherwise -- an old row and a new single-photograph row look identical.

Every malformed stored value resolves to something renderable: a slide that
will not parse is a slide the operator cannot open.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The renderer fills each slot with its own photograph

**Files:**
- Modify: `src/lib/design/renderDesignedSlide.ts` — `SlidePhoto`/`RenderDesignedSlideInput` (around lines 66-84), `withPhoto` (around lines 112-123), `standInForPhoto` (around line 150)
- Modify: `src/lib/ai/designPost.ts` — `renderOne` (around line 107) and the per-set photo assignment (`nextPhoto`, around lines 310-316)
- Test: `src/lib/design/renderDesignedSlide.test.ts` (extend)

**Interfaces:**
- Consumes: `fillPhotoSlots`, `photoSlotsUsed` from Task 1.
- Produces: `RenderDesignedSlideInput.photos?: (SlidePhoto | null)[]` — one entry per slot, index 0 being slot 1. `photo` stays as the slot-1 shorthand.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/design/renderDesignedSlide.test.ts`, before its final summary line:

```ts
// Two photographs, each in its own slot. Before this, substitution was
// `html.split(PHOTO_TOKEN).join(uri)` -- the same picture everywhere the token
// appeared -- so a comparison slide showed one photograph twice.
{
  const twoSlot =
    '<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background-color:#f2f3ed;">' +
    `<img src="${PHOTO_TOKEN}" style="width:1080px;height:540px;object-fit:cover"/>` +
    '<img src="{{PHOTO:2}}" style="width:1080px;height:540px;object-fit:cover"/>' +
    "</div>";

  const both = await renderDesignedSlide({
    html: twoSlot,
    aspectRatio: "1:1",
    photos: [{ path: photoA }, { path: photoB }],
    logoPath: null,
    system: SYSTEM,
  });
  const sameTwice = await renderDesignedSlide({
    html: twoSlot,
    aspectRatio: "1:1",
    photos: [{ path: photoA }, { path: photoA }],
    logoPath: null,
    system: SYSTEM,
  });
  check(
    "two different photographs render differently from the same one twice",
    both.filename !== sameTwice.filename,
  );

  const missingSecond = await renderDesignedSlide({
    html: twoSlot,
    aspectRatio: "1:1",
    photos: [{ path: photoA }, null],
    logoPath: null,
    system: SYSTEM,
  });
  check(
    "a slot with no photograph still renders",
    typeof missingSecond.filename === "string" && missingSecond.filename.length > 0,
  );
  check(
    "and it differs from the render where both slots were filled",
    missingSecond.filename !== both.filename,
  );

  // The stand-in must cover BOTH slots, or overflow is measured against a
  // layout with one image missing.
  const overflowTwo = await renderDesignedSlide({
    html: twoSlot,
    aspectRatio: "1:1",
    photos: [{ path: photoA }, { path: photoB }],
    logoPath: null,
    system: SYSTEM,
  });
  check("a two-photograph slide that fits reports no overflow", overflowTwo.overflowPx === 0);
}

// The single-photograph shorthand still works and is identical to the list form.
{
  const oneSlot =
    '<div style="display:flex;width:1080px;height:1080px;background-color:#f2f3ed;">' +
    `<img src="${PHOTO_TOKEN}" style="width:1080px;height:1080px;object-fit:cover"/>` +
    "</div>";
  const viaPhoto = await renderDesignedSlide({
    html: oneSlot, aspectRatio: "1:1", photo: { path: photoA }, logoPath: null, system: SYSTEM,
  });
  const viaPhotos = await renderDesignedSlide({
    html: oneSlot, aspectRatio: "1:1", photos: [{ path: photoA }], logoPath: null, system: SYSTEM,
  });
  check("the `photo` shorthand and a one-entry `photos` produce the same render", viaPhoto.filename === viaPhotos.filename);
}
```

Read the existing test file first: it already builds a `SYSTEM` and at least one photo fixture. Reuse them, and add a second distinct fixture (`photoA`, `photoB`) in the same way the file makes its first one — two solid-colour JPEGs of different colours is enough, and they must differ or the "renders differently" check is vacuous.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/design/renderDesignedSlide.test.ts`
Expected: FAIL — `photos` is not a known property of the input type.

- [ ] **Step 3: Take a list of photographs**

In `src/lib/design/renderDesignedSlide.ts`, add to `RenderDesignedSlideInput` beside the existing `photo` field:

```ts
  /**
   * A photograph per slot, index 0 being slot 1. A slot whose entry is null or
   * absent has its <img> removed rather than left with a broken src.
   *
   * `photo` above is the one-slot shorthand and still works: a single
   * photograph is the common slide and should not have to be wrapped in a list.
   * When both are given, `photos` wins.
   */
  photos?: (SlidePhoto | null)[];
```

- [ ] **Step 4: Fill each slot with its own graded photograph**

Replace `withPhoto` (around lines 112-123) with:

```ts
async function withPhotos(
  html: string,
  photos: (SlidePhoto | null)[],
  width: number,
  height: number,
  system: DesignSystem,
): Promise<string> {
  const slots = photoSlotsUsed(html);
  if (slots.length === 0) return html;

  // Grade each slot's photograph ONCE, before substitution: fillPhotoSlots is
  // synchronous, and grading is the expensive step -- a slot that appears twice
  // in the markup must not pay for it twice.
  const uriBySlot = new Map<number, string | null>();
  for (const slot of slots) {
    const photo = photos[slot - 1] ?? null;
    uriBySlot.set(
      slot,
      photo ? await gradedPhotoDataUri(photo.path, width, height, system.photo) : null,
    );
  }
  return fillPhotoSlots(html, (slot) => uriBySlot.get(slot) ?? null);
}
```

Then in `renderDesignedSlide`, replace the call to `withPhoto` with:

```ts
  // `photos` wins over `photo`; `photo` is the one-slot shorthand.
  const photos = input.photos ?? (input.photo ? [input.photo] : []);
  const html = await withPhotos(input.html, photos, width, height, input.system);
```

Add `fillPhotoSlots` and `photoSlotsUsed` to the file's import from `./photoSlots`, and delete the now-unused `PHOTO_IMG_TAG` regex and the `PHOTO_TOKEN` import if nothing else in the file uses them (the stand-in still might — check before deleting).

- [ ] **Step 5: Stand in for every slot**

`standInForPhoto` replaces every `data:image/...` run, so it already covers both slots once they are substituted. Verify that by reading it; if it instead matches the token, change it to use `fillPhotoSlots(html, () => standIn)` so an unsubstituted slot is covered too. Update its doc comment to say "every slot" rather than "the photograph".

- [ ] **Step 6: Assign a distinct photograph per slot in the generator**

In `src/lib/ai/designPost.ts`, `renderOne` currently takes one `photo: PhotoChoice | null`. Change it to take `photos: (PhotoChoice | null)[]` and pass them through to `renderDesignedSlide`'s `photos`. At the call site inside `attempt` (the `nextPhoto` cycling around lines 310-316), give each slot of a design its own photograph from the same rotation, so a two-slot slide gets two different pictures rather than the same one twice:

```ts
        const slots = photoSlotsUsed(design.html);
        const forThisSlide = slots.map(() =>
          photos.length > 0 ? photos[nextPhoto++ % photos.length] : null,
        );
```

Read the surrounding code before editing: `photos` here is the tenant's library list, `nextPhoto` is the rotation counter that exists so a seven-slide set does not put one picture on every slide. Preserve that behaviour — this only extends it from one photograph per slide to one per slot.

Also record what was used: where the slide is stored (`carouselGeneration.ts`), set `backgroundAssetId` to slot 1's id as now, and `photoAssetIds` to `serialisePhotoAssetIds(...)` of the whole list.

- [ ] **Step 7: Run the tests**

Run: `npm test -- src/lib/design/renderDesignedSlide.test.ts`
Expected: all checks pass including the six new ones.

Run: `npm test`
Expected: all files pass. The characterization test (`renderDesign.characterization.test.ts`) must pass UNCHANGED — if it fails, the refactor changed what a one-photograph slide renders, which it must not.

Run: `npm run typecheck && npx next build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/design/renderDesignedSlide.ts src/lib/design/renderDesignedSlide.test.ts src/lib/ai/designPost.ts src/lib/image/carouselGeneration.ts
git commit -m "feat(design): each photo slot gets its own photograph

Substitution was html.split(PHOTO_TOKEN).join(uri) -- the same picture
everywhere the token appeared -- so even if a slide had asked for two, it would
have shown one twice. Each slot is now graded and filled separately, a slot
with no photograph loses its <img> rather than keeping a broken src, and the
generator's photo rotation extends from one picture per slide to one per slot.

The single-photograph shorthand is unchanged and renders identically, which the
characterization test still pins.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The operator can target a slot

**Files:**
- Modify: `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts` (the body type around line 102, the pick branch, the generate branch, and the write)
- Modify: `src/components/content-studio/SlidePhotoLibrary.tsx` (props and header)
- Modify: `src/components/content-studio/ImageDesigner.tsx` (the swap call and the redesign dialog's "Make a new photo")

**Interfaces:**
- Consumes: `photoSlotsUsed` from Task 1; `parsePhotoAssetIds`/`serialisePhotoAssetIds` from Task 4; `renderDesignedSlide`'s `photos` from Task 5.
- Request shape: the photo route accepts an optional `slot?: number` on both `{ assetId }` and `{ generate: true }`. Absent means slot 1, so every existing caller keeps working.

- [ ] **Step 1: The route accepts a slot**

In `photo/route.ts`, extend the parsed body type (around line 102):

```ts
  const o = (body ?? {}) as { assetId?: unknown; generate?: unknown; onlyGenerate?: unknown };
```

to:

```ts
  const o = (body ?? {}) as {
    assetId?: unknown;
    generate?: unknown;
    onlyGenerate?: unknown;
    /** Which photo slot to act on, 1-based. Absent means slot 1. */
    slot?: unknown;
  };
```

and just below it:

```ts
  // Absent means slot 1, so every caller written before two-photograph slides
  // keeps working unchanged. A slot the markup does not use is refused rather
  // than silently written: it would store a photograph nothing renders.
  const slots = photoSlotsUsed(slide.designHtml);
  const requestedSlot = Number(o.slot);
  const slot = Number.isFinite(requestedSlot) && requestedSlot >= 1 ? requestedSlot : 1;
  if (slots.length > 0 && !slots.includes(slot)) {
    return NextResponse.json(
      { ok: false, error: `This slide has no photo slot ${slot}.` },
      { status: 400 },
    );
  }
```

Then where the chosen photograph is written onto the slide, write the LIST rather than the single field: read the existing ids with `parsePhotoAssetIds(slide.photoAssetIds, slide.backgroundAssetId)`, set index `slot - 1` to the new asset id, and store both `backgroundAssetId` (index 0, unchanged semantics) and `photoAssetIds: serialisePhotoAssetIds(next)`. Pass the same list as `photos` to `renderDesignedSlide` so the re-render shows both pictures.

- [ ] **Step 2: The panel offers the choice**

In `src/components/content-studio/SlidePhotoLibrary.tsx`, add to the props:

```ts
  /** Slot numbers this slide has. One entry (or none) hides the chooser entirely. */
  slots?: number[];
  /** Which slot a pick will replace. */
  activeSlot?: number;
  onSlotChange?: (slot: number) => void;
```

and render a chooser in the header row ONLY when `slots.length > 1`:

```tsx
        {slots.length > 1 && (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "none", letterSpacing: 0 }}>
              Replacing
            </span>
            {slots.map((s, i) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={s === activeSlot ? "secondary" : "ghost"}
                onClick={() => onSlotChange?.(s)}
                title={`Replace the ${i === 0 ? "first" : "second"} photograph`}
              >
                {i === 0 ? "First" : "Second"}
              </Button>
            ))}
          </div>
        )}
```

A one-photograph slide must look exactly as it does today — no chooser, no extra row.

- [ ] **Step 3: The editor carries the slot**

In `ImageDesigner.tsx`:
- Hold the chosen slot in state beside the photo panel, defaulting to 1, and reset it to 1 whenever the active slide changes (a slot number means nothing on a different slide).
- Pass `slots={photoSlotsUsed(activeSlide?.designHtml ?? "")}`, `activeSlot` and `onSlotChange` to `SlidePhotoLibraryPopout`.
- Include `slot` in the body of the photo-swap POST.
- In the redesign dialog's `newPhoto()`, include the same `slot` so "Make a new photo" replaces the picture the operator is pointing at rather than always the first.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npx next build`
Expected: all clean.

Then in a browser (`npm run dev`):
1. Open a one-photograph designed slide, open the PHOTOS panel: **no chooser appears**, and picking a photo swaps it exactly as before.
2. Generate a carousel on a comparison topic (for example "Infrared or HBOT: how the two actually differ") and find a slide the model gave two photographs. The panel shows First / Second.
3. Pick Second, click a library photo: only the lower picture changes.
4. Press "Make a new photo" with Second selected: the generated photograph lands in the second slot.
5. Reload the page: both photographs are still the ones you chose.

Step 5 is the one that proves Task 4 — if the second photograph reverts, the ids are not being stored.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts" src/components/content-studio/SlidePhotoLibrary.tsx src/components/content-studio/ImageDesigner.tsx
git commit -m "feat(content-studio): choose which photograph you are replacing

A two-photograph slide needs a target: picking a library photo had nowhere to
say WHICH picture it replaces, and 'Make a new photo' always meant the first.
The panel gains a First/Second chooser when -- and only when -- the slide has
two slots, and both the swap and the generate carry it.

Absent means slot 1 on the route, so every caller written before this keeps
working, and a slot the markup does not use is refused rather than stored as a
photograph nothing renders.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Ship

- [ ] **Step 1: Full verification**

```bash
npm run typecheck && npm test && npx next build 2>&1 | grep -E "Compiled successfully|Failed"
```
Expected: clean typecheck, all test files pass, `✓ Compiled successfully`.

- [ ] **Step 2: Deploy**

```bash
git push origin main
railway up --detach
until [ "$(curl -s -o /dev/null -w '%{http_code}' https://app.adonisagent.ie/api/health)" = "200" ] && railway status 2>&1 | grep -q "● Online$"; do sleep 10; done; echo live
```

A deploy restarts the app (a 502 window of roughly 30 seconds). The boot also runs the `photo_asset_ids` migration against every tenant database — confirm afterwards:

```bash
railway ssh "cd /app && NODE_PATH=/app/node_modules node -e \"
const D=require('better-sqlite3');
for (const f of ['clinic.db','tenants/optimal-health/optimal-health.db','tenants/inspire/inspire.db']) {
  const db=new D('/app/data/'+f,{readonly:true});
  const cols=db.prepare('PRAGMA table_info(carousel_slides)').all().map(c=>c.name);
  console.log(f, cols.includes('photo_asset_ids') ? 'migrated' : 'MISSING');
  db.close();
}\""
```
Expected: `migrated` for each.

- [ ] **Step 3: Record it**

Add a line to `/Users/truep/.claude/projects/-Users-truep-Desktop-Clients-Renova/memory/MEMORY.md` pointing at a new `two-photo-slides.md` memory, written with the frontmatter the other files use (`name`, `description`, `metadata.type: project`), covering: slot 1 is the bare token permanently; `photo_asset_ids` is null for one-photograph slides; the cap is two and why; and that `photoSlots.ts` is the only module that may know what a placeholder looks like.

---

## Self-Review

**Spec coverage.** Indexed token so the model can say what each slot shows — Task 3. One module owning the placeholder, killing the three bare literals — Tasks 1 and 2. JSON asset-ids column — Task 4. Per-slot substitution — Task 5. Per-slot stand-in (so the hit map does not go back to being wrong) — Tasks 2 and 5. Slot targeting in the photo panel AND in "Make a new photo" — Task 6. Back-compat — Tasks 1 (bare token is slot 1), 3 (both reply shapes parse), 4 (no data migration), 5 (`photo` shorthand renders identically), 6 (absent slot means 1). All covered.

**Placeholder scan.** No TBD or TODO. Every code step carries its code. Three steps (4.7 carousels.ts, 5.5 the stand-in, 5.6 the generator's rotation) tell the implementer to read the surrounding function before editing rather than quoting it verbatim — those are the sites whose current shape I could not pin exactly from line numbers alone, and each says precisely what to preserve.

**Type consistency.** `photos` is `(SlidePhoto | null)[]` on the render input (Task 5) and `string[]` of scenes on `RawDesign` (Task 3) — different things, deliberately: one is pictures, one is descriptions. They never meet in a signature. `photoSlotsUsed` returns `number[]` everywhere. `parsePhotoAssetIds` returns `(number | null)[]`, which is what Task 6 indexes into and what `serialisePhotoAssetIds` takes back. `MAX_PHOTO_SLOTS` is the single cap, used by the parse (Task 3), the store (Task 4) and the audit (Task 3).
