import type { Database as BetterSqlite3 } from "better-sqlite3";
import RealDatabase from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/**
 * One-time control-plane bootstrap for the Global Exercise Library (Task 1 —
 * see docs/superpowers/specs/2026-08-24-global-exercise-library-design.md).
 * Imports each tenant's PER-TENANT `exercise_library` rows (schema.ts) into
 * the control-plane `exercise_library` table (control.ts's
 * ensureControlTables): the Inspire tenant's curated exercises (bench press,
 * squat, ... — generic, not Inspire-branded) become GLOBAL rows (tenant_id
 * NULL, visible to every tenant); every other tenant's own rows become that
 * tenant's private customs (tenant_id = them). Wired in as the
 * "0002-exercise-library-bootstrap" CONTROL_MIGRATIONS entry (./index) — kept
 * in its own module (rather than inline in index.ts, unlike the shorter
 * "0002-seed-pipeline-stages" TENANT_MIGRATIONS entry) because it needs its
 * own fs/better-sqlite3 file-opening logic, and so it's independently
 * testable without the versioned-migration-runner machinery in the way. NO
 * `server-only` — loads under the plain-tsx test runner, mirrors ./index.ts
 * itself (kept generic/testable) and lib/pipeline/roles.ts.
 *
 * Deliberately does NOT import ../tenant (openTenantDb/getTenantBySlug):
 * that module opens tenant DBs READ-WRITE, runs ensureTenantTables +
 * TENANT_MIGRATIONS as a side effect, and participates in its process-wide
 * LRU connection cache — none of which belongs in a control-plane migration
 * that must only ever READ a tenant DB. It would also risk a require-cycle
 * (../tenant imports ../control, which imports ./index, which would import
 * this module — see control.ts's own "cycle-safe" note on ./migrate for the
 * same concern). Instead this opens each tenant's SQLite file directly and
 * READ-ONLY, mirroring lib/backup/runBackup.ts's listDatabaseFiles/runBackup
 * — the established precedent for a background/bootstrap task that reads
 * every tenant DB straight off disk, resolving `db_file` via plain SQL
 * against the `tenants` table rather than the app's tenant-registry helpers.
 */

/** Bootstrap constant: the tenant whose curated library seeds the globals. */
export const INSPIRE_TENANT_SLUG = "inspire";

const DATA_DIR = path.join(process.cwd(), "data");

/** A per-tenant `exercise_library` row, as read straight off its SQLite file. */
interface SourceExerciseRow {
  name: string;
  category: string | null;
  muscle_groups: string | null;
  equipment: string | null;
  video_url: string | null;
  image_url: string | null;
  instructions: string | null;
}

