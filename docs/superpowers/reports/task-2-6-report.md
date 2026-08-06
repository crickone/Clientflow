# UI Motion System — Tasks 2–6 Report

**Scope:** Tasks 2, 3, 4, 5, 6 of `docs/superpowers/plans/2026-07-14-ui-motion-system.md`.
Task 1 (foundation: `motion` dependency, `src/lib/motion.ts`, `MotionRoot.tsx`, root
`layout.tsx` wiring) was already done prior to this run — verified present and untouched.

Per the calling instructions: **no git commands were run** (this project ships via
Railway from the working directory, not git). All "Commit" steps in the plan were
skipped. Tasks 7, 8, 9 (rollout to Dashboard/list views, reduced-motion audit for
loops, deploy) were explicitly out of scope and NOT touched.

## Files created

- `app/src/components/motion/Reveal.tsx` — `<Reveal>` + `<RevealGroup>`, copied
  verbatim from the plan's Task 2 code block. Consumes `revealVariants`,
  `staggerContainer`, `STAGGER_CAP` from `@/lib/motion`.
- `app/src/app/template.tsx` — route-change fade+rise wrapper, copied verbatim
  from the plan's Task 4 code block. `motion.div` with `initial={{opacity:0,y:6}}`
  → `animate={{opacity:1,y:0}}`, `transition={{ duration: DUR.base, ease: [...EASE] }}`.

## Files modified

### `app/src/components/ui/Card.tsx` (Task 3)
- Added `"use client"` as the first line.
- Added `import { motion } from "motion/react"` and `import { DUR, EASE } from "@/lib/motion"`.
- Extracted the shared inline style object into `const baseStyle`.
- `Card` forwardRef now accepts `interactive?: boolean`. Non-interactive path
  (`!interactive`) renders the original plain `<div>` — byte-for-byte the same
  visual behavior as before. Interactive path renders `motion.div` with
  `whileHover={{ y: -2, boxShadow: "var(--shadow-2)", borderColor: "var(--hairline-strong)" }}`,
  `whileTap={{ y: 1 }}`, `transition={{ duration: DUR.fast, ease: [...EASE] }}`,
  cursor: pointer, and the rest-prop spread cast as
  `(rest as React.ComponentProps<typeof motion.div>)`.
- `CardLabel` and `CardValue` exports left completely unchanged.

### `app/src/components/ui/Dialog.tsx` (Task 5)
- `DialogPrimitive.Overlay`: added `className="anim-overlay"`, removed the inline
  `animation: "fade-up 0.18s var(--ease)"`. All other inline styles (position,
  inset, background, backdropFilter, zIndex) kept.
- `DialogPrimitive.Content`: added `className="anim-dialog"` (placed before the
  `{...props}` spread, matching the existing prop order), removed the inline
  `animation: "fade-up 0.22s var(--ease)"`. Kept `transform: "translate(-50%, -50%)"`
  and all positioning/sizing/border/shadow inline styles — the `dialog-in`/`dialog-out`
  keyframes reference that same resting transform.
- Verified no call site anywhere in `src` passes its own `className` to
  `DialogContent`, so there's no override risk.

### `app/src/components/ui/Sheet.tsx` (Task 5)
- `DialogPrimitive.Overlay`: added `className="anim-overlay"`, removed inline
  `animation: "fade-up 0.15s var(--ease)"`.
- `DialogPrimitive.Content`: added `className="anim-sheet"` (before `{...props}`,
  after the existing `aria-describedby={undefined}`), removed inline
  `animation: "sheet-in 0.24s var(--ease)"`. Kept all positioning styles (top,
  right, height, width, borderLeft, boxShadow, flex layout).
- Verified no call site passes its own `className` to `SheetContent`.

