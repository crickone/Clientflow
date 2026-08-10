// Run: npm test -- src/lib/publicForms.test.ts
//
// Batch 4c (forms public render + submissions, improvement-plan-2026-08.md
// Theme D5): the share link `/f/<slug>` had no public route and no
// submissions table. This verifies the public-resolution + storage core:
//   1. resolveFormBySlug finds the right tenant + form definition for a valid
//      slug, and returns null for: an unknown slug, an empty slug, a form
//      switched off (status=false), and a deactivated tenant. A second
//      tenant's own slug still resolves to ITS OWN tenant (no cross-talk).
//   2. buildAnswers/validateRequired (pure, no DB) — required-field
//      rejection, and that a required photo/video field never blocks
//      submission (no upload path in this v1 — deferred by design).
//   3. insertFormSubmission persists a row in the RIGHT tenant's own db, with
//      the answers payload + a sniffed submitter name/email.
//
// NOTE: this deliberately seeds the control-plane form_share_links row
// directly via SQL rather than through saveForm() — that admin-side wiring
// (saveForm/deleteForm keeping the mapping in sync) is covered separately by
// src/lib/forms.test.ts, so this file can stay focused on the public-read
// side with a lighter import graph (see the shim comment below).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// ./publicForms -> @/lib/db/tenant -> react (cache). Under the runner's
// --conditions=react-server, npm's react "react-server" entry throws on
// load, so `cache` needs stubbing — same reasoning as src/lib/cms/blog.test.ts.
// This file's import graph is narrower than that one (it never touches
// @/lib/tenants / @/lib/auth / next/navigation), so only the `react` half of
// that shim is needed here.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("./db/control");
  const { getTenantDbById } = requireLocal("./db/tenant") as typeof import("./db/tenant");
  const { forms, formQuestions, formSubmissions } = requireLocal("./db/schema") as typeof import("./db/schema");
  const { resolveFormBySlug, buildAnswers, validateRequired, insertFormSubmission, extractSubmitter } =
    requireLocal("./publicForms") as typeof import("./publicForms");

  // ── two scratch tenants (control rows + real tenant db files) ──
  const slugA = "publicforms-test-a";
  const slugB = "publicforms-test-b";
  const dbFileA = `tenants/${slugA}/${slugA}.db`;
  const dbFileB = `tenants/${slugB}/${slugB}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slugA, slugB);
  const insertTenant = controlSqlite.prepare(
    "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
  );
  const tenantA = (insertTenant.get(slugA, "Public Forms Test A", dbFileA) as { id: number }).id;
  const tenantB = (insertTenant.get(slugB, "Public Forms Test B", dbFileB) as { id: number }).id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM form_share_links WHERE tenant_id IN (?, ?)").run(tenantA, tenantB);
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tenantA, tenantB);
    for (const slug of [slugA, slugB]) {
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  try {
    const tdbA = getTenantDbById(tenantA);
    const tdbB = getTenantDbById(tenantB);

    // A live contact form on tenant A: a required "Full name", an optional
    // "Email", and a required "Goal physique" PHOTO field (unsupported/
    // deferred in this v1 — must never block submission).
    const formA = tdbA
      .insert(forms)
      .values({ type: "contact", title: "Book a call", status: true, shareSlug: "book-a-call-abc" })
      .returning()
      .get();
    const qName = tdbA
      .insert(formQuestions)
      .values({ formId: formA.id, section: "main", label: "Full name", fieldType: "short", required: true, position: 0 })
      .returning()
      .get();
    const qEmail = tdbA
      .insert(formQuestions)
      .values({ formId: formA.id, section: "main", label: "Email", fieldType: "short", required: false, position: 1 })
      .returning()
      .get();
    tdbA
      .insert(formQuestions)
      .values({ formId: formA.id, section: "main", label: "Goal physique", fieldType: "photo", required: true, position: 2 })
      .run();

    // A switched-off contact form on tenant A ("Form is live and accepting
    // submissions" toggled off in the admin).
    const formOff = tdbA
      .insert(forms)
      .values({ type: "contact", title: "Old form", status: false, shareSlug: "old-form-xyz" })
      .returning()
      .get();

    // A form on tenant B, to prove cross-tenant isolation.
    const formB = tdbB
      .insert(forms)
      .values({ type: "contact", title: "Tenant B form", status: true, shareSlug: "tenant-b-form" })
      .returning()
      .get();

    // The control-plane mapping rows saveForm()/deleteForm() would maintain —
    // inserted directly to isolate resolveFormBySlug's behaviour (see the
    // file banner comment above).
    const insertLink = controlSqlite.prepare(
      "INSERT INTO form_share_links (share_slug, tenant_id, form_id) VALUES (?, ?, ?)",
    );
    insertLink.run("book-a-call-abc", tenantA, formA.id);
    insertLink.run("old-form-xyz", tenantA, formOff.id);
    insertLink.run("tenant-b-form", tenantB, formB.id);

    // ── 1. resolveFormBySlug ──
    const resolvedA = resolveFormBySlug("book-a-call-abc");
    assert.ok(resolvedA, "a valid slug resolves");
    assert.equal(resolvedA!.tenantId, tenantA, "resolves to the RIGHT tenant");
    assert.equal(resolvedA!.tenantName, "Public Forms Test A");
    assert.equal(resolvedA!.form.id, formA.id);
    assert.equal(resolvedA!.form.questions.length, 3, "returns every question, in position order");
    assert.deepEqual(
      resolvedA!.form.questions.map((q) => q.label),
      ["Full name", "Email", "Goal physique"],
    );

    assert.equal(resolveFormBySlug("no-such-slug"), null, "an unknown slug resolves to null");
    assert.equal(resolveFormBySlug(""), null, "an empty slug resolves to null");
    assert.equal(resolveFormBySlug("   "), null, "a whitespace-only slug resolves to null");
    assert.equal(resolveFormBySlug("old-form-xyz"), null, "a form switched off (status=false) resolves to null");

    const resolvedB = resolveFormBySlug("tenant-b-form");
    assert.equal(resolvedB?.tenantId, tenantB, "a second tenant's own slug resolves to ITS OWN tenant, not the first");

    // A deactivated tenant's slug stops resolving too, even though the
    // mapping row + form are both still there untouched.
    controlSqlite.prepare("UPDATE tenants SET is_active = 0 WHERE id = ?").run(tenantB);
    assert.equal(resolveFormBySlug("tenant-b-form"), null, "a deactivated tenant's slug resolves to null");
    controlSqlite.prepare("UPDATE tenants SET is_active = 1 WHERE id = ?").run(tenantB); // restore for cleanup's FK deletes

    // ── 2. buildAnswers / validateRequired (pure) ──
    const raw = { [`q_${qName.id}`]: "  Jane Doe  ", [`q_${qEmail.id}`]: "" };
    const answers = buildAnswers(resolvedA!.form, raw);
    assert.equal(answers.length, 3);
    assert.equal(answers.find((a) => a.questionId === qName.id)?.value, "Jane Doe", "values are trimmed");

    // Missing the required "Full name" -> rejected, naming the field.
    const missingName = buildAnswers(resolvedA!.form, { [`q_${qEmail.id}`]: "jane@x.com" });
    assert.match(validateRequired(resolvedA!.form, missingName) ?? "", /Full name/);

    // The required PHOTO question is never enforced — no upload path exists
    // in this v1, so it can never legitimately be satisfied.
    const noPhoto = buildAnswers(resolvedA!.form, { [`q_${qName.id}`]: "Jane Doe" });
    assert.equal(
      validateRequired(resolvedA!.form, noPhoto),
      null,
      "a required photo/video field never blocks submission",
    );

    // A fully answered submission passes.
    const complete = buildAnswers(resolvedA!.form, { [`q_${qName.id}`]: "Jane Doe", [`q_${qEmail.id}`]: "jane@x.com" });
    assert.equal(validateRequired(resolvedA!.form, complete), null);

    // ── extractSubmitter: sniffs name/email from question labels ──
    assert.deepEqual(extractSubmitter(complete), { name: "Jane Doe", email: "jane@x.com" });

    // ── 3. insertFormSubmission persists under the RIGHT tenant ──
    const subId = insertFormSubmission(tenantA, formA.id, complete);
    const row = tdbA.select().from(formSubmissions).where(eq(formSubmissions.id, subId)).get();
    assert.ok(row, "the submission was written to tenant A's own db");
    assert.equal(row!.formId, formA.id);
    assert.equal(row!.tenantId, tenantA, "the row is stamped with the server-resolved tenant");
    assert.equal(row!.submitterName, "Jane Doe");
    assert.equal(row!.submitterEmail, "jane@x.com");
    const payload = JSON.parse(row!.payload) as { answers: unknown[] };
    assert.equal(payload.answers.length, 3);

    // Tenant B's db has nothing — the write never leaked across tenants.
    assert.equal(tdbB.select().from(formSubmissions).all().length, 0, "tenant B's db is untouched by tenant A's submission");

    console.log("publicForms.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
