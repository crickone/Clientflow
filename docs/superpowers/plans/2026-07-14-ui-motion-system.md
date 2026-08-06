# UI Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a subtle, premium, app-wide motion layer (card hovers, gentle reveals/stagger, dialog enter+exit, smooth route changes) to the ClientFlow admin app.

**Architecture:** A small motion foundation (Framer Motion + shared duration/easing tokens + one root `MotionConfig`) and ~4 reusable **client-wrapper** components that animate **server-rendered children** (so React Server Components keep fetching data on the server). Radix dialog/sheet exit uses Radix-native CSS `[data-state="closed"]` animations (Radix defers unmount for CSS animations — simpler/more robust than wrapping Radix in `AnimatePresence`). Everything pulls from the tokens; nothing animates anything but `transform`/`opacity`.

**Tech Stack:** Next.js 14 (App Router, RSC), React 18, TypeScript, Framer Motion (`motion` package), Radix UI, existing `globals.css` design tokens.

## Global Constraints

- Working directory for all commands: `app/` (the Next.js app). Repo root is one level up.
- Motion values come ONLY from `src/lib/motion.ts`. No one-off durations/eases anywhere.
- Animate `transform` + `opacity` ONLY. Never animate width/height/top/left/margin.
- Reduced motion honored globally via `<MotionConfig reducedMotion="user">` — no per-component reduced-motion code.
- Personality = subtle & premium: ease-out curves, **no spring/bounce presets**.
- Durations (seconds): `fast: 0.12`, `base: 0.18`, `slow: 0.28`. Ease: `[0.2, 0.8, 0.2, 1]`.
- Stagger children by `0.04s`, and stagger only the first 10 children (`staggerChildren` + a cap in `<Reveal>`).
- Verification reality: `src/lib/motion.ts` gets a real unit test (assert style, run via `npx tsx`). UI components are verified by `npm run typecheck` + `npm run build:prod` (both must pass) + the described manual check. There is NO component-test harness — do not add one.
- After code changes: `npm run typecheck` must pass and `npm run build:prod` must print "Compiled successfully" before committing a task.
- Do NOT touch the public marketing sites (`src/app/site/*`) or the full-screen CMS studio (`src/app/cms/*/studio`) — they keep their own motion.
- Commit after each task. Branch off `main` first (this repo currently has uncommitted work — create a branch `feat/ui-motion` before Task 1 and commit all tasks onto it).

---

### Task 0: Create the working branch

**Files:** none (git only)

- [ ] **Step 1: Create + switch to a feature branch**

```bash
cd /Users/truep/Desktop/Clients/Renova
git checkout -b feat/ui-motion
```

- [ ] **Step 2: Confirm branch**

Run: `git branch --show-current`
Expected: `feat/ui-motion`

---

### Task 1: Motion foundation — dependency, tokens, MotionConfig

**Files:**
- Modify: `app/package.json` (add `motion` dependency)
- Create: `app/src/lib/motion.ts`
- Create: `app/src/lib/motion.test.ts`
- Modify: `app/src/app/layout.tsx` (wrap authed + client-app branches in `MotionConfig`)

**Interfaces:**
- Produces: `DUR` (`{ fast: 0.12; base: 0.18; slow: 0.28 }`), `EASE` (`readonly [0.2,0.8,0.2,1]`), `revealVariants` (`{ hidden; visible }` Variants), `staggerContainer(stagger?: number)` → `Variants`, `STAGGER_CAP = 10`. All exported from `@/lib/motion`.

- [ ] **Step 1: Install the dependency**

Run: `cd app && npm install motion`
Expected: adds `"motion"` to `package.json` dependencies, no errors.

- [ ] **Step 2: Write the failing test for the tokens**

Create `app/src/lib/motion.test.ts`:

