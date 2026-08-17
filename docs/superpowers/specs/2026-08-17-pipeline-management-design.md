# Pipeline Management (editable stages + role-driven automation + segmentation) — Design

**Date:** 2026-08-17
**Status:** Approved (design), pending implementation plan
**Area:** `app/src/lib/pipeline/*`, `app/src/lib/db/{tenant.ts,schema.ts,migrations}`, `app/src/lib/leads.ts`, `app/src/components/pipeline/*`, `app/src/app/settings/pipeline`, plus stage-vocabulary readers (Sales agent tools, inbox-AI, LeadDetail, StageChip).

## Problem

The pipeline stages are a **hardcoded 9-value union** (`lib/pipeline/stages.ts`: `new_lead … lost`, with a static `STAGES` record of label/colour/rank). The operator can't add a stage, rename one, recolour it, reorder, or delete one — the vocabulary is baked into the type system and read directly by the board, the auto-advance engine, the Sales agent, inbox-AI, and the lead detail picker. The user wants to **manage their own stages**.

The original ask also included **multiple pipelines** (one per campaign). During brainstorming the user pivoted: *"I probably don't need new pipelines once leads are tagged correctly — can we segment leads by tags?"* So multi-pipeline is **dropped**; its job is done by **segmentation** (filter the single board by the fields leads already carry, with real tags as a later phase).

## Goals

- **Editable stages, per tenant:** add / rename / recolour / reorder / delete stages from a settings screen.
- **Keep the automation working** when stages are custom — via **stage roles** (see §2): the auto-advance engine targets a role, not a hardcoded name.
- **Segment the board** by Campaign / Therapy / Source (fields every FB lead already has), with the metrics strip recalculating for the filtered segment.
- **Zero visible change on deploy** — existing tenants keep today's exact 9 stages/colours until someone edits them.

## Non-goals (explicitly deferred)

- **Multiple pipelines.** No `pipelines` table. If it ever returns, it's a clean additive migration (a `pipeline_id` FK on `pipeline_stages` + `leads`). Segmentation covers the stated need.
- **Real lead tags + auto-tag rules** — **Phase 2** (the user chose "both, phased": field filters now, tags later). New `tags`/`lead_tags` tables, rule engine (`campaign contains 'PEMF' → tag`), manual tagging UI. Out of scope here.
- **Per-stage automations** (fire a message/template when a lead enters a stage) — future, hooks into the existing Automations module.
- **Editing the role vocabulary itself.** The 9 roles are a fixed, closed set (they're the engine's semantic hooks). Users tag stages *with* roles; they don't invent roles.
- The legacy `leads.status` enum (`new/contacted/replied/booked/lost`) is untouched — it's already superseded by the pipeline stage and out of scope.

## Approaches considered

- **A — DB-backed stages, single pipeline (CHOSEN).** A per-tenant `pipeline_stages` table replaces the hardcoded 9; `leads.stage_id` FKs it; roles drive the engine. No `pipelines` table. Smallest model that fully delivers add/rename/reorder/delete.
- **B — Rename/recolour overrides only.** Keep the canonical 9, allow cosmetic overrides. Cheaper but **can't add or delete** — fails the core ask. Rejected.
- **C — Full multi-pipeline model.** Where we were heading pre-pivot. Unneeded; segmentation covers it; more schema + routing + UI. Rejected.

## Design

### 1. Data model (first real schema addition — additive only)

**New tenant table `pipeline_stages`:**
- `id` (pk, autoincrement)
- `name` (text, not null) — the display label; freely editable
- `colour` (text, not null) — hex, e.g. `#ef5a24`
- `position` (integer, not null) — funnel order; drives forward-only advancement
- `role` (text, nullable) — one of the fixed role vocabulary, **at most once per tenant** (partial-unique: unique where role is not null)
- `created_at` (ms)