### `app/src/app/globals.css` (Task 5)
Appended immediately after the existing `.md-toolbar-btn[aria-pressed="true"]`
rule (previously the last rule in the file, ~line 1054–1057), verbatim from the
plan:
```css
@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes overlay-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes dialog-in { from { opacity: 0; transform: translate(-50%, -50%) scale(0.98); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
@keyframes dialog-out { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(0.98); } }
@keyframes sheet-in-x { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes sheet-out-x { from { transform: translateX(0); } to { transform: translateX(100%); } }

.anim-overlay[data-state="open"] { animation: overlay-in 0.18s cubic-bezier(0.2,0.8,0.2,1); }
.anim-overlay[data-state="closed"] { animation: overlay-out 0.12s cubic-bezier(0.2,0.8,0.2,1); }
.anim-dialog[data-state="open"] { animation: dialog-in 0.18s cubic-bezier(0.2,0.8,0.2,1); }
.anim-dialog[data-state="closed"] { animation: dialog-out 0.12s cubic-bezier(0.2,0.8,0.2,1); }
.anim-sheet[data-state="open"] { animation: sheet-in-x 0.22s cubic-bezier(0.2,0.8,0.2,1); }
.anim-sheet[data-state="closed"] { animation: sheet-out-x 0.16s cubic-bezier(0.2,0.8,0.2,1); }

@media (prefers-reduced-motion: reduce) {
  .anim-overlay, .anim-dialog, .anim-sheet { animation-duration: 0.01ms !important; }
}
```
The pre-existing `fade-up` and `sheet-in` keyframes (used elsewhere historically)
were left in place, untouched — the plan only says to add the new classes, not
remove the old keyframe defs (only their *usages* in Dialog.tsx/Sheet.tsx were
removed).

### `app/src/components/layout/Sidebar.tsx` (Task 6)
- Added imports: `import { motion } from "motion/react";` and
  `import { EASE, DUR } from "@/lib/motion";` (file already started with
  `"use client"`, so this is a safe addition).
- In `renderLink`, replaced the plain absolutely-positioned `<span aria-hidden .../>`
  active accent bar with:
  ```tsx
  {active && (
    <motion.span
      layoutId="nav-active-bar"
      aria-hidden
      style={{ position: "absolute", left: 0, top: 5, bottom: 5, width: 3, background: "var(--accent)" }}
      transition={{ duration: DUR.base, ease: [...EASE] }}
    />
  )}
  ```
  Same visual resting style as before; now slides via `layoutId` on route change
  instead of snapping.

## Global constraints check
- Every file importing `{ motion } from "motion/react"` has `"use client"` as its
  first line: `Reveal.tsx`, `Card.tsx`, `template.tsx` all start with it;
  `Sidebar.tsx` already had it.
- All new/changed motion only animates `transform`/`opacity` (`y`, `scale`,
  `translate`, `opacity`, plus `boxShadow`/`borderColor` on Card hover — these two
  are visual-only color/shadow properties, not layout-affecting, matching the
  plan's own verbatim Task 3 code exactly).
- No inline one-off durations were introduced in TS/TSX — all motion values come
  from `DUR`/`EASE` in `@/lib/motion`. The CSS keyframe durations
  (0.12s/0.16s/0.18s/0.22s) and the `cubic-bezier(0.2,0.8,0.2,1)` curve are the
  plan's own verbatim CSS block (CSS can't `@import` a TS token, and the ease
  values match `EASE` numerically) — this is exactly Task 5 as specified, not a
  deviation.
- Did not touch `src/app/site/*` or `src/app/cms/*/studio`.
- No git commands run; nothing committed.

## Verification

1. `cd app && npm run typecheck` → **exit 0**, no output (clean).
2. `cd app && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"` →
   **`✓ Compiled successfully`**. Full build log reviewed — no warnings or errors
   anywhere in the output, all routes (including every one touched transitively
   by the root `template.tsx` and `Sidebar.tsx`) built successfully.

## Concerns

- None blocking. Two small notes carried over faithfully from the plan itself
  (not introduced by this implementation):
  - `Card.tsx`'s interactive hover style references `var(--hairline-strong)`,
    which is the plan's verbatim code; it was not verified as a defined CSS
    custom property in `globals.css` (if undefined, the browser simply ignores
    that one declaration — border color would just not shift on hover — it does
    not break anything or fail the build).
  - Task 5's CSS keyframe durations/easing are hand-duplicated numeric literals
    matching `DUR`/`EASE` rather than importing the token (impossible in plain
    CSS) — this is by design per the plan's own "Rationale" note, not a gap.
