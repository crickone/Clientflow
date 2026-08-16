# Leads Pipeline Board — Design

**Date:** 2026-08-16
**Status:** Approved (design), pending implementation plan
**Area:** `app/src/app/leads`, `app/src/components/pipeline`, `app/src/lib/pipeline`

## Problem

The `/leads` page is a flat, undifferentiated grid of lead cards ("All / New lead"
tabs over `minmax(320px)` cards). Now that native Facebook Lead Ads flow straight in,
volume is real and this view doesn't support the actual job: **working leads through
stages and responding fast**. The operator can't see the funnel, can't see which new
leads are going cold, and moves stages only by opening each lead individually.

A full pipeline **stage engine already exists** and is unused by the list UI:
`lib/pipeline/` defines 9 mutually-exclusive stages (`new_lead → hot_lead →
consultation_booked → no_show → attended → sale → repeat_customer`, plus out-of-band
`lapsed`/`lost`), forward-only auto-advance on real events (inbound reply, appointment
booked/attended/no-show, payment), a lapse scheduler, and per-lead `leads.pipelineStage`.
`setLeadStageAction(leadId, stage)` is the existing operator-override server action.
Today only `StageChip` + a vertical stage picker on the detail page surface any of it.

**This project builds the board UI on top of the engine that already exists. No new
stage model, no schema change.**

## Goals

- Replace `/leads` with a **kanban pipeline board** as the primary view (board-first;
  the current grid survives as a secondary "List" tab).
- Make **response speed** visible and central (speed-to-lead timers) — it's the metric
  that converts paid FB leads.
- Let the operator **drag a lead between stages** (= the existing manual override),
  while the auto-engine keeps moving cards on real events, visibly.
- A **metrics strip** answering "how's the funnel doing" from data we already log.
- Look state-of-the-art and inherit every tenant's theme (token-driven + existing
  `motion` system).

## Non-goals (explicitly deferred)

- Funnel **analytics page** (conversion %, drop-off, per-campaign ROI) — a later layer
  on the same data (this was "Approach B").
- Configurable SLA targets, per-stage automation triggers, saved views.
- Sending messages **from** the board — sends stay on the lead detail page where the
  review-then-send flow (AI draft → edit → mark sent / WhatsApp) already lives. The
  board can *start* an AI draft (deep-links into detail), never fire blind.
- Any change to the stage vocabulary, ranks, or the auto-advance engine.
- Schema changes.

## Approaches considered

- **A — Board *becomes* the Leads page (CHOSEN).** One focused build: `/leads` renders
  the board; List tab preserves the current grid. Highest value for the scope; replaces
  the inefficient page outright.
- **B — Full pipeline module.** A + analytics page + SLA config + automation triggers +
  saved views. Multi-session; analytics deserves its own design pass. Deferred.
- **C — Minimal board tab.** Board/Grid toggle, basic columns + drag, no metrics/timers.
  Cheap, but it's "a kanban", not the interface asked for. Rejected.

## Design

### 1. Layout & views

`/leads` (server component) loads leads + metrics and renders `<PipelineBoard>`.
Vertical order:

1. `PageHeader` — unchanged (eyebrow already "Pipeline"; keep "Add lead" action).
2. **Metrics strip** — 4 stat tiles (section 4).
3. **Controls bar** — search input (reuses current client-side filter logic) +
   source/campaign filter + **Board | List** segmented toggle.
4. **Board** or **List** depending on toggle.

**View toggle** persists per user in `localStorage` (`leads.view = board|list`),
defaulting to `board`. List tab renders the *existing* `LeadList` grid unchanged.

**Board structure:**
- **7 funnel columns**, left→right in funnel order: New lead, Hot lead, Consultation
  booked, No-show, Attended, Sale, Repeat customer. Horizontal row with CSS
  `scroll-snap` on overflow.
- **Lapsed & Lost** render as two **slim collapsed rails** pinned at the right edge
  (narrow, vertical label + count). They are always valid drop targets and
  **auto-expand on drag-over**; click to expand/collapse for browsing.
- **Column header:** stage label, colour dot (`STAGES[stage].colourHex`), live count.
- **Won-stage windowing:** `sale` and `repeat_customer` columns list only cards updated
  in the **last 30 days**, with the all-time count shown in the header
  (e.g. "Sale · 4 recent / 121"). Keeps the board from silting up with won leads while
  the count stays honest. (New/Hot/Consultation/No-show/Attended show all.)
- **Empty column:** faint dashed placeholder ("No leads here").

**Responsive:** on narrow screens columns become full-width `scroll-snap` pages
(swipe between stages); metrics strip wraps 2×2; drag initiated via long-press
(dnd-kit `TouchSensor` with activation delay).

### 2. The lead card (`<LeadCard>`)

Content:
- Avatar (initials) + full name (or "Anonymous"), email/phone line.
- Chips: therapy interest · campaign · source (reuse `Badge`).
- **Speed-to-lead timer** — shown only on cards with **no outbound message yet**
  (`firstOutboundAt == null`), any stage but most relevant in New/Hot. Renders
  "waiting 23m" from `now − createdAt`:
  - `< 15 min` → neutral (`--text-tertiary`)
  - `15 min – 1 h` → **amber** `#d29922` (matches the `no_show` stage colour)
  - `> 1 h` → **red** `#dc2626` (matches the detail-page danger colour)
  (globals.css exposes no `--warn`/`--danger` tokens; these inline hex values are used
  consistently across the board, extracted as a single `slaTone()` helper.)
  Once a lead has any outbound, the timer disappears (replaced by nothing — clean card).
- **Staleness dot** — a quiet dot when the card has sat `> 7 days` in its current stage
  (`now − updatedAt`), tooltip "9 days in Hot lead". Suppressed for `sale`,
  `repeat_customer`, `lost` (terminal/won — staleness is meaningless there).
