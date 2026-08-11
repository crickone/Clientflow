// Run: npm test -- src/lib/marketing/campaigns.test.ts
//
// Email marketing (Task 4 — campaign model + builder + AI draft). Verifies
// the pieces the brief calls out directly:
//   1. resolveAudience — 'all_subscribed' only ever returns status='subscribed'
//      contacts (unsubscribed/bounced excluded), and 'tag' additionally
//      requires the tag to appear in the contact's JSON tags array (while
//      STILL excluding a non-subscribed contact that happens to have it).
//   2. createCampaign / getCampaign / listCampaigns round-trip a campaign,
//      including the audience JSON encode/decode and sensible defaults.
//   3. updateCampaign's draft-only guard: succeeds while status='draft',
//      throws CampaignNotDraftError (leaving the row untouched) once the
//      campaign has moved past draft.
//   4. A light DDL smoke test for campaign_sends (this task's other new
//      table, otherwise untouched by the above): insert + select round-trip
//      through the Drizzle definition, plus both its indexes exist.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// ./campaigns -> @/lib/db (the ambient `db` proxy) -> @/lib/db/tenant (react
// `cache`) and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same
// two-part shim as src/lib/forms.test.ts / src/lib/cms/blog.test.ts, for the
// same reason (see either file's comment). Installed via a dynamic require
// (below) rather than a static import, since a static `import ... from
// "./campaigns"` would be hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in campaigns.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById, openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { db, schema } = requireLocal("../db") as typeof import("../db");
  const {
    createCampaign,
    getCampaign,
    listCampaigns,
    updateCampaign,
    resolveAudience,
    CampaignNotDraftError,
  } = requireLocal("./campaigns") as typeof import("./campaigns");

  const { contacts, emailCampaigns, campaignSends } = schema;

  // ── scratch tenant (control row + a real tenant db file) ──
  const slug = "campaigns-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Campaigns Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // ── 1. resolveAudience: all_subscribed excludes non-subscribed ──
    runWithTenant(tid, () => {
      db.insert(contacts)
        .values({ email: "alice@example.com", status: "subscribed", tags: JSON.stringify(["vip"]) })
        .run();
      db.insert(contacts)
        .values({ email: "bob@example.com", status: "subscribed", tags: JSON.stringify(["lead"]) })
        .run();
      db.insert(contacts)
        .values({ email: "carol@example.com", status: "unsubscribed", tags: JSON.stringify(["vip"]) })
        .run();
      db.insert(contacts).values({ email: "dave@example.com", status: "bounced" }).run();
    });

    const allSubscribed = runWithTenant(tid, () => resolveAudience({ audience: { kind: "all_subscribed" } }));
    assert.equal(allSubscribed.emails.length, 2, "only the 2 subscribed contacts are included");
    assert.deepEqual(
      [...allSubscribed.emails].sort(),
      ["alice@example.com", "bob@example.com"],
      "unsubscribed/bounced contacts are excluded from 'all subscribed'",
    );

    // ── 1b. resolveAudience: tag filter requires BOTH subscribed status AND the tag ──
    const vipOnly = runWithTenant(tid, () => resolveAudience({ audience: { kind: "tag", tag: "vip" } }));
    assert.deepEqual(
      vipOnly.emails,
      ["alice@example.com"],
      "tag filter matches JSON tags, but still excludes the unsubscribed vip contact (carol)",
    );

    const noMatch = runWithTenant(tid, () => resolveAudience({ audience: { kind: "tag", tag: "nonexistent" } }));
    assert.equal(noMatch.emails.length, 0, "a tag nobody has resolves to zero recipients");

    // ── 2. createCampaign / getCampaign / listCampaigns round-trip ──
    const created = runWithTenant(tid, () =>
      createCampaign({
        name: "August newsletter",
        subject: "What's new this month",
        fromName: "Test Business",
        fromEmail: "Hello@TestBusiness.example",
        createdBy: 42,
      }),
    );
    assert.equal(created.status, "draft");
    assert.equal(created.cursor, 0);
    assert.equal(created.stats, null);
    assert.equal(created.bodyHtml, "", "body defaults to empty when not given");
    assert.deepEqual(created.audience, { kind: "all_subscribed" }, "audience defaults to all_subscribed when not given");
    assert.equal(created.fromEmail, "hello@testbusiness.example", "from email is normalized to lowercase");
    assert.equal(created.createdBy, 42);
    assert.ok(created.createdAt > 0);

    const fetched = runWithTenant(tid, () => getCampaign(created.id));
    assert.deepEqual(fetched, created, "getCampaign returns the same record createCampaign returned");

    const listed = runWithTenant(tid, () => listCampaigns());
    assert.ok(
      listed.some((c) => c.id === created.id),
      "listCampaigns includes the new campaign",
    );

    // ── 3. updateCampaign: succeeds while draft, including the audience round-trip ──
    const updated = runWithTenant(tid, () =>
      updateCampaign(created.id, {
        subject: "What's new this month (updated)",
        bodyHtml: "Hi there,\n\nHere's what's new.",
        audience: { kind: "tag", tag: "vip" },
      }),
    );
    assert.equal(updated.subject, "What's new this month (updated)");
    assert.equal(updated.bodyHtml, "Hi there,\n\nHere's what's new.");
    assert.deepEqual(updated.audience, { kind: "tag", tag: "vip" }, "audience JSON round-trips through update");
    assert.equal(updated.name, "August newsletter", "fields left out of the patch are left alone");

    // ── 3b. draft-only guard: refuse once status has left 'draft' ──
    // No exported "mark as sending" in this task (that's the later send
    // pipeline's job) — reach in directly to flip the row, the same way a
    // real send eventually will, to exercise the guard.
    getTenantDbById(tid)
      .update(emailCampaigns)
      .set({ status: "sending" })
      .where(eq(emailCampaigns.id, created.id))
      .run();

    assert.throws(
      () => runWithTenant(tid, () => updateCampaign(created.id, { subject: "Should not apply" })),
      CampaignNotDraftError,
      "updating a non-draft campaign throws CampaignNotDraftError",
    );
    // ...and nothing was actually changed by the refused update.
    const afterRefusedUpdate = runWithTenant(tid, () => getCampaign(created.id));
    assert.equal(
      afterRefusedUpdate!.subject,
      "What's new this month (updated)",
      "the refused update left the row untouched",
    );

    // ── 4. campaign_sends DDL smoke test (this task's other new table) ──
    const sendRow = getTenantDbById(tid)
      .insert(campaignSends)
      .values({ campaignId: created.id, email: "alice@example.com", providerMessageId: "msg-123" })
      .returning()
      .get();
    assert.equal(sendRow.status, "queued", "campaign_sends.status defaults to 'queued'");
    assert.equal(sendRow.campaignId, created.id);

    const { sqlite } = openTenantDb(dbFile);
    const indexNames = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='campaign_sends'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    assert.ok(indexNames.includes("idx_campaign_sends_campaign"), "idx_campaign_sends_campaign exists");
    assert.ok(indexNames.includes("idx_campaign_sends_msgid"), "idx_campaign_sends_msgid exists");

    console.log("campaigns.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
