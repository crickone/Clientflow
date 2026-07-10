# Renova — "Technical Swiss" Restyle

**Date:** 2026-05-23
**Status:** Approved direction (mockup signed off) — spec under review

## Goal

Restyle the Renova clinic app to the "technical Swiss" aesthetic of the
ChainGPT Labs reference: a light-grey canvas, white modular cells divided by
visible grid lines, near-square corners, a single orange accent, monospace
technical labels, and large Nebula display headings — while keeping the app
comfortable for daily clinic use ("inspired evolution", not a brutalist clone).

Approved decisions:
- **Fidelity:** inspired evolution (strong cues, keep light shadows where they aid usability, corners ~2px not a hard 0).
- **Scope:** whole app, driven from the design system (tokens + shared primitives + shell), not page-by-page.
- **Accent:** single orange across all UI. Per-therapy blue/purple survive **only inside charts and data badges** so HBOT/IR/PEMF stay distinguishable.

## Design tokens (`src/app/globals.css`)

Replace the current light/white palette with:

```
--bg / --canvas    #e7e7ea   (light-grey page canvas)
--surface-1        #ffffff   (white cells)
--surface-2        #f3f3f5
--surface-3        #e9e9ec
--grid             rgba(0,0,0,0.11)   (visible modular grid lines — NEW)
--hairline         rgba(0,0,0,0.10)
--hairline-strong  rgba(0,0,0,0.20)
--text-primary     #0c0c0d
--text-secondary   rgba(12,12,13,0.60)
--text-tertiary    rgba(12,12,13,0.42)
--accent           #ef5a24   (orange — was #0a84ff)
--accent-ink       #c2440f   (orange text-on-light)
--accent-soft      rgba(239,90,36,0.10)
--radius-sm        2px       (was 10px)
--radius           2px       (was 16px)
--radius-lg        3px       (was 24px)
```

- Keep `--accent-hbot / --accent-ir / --accent-pemf` defined — used by charts/badges only.
- Soften/remove `--shadow-1` / `--shadow-2` (grid lines now carry structure). Keep a faint shadow on raised/floating elements (dialogs, dropdowns, toasts) for legibility.
- Remove or greatly reduce the three radial-gradient washes on `body`; the canvas is a flat light-grey. Keep the grain overlay at low opacity (optional).

## Fonts (`src/app/fonts.ts`)

- Add a monospace Google font: **Space Mono** (`400, 700`), `variable: "--font-mono"`. (DM Mono is the fallback alternative if 500-weight labels are wanted.)
- Wire `--font-mono` into the `<html>` className in `layout.tsx`.
- Keep Hanken Grotesk (`--font-body`) for prose and Nebula (`--font-heading`) for display.
- Tailwind: add `mono: ["var(--font-mono)", ...]` to `fontFamily`.

**Type roles:**
- **Nebula, uppercase** — page titles, KPI/stat values, big numerals.
- **Space Mono** — eyebrows, section labels, metadata, table headers, badges, status pills, nav labels, dates/times, the `//` prefixes.
- **Hanken Grotesk** — body copy, names, descriptions, form values.

## Shared primitives

- **`ui/Button.tsx`** — `borderRadius: var(--radius)` (square). `primary` variant becomes orange (`--accent`) on white text, mono uppercase, `letter-spacing` ~0.04em. Keep `secondary/outline/ghost/destructive`; recolor focus/hover to orange. `icon` size square, not 999px.
- **`ui/Card.tsx`** — `borderRadius: var(--radius)`, border `var(--grid)`, drop the box-shadow (flat cell). `CardLabel` → mono uppercase. `CardValue` already Nebula — keep.
- **`ui/Badge.tsx` / `ui/StatusBadge.tsx`** — mono uppercase pills, square corners. Default = orange-soft; therapy badges keep their `colourHex` tint. Status colours (confirmed/pending/cancelled) retained but as mono pills.
- **`ui/Input.tsx`** — square corners, grid border, orange focus ring. `.search-box` in globals: square (was `border-radius:999px`), orange focus.
- **`ui/Tabs.tsx`** — active tab uses orange underline/text (the `[data-state="active"]` rule in globals already targets this — point it at `--accent`).
- **`layout/PageHeader.tsx`** — eyebrow as mono `// UPPERCASE` orange; title Nebula uppercase large; subtitle mono.

## Shell

- **`layout/Sidebar.tsx`** — flat nav items (square `--radius`), mono uppercase-ish labels. Active state: orange text + `--accent-soft` background + 3px orange left bar (replaces the current black bar). Right border `--grid`. Brand lockup keeps `renova-logo.png`. User-footer avatar square, role in mono.
- Inline literal radii in the shell and dashboard rows (`borderRadius: 10`, `8`, `999`) do **not** read from tokens — these need explicit edits. Audit: `Sidebar.tsx`, `dashboard/page.tsx` (schedule rows), `Avatar.tsx`, anywhere using `borderRadius: 999`/`10`/`8`.

## Modular grid + brackets helper (`globals.css`)

- `.grid` utility: `display:grid; gap:1px; background:var(--grid); border:1px solid var(--grid)` so the 1px gaps render as grid lines; children `.cell` are white. Use for KPI rows.
- `.brackets` utility: four corner registration marks (L-shaped, `--text-tertiary`) via pseudo-elements + two helper spans, for feature panels (e.g. revenue chart).

## Embedded report (`.pane-wrap` override layer in globals.css)

The Marketing tab renders the original dark HTML report through `.pane-wrap`
overrides. Sweep that layer to the new palette: orange where the old layer used
blue accents for generic UI, square radii, mono labels — but keep the
per-therapy accent mapping (`#58a6ff→hbot`, `#f0883e→ir`, `#a855f7→pemf`) intact
for data, since those colours encode the therapy.

## Files to touch (summary)

```
src/app/globals.css          tokens, .grid, .brackets, .search-box, .pane-wrap sweep, tabs active
src/app/fonts.ts             add Space Mono
src/app/layout.tsx           add --font-mono var to <html>
tailwind.config.ts           mono fontFamily, accent already var-bound
src/components/ui/Button.tsx, Card.tsx, Badge.tsx, StatusBadge.tsx, Input.tsx, Tabs.tsx, Avatar.tsx
src/components/layout/Sidebar.tsx, PageHeader.tsx
src/app/dashboard/page.tsx   inline-radius audit (schedule rows)
```

## Verification

- Run `npm run dev`, log in, walk the key pages: Dashboard, Leads, Clients,
  Appointments, Packages, Reports, Marketing (therapy tabs), Content Studio,
  Settings, plus Login. Screenshot Dashboard + Marketing and compare to mockup.
- Check: no leftover blue primary buttons, no large rounded cards, mono labels
  applied, therapy colours still present in charts/badges, contrast on orange
  (`#ef5a24` on white passes for large text/UI; use `--accent-ink` for small
  orange text on light).

## Out of scope (YAGNI)

- No new pages, routes, or features. No data-model changes.
- No restructuring of the embedded report's source HTML — only the `.pane-wrap` override layer.
- No dark mode.

## Notes

- Repo is not under git (`git init` not run), so this spec is not committed.
- Mockup reference: `mockup-newlook.html` at project root.
