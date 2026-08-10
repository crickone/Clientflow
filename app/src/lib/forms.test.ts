// Run: npm test -- src/lib/forms.test.ts
//
// Batch 4c (forms public render + submissions, improvement-plan-2026-08.md
// Theme D5): saveForm's contact-form share-slug now double-writes a
// control-plane form_share_links row (slug -> tenant+form) so the public
// /f/<slug> resolver (lib/publicForms.ts) can find the right tenant WITHOUT a
// session — share_slug is only unique within a tenant's own forms table, not
// globally. This verifies:
//   1. saving a NEW contact form creates exactly one control-plane mapping
//      row, pointing at (this tenant, this form).
//   2. re-saving the SAME form (slug unchanged) upserts rather than
//      duplicating the mapping row.
//   3. resolveFormBySlug (the public reader) finds the tenant+form through
//      that mapping — proving the admin-write and public-read halves
//      actually connect.
//   4. deleteForm removes the mapping row (no orphaned control-plane rows).
//   5. a non-contact form (e.g. "initial") never gets a share_slug or a
//      mapping row at all.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// ./forms -> @/lib/db (the ambient db proxy) -> @/lib/db/tenant (react cache)
// and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same two-part shim
// as src/lib/cms/blog.test.ts, for the same reason (see that file's comment).
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in forms.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { runWithTenant } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const { saveForm, deleteForm } = requireLocal("./forms") as typeof import("./forms");
  const { resolveFormBySlug } = requireLocal("./publicForms") as typeof import("./publicForms");
  const { blankForm } = requireLocal("./formsModel") as typeof import("./formsModel");

  // ── scratch tenant (control row + a real tenant db file) ──
  const slug = "forms-sharelink-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Forms Sharelink Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM form_share_links WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const countLinks = () =>
    (
      controlSqlite.prepare("SELECT COUNT(*) AS c FROM form_share_links WHERE tenant_id = ?").get(tid) as {
        c: number;
      }
    ).c;

  try {
    // ── 1 + 2. saveForm creates, then upserts (not duplicates), the mapping ──
    const input = { ...blankForm("contact"), title: "Enquiry form" };
    const formId = runWithTenant(tid, () => saveForm(input));
    assert.equal(countLinks(), 1, "saving a new contact form writes exactly one mapping row");

    const linkRow = controlSqlite
      .prepare(
        "SELECT share_slug as shareSlug, tenant_id as tenantId, form_id as formId FROM form_share_links WHERE tenant_id = ?",
      )
      .get(tid) as { shareSlug: string; tenantId: number; formId: number };
    assert.equal(linkRow.tenantId, tid);
    assert.equal(linkRow.formId, formId);
    assert.ok(linkRow.shareSlug.length > 0);

    // Re-save the same form (title change only). saveForm reuses the
    // existing share_slug, so this must UPSERT, not add a second row.
    runWithTenant(tid, () => saveForm({ ...input, id: formId, title: "Enquiry form (updated)" }));
    assert.equal(countLinks(), 1, "re-saving the same form does not duplicate the mapping row");
    const linkAfterResave = controlSqlite
      .prepare("SELECT share_slug as shareSlug FROM form_share_links WHERE tenant_id = ?")
      .get(tid) as { shareSlug: string };
    assert.equal(linkAfterResave.shareSlug, linkRow.shareSlug, "the slug itself doesn't change on a plain re-save");

    // ── 3. resolveFormBySlug finds it through the mapping saveForm wrote ──
    const resolved = resolveFormBySlug(linkRow.shareSlug);
    assert.ok(resolved, "the public resolver finds the form saveForm just registered");
    assert.equal(resolved!.tenantId, tid);
    assert.equal(resolved!.form.title, "Enquiry form (updated)");

    // ── 5. a non-contact form never gets a share_slug / mapping row ──
    runWithTenant(tid, () => saveForm(blankForm("initial")));
    assert.equal(countLinks(), 1, "saving a non-contact form adds no mapping row");

    // ── 4. deleteForm removes the mapping row ──
    runWithTenant(tid, () => deleteForm(formId));
    assert.equal(countLinks(), 0, "deleting the contact form removes its control-plane mapping row too");
    assert.equal(resolveFormBySlug(linkRow.shareSlug), null, "the slug no longer resolves once the form is deleted");

    console.log("forms.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
