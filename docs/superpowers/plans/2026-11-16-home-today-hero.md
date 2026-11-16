# Home Today Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give Home a bold "today" hero (the session in the gym's brand gradient with big set chips and Start), a row of real-data tiles, and quiet "coming up" rows.

**Architecture:**
- A pure model, `components/clientapp/home/homeModel.ts`, decides the greeting, the hero state and the tiles, and is unit-tested.
- Small presentational components, `HomeHero.tsx` and `HomeTiles.tsx`, render it with new `.pk-` classes.
- `app/app/page.tsx` gathers the data it already loads and composes the screen.

**Tech Stack:** Next.js 15 server components, TypeScript, CSS in `globals.css`, tsx tests.

Spec: `docs/superpowers/specs/2026-11-16-home-today-hero-design.md`.

## Global Constraints

- **One filled accent button on Home:** the hero's.
- **No zero tiles.** An empty state is one quiet row.
- **Colours:** brand variables only. The hero gradient is exactly `linear-gradient(150deg, var(--accent), color-mix(in srgb, var(--accent) 72%, black))`. No hard-coded colours.
- **CSS:** new CSS goes in the `.pk-` block of `app/src/app/globals.css` with the `.pk-hero` / `.pk-tiles` / `.pk-tile` prefixes. `components/clientapp/programs/kit.test.ts` must pass: every defined class used, every used class defined.
- **Layout:** controls are 44px, it works at 320px with no horizontal page scroll, and it works in light and dark brands.
- **Copy:** no emojis, and "program" (never "programme").
- **Data:** keep every existing Home data source, gate and link, unchanged in behaviour.
- **Commits:** never `git add -A`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before done:**
  - `cd app && npx tsc --noEmit -p .` is clean;
  - `npx tsx src/components/clientapp/home/homeModel.test.ts` passes;
  - the kit test passes;
  - `rm -rf .next && npx next build` succeeds;
  - full `npm test` passes.

---

### Task 1: Home model, hero, tiles and the page

**Files:**
- Create: `app/src/components/clientapp/home/homeModel.ts` (pure, no server imports)
- Create: `app/src/components/clientapp/home/homeModel.test.ts`
- Create: `app/src/components/clientapp/home/HomeHero.tsx`, `app/src/components/clientapp/home/HomeTiles.tsx`
- Modify: `app/src/app/app/page.tsx`, `app/src/app/globals.css`

**Interfaces (homeModel.ts):**

```ts
export function greeting(hour: number, firstName: string | null): string; // "Morning, Chris" (5-11), "Afternoon, Chris" (12-17), "Evening, Chris" (else); no name -> "Good morning"
export function dublinHour(now: number): number;
export interface HeroChip { kg: string; reps: string; plus: boolean }
export type Hero =
  | { kind: "program"; eyebrow: string; title: string; chips: HeroChip[]; action: "start" | "continue" }
  | { kind: "block_done"; title: "Block done" }
  | { kind: "plan"; title: string; programId: number; dayPosition: number }
  | { kind: "open"; title: string; sessionId: number }
  | { kind: "empty"; programsVisible: boolean };
/** The main lift's top working sets as chips: the first exercise with a lift (else the first with weights), its last three sets with a weight. */
export function heroChips(exercises: PlannedExercise[], fmtKg: (kg: number) => string): HeroChip[];
export interface Tile { key: "protein" | "habits" | "week" | "streak" | "class"; label: string; value: string; pct: number | null }
/** Only tiles with real data, in this order: protein, habits, week, streak, class. Never a zero. */
export function homeTiles(input: { protein: { got: number; target: number | null } | null; habits: { done: number; total: number } | null; week: { done: number; planned: number } | null; streak: number; nextClass: string | null }): Tile[];
```

Tile rules:
- **Protein:** shown only when the target is set and above 0. The value is "92 / 160 g" and pct is got / target, capped at 1.
- **Habits:** shown when total > 0, as "2 of 3".
- **Week:** shown when planned > 0, as "1 of 4".
- **Streak:** shown when > 0, as "1 week" or "3 weeks", with pct null.
- **Class:** shown when nextClass is set, with pct null.

- [ ] **Step 1:** Write `homeModel.test.ts` covering:
  - greeting: hours 6, 13, 20, and no name;
  - heroChips on a 5/3/1 planned session: the main lift is "Deadlift", three chips, the last has `plus: true`;
  - heroChips on a bodyweight-only session gives `[]`;
  - homeTiles: all present gives 5 tiles in order; a zero streak, a zero protein target and zero planned are each left out; nothing gives `[]`.

  Run it and see it fail.
- [ ] **Step 2:** Implement `homeModel.ts` and see the tests pass.
- [ ] **Step 3:** Build `HomeHero` and `HomeTiles` (server components, plain markup) with `.pk-hero*` and `.pk-tile*` CSS.
  - The hero button reuses `StartProgramSessionButton` / `StartWorkoutButton` / a Link, styled inverted through a `.pk-hero` scope.
  - Tiles with three or more items: `overflow-x: auto; scroll-snap-type: x mandatory`, scrollbar hidden. With fewer, a 1fr grid.
- [ ] **Step 4:** Recompose `app/app/page.tsx`:
  1. date line and greeting;
  2. hero (pick the state from `view`, `planFor`, `openSession`, `t.next`, `t.open`);
  3. tiles (`mealsToday.protein` with `mealTarget?.protein`, `habits`, `liveStripItems` or the plan's week, `t.streak`, `d.nextClass`);
  4. "Coming up" rows: next class or timetable, check-in due as a QuietRow with the value "Due", and the last + set from `t.latestBest` or progress data, with "Best yet" when it matches the lift's best;
  5. the existing rows and the habits card.

  Remove the old MyProgramCard "line" usage and the StatStrip from Home. Keep everything else.
- [ ] **Step 5:** Run the checks in Global Constraints, then commit:

```bash
git add app/src/components/clientapp/home/homeModel.ts app/src/components/clientapp/home/homeModel.test.ts app/src/components/clientapp/home/HomeHero.tsx app/src/components/clientapp/home/HomeTiles.tsx app/src/app/app/page.tsx app/src/app/globals.css
git commit -m "feat(app): Home leads with today's session in a bold hero

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Final

- Review.
- Controller browser check at 320px and 390px, for Optimal Health and Inspire and the three member states, on dev data restored afterwards.
- Push main, `railway up --detach` from `app/`, and the health check returns 200.
