# ClientFlow — UI Motion System (design spec)

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** Add a subtle, premium, app-wide motion layer to the ClientFlow admin app.

## Goal

Make the admin UI feel expensive and calm through restrained motion — soft card
hovers, gentle enter/exit transitions, staggered list reveals, and smooth route
changes — without ever feeling busy or slow. Motion should read as "this feels
good," not "this is animated."

## Direction decisions (locked)

- **Personality:** Subtle & premium. Fast micro-interactions, ease-out curves,
  **no** springy/bouncy easings. (The "Linear/Vercel" school.)
- **Breadth:** A reusable motion *system* applied app-wide — not per-screen one-offs.
- **Tech:** **Framer Motion** (`motion` package). Chosen over CSS-first for its
  orchestration (stagger, `AnimatePresence` exit, `layoutId` shared elements).
  Constraint: the app is heavily React Server Components; we handle this with thin
  **client wrapper** components that animate **server-rendered children** — data
  fetching stays on the server.

## Current state (baseline)

- Motion today is minimal: keyframes exist only for the AI chat + spinners
  (`spin`, `fade-up`, `sheet-in`, `skeleton`, `ai`, `dot`, `blink`, `tt`); one
  `--ease` token (`cubic-bezier(0.2,0.8,0.2,1)`); ~5 CSS transitions + ~13 hover
  rules in `globals.css`; hover states for primitives live in the `.btn` /
  `.nav-link` / `.tab-trigger` classes added in earlier UI batches.
- `prefers-reduced-motion` is only partially wired (2 uses).
- `framer-motion` is **not** installed. No root `app/src/app/template.tsx`.
- `Card` (`src/components/ui/Card.tsx`) is a simple `forwardRef` div (static
  `--shadow-1`, no hover).

## The motion system

### 1. Foundation

- Add the `motion` (Framer Motion) dependency.
- Wrap the app once in `<MotionConfig reducedMotion="user">` (in the root layout's
  authed branch, and the client-app branch) so **every** animation respects the
  user's OS "reduce motion" setting automatically — strips movement, keeps fades.
- `src/lib/motion.ts` — shared tokens, the single source of truth:
  - Durations: `fast: 0.12`, `base: 0.18`, `slow: 0.28` (seconds).
  - Ease: `[0.2, 0.8, 0.2, 1]` (matches `--ease`). No spring presets.
  - Reusable `variants` for reveal (opacity 0→1, y 8→0) and stagger container
    (`staggerChildren: 0.04`, capped — see guardrails).

### 2. Reusable primitives (the entire surface area)

1. **`<Reveal>`** — client wrapper. Fades + rises its children ~8px into place on
   mount, or when scrolled into view (`whileInView`, `viewport={{ once: true }}`).
   A `stagger` prop turns it into a stagger container for lists/grids. Children are
   passed through untouched (server-rendered content works).
2. **`<InteractiveCard>`** + enhanced `Card` — hover lift `y: -2`, shadow
   `--shadow-1 → --shadow-2`, border brightens toward accent; `whileTap` presses
   `y: 1`. Duration `fast`. `Card` gains an optional `interactive` prop so existing
   call sites are unaffected unless they opt in.
3. **Dialog / Sheet enter + exit** — wrap Radix content in `AnimatePresence` (with
   `forceMount` + controlled `open`) so modals animate **out** on close, not snap.
   Enter matches current fade/slide; exit is the reverse at `fast`.
4. **`<PageTransition>`** — an App Router `src/app/template.tsx` that wraps `children`
   in a `motion.div` keyed by pathname; fades + rises ~6px on every route change
   (`base` duration). Applies to the admin shell; excluded from the public
   `/site/*` and full-screen `/cms/*/studio` branches.

Plus one micro-touch:
- **Sidebar active-nav indicator** slides between items via `layoutId` on the
  accent bar, instead of jumping on route change.

### 3. Where it applies (rollout)

- **Dashboard** — KPI cards `<Reveal stagger>` on load; needs-attention strip
  reveals; cards use the hover lift. *Optional* KPI number count-up (deferred /
  toggle — not part of core "subtle" scope).
- **List / grid views** — clients, leads, workouts, nutrition, exercises, staff,
  memberships, packages: grid/list `<Reveal stagger>`; cards get `InteractiveCard`;
  tables keep CSS row hover.
- **Dialogs & Sheets** — enter + exit, app-wide.
- **Nav** — sliding active indicator (hover already exists).
- **Empty states & toasts** — gentle reveal.
- **AI chat** — keep its existing bespoke motion; only align its timings to the new
  tokens for consistency.

### 4. Guardrails (non-negotiable)

- **Reduced-motion** honored globally via `MotionConfig` — no per-component work.
- **GPU-only** — animate `transform` + `opacity` exclusively. Never animate
  width/height/top/left (no layout reflow; holds 60fps).
- **RSC-safe** — client wrappers animate server-rendered children; no data fetching
  moves client-side; wrappers add `"use client"` only to the thin animated shell.
- **One system** — all values come from `lib/motion.ts` tokens; zero one-off
  durations/eases.
- **Stagger caps** — only the first ~8–10 children of a list stagger; the remainder
  appear instantly, so long lists never feel slow.
- **No exit-animation jank** — verify `AnimatePresence` unmount timing doesn't
  block interaction; dialogs must remain closeable instantly by keyboard.

## Verification

- Manual: on each rollout surface, confirm hover lift, load reveal/stagger, dialog
  enter+exit, and route-change transition feel smooth and consistent.
- Reduced-motion: with OS "reduce motion" on, movement is removed (fades only) and
  nothing breaks.
- Performance: transforms/opacity only; spot-check no long frames on list reveals.
- Build/typecheck/tests green; deploy; smoke-test the dashboard + a list view + a
  dialog on the live app.

## Out of scope (YAGNI)

- Scroll-linked / parallax effects, shared-element route transitions between pages,
  3D/tilt, confetti/celebratory effects.
- KPI count-up is optional and deferred unless explicitly requested.
- No changes to the public marketing sites' own animations (they keep their GSAP).
