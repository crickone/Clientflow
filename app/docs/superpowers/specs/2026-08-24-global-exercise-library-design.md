# Global Exercise Library — Design

**Date:** 2026-08-24 · **Status:** APPROVED (design) · pending spec review
Makes the Workout **Exercise Library** (Inspire's curated ~600 exercises + their videos) available to **every tenant**, instead of being per-tenant-empty for everyone but Inspire.

## Goal

Every tenant's Workout module (`/workout` — Exercise Library page + the workout/circuit builders' pickers) shows a **shared global library** of ~600 exercises, and can still add its **own private custom exercises** on top. Videos are backfilled **once** globally (not re-fetched per tenant against the shared ~100/day YouTube quota).

## Why global (not per-tenant copies)

- The YouTube backfill shares **one global quota** (~100 searches/day, one `YOUTUBE_API_KEY`, no fairness across tenants). Cloning 600 exercises into N tenants → 600×N searches needed → tenants starve each other for weeks. A shared library needs ~600 searches **ever**.
- The codebase already ships this exact pattern for CMS images: `cms_library_assets` (control-plane table, **nullable `tenant_id`**, `NULL` = shared with everyone; read via `WHERE tenant_id = ? OR tenant_id IS NULL`, see `lib/cms/library.ts:117-127`). We mirror it.

## Architecture

