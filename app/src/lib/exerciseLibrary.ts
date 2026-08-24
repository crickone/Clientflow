import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getCurrentTenant } from "@/lib/db/tenant";
import { parseYouTubeId } from "@/lib/youtube";

/**
 * Global Exercise Library (GEL Task 2 — see
 * docs/superpowers/specs/2026-08-24-global-exercise-library-design.md):
 * reads/writes now target the CONTROL-PLANE `exercise_library` table
 * (control.ts's ensureControlTables(), GEL T1) instead of the per-tenant one
 * (schema.ts's `exerciseLibrary` — superseded, left in place/unused per the
 * design doc's "no remap needed" section). Mirrors lib/cms/library.ts's
 * listLibraryAssets/canManageLibraryAsset precedent for cms_library_assets:
 * `tenant_id IS NULL` = GLOBAL (every tenant sees it — bootstrapped from the
 * Inspire tenant's curated ~600); a set `tenant_id` = that tenant's own
 * private custom.
 *
 * `ExerciseLibInput`/`ExerciseLibRow` and every exported function's
 * signature are UNCHANGED from the pre-rewrite version — the 7 workout
 * pages + 3 builders + ExerciseLibraryView consume `listExercises()`'s
 * return value and must not be touched.
 *
 * GEL Task 3 adds the video-backfill helpers at the bottom of this file
 * (`selectExercisesNeedingVideo`, `listAllExercisesForBackfill`): the
 * nightly backfill (lib/automations/scheduler.ts) now runs ONE unscoped
 * pass over the whole control table instead of a per-tenant fan-out.
 */

export interface ExerciseLibInput {
  id?: number;
  name: string;
  category: string | null;
  muscleGroups: string[];
  equipment: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  instructions: string | null;
}

export interface ExerciseLibRow {
  id: number;
  name: string;
  category: string | null;
  muscleGroups: string[];
  equipment: string | null;
  videoUrl: string | null;
  imageUrl: string | null;
  instructions: string | null;
}

/**
 * Thrown by saveExercise()/deleteExercise() when the current tenant tries to
 * touch a row it doesn't own — a GLOBAL row (`tenant_id IS NULL`, read-only
 * to tenants; only the bootstrap migration/a future platform-admin tool can
 * write one) or another tenant's custom. Exported (mirrors tenant.ts's
 * `TenantResolutionError`) so a caller (e.g. the T4 server actions) can
 * `instanceof`-check it and map it to a clean user-facing result instead of
 * letting it 500.
 */
export class ExerciseOwnershipError extends Error {
  readonly exerciseId: number;
  readonly reason: "global" | "other-tenant";
  constructor(exerciseId: number, reason: "global" | "other-tenant") {
    super(
      reason === "global"
        ? `[exerciseLibrary] exercise ${exerciseId} is a GLOBAL exercise — tenants can only edit/delete their own customs (platform-admin editing of globals is out of scope).`
        : `[exerciseLibrary] exercise ${exerciseId} belongs to another tenant.`,
    );
    this.name = "ExerciseOwnershipError";
    this.exerciseId = exerciseId;
    this.reason = reason;
  }
}

/** A control-plane `exercise_library` row, as read straight off SQLite. */
type ControlExerciseRow = {
  id: number;
  tenant_id: number | null;
  name: string;
  category: string | null;
  muscle_groups: string | null;
  equipment: string | null;
  video_url: string | null;
  image_url: string | null;
  instructions: string | null;
};

