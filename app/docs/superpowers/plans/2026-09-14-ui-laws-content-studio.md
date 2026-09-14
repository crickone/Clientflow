# UI Laws in the Content Studio Designer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply four interaction laws to the image designer the operator lives in — Jakob's (keyboard conventions), Fitts's (target size and destructive-target separation), Von Restorff (one emphasis per view), Doherty (honest progress on long calls) — as five small, independently shippable tasks.

**Architecture:** Every piece of *logic* lands in a pure, dependency-free module under `src/lib/content-studio/` so it runs under the plain test runner (no React, no `server-only`). The React components (`ImageDesigner.tsx`, `SlidePhotoLibrary.tsx`) only *wire* those modules in. Hover/focus states go in `globals.css` — inline `style` objects cannot express pseudo-classes (the 2026-07 audit's root finding). Where a long request is split so the client can report real phases, the server gains an opt-in flag rather than a new route.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, framer-motion, lucide-react, Radix (via `components/ui/*`), plain `node:assert/strict` tests run by `scripts/test.mjs` with tsx.

## Global Constraints

- **NO EMOJIS** anywhere: UI copy, code, comments, commit messages, docs, tests. Use a `lucide-react` icon where a glyph is needed. The `⌘` / `⇧` glyphs in shortcut labels are keyboard symbols, not emojis, and are permitted.
- Tests are plain assertion scripts named `*.test.ts` under `src/`, discovered by `scripts/test.mjs` and run with tsx. Run one with `npm test -- src/path/to/file.test.ts`. Pattern: `import assert from "node:assert/strict"`, a local `check(name, cond)` helper that increments `passed`, `console.log` per check, final summary line. No test framework.
- A `*.test.ts` file cannot import anything that imports `server-only` or React. Pure modules only.
- Inline `style` cannot express `:hover` / `:focus-visible`. Hover-revealed controls get a class in `src/app/globals.css`.
- Before every deploy: `npm run typecheck`, `npm test`, `npx next build` must all pass. Deploy is `railway up` run from inside `app/`. `main` is the source of truth — commit and push before deploying.
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- `Button` variants are `"primary" | "secondary" | "ghost" | "destructive" | "outline"`; sizes are `"sm" | "md" | "lg" | "icon"` with heights 32 / 38 / 44 / 36px (`.btn--*` in `globals.css:252-255`). `size="md"` is the default.
- All paths below are relative to `app/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/content-studio/shortcuts.ts` (create) | Pure keymap: turns a keyboard event shape into a named designer action, or `null`. Knows which actions are suppressed while typing. Also formats a shortcut label per platform. |
| `src/lib/content-studio/shortcuts.test.ts` (create) | Tests for the above. |
| `src/lib/content-studio/progressLabel.ts` (create) | Pure: composes the label for a long-running dialog action from its phase and elapsed seconds. |
| `src/lib/content-studio/progressLabel.test.ts` (create) | Tests for the above. |
| `src/components/content-studio/emphasisBudget.test.ts` (create) | Source-level budget check: reads the designer's TSX and asserts the emphasis rules (at most one destructive button per file, no toggle that resolves to `"primary"`). |
| `src/components/content-studio/ImageDesigner.tsx` (modify) | Wire shortcuts (global keydown listener), Cmd+Enter in the two dialogs, size promotions, the logo toggle's variant, and the two-phase "Make a new photo" flow with phase labels. |
| `src/components/content-studio/SlidePhotoLibrary.tsx` (modify) | Photo tile: delete control becomes hover/focus-revealed and smaller-hit, off the pick target. |
| `src/app/globals.css` (modify) | `.photo-tile` / `.photo-tile-delete` hover rules. |
| `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts` (modify) | Accept `{ generate: true, onlyGenerate: true }`: make the photo, add it to the library, return it, touch nothing else. |
| `src/app/api/content-studio/carousels/[id]/redesign/route.ts` (modify) | Accept optional `photoAssetId` so a redesign can be told which photograph to design around. |

---

### Task 1: Pure shortcut resolver

**Files:**
- Create: `src/lib/content-studio/shortcuts.ts`
- Test: `src/lib/content-studio/shortcuts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DesignerAction = "undo" | "prevSlide" | "nextSlide" | "submit";
  export interface KeyLike {
    key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
    /** What the event landed on — an editable target suppresses navigation and undo. */
    target?: { tagName?: string; isContentEditable?: boolean } | null;
  }
  export function resolveShortcut(e: KeyLike): DesignerAction | null;
  export function shortcutLabel(key: string, opts?: { platform?: "mac" | "other"; shift?: boolean }): string;
  export function isMacPlatform(nav?: { platform?: string; userAgent?: string }): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/content-studio/shortcuts.test.ts
//
// The designer had no keyboard shortcuts at all. These pin the conventions
// operators bring from every other editor (Jakob's law): Cmd/Ctrl+Z undoes,
// arrows move between slides, Cmd/Ctrl+Enter submits a dialog — and none of
// the navigation ones fire while you are typing in a field.
import assert from "node:assert/strict";

import { isMacPlatform, resolveShortcut, shortcutLabel, type KeyLike } from "./shortcuts";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const base: KeyLike = { key: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null };
const input = { tagName: "INPUT", isContentEditable: false };
const textarea = { tagName: "TEXTAREA", isContentEditable: false };
const editable = { tagName: "DIV", isContentEditable: true };

check("Cmd+Z is undo", resolveShortcut({ ...base, key: "z", metaKey: true }) === "undo");
check("Ctrl+Z is undo too (Windows/Linux)", resolveShortcut({ ...base, key: "z", ctrlKey: true }) === "undo");
check("uppercase Z with shift is NOT undo (that is redo, which we do not offer)", resolveShortcut({ ...base, key: "Z", metaKey: true, shiftKey: true }) === null);
check("plain z is nothing", resolveShortcut({ ...base, key: "z" }) === null);

check("right arrow is next slide", resolveShortcut({ ...base, key: "ArrowRight" }) === "nextSlide");
check("left arrow is previous slide", resolveShortcut({ ...base, key: "ArrowLeft" }) === "prevSlide");
check("arrows with a modifier are left to the browser", resolveShortcut({ ...base, key: "ArrowRight", metaKey: true }) === null);

check("Cmd+Enter is submit", resolveShortcut({ ...base, key: "Enter", metaKey: true }) === "submit");
check("Ctrl+Enter is submit", resolveShortcut({ ...base, key: "Enter", ctrlKey: true }) === "submit");
check("plain Enter is not a designer shortcut", resolveShortcut({ ...base, key: "Enter" }) === null);

// Typing must never be hijacked.
check("undo inside an input is the browser's text undo, not ours", resolveShortcut({ ...base, key: "z", metaKey: true, target: input }) === null);
check("arrows inside a textarea move the caret, not the slide", resolveShortcut({ ...base, key: "ArrowRight", target: textarea }) === null);
check("arrows inside contenteditable are left alone", resolveShortcut({ ...base, key: "ArrowLeft", target: editable }) === null);
check("but Cmd+Enter DOES submit from inside a field — that is where you are when you want it", resolveShortcut({ ...base, key: "Enter", metaKey: true, target: textarea }) === "submit");

check("mac label uses the command glyph", shortcutLabel("Z", { platform: "mac" }) === "⌘Z");
check("other platforms spell it out", shortcutLabel("Z", { platform: "other" }) === "Ctrl+Z");
check("shift is shown", shortcutLabel("Z", { platform: "mac", shift: true }) === "⇧⌘Z");
check("Enter is named, not a glyph", shortcutLabel("Enter", { platform: "other" }) === "Ctrl+Enter");

check("mac detected from platform", isMacPlatform({ platform: "MacIntel" }) === true);
check("mac detected from user agent when platform is empty", isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }) === true);
check("windows is not mac", isMacPlatform({ platform: "Win32" }) === false);
check("no navigator at all is not mac", isMacPlatform(undefined) === false);

console.log(`\nshortcuts: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/content-studio/shortcuts.test.ts`
Expected: FAIL — `Cannot find module './shortcuts'`

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The designer's keyboard, as a pure keymap.
 *
 * Operators arrive with conventions from every other editor they use --
 * Cmd/Ctrl+Z undoes, arrows step between items, Cmd/Ctrl+Enter submits a
 * dialog -- and the designer honoured none of them (Jakob's law: people spend
 * most of their time in OTHER tools). This module decides what a key means;
 * the component decides what to do about it.
 *
 * Pure and dependency-free so it runs under the plain test runner. The event
 * is described by a small shape rather than a DOM KeyboardEvent for the same
 * reason.
 */

export type DesignerAction = "undo" | "prevSlide" | "nextSlide" | "submit";

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** What the event landed on — an editable target suppresses navigation and undo. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target: KeyLike["target"]): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has((target.tagName ?? "").toUpperCase());
}

/** Cmd on a Mac, Ctrl elsewhere — either counts as "the command key". */
function commandHeld(e: KeyLike): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * The action a key press means in the designer, or null when it means nothing
 * to us and the browser should have it.
 *
 * Undo and the arrows are suppressed while typing: Cmd+Z in a field is the
 * browser's own text undo, and arrows move the caret. Cmd+Enter is the one
 * shortcut that works FROM a field, because a field is where you are when you
 * want to submit what you typed.
 */
export function resolveShortcut(e: KeyLike): DesignerAction | null {
  if (e.altKey) return null;

  if (e.key === "Enter" && commandHeld(e) && !e.shiftKey) return "submit";

  if (isTyping(e.target)) return null;

  if (e.key === "z" && commandHeld(e) && !e.shiftKey) return "undo";

  if (!commandHeld(e) && !e.shiftKey) {
    if (e.key === "ArrowRight") return "nextSlide";
    if (e.key === "ArrowLeft") return "prevSlide";
  }

  return null;
}

/**
 * Whether we are on a Mac, from a navigator-like object. `platform` is the
 * reliable signal where it is still populated; the user agent covers the
 * browsers that have emptied it.
 */
export function isMacPlatform(nav?: { platform?: string; userAgent?: string }): boolean {
  if (!nav) return false;
  if (/mac/i.test(nav.platform ?? "")) return true;
  return /Macintosh|Mac OS X/i.test(nav.userAgent ?? "");
}

/**
 * A shortcut as it should be printed in a title or hint: "⌘Z" on a Mac,
 * "Ctrl+Z" elsewhere. The glyphs are keyboard symbols, the same ones macOS
 * prints in its own menus.
 */
export function shortcutLabel(
  key: string,
  opts: { platform?: "mac" | "other"; shift?: boolean } = {},
): string {
  const mac = opts.platform === "mac";
  if (mac) return `${opts.shift ? "⇧" : ""}⌘${key}`;
  return `${"Ctrl+"}${opts.shift ? "Shift+" : ""}${key}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/content-studio/shortcuts.test.ts`
Expected: `shortcuts: 22 checks passed` and `✓ 1/1 test file(s) passed`

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-studio/shortcuts.ts src/lib/content-studio/shortcuts.test.ts
git commit -m "feat(content-studio): a pure keymap for the designer's shortcuts

Cmd/Ctrl+Z, arrow keys and Cmd/Ctrl+Enter resolved to named actions, with
typing suppression, ahead of wiring them into the designer. Pure so it runs
under the plain test runner.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Wire the shortcuts into the designer

**Files:**
- Modify: `src/components/content-studio/ImageDesigner.tsx`
  - imports block (top of file, after the lucide import ending at line 24)
  - the `undoSlide` callback and `undoDepth` (lines 462-481)
  - the slide-actions row (lines 1694-1722: Add slide / Undo)
  - the Generate-carousel dialog's `<form>` with the topic `<Textarea>` and `<Button type="submit">` (around lines 2700-2725)
  - the Redesign dialog's `<Input id="redesign-note">` `onKeyDown` (line 3241)

**Interfaces:**
- Consumes: `resolveShortcut`, `shortcutLabel`, `isMacPlatform` from Task 1.
- Consumes (already in the component): `undoSlide()`, `undoDepth: number`, `activeIdx`, `setActiveIdx(idx: number)`, `slidesInSlot: CarouselSlide[]` (the slides in the current slot, defined around line 420), `writing: boolean`.

There is no test for this task — it is React wiring, and the logic it wires is tested in Task 1. Verification is manual, in the browser, and is spelled out in Step 5.

- [ ] **Step 1: Import the keymap**

At the top of `ImageDesigner.tsx`, after the existing `import { PHOTO_PANEL_WIDTH, SlidePhotoLibraryPopout } from "./SlidePhotoLibrary";` line, add:

```ts
import { isMacPlatform, resolveShortcut, shortcutLabel } from "@/lib/content-studio/shortcuts";
```

- [ ] **Step 2: Add the global listener next to `undoDepth`**

Directly after the line `const undoDepth = activeSlide ? (undoStacks[activeSlide.id]?.length ?? 0) : 0;` (line 481), add:

```ts
  /**
   * The designer's keyboard. One listener on the window, resolved through the
   * pure keymap, so what a key means is tested and what it does is here.
   *
   * Arrows are clamped, not wrapped: reaching the last slide and pressing
   * right doing nothing is what every filmstrip does. Undo only fires when
   * there is something to undo, so the browser keeps Cmd+Z everywhere else.
   * Nothing fires while a whole-design run is writing -- the slides are about
   * to be replaced and stepping through them would be stepping through ghosts.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (writing) return;
      const action = resolveShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        target: e.target instanceof HTMLElement
          ? { tagName: e.target.tagName, isContentEditable: e.target.isContentEditable }
          : null,
      });
      if (action === "undo") {
        if (undoDepth === 0) return;
        e.preventDefault();
        undoSlide();
      } else if (action === "nextSlide") {
        if (activeIdx >= slidesInSlot.length - 1) return;
        e.preventDefault();
        setActiveIdx(activeIdx + 1);
      } else if (action === "prevSlide") {
        if (activeIdx <= 0) return;
        e.preventDefault();
        setActiveIdx(activeIdx - 1);
      }
      // "submit" is handled by the dialogs themselves: it means nothing at
      // the window level, where there is no form to submit.
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [writing, undoDepth, undoSlide, activeIdx, slidesInSlot.length]);

  const shortcutPlatform = isMacPlatform(typeof navigator === "undefined" ? undefined : navigator)
    ? "mac"
    : "other";
```

If `slidesInSlot` is declared *after* line 481 in the file, move this block to just after `slidesInSlot`'s declaration instead — the effect must come after every value it closes over.

- [ ] **Step 3: Say the shortcut on the Undo button**

Replace the Undo button's `title` (lines 1704-1708):

```tsx
                  title={
                    undoDepth === 1
                      ? `Put this slide back the way it was (${shortcutLabel("Z", { platform: shortcutPlatform })})`
                      : `Step back through ${undoDepth} changes to this slide (${shortcutLabel("Z", { platform: shortcutPlatform })})`
                  }
```

- [ ] **Step 4: Cmd+Enter submits both dialogs**

In the Generate-carousel dialog, find the `<Textarea` that holds the topic inside the `<form onSubmit=...>` (around line 2700). Add an `onKeyDown` to it:

```tsx
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits from inside the box, where you are
                  // when you have finished typing. Plain Enter stays a newline:
                  // a topic is often more than one line.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
```

In the Redesign dialog, replace the `<Input id="redesign-note">`'s existing `onKeyDown` (line 3241-3243):

```tsx
              onKeyDown={(e) => {
                // A single-line field submits on Enter by convention; Cmd/Ctrl+Enter
                // is honoured too so the habit from the topic box carries over.
                if (e.key === "Enter" && busy === null) {
                  e.preventDefault();
                  void redesign();
                }
              }}
```

- [ ] **Step 5: Typecheck, then verify in the browser**

Run: `npm run typecheck`
Expected: no output after the `tsc --noEmit` line.

Run: `npm run dev`, open a design with at least two slides, then:
1. Press → and ← with nothing focused: the active slide in the filmstrip changes; at the last slide → does nothing.
2. Click into the design-name field and press ←: the caret moves, the slide does not.
3. Open Redesign slide, press Try a different design, wait for it, then press Cmd+Z (Ctrl+Z on Windows): the slide reverts and the Undo button's count drops.
4. Open Generate carousel, type a topic, press Cmd+Enter: the form submits.
5. Hover the Undo button: the title ends in `(⌘Z)` on a Mac.

- [ ] **Step 6: Commit**

```bash
git add src/components/content-studio/ImageDesigner.tsx
git commit -m "feat(content-studio): the designer answers the keyboard

Cmd/Ctrl+Z undoes the active slide, arrow keys step through the filmstrip,
Cmd/Ctrl+Enter submits the Generate and Redesign dialogs. None of the
navigation keys fire while typing. The app had no shortcuts at all; these are
the ones every other editor has taught operators to expect (Jakob's law).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Fitts — delete off the pick target, frequent buttons bigger

**Files:**
- Modify: `src/components/content-studio/SlidePhotoLibrary.tsx` (the tile, lines 246-325)
- Modify: `src/app/globals.css` (append after the `.cs-*` Content Studio block, around line 359)
- Modify: `src/components/content-studio/ImageDesigner.tsx`
  - Add slide button (line 1694-1702)
  - Generate carousel trigger (line 2652-2660)
  - Redesign slide trigger (lines 3218-3226)

**Interfaces:**
- No new exports. The tile gains two class names, `photo-tile` and `photo-tile-delete`, whose only consumers are the CSS rules added here.

There is no unit test for this task (CSS and JSX attributes). Verification is manual in Step 4. Do not add a test that only re-asserts the string you typed.

- [ ] **Step 1: The tile's delete control is hover-revealed and off the pick target**

In `SlidePhotoLibrary.tsx`, on the tile's outer `<div key={asset.id} ...>` (line 249) add `className="photo-tile"` as the first attribute after `key`. Then replace the whole `<Tooltip label="Remove from library">...</Tooltip>` block (lines 298-322) with:

```tsx
                {/* Hidden until the tile is hovered or holds focus (rules in
                    globals.css -- inline style cannot express :hover). The
                    pick target is the whole tile; the destructive one is a
                    small corner that only exists once you are already on
                    the tile, so a stray click on a photograph cannot land on
                    Remove (Fitts's law: make the dangerous target the small,
                    deliberate one). */}
                <Tooltip label="Remove from library">
                  <button
                    type="button"
                    className="photo-tile-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (applying) return;
                      onDelete(asset.id);
                    }}
                    aria-label="Remove from library"
                  >
                    <Trash2 size={11} />
                  </button>
                </Tooltip>
