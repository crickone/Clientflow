# Task 7 + 8 — Motion rollout (Dashboard + list/grid views)

All commands run from `app/`. No git operations performed (project ships via Railway).

## Task 7 — Dashboard (`app/src/app/dashboard/page.tsx`)

Server Component; `Reveal`/`RevealGroup`/`Card interactive` imported and used directly (server-rendered children passed through, no client-conversion needed).

- **KPI grids** (gym: 1 grid of 6; clinic: 2 grids of 3): the KPI cells are NOT `<Card>` components — they're plain `.cell` divs relying on the CSS combinator `.modular-grid > .cell` (background/seamless-grid-line effect in `globals.css`). Wrapping each cell in a generic `<Reveal>` would have broken that selector (cell would no longer be a direct child of the grid, losing its background). Fix: moved the `"cell"` className + padding onto the `<Reveal>` wrapper itself (`<Reveal key="..." className="cell" style={{ padding: "22px 22px 24px" }}>`), and simplified the `Kpi()` helper to return a fragment instead of its own wrapping div. `RevealGroup` carries the original `className="modular-grid"` + `style` untouched. No `interactive` added — KPI cells are static info, not clickable/navigational, consistent with "only add interactive to clickable cards."
- **Needs-attention strip**: wrapped `<NeedsAttention items={attention} />` in a single `<Reveal>`.
- **Business-brief nudge card** (`{!briefComplete && …}`): wrapped in a single `<Reveal>` (treated as a secondary/conditional section).
- **Today's classes/schedule + Recent activity split-grid** (gym and clinic variants): each wrapped in one `<Reveal>` as a whole section (per the instruction — reveal the section, not each row; these are dense scheduling rows, not cards).
- **Revenue · last 30 days card**: wrapped in a single `<Reveal>`.

All existing styles/classNames/keys preserved; only wrappers + `interactive` (where applicable) added.

## Task 8 — list/grid views

### Wrapped (genuine card/tile grids found and converted)

- `app/src/app/clients/page.tsx` — the real "clients list" card grid (target doc said `src/components/clients/*`, but that directory has no card grid — see Skipped below; this is the actual grid). `<Link><Card></Card></Link>` grid → `RevealGroup` (same style) + `<Reveal key={c.id}>` + `Card interactive` (existing inline `transition` style preserved as-is).
- `app/src/components/leads/LeadList.tsx` — same pattern: `<Link><Card></Card></Link>` grid → `RevealGroup` + `Reveal key={l.id}` + `Card interactive`.
- `app/src/components/staff/StaffView.tsx` — roster grid of custom `<button style={card}>` tiles (not the `<Card>` component, so no `interactive` prop applies). Wrapped in `RevealGroup` + `Reveal key={s.id}`. Because the button was previously the direct CSS-grid item (stretched to fill the cell via grid default `align-items:/justify-items: stretch`), and now the `Reveal` motion.div is the direct grid item instead, added `width: "100%", height: "100%"` to the button's style so it still fills the stretched Reveal wrapper exactly as before (verified `box-sizing: border-box` is a global reset in `globals.css`, so this is safe). Payroll + Performance sections are div-based data tables — left untouched (see rule on tables below).
- `app/src/components/memberships/MembershipsView.tsx` — catalog plan-tile grid (`<button style={card}>`) → same `RevealGroup`/`Reveal`/`width:100%,height:100%` treatment. "Purchased memberships" table untouched.
- `app/src/components/packages/PackagesView.tsx` — catalog package-tile grid → same treatment. "Purchased packages" table untouched.
- `app/src/components/workout/WorkoutProgramsView.tsx` — the 3-way `TypeCard` picker grid inside `CreateTypeDialog` (choosing Simple/Detailed/Upload) wrapped in `RevealGroup` + `Reveal`. (`TypeCard` already sets its own `height: "100%"`, and block elements fill width by default, so no extra sizing fix was needed here.) The main programs list is a div-based table — untouched.
- `app/src/components/nutrition/NutritionPlansView.tsx` — both `TypeCard` picker grids inside `CreateTypeDialog` (the 3-way "type" step and the 2-way "macro mode" step) wrapped the same way. Main plans list is a table — untouched.
- `app/src/components/workout/ExerciseLibraryView.tsx` — per the plan's explicit instruction to wrap "each per-category card grid (NOT the whole page)": each category's items are actually rendered as a div-based table (header row + `row` grid rows), not cards, so the individual exercise rows were left alone. Instead, wrapped the outer `groups.map(([cat, items]) => …)` list — i.e. each **category section** (heading + its table) — in `RevealGroup` + `Reveal key={cat}`, giving a staggered reveal per category without touching the row-table internals.

### Skipped (no genuine card/list grid to wrap, or out of safe scope)

- `app/src/components/clients/*` (`ClientAppAccess.tsx`, `ClientEmailPanel.tsx`, `ClientForm.tsx`, `ClientPicker.tsx`, `ClientSearch.tsx`, `DeleteClientButton.tsx`, `FilterTabs.tsx`, `QuickAddClientForm.tsx`) — checked all `.map()` sites in this directory; none is a navigational card grid. `ClientPicker.tsx` and `ClientAppAccess.tsx` render small live-filtered/assignment listbox rows (not cards, re-render every keystroke, live inside forms/dialogs) — wrapping in a scroll-triggered `Reveal` would be a poor fit and risks flicker on typing. `ClientEmailPanel.tsx` is a message thread. The actual "clients list" card grid lives at `app/src/app/clients/page.tsx`, which was wrapped instead (see above).
- `app/src/components/workout/WorkoutsView.tsx` and `app/src/components/workout/CircuitsView.tsx` — both are pure div-based data tables (header row + `row`-styled grid rows, `MoreHorizontal` action menu per row). No card grid present anywhere in either file. Per the stated rule ("leave `<table>`-based lists alone — they keep CSS row hover"), left untouched; these are functionally tables even though implemented with CSS grid divs rather than a literal `<table>` element.
- Payroll/Performance tables in `StaffView.tsx`, "Purchased memberships"/"Purchased packages" tables in `MembershipsView.tsx`/`PackagesView.tsx`, and the main programs/plans tables in `WorkoutProgramsView.tsx`/`NutritionPlansView.tsx` — same reasoning, left untouched.

## Verification

```
$ npm run typecheck
> renova-cellular-health@1.0.0 typecheck
> tsc --noEmit
(exit 0, no output)

$ npm run build:prod 2>&1 | grep -E "Compiled successfully|Failed"
 ✓ Compiled successfully
```

## Concerns / follow-ups

- None blocking. The only structural risk spots (the `.modular-grid > .cell` CSS combinator on the dashboard, and the CSS-grid-stretch behavior of bare `<button style={card}>` tiles in Staff/Memberships/Packages) were identified and specifically compensated for rather than skipped, since skipping would have left Task 7/8's core targets (dashboard KPIs, staff roster, memberships/packages catalogs) without any motion at all.
- Live/manual verification (hover-lift, stagger timing, reduced-motion) was not performed in this pass — only `typecheck` + `build:prod` per the verification gate given. Recommend a quick `npm run dev` pass over `/dashboard`, `/clients`, `/leads`, `/staff`, `/memberships`, `/session-packages`, and the workout "Add" dialogs to eyeball the stagger + hover-lift before considering Task 9 (final reduced-motion audit + deploy).