```ts
/**
 * Unit tests for the motion tokens — the single source of truth for durations,
 * easing, and reveal/stagger variants. Pure, no I/O. Run: npx tsx src/lib/motion.test.ts
 */
import assert from "node:assert/strict";

import { DUR, EASE, STAGGER_CAP, revealVariants, staggerContainer } from "./motion";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed++;
}

// The Variants union type doesn't expose `.opacity`/`.transition` directly, so
// cast to a plain record shape for these value assertions.
const hidden = revealVariants.hidden as { opacity: number; y: number };
const visible = revealVariants.visible as { opacity: number; y: number };
const container = staggerContainer().visible as { transition: { staggerChildren: number } };

check("durations are the premium values", DUR.fast === 0.12 && DUR.base === 0.18 && DUR.slow === 0.28);
check("ease is the ease-out curve", EASE[0] === 0.2 && EASE[1] === 0.8 && EASE[2] === 0.2 && EASE[3] === 1);
check("reveal hidden state offsets down + transparent", hidden.opacity === 0 && hidden.y === 8);
check("reveal visible state settles", visible.opacity === 1 && visible.y === 0);
check("stagger container default staggers by 0.04", container.transition.staggerChildren === 0.04);
check("stagger cap is 10", STAGGER_CAP === 10);

console.log(`motion tokens: ${passed} checks passed.`);
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd app && npx tsx src/lib/motion.test.ts`
Expected: FAIL — `Cannot find module './motion'`.

- [ ] **Step 4: Implement the tokens module**

Create `app/src/lib/motion.ts`:

```ts
import type { Variants } from "motion/react";

/** Duration tokens (seconds). Subtle & premium — fast micro-interactions. */
export const DUR = { fast: 0.12, base: 0.18, slow: 0.28 } as const;

/** Ease-out curve (matches globals.css --ease). No spring/bounce by design. */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Only the first N children of a list stagger; the rest appear instantly. */
export const STAGGER_CAP = 10;

/** Fade + rise into place. Used by <Reveal>. */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } },
};

/** Container that staggers its <Reveal> children. */
export function staggerContainer(stagger = 0.04): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger } },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx tsx src/lib/motion.test.ts`
Expected: PASS — `motion tokens: 6 checks passed.`

- [ ] **Step 6: Create a client MotionRoot wrapper**

`layout.tsx` is a Server Component; `MotionConfig` is a client component. Wrap it in a thin `"use client"` component so the boundary is explicit and unambiguous.

Create `app/src/components/motion/MotionRoot.tsx`:

```tsx
"use client";

import { type ReactNode } from "react";
import { MotionConfig } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

/** App-wide motion defaults + global reduced-motion handling (one place). */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: [...EASE] }}>
      {children}
    </MotionConfig>
  );
}
```

- [ ] **Step 7: Use MotionRoot in the root layout**

In `app/src/app/layout.tsx`, add the import near the other component imports:

```tsx
import { MotionRoot } from "@/components/motion/MotionRoot";
```

Wrap the **authed admin branch**'s tree — find the `<TooltipProvider delayDuration={300}>` … `</TooltipProvider>` block and wrap it:

```tsx
<MotionRoot>
  <TooltipProvider delayDuration={300}>
    {/* …existing ConfirmProvider + AppShell… */}
  </TooltipProvider>
</MotionRoot>
```

And wrap the **client-app branch**'s `<ConfirmProvider>` … `</ConfirmProvider>`:

```tsx
<MotionRoot>
  <ConfirmProvider>
    {/* …existing ClientAppFrame… */}
  </ConfirmProvider>
</MotionRoot>
```

Do NOT wrap the `/site/*` + studio bare branch (`return <html><body>{children}</body></html>`).

- [ ] **Step 8: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck exits 0; build prints "Compiled successfully".

