# Global Exercise Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Workout exercise library a shared **global** library (control-plane, nullable `tenant_id`) that every tenant sees, bootstrapped from Inspire's curated ~600, + each tenant's own private customs; videos backfilled once.

**Architecture:** New control-plane `exercise_library` (mirror `cms_library_assets`) → `listExercises()` merges global+own → nightly backfill on the control table → one-time migration imports Inspire's rows as global. UI untouched (one function's return shape preserved). Spec: `docs/superpowers/specs/2026-08-24-global-exercise-library-design.md`.

## Global Constraints
- **Reuse the `cms_library_assets` precedent** (`lib/db/control.ts` table with nullable `tenant_id`; `lib/cms/library.ts:117-127` merge read `WHERE tenant_id = ? OR tenant_id IS NULL`). Mirror it exactly.
- **`ExerciseLibRow` return shape of `listExercises()` MUST NOT change** — the 7 pages + 3 builders + `ExerciseLibraryView` depend on it; do not touch them.
- **Tenancy:** a tenant sees global + its OWN customs only; can create/edit/delete only its OWN customs; **cannot** edit/delete a global (`tenant_id IS NULL`) row — guard it. Global editing is platform-admin/out-of-scope here.
- **Existing workouts:** items denormalize `name`/`muscleGroups`, so **no item-FK remap** — old `exerciseId` values become inert soft refs. Do NOT migrate workout item rows. _(Correction, GEL whole-branch review: the "never re-query the library / render unaffected" assumption was WRONG — the workout/circuit **preview** pages did re-resolve `exerciseId` for thumbnails, which the bootstrap's id renumbering staled. Fixed by resolving thumbnails on the denormalized `name` instead — see `lib/workoutPreviewMedia.ts` + the corrected design doc.)_
- **Migration idempotent** (`next build` runs it twice); robust to environments where the Inspire tenant / its rows are absent (import nothing, no error).
- Money/quota: the video backfill must NOT multiply YouTube searches per tenant (globals filled once).
- Gate each task: `npm run typecheck` + `node scripts/test.mjs` + `npx next build`.

## File Structure
```
lib/db/control.ts               — control-plane exercise_library (nullable tenant_id) in ensureControlTables()
lib/db/migrations/index.ts      — CONTROL_MIGRATIONS entry: bootstrap import (Inspire→global, others→own), idempotent
lib/exerciseLibrary.ts          — listExercises (merge), saveExercise/deleteExercise (tenant-custom + global-guard), listExercisesForTenant → control table
lib/automations/scheduler.ts    — backfill on the control table (one global pass + customs), drop per-tenant multiplication
app/workout/exercises/actions.ts— save/delete/bulk-find on the control table + tenant-vs-global guard (admin-gated as today)
lib/assistant/tools.ts          — verify add_exercise writes a tenant-custom control row
```

---

### Task 1: Control-plane table + bootstrap migration (`control.ts` + `migrations/index.ts`)
Add `exercise_library` to `ensureControlTables()` — same column set as the per-tenant table + `tenant_id INTEGER` nullable (mirror `cms_library_assets` at `control.ts:206-217`). Add a `CONTROL_MIGRATIONS` entry that, idempotently (guard: skip if the control table already has rows / a version marker):
- imports the **Inspire** tenant's per-tenant `exercise_library` rows (open its tenant DB read-only; resolve Inspire by slug — a bootstrap constant) into the control table as **global** (`tenant_id = NULL`), preserving `video_url` etc.;
- imports every OTHER tenant's per-tenant `exercise_library` rows as that tenant's customs (`tenant_id = tenantId`);
- robust when the Inspire tenant or its rows don't exist (import nothing).
- [ ] TDD the importer's pure mapping if extractable; verify idempotency by running the migration path twice (build twice). Commit.

### Task 2: `exerciseLibrary.ts` on the control table (read merge + writes)
Rewrite `listExercises()` → control rows `WHERE tenant_id = <current tenant id> OR tenant_id IS NULL` ORDER BY name, returning the **unchanged `ExerciseLibRow`** shape. `saveExercise` inserts/updates with `tenant_id = current` (a custom); **reject** editing/deleting a row whose `tenant_id IS NULL` (global) — a tenant can only touch its own. `deleteExercise` same guard. `listExercisesForTenant`/`setExerciseVideoUrlForTenant` (background siblings) → control table by explicit tenant/global. TDD the merge (global + own visible; another tenant's custom NOT visible; global-edit rejected) with the repo's control-DB test approach.
- [ ] TDD → commit.

### Task 3: Video backfill on the control table (`scheduler.ts`)
Rework the nightly backfill to fill missing videos over the **control** `exercise_library` (globals once + customs), NOT a per-tenant fan-out that multiplies the shared quota. Keep the quota cap + stop-on-quota behaviour. `bulkFindExerciseVideosAction` likewise targets the control table (respect the guard). TDD the "which rows need a video" selection if pure.
- [ ] Build → typecheck/build → commit.

### Task 4: Actions + AI tool verify (`actions.ts` + `tools.ts`)
`saveExerciseAction`/`deleteExerciseAction`/`bulkFindExerciseVideosAction` — admin-gated (as today), operate on the control table via T2's fns, enforce the tenant-vs-global guard (direct-POST safe). Verify the assistant `add_exercise` tool writes a tenant-custom control row. Confirm the 7 pages/3 builders/`ExerciseLibraryView` compile unchanged.
- [ ] Build → typecheck/build → commit.

### Task 5: Whole-branch review + deploy
- [ ] `scripts/review-package` the range → final reviewer (most-capable): tenancy (a tenant never sees/edits another's customs; global-edit guard), migration idempotency + robustness (no Inspire → no error), UI-shape unchanged, no workout-item breakage (denormalized render), backfill quota not multiplied, admin gates. Fix Critical/Important → deploy → verify (a fresh tenant sees the library) → finishing-a-development-branch.

## Self-Review
- Spec coverage: control table + bootstrap(T1) · read-merge + tenant-custom writes + global-guard(T2) · backfill(T3) · actions + AI tool(T4) · review/deploy(T5). New-tenant provisioning needs NO change (global visible immediately). UI untouched.
- Types consistent: `ExerciseLibRow` unchanged; nullable `tenant_id` global convention matches `cms_library_assets`.