```

- [ ] **Step 2: The CSS**

Append to `src/app/globals.css`, immediately after the line `@media (max-width: 720px) { .cs-create { grid-template-columns: 1fr; } }`:

```css
/* Photo library tiles (content-studio/SlidePhotoLibrary). The delete control
   is invisible until the tile is hovered or focused, and sits in the bottom
   corner away from where a pick lands. Always visible when hover is not a
   thing (touch), because there is no hover to reveal it with. */
.photo-tile-delete {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.12s var(--ease);
}
.photo-tile:hover .photo-tile-delete,
.photo-tile:focus-within .photo-tile-delete,
.photo-tile-delete:focus-visible { opacity: 1; }
.photo-tile-delete:hover { background: rgba(220, 38, 38, 0.85); }
@media (hover: none) { .photo-tile-delete { opacity: 1; } }
```

- [ ] **Step 3: Promote the frequent buttons to the default size**

In `ImageDesigner.tsx`, remove `size="sm"` from exactly these three buttons, leaving every other attribute as it is:

1. Add slide (line 1694-1702): the `<Button variant="outline" size="sm" onClick={() => addSlide()} ...>` becomes `<Button variant="outline" onClick={() => addSlide()} ...>`.
2. Generate carousel trigger (line 2652-2660): `<Button variant="outline" size="sm" title="Generate a full carousel on a topic with Claude">` becomes `<Button variant="outline" title="Generate a full carousel on a topic with Claude">`.
3. Redesign slide trigger (line 3218-3226): `<Button variant="outline" size="sm" title="Ask Adonis for a different design for this slide">` becomes `<Button variant="outline" title="Ask Adonis for a different design for this slide">`.

Leave `Delete slide` (ghost, sm) and `Delete design` (destructive, sm) small: a destructive target should be the harder one to hit. Leave Undo small too — it is reached by keyboard now.

- [ ] **Step 4: Typecheck, then verify in the browser**

Run: `npm run typecheck`
Expected: clean.

Run: `npm run dev`, open a design, open the PHOTOS panel:
1. Tiles show no trash icon until the pointer is over one; then a 22px control appears bottom-right.
2. Clicking anywhere on the photograph except that corner picks the photo (border highlights, slide updates).
3. Tab into the grid: the focused tile's control appears without a mouse.
4. Add slide, Generate carousel and Redesign slide are visibly taller (38px) than Delete slide (32px).

- [ ] **Step 5: Commit**

```bash
git add src/components/content-studio/SlidePhotoLibrary.tsx src/app/globals.css src/components/content-studio/ImageDesigner.tsx
git commit -m "fix(content-studio): the destructive target is the small one