- [ ] **Step 9: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/package.json app/package-lock.json app/src/lib/motion.ts app/src/lib/motion.test.ts app/src/components/motion/MotionRoot.tsx app/src/app/layout.tsx
git commit -m "feat(motion): add Framer Motion, motion tokens, and root MotionConfig"
```

---

### Task 2: `<Reveal>` primitive (fade+rise, optional stagger)

**Files:**
- Create: `app/src/components/motion/Reveal.tsx`

**Interfaces:**
- Consumes: `revealVariants`, `staggerContainer`, `STAGGER_CAP` from `@/lib/motion`.
- Produces:
  - `<Reveal>` — props `{ children: ReactNode; className?: string; style?: CSSProperties; as?: "div" | "li"; delay?: number }`. A single fade+rise wrapper.
  - `<RevealGroup>` — props `{ children: ReactNode; className?: string; style?: CSSProperties; stagger?: number }`. A stagger container; direct `<Reveal>` children animate in sequence (first `STAGGER_CAP` staggered, rest instant).

- [ ] **Step 1: Implement the component**

Create `app/src/components/motion/Reveal.tsx`:

```tsx
"use client";

import { type CSSProperties, type ReactNode, Children, isValidElement } from "react";
import { motion } from "motion/react";

import { revealVariants, staggerContainer, STAGGER_CAP } from "@/lib/motion";

/**
 * Fades + rises its children into place. Standalone it animates on scroll-into-
 * view (once). Inside a <RevealGroup> it inherits the group's staggered timing.
 * A thin client shell — children are server-rendered and passed straight through.
 */