function parse(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

const toRow = (r: ControlExerciseRow): ExerciseLibRow => ({
  id: r.id,
  name: r.name,
  category: r.category,
  muscleGroups: parse(r.muscle_groups),
  equipment: r.equipment,
  videoUrl: r.video_url,
  imageUrl: r.image_url,
  instructions: r.instructions,
});

/**
 * The merge read shared by listExercises() (ambient current-tenant) and
 * listExercisesForTenant() (explicit tenant) below — every GLOBAL row plus
 * `tenantId`'s own customs. Mirrors lib/cms/library.ts:117-127's
 * listLibraryAssets(tenantId) `WHERE tenant_id = ? OR tenant_id IS NULL`
 * merge exactly.
 */
function mergedExercisesForTenant(tenantId: number): ExerciseLibRow[] {
  return (
    controlSqlite
      .prepare(
        `SELECT * FROM exercise_library
         WHERE tenant_id = ? OR tenant_id IS NULL
         ORDER BY name`,
      )
      .all(tenantId) as ControlExerciseRow[]
  ).map(toRow);
}

/** Shared by setExerciseVideoUrl()/setExerciseVideoUrlForTenant() below — a
 *  plain by-id write, deliberately with no ownership check (see both). */
function updateExerciseVideoUrlById(id: number, url: string): void {
  controlSqlite
    .prepare("UPDATE exercise_library SET video_url = ?, updated_at = ? WHERE id = ?")
    .run(url, Date.now(), id);
}

/**
 * Every exercise visible to the CURRENT tenant: global rows (`tenant_id IS
 * NULL`) plus this tenant's own customs, ordered by name — the single read
 * the 7 pages/3 builders/ExerciseLibraryView all go through.
 */
export function listExercises(): ExerciseLibRow[] {
  return mergedExercisesForTenant(getCurrentTenant().id);
}

/**
 * Create/update a CUSTOM exercise owned by the CURRENT tenant.
 *
 * - No `input.id` → INSERT, always stamped `tenant_id = current tenant`
 *   (tenants can never create a global row here — only the bootstrap
 *   migration/a future platform-admin tool does).
 * - `input.id` set → UPDATE, but ONLY when that row already belongs to the
 *   current tenant. Editing a GLOBAL row (`tenant_id IS NULL`) or another
 *   tenant's row throws ExerciseOwnershipError, leaving the row untouched.
 *   An `input.id` that doesn't exist at all is a silent no-op (the UPDATE
 *   below simply matches zero rows) — matching the pre-rewrite drizzle
 *   `.update().where(eq(id)).run()` behaviour for an unknown id.
 */
export function saveExercise(input: ExerciseLibInput): number {
  const tenantId = getCurrentTenant().id;
  const name = input.name.trim();
  const category = input.category?.trim() || null;
  const muscleGroups = input.muscleGroups.map((s) => s.trim()).filter(Boolean).join(",") || null;
  const equipment = input.equipment?.trim() || null;
  const videoUrl = input.videoUrl?.trim() || null;
  const imageUrl = input.imageUrl?.trim() || null;
  const instructions = input.instructions;

  if (input.id) {
    const existing = controlSqlite
      .prepare("SELECT tenant_id FROM exercise_library WHERE id = ?")
      .get(input.id) as { tenant_id: number | null } | undefined;
    if (existing && existing.tenant_id !== tenantId) {
      throw new ExerciseOwnershipError(input.id, existing.tenant_id === null ? "global" : "other-tenant");
    }
    controlSqlite
      .prepare(
        `UPDATE exercise_library
         SET name = ?, category = ?, muscle_groups = ?, equipment = ?, video_url = ?, image_url = ?, instructions = ?, updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(name, category, muscleGroups, equipment, videoUrl, imageUrl, instructions, Date.now(), input.id, tenantId);
    return input.id;
  }

  const row = controlSqlite
    .prepare(
      `INSERT INTO exercise_library
         (tenant_id, name, category, muscle_groups, equipment, video_url, image_url, instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(tenantId, name, category, muscleGroups, equipment, videoUrl, imageUrl, instructions) as {
    id: number;
  };
  return row.id;
}

/**
 * Delete a CUSTOM exercise owned by the CURRENT tenant. Same ownership guard
 * as saveExercise's UPDATE path: a row that exists but belongs to a GLOBAL
 * (`tenant_id IS NULL`) or another tenant throws ExerciseOwnershipError,
 * leaving it untouched; an unknown id is a silent no-op (mirrors the
 * pre-rewrite drizzle `.delete().where(eq(id)).run()`, which likewise
 * affected zero rows without throwing).
 */
export function deleteExercise(id: number): void {
  const tenantId = getCurrentTenant().id;
  const existing = controlSqlite
    .prepare("SELECT tenant_id FROM exercise_library WHERE id = ?")
    .get(id) as { tenant_id: number | null } | undefined;
  if (existing && existing.tenant_id !== tenantId) {
    throw new ExerciseOwnershipError(id, existing.tenant_id === null ? "global" : "other-tenant");
  }
  controlSqlite.prepare("DELETE FROM exercise_library WHERE id = ? AND tenant_id = ?").run(id, tenantId);
}

/**
 * Set just the video URL for one exercise, by id. Two callers, both walking
 * a list that mixes GLOBAL rows in with tenant-owned ones and neither
 * wanting an ownership check on a narrow, single-field enrichment:
 * - the CURRENT tenant's "auto-find missing videos" bulk action
 *   (bulkFindExerciseVideosAction, app/workout/exercises/actions.ts), over
 *   THIS tenant's own listExercises() result;
 * - the nightly single-pass video backfill (lib/automations/scheduler.ts,
 *   GEL Task 3), over EVERY row in the control table
 *   (listAllExercisesForBackfill() below) — there's no single "current
 *   tenant" in that unscoped pass, so it uses this bare setter rather than
 *   setExerciseVideoUrlForTenant.
 * Deliberately NO ownership guard, like setExerciseVideoUrlForTenant below:
 * filling in a discovered YouTube link is not a content edit/delete of
 * someone else's row, so it's allowed to land on a global row rather than
 * throwing mid-loop the first time either caller reaches one.
 */
export function setExerciseVideoUrl(id: number, url: string): void {
  updateExerciseVideoUrlById(id, url);
}

// ── Video-backfill helpers (GEL Task 3) ────────────────────────────────────────

/**
 * Rows from a list that are still missing a valid YouTube video — the one
 * predicate shared by:
 * - the nightly single-pass backfill (lib/automations/scheduler.ts), over
 *   listAllExercisesForBackfill() below;
 * - the manual "Auto-find missing videos" bulk action
 *   (bulkFindExerciseVideosAction, app/workout/exercises/actions.ts), over
 *   the current tenant's listExercises().
 * Pure (no DB access), so both callers share one tested definition of
 * "missing" instead of duplicating the `!parseYouTubeId(...)` filter, and it
 * can be unit-tested directly against plain ExerciseLibRow[] fixtures.
 */
export function selectExercisesNeedingVideo(rows: ExerciseLibRow[]): ExerciseLibRow[] {
  return rows.filter((e) => !parseYouTubeId(e.videoUrl));
}

/**
 * EVERY control-plane exercise_library row — global rows AND every tenant's
 * customs, with no `tenant_id` scoping at all. Background-job only: the
 * nightly video backfill (lib/automations/scheduler.ts) runs a SINGLE pass
 * over the whole table (GEL Task 3) instead of the old per-tenant fan-out
 * (one listExercisesForTenant() call per active tenant) — now that the
 * library is ONE shared control table (T1/T2), looping per tenant would
 * just re-derive mostly the same "missing" set once per tenant and let
 * quota fairness hinge on tenant iteration order, instead of treating the
 * ~100/day YOUTUBE_API_KEY quota as the single shared resource it actually
 * is. NEVER call this from a tenant-facing code path — unlike
 * listExercises()/listExercisesForTenant(), it returns every OTHER tenant's
 * custom exercises too.
 */
export function listAllExercisesForBackfill(): ExerciseLibRow[] {
  return (
    controlSqlite.prepare(`SELECT * FROM exercise_library ORDER BY name`).all() as ControlExerciseRow[]
  ).map(toRow);
}

// ── Tenant-explicit variants (for background jobs with no request scope) ──────

/**
 * Same merge read as listExercises(), for an EXPLICIT tenantId — for
 * background jobs that run outside any request context and so can't rely on
 * getCurrentTenant()'s cookie/session resolution, but DO want one specific
 * tenant's view (global + that tenant's own customs) rather than the
 * whole-table read listAllExercisesForBackfill() does. Not currently called
 * in production — the nightly video backfill moved to a single unscoped
 * pass in GEL Task 3 (see listAllExercisesForBackfill above) — kept as a
 * general per-tenant primitive and exercised directly by
 * exerciseLibrary.test.ts.
 */
export function listExercisesForTenant(tenantId: number): ExerciseLibRow[] {
  return mergedExercisesForTenant(tenantId);
}

/**
 * Set an exercise's video URL by row id, for an EXPLICIT tenantId — the
 * setExerciseVideoUrl() sibling that pairs with listExercisesForTenant()
 * above. Deliberately NOT tenant-guarded, same as setExerciseVideoUrl():
 * a global row must be writable regardless of which tenant's pass reaches
 * it. `tenantId` is accepted (for call-site symmetry with
 * listExercisesForTenant) but unused for authorization. Not currently
 * called in production — the nightly backfill moved to a single unscoped
 * pass in GEL Task 3, writing via the plain setExerciseVideoUrl() instead
 * (there's no single tenantId to pass in an unscoped run) — kept as a
 * general per-tenant primitive and exercised directly by
 * exerciseLibrary.test.ts.
 */
export function setExerciseVideoUrlForTenant(tenantId: number, id: number, url: string): void {
  void tenantId;
  updateExerciseVideoUrlById(id, url);
}
