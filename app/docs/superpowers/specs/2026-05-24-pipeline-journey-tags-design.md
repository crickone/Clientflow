# Pipeline Journey Stage

**Date:** 2026-05-24 (rev 2 — switched from cumulative tags to a single exclusive stage)
**App:** ClientFlow / Renova (Next.js 14, SQLite + Drizzle)

## Goal

Track each lead's **current position in the customer journey** as a **single, mutually-exclusive stage**, auto-advanced as they progress, rendered as a colour-coded chip and **filterable** — so the operator can cleanly segment for marketing ("message everyone at `consultation_booked`") without overlap.

## Why single-stage, not cumulative tags

Cumulative tags were the first idea, but they break segmentation: a customer would still carry `hot_lead` and `new_lead`, so a "message all hot leads" blast would also hit existing customers. **One current stage per person** gives clean, non-overlapping segments. Qualities that genuinely coexist with a stage (e.g. **VIP**) stay as **additive tags** (the existing tag system) — they are *not* part of the exclusive stage set.

## The stage set

A single `pipelineStage` value per lead. **Main funnel (ranked, auto-advances forward only):**

| Stage (slug) | Label | Auto-set when | Rank |
|---|---|---|---|
| `new_lead` | 🆕 New lead | a lead is created (`upsertLead`), if no stage yet | 10 |
| `hot_lead` | 🔥 Hot lead | the lead sends an inbound message | 20 |
| `consultation_booked` | 📅 Consultation booked | an appointment is booked (any appointment) | 30 |
| `no_show` | ⚠️ No-show | a booked appointment is marked `no_show` (and not yet attended) | 35 |
| `attended` | ✅ Attended | an appointment is marked `completed` | 40 |
| `sale` | 💰 Sale | their **first** payment is recorded | 50 |
| `repeat_customer` | 🔁 Repeat customer | their **2nd+** payment is recorded | 60 |

**Branch / out-of-band states:**
- `lapsed` 💤 — time-based & **reversible** (see §Lapsed).
- `lost` ❌ — **manual only**, terminal.

**Additive tags (unchanged, coexist with any stage):** `vip` ⭐ VIP, plus existing AI/topic/user tags.

## Stage engine — `lib/pipeline/stage.ts`

- `advanceStage(leadId, candidate)` — **forward-only**: sets the stage to `candidate` iff `rank(candidate) > rank(current)`. Never regresses (an existing customer who replies stays `sale`, does not drop to `hot_lead`). No-ops if the lead is `lost` (auto events don't move a lost lead) or `candidate` ≤ current.
- `setStageManual(leadId, stage)` — operator override; may set **any** stage (incl. `lost`, or clearing `lost` back to an active stage), bypassing forward-only.
- `no_show` (rank 35) sits below `attended`/`sale`, so a no-show who later attends or pays still advances past it.
- Every change writes an `activity_log` entry (`pipeline.stage` — "Aoife moved to Consultation booked") for an auditable timeline.

### Anchoring: stage lives on the LEAD
The journey is a lead funnel, so `pipelineStage` is a column on `leads`. Client-side events (booking, payment, attendance) resolve the originating lead via `leads.clientId` (`leadIdForClient(clientId)`) and advance **the lead**. **Walk-in clients with no originating lead are out of scope for v1** (those events no-op).

### Event hooks (non-blocking — wrapped in try/catch + log, like `void runTriage().catch`)
- `upsertLead` create path → `advanceStage(new_lead)`.
- WhatsApp webhook inbound (+ any inbound message creation) → `advanceStage(hot_lead)`.
- `/api/appointments` POST → resolve lead → `advanceStage(consultation_booked)`.
- Appointment status → `completed` → `advanceStage(attended)`; `no_show` → `advanceStage(no_show)`.
- Payment recorded (`clients/actions.ts`) → resolve lead → `advanceStage(sale)` on first payment, `advanceStage(repeat_customer)` on 2nd+.

## Data model

- **`leads.pipelineStage`** — new `text` enum column (`new_lead | hot_lead | consultation_booked | no_show | attended | sale | repeat_customer | lapsed | lost`), default `new_lead`. Added via the self-healing `ALTER TABLE` loop in `lib/db/index.ts`.
- **Backfill on boot:** map the legacy `leads.status` → `pipelineStage` once (`new→new_lead`, `contacted→new_lead`, `replied→hot_lead`, `booked→consultation_booked`, `lost→lost`).
- **`pipelineStage` becomes the canonical journey field.** The stage engine is its only writer; existing `setLeadStatus` callers (webhook, `leads/actions.ts`) are repointed to the stage engine. The legacy `status` column is **deprecated** — retained physically to avoid breaking unaudited reads, but no longer authoritative. (Full removal is a later cleanup.)
- **No changes to the `tags`/`conversation_tags` tables** — VIP and topic tags use them as-is.

## Lapsed (time-based, reversible)
- A **daily job** (sibling of the nightly backup scheduler): for each lead currently at `sale`/`repeat_customer` with **no visit in 90 days** → `lapsed`; if a lead at `lapsed` has a visit within 90 days → revert to `repeat_customer` (≥2 payments) or `sale`. Recomputed from payment/visit history, so no "previous stage" needs storing.
- Only `lapsed` (and manual `lost` clearing) move a stage "backward"; the funnel is otherwise forward-only.

## Surfacing
- A **colour-coded stage chip** (colour map by stage) on each Leads-list row, in the Communication inbox conversation, and on the client profile (via the linked lead).
- A **stage filter** on the Leads list — the practical segmentation handle (and the basis for future "message everyone at stage X", which belongs to the parked action center).
- Manual stage control on the lead detail (a dropdown / "mark Lost"), plus VIP as a normal addable tag.

## Error handling
- Hooks are best-effort and never block the underlying action (booking/payment/inbound) — try/catch + log.
- `advanceStage` is idempotent and monotonic (re-firing the same/earlier candidate is a no-op).
- Unknown stage / no resolvable lead → no-op + warn.

## Testing
- Unit (`lib/pipeline/stage.ts`): forward-only (replying as `sale` stays `sale`); `no_show`→later `attended` advances; first-vs-2nd payment → `sale`/`repeat_customer`; `lost` frozen against auto; `leadIdForClient` resolution; lapse apply + revert-on-visit.
- E2E (`tests/`): create lead → inbound → book → pay; assert stage ends at `sale` (not a pile of tags); no-show path; daily lapse job.
- Typecheck + `build:prod` green; visual check of the Leads-list chip + filter via the local screenshot recipe.

## Out of scope (v1)
Walk-in (lead-less) clients in the pipeline · a kanban/board view · per-stage automations / "message everyone at stage X" (parked action center) · removing the legacy `status` column · making VIP/qualities anything other than ordinary additive tags.