- **One control-plane table `exercise_library`** (in `control.db` via `ensureControlTables()`), mirroring the per-tenant `exercise_library` columns (`name`, `category`, `muscle_groups`, `equipment`, `video_url`, `image_url`, `instructions`, timestamps) **plus a nullable `tenant_id`**: `NULL` = **global** (every tenant sees it); a set `tenant_id` = that tenant's **private custom** exercise.
- **`listExercises()` (`lib/exerciseLibrary.ts`)** — the single function all 7 pages + 3 builders read through — is rewritten to return the control-plane rows `WHERE tenant_id = <current> OR tenant_id IS NULL`, ordered by name. **Returned shape (`ExerciseLibRow[]`) is unchanged**, so the entire UI (pages, builders, `ExerciseLibraryView`) is untouched.
- **`saveExercise`/`deleteExercise`** now write to the control table: a normal tenant admin creates/edits **only their own** (`tenant_id` = current) customs; **global rows are platform-admin-only** (a tenant can't edit/delete a `tenant_id IS NULL` row — guard it). Adding a custom exercise still works exactly as before from the tenant's view.
- **Video backfill** (`lib/automations/scheduler.ts`) — operate on the **control table**: one pass fills missing videos for global rows (once, ~600) + each tenant's customs; drop the per-tenant `backfillVideosForTenant` fan-out that multiplied the quota. Manual "Auto-find videos" button fills what's missing in the current view (respect the same quota guards).

## Bootstrap (no manual export)

A **one-time control migration** (`CONTROL_MIGRATIONS`) that:
1. Creates the control `exercise_library` table.
2. **Imports the curated ~600 from the Inspire tenant's per-tenant `exercise_library` (video URLs and all) as GLOBAL rows** (`tenant_id = NULL`). It runs in **production**, where those rows actually live (`app/data/tenants/inspire/inspire.db`) — so nothing is exported by hand. Source tenant = Inspire (its slug/id — a one-time bootstrap constant; the exercises are generic — bench press, squat — not Inspire-branded).
3. **Imports any OTHER tenant's existing per-tenant custom exercises** as that tenant's customs (`tenant_id` = them). (Recon: only Inspire has rows today; others are empty — so this is a no-op in practice but correct for completeness.)
4. Idempotent (guard on the control table already being populated / a migration version) — safe to run repeatedly; the deploy runs migrations on boot.

The per-tenant `exercise_library` tables are **left in place but no longer read/written** (their rows are migrated to control). Not dropped (don't destroy data); a later cleanup can remove them.

## The one nuance — existing workout links (no remap needed)

Workout items (`workout_exercises`/`workout_items`/`circuit_items`) hold a **nullable, soft** `exerciseId` (`onDelete: set null`) **plus a denormalized copy of the exercise `name`/`muscleGroups`** captured at add-time. Builders/editors render straight off that denormalized `name`/`muscleGroups` and never re-query the library for them.

**Correction (GEL whole-branch review, post-launch):** the preview pages are an exception to "never re-queries" — `workout/workouts/[id]/preview` and `workout/circuits/[id]/preview` DO re-query `listExercises()`, to resolve exercise **thumbnails**. The original version of this doc claimed rendering/preview never re-queries the library at all, which was false and masked a real bug: that thumbnail lookup was keyed by the item's stored `exerciseId`, which the bootstrap below silently renumbers — so any workout/circuit created before the migration would resolve thumbnails against the wrong id namespace (invisible while `image_url` was 0% populated, but latently capable of showing the WRONG image once it wasn't). Fixed by keying/looking up thumbnails by the item's normalized `name` instead (`lib/workoutPreviewMedia.ts`'s `normalizeExerciseName`/`buildExerciseMediaMap`) — the same denormalized, id-namespace-agnostic field builders/editors already rely on. So after exercises move to the control table:
- **Existing workouts render + edit perfectly** via their denormalized `name`/`muscleGroups` — no data migration of item FKs required. Preview thumbnails resolve correctly too, via that same denormalized `name`, not `exerciseId`.
- The old `exerciseId` values (old per-tenant ids) become **inert soft references**: never re-resolved, and — since the thumbnail fix — never used to resolve display media either. New picks still store the control-plane id, but nothing reads it back for display, so a mixed-namespace `exerciseId` can no longer cause a wrong-thumbnail collision.
- The per-tenant `exerciseId REFERENCES exercise_library(id)` FK is now a **logical/soft reference across the tenant↔control boundary** (SQLite can't enforce cross-file FKs) — matches the already-soft, denormalized reality. Design it as a plain integer, don't rely on FK enforcement.

## Components (files — final split in the plan)

- `lib/db/control.ts` — `exercise_library` control table in `ensureControlTables()` (mirror `cms_library_assets`, nullable `tenant_id`).
- `lib/db/migrations/index.ts` — a `CONTROL_MIGRATIONS` entry: create + bootstrap-import from Inspire + other tenants' customs (idempotent).
- `lib/exerciseLibrary.ts` — `listExercises()` (merge global+own), `saveExercise`/`deleteExercise` (tenant-custom writes + global-guard), `listExercisesForTenant` (background-job sibling) — all onto the control table. **Keep the `ExerciseLibRow` return shape.**
- `lib/automations/scheduler.ts` — backfill operates on the control table (one global pass + customs); drop the per-tenant multiplication.
- `app/workout/exercises/actions.ts` — `saveExerciseAction`/`deleteExerciseAction`/`bulkFindExerciseVideosAction` adjusted for the control table + the tenant-vs-global guard (admin-gated as today).
- `lib/assistant/tools.ts` — the `add_exercise` AI tool writes a tenant-custom row (control, `tenant_id` = current) — verify it still works.
- No change to the 7 `page.tsx` call sites, the 3 builder components, or `ExerciseLibraryView.tsx`.

## Error handling / edge cases

- **Tenancy:** a tenant only ever sees global + its OWN customs (`tenant_id = ? OR IS NULL`); never another tenant's customs. A tenant cannot edit/delete a global row (guard in save/delete).
- **Bootstrap idempotency:** re-running the migration doesn't duplicate the 600 (guarded).
- **A tenant with pre-existing customs** (none today, but correct): migrated to their `tenant_id`, still visible only to them.
- **New tenants:** get the global library immediately (nothing to seed) — no `createTenant`/`seedTenant` change needed.
- **Video quota:** globals backfilled once; the nightly job no longer multiplies searches per tenant.
- **The AI `add_exercise` tool + manual add** still create tenant customs (not globals).

## Testing

- `listExercises` merge (global + own; excludes other tenants' customs) — via the control-DB test approach the repo already uses.
- `saveExercise`/`deleteExercise`: tenant custom round-trip; global-row edit/delete rejected for a non-platform-admin.
- The bootstrap migration: idempotent (run twice → 600 once); Inspire→global, other→own; a real workout item's denormalized render still works with an inert exerciseId.
- Gate: typecheck + `node scripts/test.mjs` + `npx next build` **twice** (idempotent migration).

## Decisions (defaults — confirm at review)

- **Model:** shared global (nullable `tenant_id`) + tenant customs — NOT per-tenant editable copies (operator picked this).
- **Global source:** the Inspire tenant's current ~600 (curated, generic).
- **Global editing:** platform-admin only (tenants read globals, add/edit only their own customs). A per-tenant "hide a global exercise" toggle is deferred.
- **Old per-tenant `exercise_library` tables:** left unused (not dropped) post-migration.
