// Run: npm test -- src/lib/offers/salesFunnel.test.ts
//
// The sales campaign around an offer, end to end against a scratch tenant:
//   - a paid order from an ad (utm_campaign = the Meta campaign id, which the
//     ads now carry) counts as that campaign's sale and revenue; a lead from
//     the same ad counts as its enquiry; a paid order from elsewhere does not
//   - a checkout that expires with details given becomes a lead and gets the
//     "Checkout not finished" sequence (when on) with the offer's name and
//     link; nothing for someone who has since bought; buying stops it
//   - started-checkout events go to Meta only with consent, once per id
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
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { createCampaign } = requireLocal("../campaigns/store") as typeof import("../campaigns/store");
  const store = requireLocal("./store") as typeof import("./store");
  const fulfil = requireLocal("./fulfil") as typeof import("./fulfil");
  const { ownResults } = requireLocal("../ads/accountInsights") as typeof import("../ads/accountInsights");
  const capi = requireLocal("../facebook/capi") as typeof import("../facebook/capi");

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const slug = "sales-funnel-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Sales Funnel Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    for (const t of ["capi_events", "capi_context"]) controlSqlite.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    await runWithTenant(tid, async () => {
      const tdb = getTenantDbById(tid);
      const [therapy] = tdb.insert(schema.therapies).values({ name: "Massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 } as typeof schema.therapies.$inferInsert).returning().all();
      const campaign = createCampaign({ name: "Black Friday", slug: "black-friday" });
      const offerId = store.saveOffer(null, campaign.id, {
        title: "Black Friday massage",
        description: null,
        priceCents: 6400,
        compareAtCents: 8000,
        items: [{ therapyId: therapy.id, sessions: 1 }],
        quantityLimit: null,
        saleStartsAt: null,
        saleEndsAt: null,
        useByDate: "2027-01-31",
        terms: null,
      });
      const offer = store.getOffer(offerId)!;
      const META = "120201234567890";
      const now = Date.now();

      // ── revenue matching ──
      const fromAd = store.createPendingOrder(offer, "acct_1", { source: "facebook", medium: "paid", campaign: META, click: "facebook" });
      const fromElsewhere = store.createPendingOrder(offer, "acct_1", { source: "newsletter" });
      tdb.update(schema.offerOrders).set({ status: "paid", paidAt: now - 1000 }).where(eq(schema.offerOrders.id, fromAd.id)).run();
      tdb.update(schema.offerOrders).set({ status: "paid", paidAt: now - 1000 }).where(eq(schema.offerOrders.id, fromElsewhere.id)).run();
      tdb.insert(schema.leads).values({ firstName: "Ad", lastName: "Lead", source: "website", arrival: JSON.stringify({ source: "facebook", campaign: META }) } as typeof schema.leads.$inferInsert).run();
      const ours = ownResults(tid, { from: now - 86_400_000, to: now + 1000 });
      assert.deepEqual(ours.get(META), { leads: 1, sales: 1, revenue: 64 }, "the ad's sale, revenue and enquiry, from our own records");
      assert.equal(ours.size, 1, "a sale from elsewhere is not credited to any ad");

      // ── unfinished checkout ──
      tdb.insert(schema.automationTriggers).values({ key: "checkout_abandoned", enabled: true }).run();
      const pending = store.createPendingOrder(offer, "acct_1", null);
      store.setOrderSession(pending.id, "cs_test_1");
      await fulfil.recoverAbandonedCheckout(tid, { id: "cs_test_1", customer_details: { email: "Maeve@Example.ie", name: "Maeve Test", phone: "0871234567" } } as never);
      const lead = tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, `checkout:${offerId}:maeve@example.ie`)).get();
      assert.ok(lead, "the person who did not pay is on the board");
      const queued = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, lead!.id), eq(schema.automationQueue.status, "queued"))).all();
      assert.equal(queued.length, 2, "the follow-up: WhatsApp then email");
      assert.ok(queued.every((q) => q.body.includes("Black Friday massage")), "with the offer's name");
      assert.ok(queued.every((q) => !q.body.includes("[OFFER_LINK]")), "and the link filled in");
      assert.equal(tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, lead!.id), eq(schema.automationQueue.triggerKey, "new_lead"))).all().length, 0, "not the generic new-lead sequence too");

      // Someone who already bought this offer is left alone.
      const bought = store.createPendingOrder(offer, "acct_1", null);
      tdb.update(schema.offerOrders).set({ status: "paid", email: "done@example.ie" }).where(eq(schema.offerOrders.id, bought.id)).run();
      const again = store.createPendingOrder(offer, "acct_1", null);
      store.setOrderSession(again.id, "cs_test_2");
      await fulfil.recoverAbandonedCheckout(tid, { id: "cs_test_2", customer_details: { email: "done@example.ie" } } as never);
      assert.equal(tdb.select().from(schema.leads).where(eq(schema.leads.sourceLeadId, `checkout:${offerId}:done@example.ie`)).all().length, 0);

      // Buying stops the chase.
      const nurture = requireLocal("../automations/nurture") as typeof import("../automations/nurture");
      nurture.cancelSequences(lead!.id, ["checkout_abandoned"]);
      assert.equal(tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, lead!.id), eq(schema.automationQueue.status, "queued"))).all().length, 0);

      // ── started-checkout events ──
      tdb.insert(schema.sites).values({ slug: "sales-funnel-site", name: "Site", status: "live", metaPixelId: "1234567890123456" } as typeof schema.sites.$inferInsert).run();
      const ctx = { consent: true, fbp: null, fbc: null, ip: "1.2.3.4", userAgent: "UA", url: "https://x.ie/c/black-friday" };
      capi.queueFunnelEvent({ tenantId: tid, name: "InitiateCheckout", eventId: "ic-abc12345", ctx, custom: { value: 64, currency: "EUR" } });
      capi.queueFunnelEvent({ tenantId: tid, name: "InitiateCheckout", eventId: "ic-abc12345", ctx, custom: { value: 64, currency: "EUR" } });
      capi.queueFunnelEvent({ tenantId: tid, name: "ViewContent", eventId: "vc-nope", ctx: { ...ctx, consent: false }, custom: {} });
      const evs = controlSqlite.prepare("SELECT event_name, payload FROM capi_events WHERE tenant_id = ?").all(tid) as Array<{ event_name: string; payload: string }>;
      assert.deepEqual(evs.map((e) => e.event_name), ["InitiateCheckout"], "once per id, and nothing without consent");
      assert.equal(JSON.parse(evs[0].payload).event_id, "ic-abc12345", "the browser's id, so Meta keeps one");
    });
    console.log("salesFunnel: revenue matched to ads, unfinished checkout follow-up, funnel events; 13 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