**Role vocabulary (fixed, closed set — the engine's semantic hooks):**
`new · engaged · booked · no_show · attended · won · repeat · lapsed · lost`
(These map 1:1 onto today's stages: `new_lead→new`, `hot_lead→engaged`, `consultation_booked→booked`, `no_show→no_show`, `attended→attended`, `sale→won`, `repeat_customer→repeat`, `lapsed→lapsed`, `lost→lost`.) A stage with a `null` role is **manual-only** (drag moves it; no event ever auto-targets it).

**`leads` gains `stage_id`** (integer, nullable FK → `pipeline_stages.id`), added with the existing `PRAGMA table_info(leads)` → `ALTER TABLE leads ADD COLUMN` guard pattern (mirrors how `pipeline_stage` itself was added at tenant.ts:1345). The old `leads.pipeline_stage` **text column is frozen** — kept for the backfill mapping + rollback safety, never read or written after migration.

**Table creation** goes in `ensureTenantTables` (a `CREATE TABLE IF NOT EXISTS pipeline_stages …`) so every tenant DB gets it on open; the column-add + seed run in the same idempotent bootstrap path.

**Idempotent seeder + backfill** (runs per tenant, self-heals on first DB access post-deploy): *if `pipeline_stages` is empty*, insert the 9 canonical stages (name/colour/position/role taken from today's `STAGES` record in order), then **backfill every lead's `stage_id`** by matching the frozen `pipeline_stage` text → the seeded stage of the corresponding role. Result: day one is byte-identical to today.

**Invariants (enforced in the settings actions + engine):**
- Always ≥1 stage (can't delete the last).
- Each role used at most once (DB partial-unique + UI guard).
- **Entry stage** = the `role:new` stage; if none, the lowest `position`. New leads (inbound + manual) land here.

### 2. Engine → roles (the load-bearing change)

`lib/pipeline/stage.ts` keeps its **five event hooks and every call site unchanged** (`onInboundFromLead`, `onInboundFromClient`, `onAppointmentBooked`, `onAppointmentStatus`, `onPaymentRecorded` — invoked from the appointments API/actions, whatsapp webhook, packages actions). Only their internals change:

- `advanceStage(leadId, role)` now resolves **the lead's tenant's stage tagged with `role`** and moves forward-only **by `position`** (today it compares static `rank`). If no stage carries that role → **no-op** (that automation is simply off for this tenant's layout — the design's answer to "custom stages").
- **Out-of-band roles keep today's `rank:0` semantics — `position` does NOT order them.** `position` drives board display order for *all* stages, but advancement treats the two out-of-band roles specially, exactly as the current engine's `rank:0` does: `role:lost` is **frozen** (no auto event ever moves a lost lead); from `role:lapsed`, **any** forward funnel event pulls the lead back out (a re-paying lapsed customer must reach `won`/`repeat` even though the lapsed rail sits at a high `position`). So `shouldAdvance` must NOT simply compare positions when the current stage is out-of-band — it branches on role first (lost→frozen, lapsed→pull-out to the target funnel stage), then falls back to **forward-only by `position` among funnel stages**. This mirrors why lapsed/lost are `rank:0` today. The pure decision (`shouldAdvance(current, candidate)` over `{position, role}`) stays in a **pure, unit-tested module** (the successor to `nextAutoStage`), with explicit tests for the lapsed-pull-out and lost-frozen cases.
- `lib/pipeline/stages.ts`: the static `STAGES` record and the `PipelineStage` name-union are **removed**; a `StageRole` union (the 9 roles) + role metadata (default label/colour/order, used only by the seeder) replace them. Stage *names* are now data.

**`boardMetrics` (pure, already tested):** its hardcoded stage sets become **role sets** — `won = {won, repeat}`, inactive/uncontacted-excluded = `{won, repeat, lost}`, staleness-suppressed = `{won, repeat, lost}`, won-window columns = `{won, repeat}`. It now takes each lead's `role` (resolved from its stage) alongside `position`. Tests updated to role inputs.

**Downstream readers switch from the static record to DB-loaded stages:** the Sales agent tools (`tools.sales.ts` — so the agent speaks the tenant's custom vocabulary automatically), inbox-AI settings, `LeadDetail`'s stage picker, `StageChip`, `LeadCard`, `StageColumn`. A server helper `listStages(tenant)` returns the ordered stage records; server pages load it and thread a `stages` array (or `id → {name,colour,role}` map) into client components. `StageChip` takes the resolved stage record (or an id + the map) instead of `STAGES[nameUnion]`.

### 3. Settings UI — `/settings/pipeline` (admin-only)

One screen. The tenant's stages as a **reorderable list** (drag handle, reusing `@dnd-kit`), each row:
- colour **swatch** → palette picker
- inline **name** edit
- **role** dropdown with plain-English hints ("Engaged — set automatically when a lead replies"; "Won — set on first payment"). A role already assigned elsewhere shows which stage holds it (pick here → moves it).
- **delete**
- an **Add stage** row at the bottom.

Explicit **save** actions with toasts (matches the user's visible-save preference). **Reorder / rename / recolour are safe and effectively instant** — leads reference stage *ids*, not names. **Deleting a stage that has leads** opens a "Move its N leads to [stage picker]" prompt and does the reassign + delete **atomically** (one transaction). Deleting the last stage, or leaving zero `role:new` stages, is blocked with an inline explanation.

### 4. Board + segmentation

**Columns render from the DB:** funnel = all stages ordered by `position`; **rails** = the `role:lapsed` + `role:lost` stages; the **30-day won-window** applies to `role:won` + `role:repeat` columns (unchanged behaviour, now keyed by role). A stage with no leads still renders (its column/rail exists because it's configured).

**New filter bar** (Phase-1 segmentation): **Campaign · Therapy · Source** dropdowns, populated from the distinct values across the tenant's actual leads, combinable with the existing search, **persisted per user** (localStorage, like the board/list toggle). The **metrics strip recalculates for the filtered segment** — filtering to "PEMF JUNE" shows that segment's own new-count / speed / conversion. Because filtering is client-side over the already-loaded leads and `computeBoardMetrics` is pure, the segment metrics also live-update with the existing 30s refresh.

### 5. Rollout & safety

- **Additive DDL only** via the existing idempotent bootstrap (`ensureTenantTables` + the PRAGMA-guarded column add + the empty-table seeder). Runs for **every tenant** (renova, inspire, test…) on first DB access after deploy → **zero visible change until someone edits**.
- **Clean cutover:** Railway swaps deployments atomically (old stops when new is healthy), so no old-code/new-code overlap — no dual-write of the frozen `pipeline_stage` text column needed.
- **Stage deletion is transactional** (reassign leads → delete, or nothing). A lead insert that races a deletion falls back to the **entry stage** (never a dangling `stage_id`).
- **Rollback:** the frozen `pipeline_stage` text column still holds each lead's last value at migration time; reverting the deploy resumes reading it (no data lost, only post-migration stage moves that hadn't been mirrored).
- **Gate** (unchanged): `npm run typecheck && npm test && npx next build`. New pure tests: the role-based `shouldAdvance` decision, the seeder's name↔role backfill mapping, the role-set metrics, and the settings invariants (last-stage / entry-stage / role-uniqueness guards) — all DB-free pure functions.

### 6. Testing

- Pure unit tests (plain-tsx runner): `shouldAdvance` (forward-only by position; `lost` frozen; `lapsed` out-of-band pull-back), role-set membership for metrics, the invariant guards (`canDeleteStage`, `resolveEntryStage`, `assertRoleUnique`), and the backfill map (`pipeline_stage` text → seeded role).
- DB-touching paths (seeder, `listStages`, delete-with-move transaction) are verified by typecheck + the manual QA below (consistent with the repo's DB-free test convention).
- Manual QA on a running app: add/rename/recolour/reorder a stage and see the board update; delete a stage with leads → reassign prompt; confirm auto-advance still fires (a reply moves a lead to the `engaged`-role stage even after it's renamed); segment by campaign and watch the metrics recompute.

## Open questions (resolve during planning)

- **Colour palette:** a fixed swatch set (derived from the current stage colours + a few more) vs. a free hex input. Lean fixed swatch set for consistency; decide in plan.
- **`StageChip` signature:** take the resolved `{name,colour}` record vs. take an id + a `stages` map prop. Lean record (simplest for callers that already hold the stage); decide per call site in plan.
- **Seeder placement:** inline in `ensureTenantTables` vs. a versioned `TENANT_MIGRATIONS` entry (the repo has both). Lean versioned migration for the column-add + seed (auditable, ordered), `CREATE TABLE IF NOT EXISTS` in `ensureTenantTables` for the table itself; confirm the division against `migrations/index.ts` in plan.
