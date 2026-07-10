# Timetable Restyle — Split Day-Column Week View

**Date:** 2026-05-24
**Component:** `src/components/appointments/WeekCalendar.tsx` (week view only; List view and `WeekNav`/`ViewToggle` unchanged)
**Goal:** Make the appointments week view calmer and more legible while preserving the at-a-glance "which therapy is free" read.

## Problem

The current week view renders **6 days × N therapy lanes** (HBOT / Infrared / PEMF), i.e. up to 18 thin columns across. It's information-dense but washed-out and cramped: client names barely fit, hairlines are faint, and the grid reads as busy-yet-empty. The per-therapy lanes do carry real meaning (the booking model is **single-therapy, capacity 1 each** — see `[[booking-model]]`), so each lane = one bookable resource.

## Chosen design — "Split day columns"

Collapse to **one column per day**. Therapy is conveyed by **colour** (the therapy's `colourHex`), not by a dedicated lane.

- **A lone appointment spans the full day-column width** → roomy, full client name + therapy + time fit.
- **When appointments overlap in time, the column splits** into equal side-by-side colour-coded cards (max 3, since capacity is 1 per therapy). The split itself is the lane read: blue + purple cards at 9:00 with no orange = "HBOT and PEMF booked, Infrared free."
- **Per-day availability dots:** under each date, three small therapy-coloured pips — filled if that therapy has ≥1 booking that day, grey if free all day. A day-level free/busy glance.

This keeps B's breathing room while preserving the resource/lane read through colour + the split + the dots.

## Layout & rendering

- **Grid:** `time-column (≈44px) + repeat(6, 1fr)` — one cell per day, no therapy sub-columns. Time column keeps the existing hourly-label / blank-intra-hour logic and `slotMinutes` rows.
- **Appointment positioning (per day column):** absolute positioning by time — `top` = (start − windowOpen) offset, `height` = duration (carry the existing `SLOT_PX`/duration math). This correctly handles **staggered overlaps** (e.g. HBOT 09:00–10:00 alongside PEMF 09:30–10:30), which a pure per-slot-row flex cannot.
- **Overlap packing:** within a day, group appointments into overlap clusters (any chain of time-overlapping appts). Each cluster lays its members into `N` equal-width sub-columns where `N` = the cluster's max concurrency (1–3). Width = `100% / N`, left offset = `subIndex × width`. A cluster of one → full width. Greedy first-fit column assignment; deterministic tiebreak by start time then therapy display order.
- **Card:** solid `colourHex` fill, white text, 2px corners. Shows client name (single line, ellipsis truncation), therapy short-label, **and the start time on every card**. Click → `/appointments/[id]` (unchanged `Link`).

## Visual polish (brand: `[[brand-conventions]]`)

- Grey canvas, **squared 2px corners**, brand orange `#ef5a24` for the now-line and today accents.
- **Zebra hour rows** (alternating subtle shading) for horizontal tracking.
- **Today:** column gets a faint warm tint; the date in the header renders in orange.
- **Live "now" line:** a 2px orange line with a dot, positioned by current time, drawn only over today's column. Recomputes on mount + a light interval (e.g. every 60s).
- Stronger day dividers; lighter intra-row hairlines than today.
- **Legend:** a compact therapy colour key (● HBOT ● Infrared ● PEMF) above or below the grid.

## Preserved behaviour (no change)

- **Blockouts / closed / outside-opening-hours** cells keep the diagonal-hatch treatment and the `reason` label, recomputed per day column (currently per lane).
- 6-day Mon–Sat range, `weekStart` math, `WeekNav` (prev/next/Today), `ViewToggle` (Week/List), and the List view.
- Props/data contract of `WeekCalendar` is unchanged (`appointments`, `clients`, `therapies`, `therapyList`, `openingHours`, `blockOuts`, `windowOpen/Close`, `slotMinutes`). This is a **render-layer change only** — no data, server, or DB changes.

## Out of scope (YAGNI)

Drag-to-create / drag-to-move, resizing, click-empty-slot-to-book, day/month views, horizontal scroll redesign. This is a visual + layout refactor of the existing week grid.

## Testing / acceptance

- Lone appointment renders full-width with full name; two/three concurrent split evenly and stay colour-correct.
- Staggered overlap (different start times) sits side-by-side without visual collision.
- Now-line appears only on today at the right vertical position; today column + date highlighted.
- Blockout/closed/outside-hours hatch + reason still render per day.
- Availability dots reflect each day's booked therapies.
- Clicking a card navigates to the appointment; Week/List toggle and week nav unaffected.
- Typecheck clean; visual check via the `run` skill against real prod-like data.