The photo tile carried its Remove button on top of the pick target, so the
most frequent click in the panel and the one that deletes shared the same
square. Remove is now revealed on hover or focus, in the corner, and the
whole tile is the pick. The three buttons an operator hits all session --
Add slide, Generate carousel, Redesign slide -- go up to the default 38px;
the two that delete stay at 32px (Fitts's law, both directions).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Von Restorff — an emphasis budget, and a test that keeps it

**Files:**
- Modify: `src/components/content-studio/ImageDesigner.tsx` (the logo toggle, line 1334-1352)
- Create: `src/components/content-studio/emphasisBudget.test.ts`

**Interfaces:**
- None. The test reads source files from disk with `node:fs`; it imports nothing from the components.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/content-studio/emphasisBudget.test.ts`
Expected: FAIL on `no toggle in the designer borrows the primary weight` — the logo toggle at line 1337 is `variant={showLogo ? "primary" : "outline"}`.

- [ ] **Step 3: Give the logo toggle its own weight**

In `ImageDesigner.tsx` line 1337, change:

```tsx
              variant={showLogo ? "primary" : "outline"}
```

to:

```tsx
              // A toggle's ON state must not look like the page's primary
              // action -- it sat in the top bar at the same weight as the one
              // button that should own it. Secondary reads as "on" without
              // competing (Von Restorff: emphasis works only when scarce).
              variant={showLogo ? "secondary" : "outline"}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/components/content-studio/emphasisBudget.test.ts`
Expected: `emphasisBudget: 4 checks passed`

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/content-studio/ImageDesigner.tsx src/components/content-studio/emphasisBudget.test.ts
git commit -m "fix(content-studio): the logo toggle stops impersonating the primary action

Its ON state rendered as a primary button in the top bar, beside the one red
Delete. Secondary now. A source-level test keeps the budget: one destructive
button in the designer, no toggle that resolves to primary, none of either
in the photo panel (Von Restorff: emphasis is worth exactly its scarcity).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Doherty — honest phases on "Make a new photo" and "Redesign"

The whole-design run already reports real stages from the server (`Designing 5 slides` / `Drawing slide 2 of 5` / `Correcting ...`, via `setGenerationStage`). The two dialog actions do not: "Make a new photo" on a flat-ground slide is an image generation followed by a full redesign inside ONE request, and the button just says "Making a photo, then redesigning…" for up to a minute. The fix is to split it into two requests the client drives, so the phase it shows is the phase that is happening, and to show elapsed seconds on both actions so time is visibly passing.

**Files:**
- Create: `src/lib/content-studio/progressLabel.ts`
- Test: `src/lib/content-studio/progressLabel.test.ts`
- Modify: `src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts` (the `generate === true` branch, lines 107-141)
- Modify: `src/app/api/content-studio/carousels/[id]/redesign/route.ts` (body parsing at lines 46-63, the `photo` line at 63)
- Modify: `src/components/content-studio/ImageDesigner.tsx` (RedesignSlideDialog: state at 3135-3138, `newPhoto()` at 3200-3208, the two buttons at 3258-3281)

**Interfaces:**
- Produces:
  ```ts
  export type DialogPhase = "designing" | "photo" | "photoThenDesign";
  export function progressLabel(phase: DialogPhase, elapsedSeconds: number): string;
  ```
- Photo route, new request shape: `{ generate: true, onlyGenerate: true }` → response `{ ok: true, asset: ImageLibraryAsset }`, slide untouched.
- Redesign route, new optional field: `{ slideId, note, photoAssetId?: number }` — when given, that library asset is the photograph the redesign may use.

- [ ] **Step 1: Write the failing test for the label**

```ts
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

console.log(`\nprogressLabel: ${passed} checks passed`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/content-studio/progressLabel.test.ts`
Expected: FAIL — `Cannot find module './progressLabel'`

- [ ] **Step 3: Write the label module**

```ts
/**
 * What a dialog's button says while a long call runs.
 *
 * Past about 400ms a wait needs feedback or it reads as broken (the Doherty
 * threshold), and a bare "Designing…" for forty seconds is feedback only in
 * the first two of them. The seconds make time visibly pass; the step count
 * makes the two-request photo path say which request it is on. Pure, so the
 * copy is pinned by a test rather than left to drift.
 */

export type DialogPhase = "designing" | "photo" | "photoThenDesign";

const WORDING: Record<DialogPhase, string> = {
  designing: "Designing…",
  photo: "Making the photo…",
  photoThenDesign: "Making the photo (1 of 2)…",
};

/** Seconds are shown once a few have passed: "1s" flickering on is a glitch, not information. */
const SHOW_SECONDS_FROM = 3;

export function progressLabel(phase: DialogPhase, elapsedSeconds: number): string {
  const s = Math.floor(elapsedSeconds);
  const base = WORDING[phase];
  return s >= SHOW_SECONDS_FROM ? `${base} ${s}s` : base;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/content-studio/progressLabel.test.ts`
Expected: `progressLabel: 6 checks passed`

- [ ] **Step 5: The photo route can generate WITHOUT applying**

In `photo/route.ts`, change the body type on line 102 from:

```ts
  const o = (body ?? {}) as { assetId?: unknown; generate?: unknown };
```

to:

```ts
  const o = (body ?? {}) as { assetId?: unknown; generate?: unknown; onlyGenerate?: unknown };
```

Then, inside the `if (o.generate === true) {` branch, directly after the line `if (!photo.path) photo = null;` (line 133) and before the `} catch (err) {`, add:

```ts
      // The client's two-step path: make the photograph, put it in the
      // library, hand it back, and touch nothing else. The client then
      // decides -- swap it in, or redesign around it -- and can say which
      // step it is on while it does, which one long request never could.
      if (o.onlyGenerate === true) {
        return NextResponse.json({ ok: true, asset });
      }
```

- [ ] **Step 6: The redesign route accepts the photograph to design around**

In `redesign/route.ts`, change the body type (line 46) from:

```ts
  let body: { slideId?: unknown; note?: unknown };
```

to:

```ts
  let body: { slideId?: unknown; note?: unknown; photoAssetId?: unknown };
```

And replace line 63:

```ts
  const photo = photoChoiceFor(slide.backgroundAssetId);
```

with:

```ts
  // The photograph the redesign may use: one the caller just made (the
  // two-step "make a new photo" path) or, failing that, the one this slide
  // already had -- so a plain redesign keeps its picture rather than
  // silently reverting to the library's first.
  const requestedPhotoId = Number(body?.photoAssetId);
  const photo = photoChoiceFor(
    Number.isFinite(requestedPhotoId) && requestedPhotoId > 0
      ? requestedPhotoId
      : slide.backgroundAssetId,
  );
```

- [ ] **Step 7: The dialog drives the two steps and shows the phase**

In `ImageDesigner.tsx`, RedesignSlideDialog. Add the import at the top of the file, next to the shortcuts import from Task 2:

```ts
import { progressLabel, type DialogPhase } from "@/lib/content-studio/progressLabel";
```

Replace the state line (3137):

```ts
  const [busy, setBusy] = useState<null | "design" | "photo">(null);
```

with:

```ts
  const [busy, setBusy] = useState<null | DialogPhase>(null);
  // Seconds since the current action started, ticking once a second while
  // busy. Reset with busy so a second action never inherits the first's clock.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (busy === null) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [busy]);
```

Change `redesign()` (line 3187) to set the new phase name: `setBusy("design")` becomes `setBusy("designing")`.

Replace `newPhoto()` (lines 3200-3208) with:

```ts
  /**
   * Two requests, so the button can say which one is running. Step 1 makes
   * the photograph and returns it. Step 2 is whichever this slide needs: a
   * swap when its markup has a photo slot, a redesign around the picture
   * when it does not. Everything the server does in one call it can do in
   * two; what it cannot do in one is tell the operator it is halfway.
   */
  async function newPhoto() {
    setBusy(hasPhotoSlot ? "photo" : "photoThenDesign");
    setError(null);
    let asset: ImageLibraryAsset | null = null;
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/photo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generate: true, onlyGenerate: true }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      const json = await res.json().catch(() => null);
      if (!json?.ok || !json.asset) {
        setError(json?.error ?? `Couldn't make the photo (HTTP ${res.status}).`);
        setBusy(null);
        return;
      }
      asset = json.asset as ImageLibraryAsset;
    } catch {
      setError("Couldn't reach the server. Try again in a moment.");
      setBusy(null);
      return;
    }

    if (hasPhotoSlot) {
      await post(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/photo`,
        { assetId: asset.id },
        (json) => json.slide as CarouselSlide | undefined,
      );
    } else {
      setBusy("designing");
      onBeforeRedesign();
      await post(
        `/api/content-studio/carousels/${designId}/redesign`,
        { slideId: slide.id, note: "Use the photograph on this slide.", photoAssetId: asset.id },
        (json) =>
          (json.carousel?.slides as CarouselSlide[] | undefined)?.find(
            (sl) => sl.id === slide.id,
          ),
      );
    }
    setBusy(null);
  }
```

`ImageLibraryAsset` is already imported in this file (line 56 area, `import type { ImageLibraryAsset } from "@/lib/db/schema";`) — confirm with `grep -n "ImageLibraryAsset" src/components/content-studio/ImageDesigner.tsx | head -1`; add the import if it is missing.

Replace the two buttons' labels. The redesign button (lines 3258-3269) becomes:

```tsx
            <Button onClick={redesign} disabled={busy !== null}>
              {busy === "designing" ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              {busy === "designing"
                ? progressLabel("designing", elapsed)
                : note.trim()
                  ? "Redesign with that"
                  : "Try a different design"}
            </Button>
```

The photo button (lines 3270-3281, inside `{imageGenEnabled && (`) becomes:

```tsx
              <Button variant="outline" onClick={newPhoto} disabled={busy !== null}>
                {busy === "photo" || busy === "photoThenDesign" ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <ImageIcon size={15} />
                )}
                {busy === "photo" || busy === "photoThenDesign"
                  ? progressLabel(busy, elapsed)
                  : "Make a new photo"}
              </Button>
```

Note: when the two-step path reaches its second request it sets `busy` to `"designing"`, so the *redesign* button is the one that shows `Designing… 12s` for step 2, and the photo button goes idle-disabled. That is correct: step 2 is a redesign.

- [ ] **Step 8: Typecheck, run all tests, verify in the browser**

Run: `npm run typecheck && npm test`
Expected: clean typecheck; `✓ 174/174 test file(s) passed` (171 existing + shortcuts + progressLabel + emphasisBudget).

Run: `npm run dev`, open a design whose active slide has NO photograph (a plaster/sage panel), open Redesign slide, press Make a new photo:
1. The button reads `Making the photo (1 of 2)…`, then after three seconds `Making the photo (1 of 2)… 3s`, counting.
2. When the photo lands, the other button takes over: `Designing… 4s`, counting from its own zero.
3. The slide comes back redesigned around the new photograph; the library gained one image.
4. On a slide that HAS a photograph, the same button reads `Making the photo…` and the swap happens with no second phase.
5. Try a different design on its own shows `Designing… Ns` counting.

- [ ] **Step 9: Commit**

```bash
git add src/lib/content-studio/progressLabel.ts src/lib/content-studio/progressLabel.test.ts "src/app/api/content-studio/carousels/[id]/slides/[slideId]/photo/route.ts" "src/app/api/content-studio/carousels/[id]/redesign/route.ts" src/components/content-studio/ImageDesigner.tsx
git commit -m "feat(content-studio): the redesign dialog says what it is doing, and for how long

Make a new photo on a flat-ground slide was one request that ran an image
generation and then a full redesign -- up to a minute behind a label that
never changed. It is two requests now, driven by the dialog: the photo route
can generate without applying ({ onlyGenerate }), and the redesign route can
be told which photograph to design around ({ photoAssetId }). So the button
reads 'Making the photo (1 of 2)… 8s' and then 'Designing… 5s', each counting
from its own start. The plain redesign counts too. Past ~400ms a wait needs
feedback (Doherty); past twenty seconds it needs a clock.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Ship

**Files:** none new.

- [ ] **Step 1: Full verification**

Run, from `app/`:

```bash
npm run typecheck && npm test && npx next build 2>&1 | grep -E "Compiled successfully|Failed|Error"
```

Expected: clean typecheck, `✓ 174/174 test file(s) passed`, `✓ Compiled successfully`.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
railway up --detach
```

Then poll until the app is serving the new build:

```bash
until [ "$(curl -s -o /dev/null -w '%{http_code}' https://app.adonisagent.ie/api/health)" = "200" ] && railway status 2>&1 | grep -q "● Online$"; do sleep 10; done; echo live
```

Expected: `live`. A deploy restarts the app (a 502 window of ~30s); tell the operator before running it if they are mid-generation.

- [ ] **Step 3: Record it**

Append one line to `/Users/truep/.claude/projects/-Users-truep-Desktop-Clients-Renova/memory/MEMORY.md` under the Content Studio entries:

```
- [UI laws in the designer](ui-laws-designer.md) — shortcuts (Cmd+Z/arrows/Cmd+Enter via lib/content-studio/shortcuts.ts), hover-revealed tile delete, size promotions, emphasis-budget source test, two-step photo path with progressLabel; shipped 2026-09-14
```

and create `ui-laws-designer.md` beside it with the frontmatter the other memory files use (`name`, `description`, `metadata.type: project`) and a five-line summary of what each task changed and where the pure modules live.

---

## Self-Review

**Spec coverage.**
- Keyboard shortcuts: Cmd+Z → Task 1+2 (`undo`); arrows between slides → Task 1+2 (`prevSlide`/`nextSlide`); Cmd+Enter submit → Task 1+2 (both dialogs). Covered.
- Fitts: delete off the photo tile → Task 3; "delete off the filmstrip" from the brief — the filmstrip (`SlideFilmstrip.tsx`) carries **no** delete control (checked: it exposes only `onSelect`, `onReorder`, `onAdd`), so there is nothing to move; Delete slide already lives in the actions row as a ghost button. Frequent buttons to `md` → Task 3. Covered.
- Von Restorff: one primary per view → Task 4 (the only violation found was the logo toggle; the three `variant="primary"` buttons in the file each live in a different dialog/panel, which is one per view); red reserved → Task 4's test pins exactly one destructive button. Covered.
- Doherty: phased labels on long AI calls → Task 5 for the dialog actions. The whole-design run already has server stages and is deliberately left alone. Covered.

**Placeholder scan.** No TBD/TODO. Every code step has the code. Line numbers are as of commit `9a54c51`; Task 2's note about `slidesInSlot` ordering covers the one place a line reference could mislead.

**Type consistency.** `DialogPhase` is `"designing" | "photo" | "photoThenDesign"` in Task 5's module, state, and `progressLabel` calls; `redesign()` is changed from `setBusy("design")` to `setBusy("designing")` in Step 7 and the button test at line 3258 is updated to match. `resolveShortcut`'s `KeyLike.target` shape matches what Task 2 constructs from `HTMLElement`. `onlyGenerate` and `photoAssetId` are spelled identically in the routes and the client. `shortcutLabel`'s `platform` option is `"mac" | "other"` in both the module and `shortcutPlatform`.