export function Reveal({
  children,
  className,
  style,
  as = "div",
  delay,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "li";
  delay?: number;
}) {
  const Tag = as === "li" ? motion.li : motion.div;
  return (
    <Tag
      className={className}
      style={style}
      variants={revealVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      transition={delay != null ? { delay } : undefined}
    >
      {children}
    </Tag>
  );
}

/**
 * Staggers its direct <Reveal> children. Only the first STAGGER_CAP children get
 * staggered delays; the remainder are wrapped so they appear immediately, so long
 * lists never feel slow. Uses initial/whileInView so it also works on scroll.
 */
export function RevealGroup({
  children,
  className,
  style,
  stagger,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  stagger?: number;
}) {
  const items = Children.toArray(children);
  return (
    <motion.div
      className={className}
      style={style}
      variants={staggerContainer(stagger)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
    >
      {items.map((child, i) =>
        isValidElement(child) && i >= STAGGER_CAP
          ? // Past the cap: render outside the stagger so it appears instantly.
            <motion.div key={i} variants={{ hidden: { opacity: 1 }, visible: { opacity: 1 } }}>{child}</motion.div>
          : child,
      )}
    </motion.div>
  );
}
```

Note: this file starts with `"use client"`, so `import { motion } from "motion/react"` is safe. Server pages can still render `<Reveal>`/`<RevealGroup>` and pass server-rendered children through.

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 3: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/components/motion/Reveal.tsx
git commit -m "feat(motion): add Reveal + RevealGroup primitives"
```

---

### Task 3: Interactive Card (hover lift)

**Files:**
- Modify: `app/src/components/ui/Card.tsx`

**Interfaces:**
- Produces: `Card` gains optional `interactive?: boolean`. When true it renders a `motion.div` with `whileHover={{ y: -2 }}` + shadow/border shift and `whileTap={{ y: 1 }}`; when false/absent it renders the existing static `div` (no behavior change for current call sites).

- [ ] **Step 1: Implement the interactive variant**

Replace the `Card` forwardRef in `app/src/components/ui/Card.tsx` with the following. **Add `"use client"` as the very first line of the file** (Card becomes a client leaf component — server pages can still render it):

```tsx
"use client";

import * as React from "react";
import { motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

const baseStyle: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--grid)",
  borderRadius: "var(--radius)",
  padding: 24,
  boxShadow: "var(--shadow-1)",
};

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ children, style, interactive, ...rest }, ref) => {
  if (!interactive) {
    return (
      <div ref={ref} style={{ ...baseStyle, ...style }} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      ref={ref}
      style={{ ...baseStyle, cursor: "pointer", ...style }}
      whileHover={{ y: -2, boxShadow: "var(--shadow-2)", borderColor: "var(--hairline-strong)" }}
      whileTap={{ y: 1 }}
      transition={{ duration: DUR.fast, ease: [...EASE] }}
      {...(rest as React.ComponentProps<typeof motion.div>)}
    >
      {children}
    </motion.div>
  );
});
Card.displayName = "Card";
```

Keep `CardLabel`, `CardValue`, and any other exports in the file unchanged.

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 3: Manual check (after Task 9 deploy, or `npm run dev`)**

Hover any `<Card interactive>` — it lifts 2px, shadow deepens, border brightens; pressing nudges it down. Non-interactive cards are unchanged.

- [ ] **Step 4: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/components/ui/Card.tsx
git commit -m "feat(motion): add interactive hover-lift variant to Card"
```

---

### Task 4: Page transition (App Router template)

**Files:**
- Create: `app/src/app/template.tsx`

**Interfaces:**
- Produces: a route-transition wrapper. `template.tsx` re-mounts on every navigation, so a `motion.div` with `initial`/`animate` fades+rises the page on each route change. Applies to ALL routes under the root layout; the public `/site/*` and studio branches render their own `<html>` and are unaffected visually because their content is short-lived — but to be safe the wrapper is opacity/transform only and never blocks interaction.

- [ ] **Step 1: Implement the template**

Create `app/src/app/template.tsx`:

```tsx
"use client";

import { type ReactNode } from "react";
import { motion } from "motion/react";

import { DUR, EASE } from "@/lib/motion";

/** Runs on every route change (App Router re-mounts template.tsx). A barely-there
 *  fade + 6px rise so navigation feels intentional. */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 3: Manual check**

Navigate between admin pages (Dashboard → Clients → Leads). Each page fades + rises subtly on load. No layout jump; no flash.

- [ ] **Step 4: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/app/template.tsx
git commit -m "feat(motion): add route-change page transition"
```

---

### Task 5: Dialog + Sheet exit animations (Radix-native CSS)

**Files:**
- Modify: `app/src/app/globals.css` (add `[data-state="closed"]` keyframes + rules)
- Modify: `app/src/components/ui/Dialog.tsx` (add exit animation classes)
- Modify: `app/src/components/ui/Sheet.tsx` (add exit animation classes)

**Rationale:** Radix keeps content mounted until CSS animations finish on `[data-state="closed"]`, so CSS gives reliable enter **and** exit with no `AnimatePresence` wrapping of Radix. This is the one place we intentionally use CSS instead of Framer.

**Interfaces:**
- Produces: CSS classes `.anim-overlay`, `.anim-dialog`, `.anim-sheet` that animate in on `[data-state="open"]` and out on `[data-state="closed"]`.

- [ ] **Step 1: Add the keyframes + classes to globals.css**

Append to `app/src/app/globals.css`:

```css
/* Radix dialog/sheet enter+exit — Radix defers unmount until these finish. */
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

- [ ] **Step 2: Apply classes in Dialog.tsx**

In `app/src/components/ui/Dialog.tsx`: add `className="anim-overlay"` to the `DialogPrimitive.Overlay` and `className="anim-dialog"` to the `DialogPrimitive.Content`. Remove the existing inline `animation: "fade-up 0.18s var(--ease)"` from both (the class now owns it). Keep all other inline styles (position/transform base, etc.) — but for `.anim-dialog`, the keyframes set `transform`, so the Content's base `transform: translate(-50%,-50%)` stays as the resting state (the keyframes include it).

- [ ] **Step 3: Apply classes in Sheet.tsx**

In `app/src/components/ui/Sheet.tsx`: add `className="anim-overlay"` to its overlay and `className="anim-sheet"` to its content panel; remove the existing inline `animation: "sheet-in …"`. Keep the panel's positioning styles.

- [ ] **Step 4: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 5: Manual check**

Open a dialog (e.g. any confirm) and a sheet (e.g. exercise edit) → both animate IN; on close, both animate OUT (no snap). Escape still closes instantly-feeling. Reduced-motion → near-instant.

- [ ] **Step 6: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/app/globals.css app/src/components/ui/Dialog.tsx app/src/components/ui/Sheet.tsx
git commit -m "feat(motion): add dialog + sheet enter/exit animations"
```

---

### Task 6: Sidebar active-nav slide (layoutId)

**Files:**
- Modify: `app/src/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `motion/react-client`.
- Produces: the active accent bar becomes a `motion.span layoutId="nav-active-bar"` so it slides between items on route change instead of jumping.

- [ ] **Step 1: Convert the active bar to a layout element**

`app/src/components/layout/Sidebar.tsx` already starts with `"use client"`. Import at top:

```tsx
import { motion } from "motion/react";
import { EASE, DUR } from "@/lib/motion";
```

In `renderLink`, replace the active accent bar `<span … />` (the absolutely-positioned 3px accent bar rendered when `active`) with:

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

`layoutId` makes Framer animate the bar's position from its previous item to the new active item.

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 3: Manual check**

Click between nav items — the accent bar slides to the new item instead of jumping. (Note: after a full page reload it simply appears at the active item, which is correct.)

- [ ] **Step 4: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/components/layout/Sidebar.tsx
git commit -m "feat(motion): slide the sidebar active indicator between items"
```

---

### Task 7: Rollout — Dashboard

**Files:**
- Modify: `app/src/app/dashboard/page.tsx` (wrap the KPI grid + attention strip in reveal/stagger; mark KPI cards interactive)

**Interfaces:**
- Consumes: `RevealGroup`, `Reveal` from `@/components/motion/Reveal`; `Card interactive`.

- [ ] **Step 1: Apply reveal + stagger to the dashboard**

Open `app/src/app/dashboard/page.tsx`. For the KPI card grid, wrap the mapped cards so the grid is a `RevealGroup` and each card is a `Reveal`:

```tsx
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
// …
<RevealGroup style={{ display: "grid", gridTemplateColumns: /* keep existing */, gap: /* keep existing */ }}>
  {kpis.map((k) => (
    <Reveal key={k.key}>
      <Card interactive>{/* existing KPI card contents */}</Card>
    </Reveal>
  ))}
</RevealGroup>
```

Wrap the needs-attention strip and any secondary sections each in a single `<Reveal>`. Keep all existing grid/gap/styles — only add the wrappers + `interactive`.

Note: the dashboard `page.tsx` is a Server Component. `RevealGroup`/`Reveal`/interactive `Card` are client components that accept server-rendered children — this is fine, data still loads on the server.

- [ ] **Step 2: Typecheck + build**

Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 3: Manual check**

Load the dashboard — KPI cards fade+rise in sequence (first 10 staggered), hover-lift on each; the attention strip reveals. Reduced-motion → they just appear.

- [ ] **Step 4: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/app/dashboard/page.tsx
git commit -m "feat(motion): reveal + hover on the dashboard"
```

---

### Task 8: Rollout — list/grid views

**Files (apply the SAME pattern to each; each is a card/list grid):**
- Modify: `app/src/components/clients/*` (clients list grid)
- Modify: `app/src/components/leads/*` (leads list)
- Modify: `app/src/components/workout/WorkoutsView.tsx`, `WorkoutProgramsView.tsx`, `CircuitsView.tsx`
- Modify: `app/src/components/nutrition/NutritionPlansView.tsx`
- Modify: `app/src/components/workout/ExerciseLibraryView.tsx` (the category groups)
- Modify: `app/src/components/staff/StaffView.tsx`
- Modify: memberships + packages list views

**Pattern to apply in each** (find the mapped grid of cards; leave table-based lists to their CSS row hover):

```tsx
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
// wrap the grid:
<RevealGroup style={{ /* keep the existing grid style object */ }}>
  {items.map((it) => (
    <Reveal key={it.id}>
      {/* existing card element; if it's a <Card>, add `interactive` */}
    </Reveal>
  ))}
</RevealGroup>
```

- [ ] **Step 1: Apply to the clients + leads views**

Wrap their card grids per the pattern; add `interactive` to card elements that are clickable. Typecheck + build:
Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 2: Commit**

```bash
git add app/src/components/clients app/src/components/leads
git commit -m "feat(motion): reveal + hover on clients + leads"
```

- [ ] **Step 3: Apply to the workout/nutrition/exercise/staff views**

Same pattern for `WorkoutsView`, `WorkoutProgramsView`, `CircuitsView`, `NutritionPlansView`, `ExerciseLibraryView` (wrap each category group's card grid), `StaffView`, memberships, packages. For `ExerciseLibraryView`, wrap the per-category card grid in `RevealGroup` (not the whole page). Typecheck + build after:
Run: `cd app && npm run typecheck && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add app/src/components/workout app/src/components/nutrition app/src/components/staff app/src/components/memberships app/src/components/packages
git commit -m "feat(motion): reveal + hover on coaching + business list views"
```

---

### Task 9: Final — reduced-motion audit, AI-chat timing, deploy + smoke

**Files:**
- Modify: `app/src/app/globals.css` (ensure skeleton shimmer + any keyframe animation gated by reduced-motion)

- [ ] **Step 1: Gate remaining always-on animations for reduced-motion**

In `app/src/app/globals.css`, ensure a global reduced-motion block exists that freezes shimmer/pulse loops (the audit noted the skeleton shimmer wasn't gated). Add if missing:

```css
@media (prefers-reduced-motion: reduce) {
  .skeleton, .ai-shimmer, .ai-caret, .ai-dot { animation: none !important; }
  * { scroll-behavior: auto !important; }
}
```

- [ ] **Step 2: Typecheck + build + tests**

Run: `cd app && npm run typecheck && npm test && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"`
Expected: typecheck 0; tests pass (incl. `motion tokens: 6 checks passed.`); "Compiled successfully".

- [ ] **Step 3: Deploy**

Run: `cd app && railway up --detach`
Then wait for the new `containerimage.digest` and a `200` on `/login` (per the project's deploy pattern).

- [ ] **Step 4: Live smoke test**

On the deployed app: dashboard (reveal + hover), a list view (stagger + hover), open+close a dialog and a sheet (enter + exit), navigate between pages (page transition), click nav items (sliding bar). Then toggle OS "reduce motion" and confirm movement is removed but nothing breaks.

- [ ] **Step 5: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/app/globals.css
git commit -m "feat(motion): gate looping animations under reduced-motion"
```

---

## Notes for the implementer

- Every file that imports `{ motion } from "motion/react"` MUST have `"use client"` as its first line. Server pages/components can still render these client leaf components and pass server-rendered children through — that's the whole RSC-safe pattern here. (If you hit a boundary error, the fix is a missing `"use client"`, not moving data fetching.)
- If any `motion.*` prop type conflicts with a spread of `React.HTMLAttributes` (e.g. `onDrag`, `onAnimationStart`), cast the spread as shown in Task 3 rather than widening the component's public types.
- The `motion` package (v11+, formerly `framer-motion`) exposes everything under `motion/react`. If a symbol is missing, check the installed version's docs rather than guessing.
- Do not convert data-fetching Server Components to Client Components. Only the thin motion wrapper is a client component; it receives already-rendered children.
- Keep every duration/ease referencing `@/lib/motion` — if you find yourself typing `0.2s` inline, import the token instead.
