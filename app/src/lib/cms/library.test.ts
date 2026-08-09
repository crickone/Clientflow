// Run: npm test -- src/lib/cms/library.test.ts
//
// Batch 2c (tenant-scope the CMS media library, improvement-plan-2026-08.md
// Theme B2): cms_library_assets had no tenant_id, so listLibraryAssets()
// returned EVERY tenant's uploads to any admin. Verifies:
//   1. the upload/create path (addLibraryAsset) stamps the uploading tenant's
//      id onto the row, and it survives a re-read;
//   2. listLibraryAssets(tenantId) returns that tenant's own rows plus any
//      legacy row (tenant_id IS NULL — pre-migration, no recoverable owner),
//      but NOT another tenant's rows.
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  addLibraryAsset,
  deleteLibraryAsset,
  getLibraryAsset,
  listLibraryAssets,
} from "./library";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  // ── two scratch tenants (control rows only — no real tenant DB needed) ──
  const slugA = "medialib-test-a";
  const slugB = "medialib-test-b";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slugA, slugB);
  const insertTenant = controlSqlite.prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
  );
  const tenantA = (
    insertTenant.get(slugA, "Medialib Test A", `tenants/${slugA}/void.db`) as {
      id: number;
    }
  ).id;
  const tenantB = (
    insertTenant.get(slugB, "Medialib Test B", `tenants/${slugB}/void.db`) as {
      id: number;
    }
  ).id;

  const uploadedIds: number[] = []; // created via addLibraryAsset -> also wrote a storage object
  const rawIds: number[] = []; // inserted directly via SQL -> no storage object to clean up

  const cleanup = async () => {
    // Awaited (not fire-and-forget): cms_library_assets.tenant_id is a real FK
    // to tenants(id) and foreign_keys=ON, so every asset row referencing
    // tenantA/tenantB must actually be gone before the DELETE FROM tenants
    // below runs, or it fails with SQLITE_CONSTRAINT_FOREIGNKEY.
    for (const id of uploadedIds) {
      try {
        await deleteLibraryAsset(id); // removes the storage object + the row
      } catch {
        // best effort
      }
    }
    for (const id of rawIds) {
      controlSqlite.prepare("DELETE FROM cms_library_assets WHERE id = ?").run(id);
    }
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tenantA, tenantB);
  };

  try {
    // ── 1. the upload/create path persists tenant_id ──
    const uploaded = await addLibraryAsset({
      originalName: "a.png",
      mimeType: "image/png",
      bytes: Buffer.from("fake-png-bytes"),
      tenantId: tenantA,
    });
    uploadedIds.push(uploaded.id);
    assert.equal(
      uploaded.tenantId,
      tenantA,
      "addLibraryAsset stamps the uploading tenant's id on the returned row",
    );
    const reread = getLibraryAsset(uploaded.id);
    assert.equal(
      reread?.tenantId,
      tenantA,
      "tenant_id persists to a fresh SELECT, not just the insert's return value",
    );

    // An upload with no tenantId (defensive/legacy caller) stays NULL rather
    // than throwing — matches the column being nullable-by-design.
    const noTenant = await addLibraryAsset({
      originalName: "no-tenant.png",
      mimeType: "image/png",
      bytes: Buffer.from("fake-png-bytes-2"),
    });
    uploadedIds.push(noTenant.id);
    assert.equal(noTenant.tenantId, null, "omitting tenantId leaves the column NULL");

    // ── 2. a legacy row predating this migration (tenant_id NULL) ──
    const legacy = controlSqlite
      .prepare(
        `INSERT INTO cms_library_assets (storage_key, original_name, mime_type, size_bytes)
         VALUES ('legacy-test.png', 'legacy.png', 'image/png', 1) RETURNING id`,
      )
      .get() as { id: number };
    rawIds.push(legacy.id);

    // ── 3. a row explicitly owned by tenant B ──
    const bOwned = controlSqlite
      .prepare(
        `INSERT INTO cms_library_assets (storage_key, original_name, mime_type, size_bytes, tenant_id)
         VALUES ('b-owned-test.png', 'b-owned.png', 'image/png', 1, ?) RETURNING id`,
      )
      .get(tenantB) as { id: number };
    rawIds.push(bOwned.id);

    // ── listLibraryAssets(A): its own upload(s) + the legacy row, NOT B's ──
    const listA = listLibraryAssets(tenantA).map((a) => a.id);
    assert.ok(listA.includes(uploaded.id), "tenant A sees its own upload");
    assert.ok(listA.includes(legacy.id), "tenant A sees the legacy (tenant_id NULL) row");
    assert.ok(!listA.includes(bOwned.id), "tenant A does NOT see tenant B's asset");
    assert.ok(listA.includes(noTenant.id), "a NULL-tenant row (omitted tenantId) is visible to A via the legacy/shared rule");

    // ── listLibraryAssets(B): its own asset + the legacy rows, NOT A's ──
    const listB = listLibraryAssets(tenantB).map((a) => a.id);
    assert.ok(listB.includes(bOwned.id), "tenant B sees its own asset");
    assert.ok(listB.includes(legacy.id), "tenant B ALSO sees the legacy (tenant_id NULL) row");
    assert.ok(listB.includes(noTenant.id), "tenant B ALSO sees the NULL-tenant upload");
    assert.ok(!listB.includes(uploaded.id), "tenant B does NOT see tenant A's upload");

    console.log("cms/library.test.ts: all assertions passed");
  } finally {
    await cleanup();
  }
})();
