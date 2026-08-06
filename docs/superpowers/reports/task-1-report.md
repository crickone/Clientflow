# Task 1 Report — Motion foundation: dependency, tokens, MotionConfig

**Plan:** `docs/superpowers/plans/2026-07-14-ui-motion-system.md`, Task 1
**Scope implemented:** Task 1 only + Global Constraints. Task 0 (branch) skipped
per instructions — this project deploys via Railway from the working
directory, not git, so no git commands were run and nothing was committed.

## Files changed

- Modified: `app/package.json` — added `"motion": "^12.42.2"` to `dependencies`.
- Modified: `app/package-lock.json` — lockfile updated by `npm install motion`.
- Created: `app/src/lib/motion.ts` — `DUR`, `EASE`, `STAGGER_CAP`,
  `revealVariants`, `staggerContainer()` (exact code from the plan, verbatim).
- Created: `app/src/lib/motion.test.ts` — pure unit test for the tokens
  (exact code from the plan, verbatim), run via `npx tsx`.
- Created: `app/src/components/motion/MotionRoot.tsx` — `"use client"`
  wrapper around `MotionConfig` with `reducedMotion="user"` and the shared
  `DUR.base`/`EASE` transition (exact code from the plan, verbatim).
- Modified: `app/src/app/layout.tsx`:
  - Added `import { MotionRoot } from "@/components/motion/MotionRoot";`
    alongside the other component imports.
  - Wrapped the **client-app branch** (`/app`, `/app/*`): `<MotionRoot>` now
    wraps `<ConfirmProvider>…<ClientAppFrame>…</ClientAppFrame>…</ConfirmProvider>`.
  - Wrapped the **authed-admin branch**: `<MotionRoot>` now wraps
    `<TooltipProvider delayDuration={300}>…<ConfirmProvider>…<AppShell>…</AppShell>…</ConfirmProvider>…</TooltipProvider>`.
  - Left the `/site/*` + studio bare branch (`return <html><body>{children}</body></html>`)
    untouched, as required.

No other files were touched. No `git` commands were run (no branch, no commit,
no staging) per the explicit project deviation from the plan.

## Verification — exact commands and outputs

**1. Motion tokens unit test**

```
$ cd /Users/truep/Desktop/Clients/Renova/app && npx tsx src/lib/motion.test.ts
motion tokens: 6 checks passed.
```
Matches required output exactly.

**2. Typecheck**

```
$ cd /Users/truep/Desktop/Clients/Renova/app && npm run typecheck
> renova-cellular-health@1.0.0 typecheck
> tsc --noEmit
```
No errors emitted; explicit exit-code check confirmed `typecheck exit code: 0`.

**3. Production build**

```
$ cd /Users/truep/Desktop/Clients/Renova/app && npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"
 ✓ Compiled successfully
```
Full build log was captured to a scratch file and reviewed — all routes
compiled/generated normally (static + dynamic), no build failures. The
`/site/*` and `/cms/*/studio` routes still render through the bare
`<html><body>{children}</body></html>` branch, unaffected by `MotionRoot`.

All three required verification steps pass.

## Concerns / notes

- `npm install motion` reported the repo's pre-existing npm audit warnings
  (`6 vulnerabilities (5 moderate, 1 high)`). These are not new — they're
  from existing dependencies, unrelated to `motion` — and no action was taken
  per scope (installing/auditing unrelated deps is out of scope for this task).
- The working tree already had a large number of uncommitted modifications
  across the app (per `git status` at session start — this repo doesn't
  commit routinely, consistent with the Railway-from-working-directory deploy
  model). `git diff` for `package.json` therefore shows more than just the
  `motion` line (e.g. a pre-existing `resend` addition); the only change made
  in this task is the `"motion": "^12.42.2"` dependency line plus the
  corresponding lockfile update.
- Did not run `npm test` (that's part of Task 9, not Task 1) — not required
  by this task's verification steps, so skipped to stay in scope.
- No manual browser/dev-server check was performed (not required for Task 1;
  the plan's manual-check steps start at Task 3+). `MotionRoot` itself has no
  visible effect yet since no component in this task consumes motion/reveal
  primitives — that starts at Task 2.
