// Run: npm test -- src/lib/facebook/capi.test.ts
//
// Meta Conversions API (server-side events). Before this, conversions reached
// Meta only through the browser Pixel, which ad blockers and phone privacy
// settings stop; leads were never sent at all. Checks:
//   - personal data is normalised and hashed the way Meta asks; raw email
//     never leaves us
//   - NOTHING is queued for a visitor who did not accept advertising cookies
//   - each event goes once (event_key), in one batch per Pixel
//   - Purchase carries the browser's event id, so Meta counts it once
//   - lead-ads leads that book/buy send Meta's lead id only, once per stage
//   - a refusal is kept, retried and shown in Settings
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
  const m = requireLocal("./capiModel") as typeof import("./capiModel");

  // ── normalising and hashing ──
  assert.equal(m.normPhone("083 867 2844"), "353838672844", "an Irish number gets +353");
  assert.equal(m.normPhone("+44 7700 900123"), "447700900123");
  assert.equal(m.normPhone("0044 7700 900123"), "447700900123");
  assert.equal(m.normPhone("123"), null);
  assert.equal(m.normEmail("  Jo@Example.IE "), "jo@example.ie");
  assert.equal(m.normEmail("not an email"), null);
  assert.equal(m.normName(" Siobhán "), "siobhán");
  const ud = m.userData({ email: "Jo@Example.ie", phone: "083 867 2844", firstName: "Jo" }, { ip: "1.2.3.4", userAgent: "UA", fbp: "fb.1.1700000000000.123", fbc: null });
  assert.deepEqual(ud.em, [m.sha256("jo@example.ie")]);
  assert.deepEqual(ud.ph, [m.sha256("353838672844")]);
  assert.equal(ud.client_ip_address, "1.2.3.4", "browser fields are sent as they are");
  assert.equal(ud.fbc, undefined, "empty fields are left out");
  assert.ok(!JSON.stringify(ud).includes("jo@example"), "the raw email never appears");
  assert.equal(m.crmEvent({ stageName: "Booked", leadgenId: "not-a-number" }), null, "only Meta's numeric lead ids");
  assert.equal(m.isMetaCookie("fb.1.1700000000000.AbC-123"), true);
  assert.equal(m.isMetaCookie("<script>"), false);
  assert.equal(m.cookieValue("a=1; aa_ads_consent=1; _fbp=fb.1.1700000000000.9", "aa_ads_consent"), "1");
  assert.equal(m.capiRetryDelayMs(1), 60_000);
  assert.equal(m.capiRetryDelayMs(9), 60 * 60_000);

  // ── the queue and sender, against a faked Meta ──
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const capi = requireLocal("./capi") as typeof import("./capi");

  const slug = "capi-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "CAPI Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    for (const t of ["capi_events", "capi_context", "capi_status"]) controlSqlite.prepare(`DELETE FROM ${t} WHERE tenant_id = ?`).run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const sent: Array<{ url: string; body: { data: Array<Record<string, unknown>>; test_event_code?: string } }> = [];
  let refuse = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (refuse) return new Response(JSON.stringify({ error: { message: "Invalid OAuth access token.", code: 190 } }), { status: 400 });
    sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }) as typeof fetch;

  const rows = (where = "1=1") => controlSqlite.prepare(`SELECT * FROM capi_events WHERE tenant_id = ? AND ${where}`).all(tid) as Array<Record<string, unknown>>;
  const ctx = (consent: boolean): import("./capiModel").AdContext => ({ consent, fbp: "fb.1.1700000000000.42", fbc: null, ip: "1.2.3.4", userAgent: "Mozilla", url: "https://www.example.ie/contact" });

  try {
    const [site] = getTenantDbById(tid)
      .insert(schema.sites)
      .values({ slug: "capi-test-site", name: "CAPI Test", status: "live", metaPixelId: "1234567890123456", metaCapiToken: capi.sealCapiToken("EAAcapitoken0000000000000000000000000000000"), metaCapiTestCode: "TEST123" } as typeof schema.sites.$inferInsert)
      .returning()
      .all();

    // No consent: nothing queued, ever.
    capi.queueWebsiteLead({ tenantId: tid, siteId: site.id, leadId: 1, person: { email: "jo@example.ie" }, ctx: ctx(false), contentName: "Website enquiry" });
    assert.equal(rows().length, 0, "a visitor who did not accept cookies is never sent");

    // Consent: queued once, however often it is asked.
    for (let i = 0; i < 2; i++) {
      capi.queueWebsiteLead({ tenantId: tid, siteId: site.id, leadId: 2, person: { email: "Jo@Example.ie", phone: "083 867 2844", firstName: "Jo" }, ctx: ctx(true), contentName: "Website enquiry" });
    }
    assert.equal(rows().length, 1, "one event per lead");
    assert.ok(!String(rows()[0].payload).includes("jo@example"), "stored already hashed");

    // Purchase: context remembered at checkout, sent with the browser's event id.
    capi.rememberCheckoutContext(tid, 7, ctx(true));
    capi.queuePurchase({ tenantId: tid, orderId: 7, valueCents: 6400, currency: "eur", person: { email: "buyer@example.ie" }, contentName: "Black Friday massage" });
    capi.queuePurchase({ tenantId: tid, orderId: 8, valueCents: 6400, currency: "eur", person: { email: "x@example.ie" }, contentName: "No consent at checkout" });
    assert.equal(rows("event_name = 'Purchase'").length, 1, "a purchase without consent at checkout is not sent");

    // Conversion leads: a lead-ads lead that books.
    capi.queueCrmStage(tid, { source: "facebook", sourceLeadId: "1122334455667788" }, "booked");
    capi.queueCrmStage(tid, { source: "facebook", sourceLeadId: "1122334455667788" }, "booked");
    capi.queueCrmStage(tid, { source: "facebook", sourceLeadId: "1122334455667788" }, "engaged");
    capi.queueCrmStage(tid, { source: "website", sourceLeadId: "website:jo@example.ie" }, "won");
    assert.equal(rows("event_name = 'Booked'").length, 1, "once per lead and stage; only lead-ads leads; only stages that matter");
    assert.equal(rows().length, 3);

    // Send: one batch to the Pixel, with the site's own token and test code.
    assert.equal(await capi.processDueCapiEvents(), 3);
    assert.equal(sent.length, 1, "one request per Pixel");
    assert.match(sent[0].url, /\/1234567890123456\/events\?access_token=EAAcapitoken/);
    assert.equal(sent[0].body.test_event_code, "TEST123");
    const byName = Object.fromEntries(sent[0].body.data.map((e) => [e.event_name, e]));
    assert.equal(byName.Purchase.event_id, "offer-order-7", "the browser Purchase uses this id, so Meta keeps one");
    assert.deepEqual((byName.Purchase.custom_data as { value: number }).value, 64);
    assert.equal((byName.Booked.user_data as { lead_id: number }).lead_id, 1122334455667788);
    assert.equal(byName.Booked.action_source, "system_generated");
    assert.equal(byName.Lead.action_source, "website");
    assert.equal(rows("status = 'sent' AND payload IS NULL").length, 3, "sent, and the stored copy cleared");
    assert.ok(capi.capiStatus(tid, "1234567890123456")?.lastOkAt);

    // A refusal: kept for a retry, and shown in Settings with what to do.
    refuse = true;
    capi.queueWebsiteLead({ tenantId: tid, siteId: site.id, leadId: 3, person: { email: "b@example.ie" }, ctx: ctx(true), contentName: "Website enquiry" });
    assert.equal(await capi.processDueCapiEvents(), 0);
    const failed = rows("event_key LIKE 'lead-%-3'")[0];
    assert.equal(failed.status, "pending");
    assert.equal(failed.attempts, 1);
    assert.match(String(capi.capiStatus(tid, "1234567890123456")?.lastError), /Conversions API token/);

    // No Pixel on any site: nothing to send to, nothing queued.
    getTenantDbById(tid).update(schema.sites).set({ metaPixelId: null }).where(eq(schema.sites.id, site.id)).run();
    capi.queueWebsiteLead({ tenantId: tid, siteId: site.id, leadId: 4, person: { email: "c@example.ie" }, ctx: ctx(true), contentName: "Website enquiry" });
    assert.equal(rows("event_key LIKE 'lead-%-4'").length, 0);

    console.log("capi: hashing, consent, once-only, batching, purchase dedup, conversion leads, refusals; 42 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
