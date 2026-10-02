// Run: npm test -- src/lib/dashboard/data/emailQueries.test.ts
//
// Smoke test: every emailQueries loader once against a scratch tenant with a
// little seeded data, plus the control-plane readers the widgets call.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./emailQueries") as typeof import("./emailQueries");
  const credits = requireLocal("../../email/credits") as typeof import("../../email/credits");
  const included = requireLocal("../../email/included") as typeof import("../../email/included");

  const slug = "dashboard-email-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Email Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const from = now - 7 * DAY;
  const to = now + DAY;

  try {
    await runWithTenant(t.id, async () => {
      db.insert(schema.contacts).values([
        { email: "a@example.com", status: "subscribed", source: "import", subscribedAt: new Date(now - DAY) },
        { email: "b@example.com", status: "subscribed", source: null, createdAt: new Date(now - 2 * DAY) },
        { email: "c@example.com", status: "unsubscribed", source: "import", subscribedAt: new Date(now - 3 * DAY), unsubscribedAt: new Date(now - DAY) },
        { email: "d@example.com", status: "bounced", source: "form" },
        { email: "e@example.com", status: "subscribed", subscribedAt: new Date(now - 60 * DAY) },
      ]).run();
      db.insert(schema.suppressions).values([
        { email: "c@example.com", reason: "unsubscribe" },
        { email: "d@example.com", reason: "bounce" },
      ]).run();
      const camp = db.insert(schema.emailCampaigns).values({
        name: "Autumn news", subject: "s", fromName: "f", fromEmail: "f@example.com", bodyHtml: "<p>x</p>",
        audience: '{"kind":"all_subscribed"}', status: "sent", sentAt: new Date(now - 2 * DAY),
        stats: JSON.stringify({ counts: { delivered: 5, opened: 3, clicked: 1, bounced: 1 } }),
      }).returning().get();
      db.insert(schema.emailCampaigns).values({
        name: "Old", subject: "s", fromName: "f", fromEmail: "f@example.com", bodyHtml: "<p>x</p>",
        audience: '{"kind":"all_subscribed"}', status: "sent", sentAt: new Date(now - 90 * DAY),
      }).run();
      db.insert(schema.emailEvents).values([
        { campaignId: camp.id, sendId: 1, event: "opened", at: new Date(now - DAY) },
        { campaignId: camp.id, sendId: 1, event: "opened", at: new Date(now - DAY + 1000) },
        { campaignId: camp.id, sendId: 2, event: "opened", at: new Date(now - DAY + 2000) },
        { campaignId: camp.id, sendId: 1, event: "clicked", url: "https://example.com/book?utm=a", at: new Date(now - DAY) },
        { campaignId: camp.id, sendId: 2, event: "clicked", url: "https://example.com/book?utm=b", at: new Date(now - DAY) },
        { campaignId: camp.id, sendId: 2, event: "clicked", url: "https://example.com/other", at: new Date(now - DAY) },
      ]).run();

      assert.equal(q.subscribedNow(), 3);
      // a (subscribedAt), b (createdAt fallback), c in range; e is 60 days ago; d bounced excluded
      assert.deepEqual(q.listChange(from, to), { adds: 3, unsubs: 1 });
      const lg = q.listGrowthSeries(from, to);
      assert.equal(lg.reduce((s, r) => s + r.Adds, 0), 3);
      assert.equal(lg.reduce((s, r) => s + r.Unsubscribes, 0), 1);
      assert.deepEqual(q.statusCounts().sort((a, b) => a.label.localeCompare(b.label)), [
        { label: "bounced", value: 1 }, { label: "subscribed", value: 3 }, { label: "unsubscribed", value: 1 },
      ]);

      const sent = q.campaignsSentIn(from, to);
      assert.deepEqual(sent.map((c) => c.name), ["Autumn news"]);
      assert.equal(sent[0].counts.delivered, 5);

      const es = q.engagementSeries(from, to);
      assert.equal(es.reduce((s, r) => s + r.Opens, 0), 3);
      assert.equal(es.reduce((s, r) => s + r["Unique opens"], 0), 2);
      assert.equal(es.reduce((s, r) => s + r.Clicks, 0), 3);
      assert.equal(es.reduce((s, r) => s + r["Unique clicks"], 0), 2);

      assert.deepEqual(q.topLinks(from, to, 8), [
        { url: "https://example.com/book", clicks: 2, uniques: 2 },
        { url: "https://example.com/other", clicks: 1, uniques: 1 },
      ]);
      assert.equal(q.openTimes(from, to).length, 3);
      assert.deepEqual(q.suppressionCounts().sort((a, b) => a.label.localeCompare(b.label)), [
        { label: "bounce", value: 1 }, { label: "unsubscribe", value: 1 },
      ]);
      assert.deepEqual(q.contactSourceCounts().sort((a, b) => a.label.localeCompare(b.label)), [
        { label: "form", value: 1 }, { label: "import", value: 2 }, { label: "Unknown", value: 2 },
      ]);
    });

    // Control-plane readers used by the credits and sends widgets.
    assert.equal(typeof credits.getEmailBalanceCents(t.id), "number");
    assert.equal(typeof credits.isMarketingSuspended(t.id), "boolean");
    assert.equal(typeof included.getSentThisMonth(t.id), "number");
    assert.ok(included.getTenantIncludedSends(t.id) >= 0);
    console.log("emailQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