/** Insert values for the control-plane `exercise_library` table. */
export interface ControlExerciseValues {
  tenant_id: number | null;
  name: string;
  category: string | null;
  muscle_groups: string | null;
  equipment: string | null;
  video_url: string | null;
  image_url: string | null;
  instructions: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Pure row mapper: a source (per-tenant) exercise row -> control-plane insert
 * values for `targetTenantId` (null = global). No DB/fs access — trivially
 * unit-testable. Timestamps are FRESH (import time), matching the design
 * doc's "+ fresh timestamps": the source row's original created_at/
 * updated_at are intentionally NOT carried over.
 */
export function mapExerciseForImport(
  row: SourceExerciseRow,
  targetTenantId: number | null,
  importedAtMs: number,
): ControlExerciseValues {
  return {
    tenant_id: targetTenantId,
    name: row.name,
    category: row.category,
    muscle_groups: row.muscle_groups,
    equipment: row.equipment,
    video_url: row.video_url,
    image_url: row.image_url,
    instructions: row.instructions,
    created_at: importedAtMs,
    updated_at: importedAtMs,
  };
}

/**
 * Every row of a tenant's per-tenant `exercise_library`, read by opening its
 * SQLite file directly, READ-ONLY (mirrors runBackup.ts's
 * `new Database(srcPath, { readonly: true })`). Never throws: a missing
 * `db_file`, a DB that predates the exercise_library table, or any other
 * read error all resolve to `[]` — callers treat "nothing to import"
 * identically to "tenant absent", exactly the robustness the bootstrap needs
 * (a fresh dev/CI tenant with 0 rows, or a prod tenant mid-provisioning).
 */
function readTenantExercises(dbFile: string): SourceExerciseRow[] {
  const fullPath = path.isAbsolute(dbFile) ? dbFile : path.join(DATA_DIR, dbFile);
  if (!fs.existsSync(fullPath)) return [];
  let sqlite: BetterSqlite3 | undefined;
  try {
    sqlite = new RealDatabase(fullPath, { readonly: true });
    return sqlite
      .prepare(
        "SELECT name, category, muscle_groups, equipment, video_url, image_url, instructions FROM exercise_library",
      )
      .all() as SourceExerciseRow[];
  } catch (err) {
    console.error(
      `[db] exercise-library bootstrap: could not read exercise_library from ${dbFile}:`,
      err,
    );
    return [];
  } finally {
    try {
      sqlite?.close();
    } catch {
      // best effort — a close failure on a read-only handle changes nothing
    }
  }
}

/**
 * One-time bootstrap: import Inspire's curated exercises as GLOBAL control
 * rows (tenant_id NULL), plus every other ACTIVE tenant's own rows as their
 * private customs (tenant_id = them), into the control-plane
 * `exercise_library` table. `sqlite` is the CONTROL connection (raw
 * better-sqlite3 handle, as passed to a Migration's `up`).
 *
 * Idempotency: called from "0002-exercise-library-bootstrap"
 * (CONTROL_MIGRATIONS, ./index), which already guarantees this runs at most
 * ONCE per control.db via schema_migrations. The row-count guard below is a
 * SECOND, independent guard (mirrors TENANT_MIGRATIONS'
 * "0002-seed-pipeline-stages" count===0 check) so calling this function
 * directly a second time — not just a second migration-runner pass — is
 * ALSO a safe no-op. See exerciseLibraryBootstrap.test.ts's idempotency
 * block for the double-call proof.
 *
 * Robust by construction: an absent Inspire tenant, an absent/unreadable
 * tenant DB file, or a tenant DB that predates exercise_library all resolve
 * to "nothing to import" for that tenant (readTenantExercises never throws)
 * — this function itself never throws either.
 */
export function runExerciseLibraryBootstrap(sqlite: BetterSqlite3): void {
  const already = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM exercise_library").get() as { c: number }
  ).c;
  if (already > 0) return;

  const insert = sqlite.prepare(
    `INSERT INTO exercise_library
       (tenant_id, name, category, muscle_groups, equipment, video_url, image_url, instructions, created_at, updated_at)
     VALUES (@tenant_id, @name, @category, @muscle_groups, @equipment, @video_url, @image_url, @instructions, @created_at, @updated_at)`,
  );
  const now = Date.now();

  const importInto = (dbFile: string, targetTenantId: number | null): number => {
    const rows = readTenantExercises(dbFile);
    for (const row of rows) insert.run(mapExerciseForImport(row, targetTenantId, now));
    return rows.length;
  };

  // Inspire's curated library -> global (tenant_id NULL). Resolved by slug
  // regardless of its own is_active flag: the design doc's Bootstrap section
  // says "if it exists" with no active-only caveat, and the exercises
  // themselves are generic (bench press, squat), not Inspire-branded.
  const inspire = sqlite
    .prepare("SELECT id, db_file FROM tenants WHERE slug = ?")
    .get(INSPIRE_TENANT_SLUG) as { id: number; db_file: string } | undefined;
  const globalCount = inspire ? importInto(inspire.db_file, null) : 0;

  // Every OTHER active tenant's own rows -> their own customs. (Recon: a
  // no-op today — only Inspire has rows — but implemented for correctness.)
  const others = sqlite
    .prepare("SELECT id, db_file FROM tenants WHERE is_active = 1 AND slug != ? ORDER BY id")
    .all(INSPIRE_TENANT_SLUG) as Array<{ id: number; db_file: string }>;
  let customCount = 0;
  for (const t of others) customCount += importInto(t.db_file, t.id);

  if (globalCount > 0 || customCount > 0) {
    console.log(
      `[db] exercise-library bootstrap: imported ${globalCount} global row(s) from '${INSPIRE_TENANT_SLUG}' + ${customCount} custom row(s) across ${others.length} other tenant(s)`,
    );
  }
}
