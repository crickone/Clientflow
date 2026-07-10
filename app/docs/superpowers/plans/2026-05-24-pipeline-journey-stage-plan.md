# Implementation Plan — Pipeline Journey Stage

**Spec:** `docs/superpowers/specs/2026-05-24-pipeline-journey-tags-design.md` (rev 2 — single exclusive stage)
**Scope:** A single `pipelineStage` per lead, auto-advanced (forward-only) at journey events, with `lapsed`/`lost` branches, surfaced + filterable on the Leads list. VIP stays an additive tag.

**Conventions:** each phase ends `npx tsc --noEmit` clean; UI verified via the local Playwright screenshot recipe; deploy only once the slice is whole and `build:prod` is green. Hooks are non-blocking (try/catch + log).

---

## Phase 1 — Data model + one-time backfill
- `leads.pipelineStage` text enum (`new_lead | hot_lead | consultation_booked | no_show | attended | sale | repeat_customer | lapsed | lost`), default `new_lead`, in `schema.ts`.
- Self-healing `ALTER TABLE leads ADD COLUMN pipeline_stage ...` in `lib/db/index.ts` (PRAGMA-guarded, like existing migrations).
- **One-time backfill** guarded by a settings flag `pipeline_stage_backfilled`: map legacy `status` → stage (`new/contacted→new_lead`, `replied→hot_lead`, `booked→consultation_booked`, `lost→lost`) for all existing leads, then set the flag. Never re-runs (so it can't regress advanced leads).
- **Verify:** column present; a node check shows existing leads carry sensible stages; flag set.

## Phase 2 — Stage engine (`lib/pipeline/stage.ts`)
- `STAGES` metadata (slug → `{ label, colourHex }`) and `STAGE_RANK` (new_lead 10, hot_lead 20, consultation_booked 30, no_show 35, attended 40, sale 50, repeat_customer 60; `lapsed`/`lost` out-of-band).
- `currentStage(leadId)`; `advanceStage(leadId, candidate)` — forward-only (`rank(candidate) > rank(current)`), no-op if `current === "lost"`; `setStageManual(leadId, stage)` — any stage (incl. set/clear `lost`); `leadIdForClient(clientId)` reverse lookup via `leads.clientId`.
- Each change writes `activity_log` (`pipeline.stage`).
- **Verify:** unit test `lib/pipeline/stage.test.ts` (run `npx tsx`): forward-only (replying as `sale` stays `sale`); `no_show` then `attended` advances; `lost` frozen vs auto; manual override sets any; rank monotonicity.

## Phase 3 — Event hooks
Wire `advanceStage`/`leadIdForClient` into the located write points; repoint existing `setLeadStatus` callers to the stage engine:
- `upsertLead` create path → `advanceStage(new_lead)`.
- WhatsApp webhook inbound + any inbound message creation (`lib/leads` / `lib/clientMessages` add paths) → `advanceStage(hot_lead)`.
- `POST /api/appointments` → `leadIdForClient` → `advanceStage(consultation_booked)`.
- Appointment status setter (find in appointment actions / `StatusActions`) → `completed`→`attended`, `no_show`→`no_show`.
- Payment recording in `clients/actions.ts` → `sale` on first payment, `repeat_customer` on 2nd+ (count the client's prior payments).
- All calls wrapped non-blocking.
- **Verify:** E2E (`tests/e2e_pipeline.py` or extend `e2e_appointments`): create lead → inbound → book → pay → assert stage `sale`; mark no-show path; confirm an existing customer's reply does not regress to `hot_lead`.

## Phase 4 — Lapsed daily job
- `lib/pipeline/lapse.ts` `recomputeLapsed()`: leads at `sale`/`repeat_customer` with no visit in 90d → `lapsed`; leads at `lapsed` with a visit in 90d → revert to `repeat_customer` (≥2 payments) else `sale`.
- Schedule daily (mirror `lib/backup/scheduler.ts`; arm from `lib/db/index.ts`, NOT instrumentation — Edge-compile trap noted in deploy memory). Expose an admin trigger route for testing (like `/api/internal/backup`).
- **Verify:** seed a stale customer → run → `lapsed`; add a visit → run → reverts.

## Phase 5 — Surfacing (UI)
- `StageChip` component (colour by stage) reused across views.
- **Leads list:** chip per row + a **stage filter** (segment control / dropdown) driving the query.
- **Communication inbox:** show the conversation's lead stage chip.
- **Client profile:** show the linked lead's stage chip.
- **Lead detail:** manual stage control (dropdown incl. "Mark Lost" / clear) → `setStageManual`; VIP remains an addable normal tag.
- **Verify:** screenshot the Leads list (chips + filter) via the local recipe; manual change persists.

## Phase 6 — Tests + deploy
- Run unit + E2E; `tsc` + `build:prod` green; deploy via `railway up`; smoke-check Leads + inbox.

---

## Notes / out of scope
Walk-in (lead-less) clients · kanban board · "message everyone at stage X" automation (parked action center) · dropping the legacy `status` column (deprecated now, removed later) · VIP/qualities as anything but additive tags.
