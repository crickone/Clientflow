// Run: npm test -- src/app/api/site/enquiry/route.test.ts
//
// The public enquiry handler, exercised through the real route with a real
// scratch tenant DB, exactly as src/app/f/[slug]/submit/route.test.ts does
// (same Module._load shim, same reason: react's cache and next/navigation
// cannot load under --conditions=react-server without full React).
//
// Covers: a signed token puts the lead in ITS tenant; a tampered token, a
// campaign-shaped token and a missing token are all one 400 with nothing
// written; honeypot is a silent 200; validation 400; url-encoded no-JS path
// gets a 303 back to a SAFE return path; oversized payload 413; the per-IP
// rate limit; a repeat enquiry from the same contact dedupes to one lead, and
// reopens that lead when the business had written it off as lost.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const SECRET = "test-site-enquiry-route-secret";
const originalSecret = process.env.EMAIL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = SECRET;

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { getTenantDbById } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { leads, pipelineStages, sites } = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { signSiteEnquiryToken } = requireLocal("../../../../lib/cms/enquiryToken") as typeof import("@/lib/cms/enquiryToken");
  const { POST } = requireLocal("./route") as typeof import("./route");

  const slug = "route-enquiry-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Route Enquiry Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
    if (originalSecret === undefined) delete process.env.EMAIL_TOKEN_SECRET;
    else process.env.EMAIL_TOKEN_SECRET = originalSecret;
  };

  try {
    const tdb = getTenantDbById(tid);
    const leadCount = () => tdb.select({ id: leads.id }).from(leads).all().length;
    // One tenant, two sites -- the agency case, and the reason "which site"
    // cannot be inferred from the tenant. The scratch DB is seeded with a
    // "renova" site at id 1 (lib/cms/seed.ts); these are the two the enquiry
    // form is wired to, and the token names one of them.
    const siteId = (name: string, slug: string) =>
      tdb.insert(sites).values({ slug, name }).returning({ id: sites.id }).get().id;
    const hwSiteId = siteId("Healthwise", "healthwise");
    const ohSiteId = siteId("Optimal Health", "optimal-health");
    const token = signSiteEnquiryToken({ tenantId: tid, siteId: hwSiteId });
    const ohToken = signSiteEnquiryToken({ tenantId: tid, siteId: ohSiteId });

    const post = (body: Record<string, string>, ip = "10.77.0.1") =>
      POST(
        new Request("http://localhost/api/site/enquiry", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": ip },
          body: JSON.stringify(body),
        }),
      );

    // 1. a signed token puts the lead in ITS tenant
    assert.equal(leadCount(), 0);
    const r1 = await post({ name: " Mary Byrne ", phone: "086 123 4567", programme: "studio60", about: "Had a stent in March.", token });
    assert.equal(r1.status, 200);
    const b1 = (await r1.json()) as { ok: boolean; created: boolean };
    assert.equal(b1.ok, true);
    assert.equal(b1.created, true);
    assert.equal(leadCount(), 1);
    const lead = tdb.select().from(leads).get();
    assert.equal(lead?.source, "website");
    assert.equal(lead?.firstName, "Mary");
    assert.equal(lead?.lastName, "Byrne");
    assert.equal(lead?.campaign, "Website enquiry");
    assert.match(lead?.notes ?? "", /Programme: Studio 60/);
    assert.match(lead?.notes ?? "", /Had a stent/);

    // 2. a repeat from the same contact dedupes to the same lead, and its
    //    message is appended rather than dropped
    const r2 = await post({
      name: "Mary Byrne",
      phone: "086 123 4567",
      programme: "heartwise",
      about: "Consultant referred me.",
      token,
    });
    assert.equal(r2.status, 200);
    const b2 = (await r2.json()) as { ok: boolean; created: boolean };
    assert.equal(b2.created, false, "same phone -> existing lead, not a duplicate");
    assert.equal(leadCount(), 1);
    const leadAfterRepeat = tdb.select().from(leads).get();
    assert.match(leadAfterRepeat?.notes ?? "", /Programme: Studio 60/, "the first enquiry's programme survives");
    assert.match(leadAfterRepeat?.notes ?? "", /Had a stent/, "the first enquiry's message survives");
    assert.match(leadAfterRepeat?.notes ?? "", /Repeat enquiry/, "the repeat is appended, not silently dropped");
    assert.match(leadAfterRepeat?.notes ?? "", /Programme: Heartwise/, "the repeat's new programme is recorded");
    assert.match(leadAfterRepeat?.notes ?? "", /Consultant referred me\./, "the repeat's about text is recorded");

    // 2b. a repeat enquiry from someone the business wrote off REOPENS the
    //     lead: it comes back to the board's entry stage and the legacy
    //     status stops saying lost, so the operator actually sees them.
    const stages = tdb.select().from(pipelineStages).all();
    const lostStage = stages.find((st) => st.role === "lost");
    const entryStage = stages.find((st) => st.role === "new");
    assert.ok(lostStage && entryStage, "the scratch tenant seeded a lost and a new stage");
    tdb
      .update(leads)
      .set({ stageId: lostStage!.id, pipelineStage: "lost", status: "lost" })
      .run();
    const lostLead = tdb.select().from(leads).get();
    assert.equal(lostLead?.stageId, lostStage!.id, "setup: the lead really is in Lost");

    const r2b = await post(
      { name: "Mary Byrne", phone: "086 123 4567", programme: "studio60", about: "Changed my mind.", token },
      "10.77.0.9",
    );
    assert.equal(r2b.status, 200);
    const b2b = (await r2b.json()) as { created: boolean; reopened: boolean };
    assert.equal(b2b.created, false, "still the same lead, not a new one");
    assert.equal(b2b.reopened, true, "the route reports that it reopened a lost lead");
    assert.equal(leadCount(), 1, "reopening does not create a second card");
    const reopenedLead = tdb.select().from(leads).get();
    assert.equal(reopenedLead?.stageId, entryStage!.id, "the lead is back at the entry stage");
    assert.equal(reopenedLead?.pipelineStage, "new_lead", "the frozen dual-write column follows the stage");
    assert.equal(reopenedLead?.status, "new", "the legacy status stops saying lost");
    assert.match(reopenedLead?.notes ?? "", /Changed my mind\./, "the reopening enquiry's message is kept");
    assert.match(reopenedLead?.notes ?? "", /Had a stent/, "the original enquiry still survives");

    // 2c. a repeat from a lead that is NOT lost leaves the stage alone
    const r2c = await post(
      { name: "Mary Byrne", phone: "086 123 4567", programme: "livewell", about: "One more thing.", token },
      "10.77.0.10",
    );
    const b2c = (await r2c.json()) as { created: boolean; reopened: boolean };
    assert.equal(b2c.reopened, false, "an already-open lead is not reported as reopened");
    assert.equal(tdb.select().from(leads).get()?.stageId, entryStage!.id, "and it has not been moved");

    // 3. tampered / campaign-shaped / missing tokens are one 400, nothing written
    //    (own IP: the route counts a rejected request against the caller's
    //    budget, and this file must never trip its own rate limit by accident)
    const [payload, sig] = token.split(".");
    const flipped = sig!.endsWith("A") ? sig!.slice(0, -1) + "B" : sig!.slice(0, -1) + "A";
    const bad = [
      `${payload}.${flipped}`,
      (() => { const p = Buffer.from(JSON.stringify({ t: tid, c: 1 }), "utf8").toString("base64url"); return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`; })(),
      "",
    ];
    for (const badToken of bad) {
      const r = await post({ name: "Eve", phone: "1", token: badToken }, "10.77.0.3");
      assert.equal(r.status, 400, `bad token "${badToken.slice(0, 12)}" -> 400`);
      const b = (await r.json()) as { ok: boolean; error: string };
      assert.equal(b.error, "Invalid or missing token.");
    }
    assert.equal(leadCount(), 1, "no bad-token request wrote a lead");

    // 4. honeypot: silent 200, nothing written (answered before the throttle, so not counted)
    const r4 = await post({ name: "Bot", phone: "1", token, company_website: "http://spam.example" });
    assert.equal(r4.status, 200);
    assert.equal(((await r4.json()) as { ok: boolean }).ok, true);
    assert.equal(leadCount(), 1);

    // 5. validation
    const r5 = await post({ phone: "1", token }, "10.77.0.4");
    assert.equal(r5.status, 400);
    assert.match(((await r5.json()) as { error: string }).error, /name/i);

    // 6. no-JS: url-encoded, no JSON accept -> 303 to a SAFE return path, lead written
    const r6 = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-forwarded-for": "10.77.0.4" },
        body: new URLSearchParams({ name: "No JS Nancy", email: "nancy@example.ie", programme: "livewell", token, return: "https://evil.example/" }).toString(),
      }),
    );
    assert.equal(r6.status, 303);
    assert.equal(r6.headers.get("location"), "http://localhost/contact?ok=1", "absolute return path refused -> fallback");
    assert.equal(leadCount(), 2);
    const r6b = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-forwarded-for": "10.77.0.4" },
        body: new URLSearchParams({ name: "Bad Email", email: "nope", token, return: "/site/healthwise/contact" }).toString(),
      }),
    );
    assert.equal(r6b.status, 303);
    assert.match(r6b.headers.get("location") ?? "", /^http:\/\/localhost\/site\/healthwise\/contact\?err=/);

    // 6c. no-JS with a same-origin Referer: the reply returns to the page the
    //     visitor was on, whichever mount the site is served from
    const r6c = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
          referer: "http://localhost/site/healthwise/contact",
          "x-forwarded-for": "10.77.0.5",
        },
        body: new URLSearchParams({ name: "Referer Rita", email: "rita@example.ie", return: "/contact", token }).toString(),
      }),
    );
    assert.equal(r6c.status, 303);
    assert.equal(r6c.headers.get("location"), "http://localhost/site/healthwise/contact?ok=1", "same-origin referer path wins over the hidden default");
    // 6d. a cross-origin Referer is ignored
    const r6d = await POST(
      new Request("http://localhost/api/site/enquiry", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
          referer: "https://evil.example/site/healthwise/contact",
          "x-forwarded-for": "10.77.0.5",
        },
        body: new URLSearchParams({ name: "Cross Origin Carl", email: "carl@example.ie", return: "/contact", token }).toString(),
      }),
    );
    assert.equal(r6d.status, 303);
    assert.equal(r6d.headers.get("location"), "http://localhost/contact?ok=1", "cross-origin referer ignored -> the hidden field's path");
    assert.equal(leadCount(), 4, "both referer scenarios wrote leads");

    // 7. oversized
    const r7 = await post({ name: "x".repeat(40_000), phone: "1", token });
    assert.equal(r7.status, 413);

    // 8. rate limit: 8 per 10 minutes per IP
    let last = 0;
    for (let i = 0; i < 9; i++) {
      const r = await post({ name: `Burst ${i}`, phone: `08${i}`, token }, "10.77.0.2");
      last = r.status;
    }
    assert.equal(last, 429, "the ninth request in the window is throttled");

    // 9. the programme list belongs to the SITE, and the site comes from the
    //    signed token -- never from the body, which would let a caller pick
    //    which list they are checked against and defeat the check entirely.
    const leadWith = (email: string) => tdb.select().from(leads).all().find((l) => l.email === email);
    const before9 = leadCount();

    const r9 = await post({ name: "Aoife Nolan", email: "aoife@example.ie", programme: "hifem", token: ohToken }, "10.77.0.11");
    assert.equal(r9.status, 200, "optimal-health's own therapy is accepted");
    assert.equal(leadCount(), before9 + 1, "and it landed as a lead");
    assert.match(leadWith("aoife@example.ie")?.notes ?? "", /Programme: HIFEM chair/, "the note carries optimal-health's own label");

    const r9b = await post({ name: "Wrong List", email: "wrong@example.ie", programme: "livewell", token: ohToken }, "10.77.0.12");
    assert.equal(r9b.status, 400, "healthwise's programme is refused on optimal-health's form");
    assert.equal(((await r9b.json()) as { error: string }).error, "Please choose one of the options.");
    assert.equal(leadCount(), before9 + 1, "and nothing was written");

    const r9c = await post({ name: "Other Way", email: "other@example.ie", programme: "hifem", token }, "10.77.0.13");
    assert.equal(r9c.status, 400, "and it refuses in the other direction too");
    assert.equal(leadCount(), before9 + 1);

    // A submission with no programme at all still lands: the enquiry is the
    // point, not the dropdown, and a form that never carried the field must
    // not start failing (sections 5, 6 and 6c above post without one).
    const r9d = await post({ name: "No Dropdown Dave", email: "dave@example.ie", token: ohToken }, "10.77.0.14");
    assert.equal(r9d.status, 200);
    assert.match(leadWith("dave@example.ie")?.notes ?? "", /Programme: Not sure yet/);

    // A claim naming a site that is not there any more cannot say what its
    // form offered, so it is refused rather than checked against some other
    // site's list. Same answer as every other unusable token.
    const goneToken = signSiteEnquiryToken({ tenantId: tid, siteId: 99_999 });
    const r9e = await post({ name: "Ghost Site", email: "ghost@example.ie", programme: "unsure", token: goneToken }, "10.77.0.15");
    assert.equal(r9e.status, 400);
    assert.equal(((await r9e.json()) as { error: string }).error, "Invalid or missing token.");
    assert.equal(leadCount(), before9 + 2, "only the two accepted enquiries wrote leads");

    console.log("api/site/enquiry/route.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