- **Hover quick-actions** (appear on hover / always visible on touch): **✨ AI draft**
  (deep-links to `/leads/[id]?draft=1` which auto-triggers the existing draft
  generation), **WhatsApp** (deep-link to detail with reply composer open, only if
  `phone`), **Open**. No action sends a message directly from the board.

Card is a drag handle; clicking (not dragging) navigates to `/leads/[id]`
(dnd-kit distinguishes click vs drag via activation constraint).

### 3. Drag & drop + motion

- **Library:** add `@dnd-kit/core` + `@dnd-kit/sortable` (small, accessible,
  keyboard-draggable, tree-shakeable; complements existing `motion` v12). This is the
  one new dependency.
- **Drop behaviour:** dropping a card on a column calls `setLeadStageAction(leadId,
  stage)` (existing manual-override action — bypasses forward-only, which is correct for
  an operator). **Optimistic**: card moves instantly; on server error it snaps back and
  an error toast shows.
- **Undo:** every successful move shows a **5-second Undo toast** ("Moved to Sale —
  Undo"). Undo calls the same action with the prior stage.
- **Auto-engine visibility:** the board **refetches every 30 s and on window focus**
  (`router.refresh()` against the `force-dynamic` server component, or a light JSON
  fetch of a board endpoint — decided in plan). When a card's stage changed
  server-side (e.g. a lead replied → `hot_lead`), `motion` **layout animation** glides
  the card from its old column to its new one — the "it moves itself" moment. No
  websockets.
- **Accessibility:** dnd-kit keyboard sensor (pick up / move / drop via keyboard);
  columns are labelled drop regions; live-region announces moves.

### 4. Metrics strip (`lib/pipeline/metrics.ts`)

Four tiles, each a small stat with a sublabel, computed from existing data:
- **New this week** — count of leads `createdAt ≥ start of this week`, with ± delta vs
  the previous week.
- **Avg speed-to-lead (30d)** — mean of `firstOutboundAt − createdAt` over leads created
  in the last 30 days that have a first outbound. "—" if none.
- **Uncontacted now** — count of **active** leads (stage not in `sale`,
  `repeat_customer`, `lost`) with **no outbound message yet** (`firstOutboundAt == null`);
  tile turns **red** when any such lead is `> 1 h` old.
- **Lead → Sale conversion (90d)** — `sale∪repeat_customer` count ÷ total leads created
  in the last 90 days, as a %.

`metrics.ts` is a **pure-ish server module** (reads DB, no side effects); the SLA-tone
thresholds and date-bucketing are extracted as pure functions for unit testing.

### 5. Data & components

**Data:**
- Extend `listLeads` (or add `listLeadsForBoard`) to also return **`firstOutboundAt`**
  per lead via a single grouped join on `lead_messages`
  (`MIN(sent_at) WHERE direction='outbound' AND sent_at IS NOT NULL`) — **no N+1**.
  Shape returned to the client: `Lead & { firstOutboundAt: number | null }`.
- `getBoardMetrics()` in `lib/pipeline/metrics.ts`.
- No schema change. No new columns.

**Components** (under `components/pipeline/`):
- `PipelineBoard.tsx` — client component; owns board state, dnd context, 30s/focus
  refresh, view toggle, search/filter, optimistic moves + undo.
- `StageColumn.tsx` — one column (header + count + droppable body + windowing for won
  stages); also the collapsed-rail variant for lapsed/lost.
- `LeadCard.tsx` — the card (section 2); draggable.
- `PipelineMetrics.tsx` — the 4-tile strip.
- Reuse: `StageChip`, `Badge`, `Card`, `Input`, `motion` primitives, `useVocab`.
- Keep: `LeadList.tsx` (now the List tab), `LeadDetail.tsx` (unchanged).

**Styling:** all token-driven (`--surface-*`, `--hairline`, `--text-*`, stage
`colourHex`) so it inherits each tenant's theme automatically (Optimal Health red,
Inspire, etc.). Uses the existing motion system (`Reveal`/layout animation).

### 6. Error handling & testing

**Errors:**
- Failed stage move → revert optimistic state + error toast; lead stays put.
- Metrics/board load failure → the page still renders (empty/`—` tiles); never throws
  the route.
- Board refetch failure is silent (keeps last-good state; retries next tick).

**Testing** (existing plain-tsx runner + gate `typecheck · test · build:prod`):
- Pure unit tests: speed-to-lead tone thresholds (`<15m/15m–1h/>1h`), staleness
  threshold, metrics date-bucketing (week/30d/90d boundaries), won-stage 30d window.
- `firstOutboundAt` query correctness (a lead with mixed inbound/outbound/draft messages
  resolves to the earliest *sent outbound*; drafts with null `sent_at` excluded).
- No E2E/drag simulation in v1 (dnd interaction covered by manual QA on the deploy).

## Rollout

- Ships behind no flag — it's a UI replacement for an authenticated internal page. The
  List tab is the fallback if anything about the board feels off.
- Standard deploy gate: `npm run typecheck && npm test && npx next build` green locally,
  then `railway up` from `app/` (per project runbook).
- Manual QA on the live deploy: drag across all 7 columns + into lapsed/lost, undo,
  optimistic revert (kill network), auto-move animation (change a lead's stage via a
  reply and watch it glide), mobile long-press drag, theme inheritance on a second
  tenant.

## Open questions (resolve during planning)

- Board refresh mechanism: `router.refresh()` on the `force-dynamic` server component
  vs a dedicated lightweight `GET /api/leads/board` JSON endpoint. Lean JSON endpoint
  for a 30s poll (cheaper than a full RSC re-render), decide in plan.
