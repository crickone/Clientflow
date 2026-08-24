import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getCurrentTenant } from "@/lib/db/tenant";

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
 * Set just the video URL for one exercise, by id — used by the CURRENT
 * tenant's "auto-find missing videos" bulk action
 * (bulkFindExerciseVideosAction, app/workout/exercises/actions.ts), which
 * walks THIS tenant's own listExercises() result. That result now includes
 * GLOBAL rows, so — deliberately, like setExerciseVideoUrlForTenant below —
 * this has NO ownership guard: filling in a discovered YouTube link is a
 * narrow, single-field enrichment (not a content edit/delete of someone
 * else's row), so it's allowed to land on a global row rather than throwing
 * mid-loop the first time the bulk action reaches one.
 */
export function setExerciseVideoUrl(id: number, url: string): void {
  updateExerciseVideoUrlById(id, url);
}

// ── Tenant-explicit variants (for background jobs with no request scope) ──────

/**
 * Same merge read as listExercises(), for an EXPLICIT tenantId — used by
 * background jobs (the daily video backfill, lib/automations/scheduler.ts)
 * that run outside any request context and so can't rely on
 * getCurrentTenant()'s cookie/session resolution.
 */
export function listExercisesForTenant(tenantId: number): ExerciseLibRow[] {
  return mergedExercisesForTenant(tenantId);
}

/**
 * Set an exercise's video URL by row id, for the shared nightly backfill
 * (lib/automations/scheduler.ts's backfillVideosForTenant). Deliberately NOT
 * tenant-guarded — unlike saveExercise/deleteExercise's ownership check,
 * this legitimately writes to GLOBAL rows too: the backfill walks every
 * tenant's listExercisesForTenant() (globals included) looking for missing
 * videos, and a global row must actually get filled the first time ANY
 * tenant's pass reaches it — that's the whole point of backfilling the
 * shared library once instead of per tenant. `tenantId` is accepted (for
 * call-site symmetry with listExercisesForTenant) but unused for
 * authorization.
 */
export function setExerciseVideoUrlForTenant(tenantId: number, id: number, url: string): void {
  void tenantId;
  updateExerciseVideoUrlById(id, url);
}
