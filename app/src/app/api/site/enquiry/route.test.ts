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
// rate limit; a repeat enquiry from the same contact dedupes to one lead.
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
  const { leads } = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
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
    const token = signSiteEnquiryToken({ tenantId: tid, siteId: 1 });

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
    const r1 = await post({ name: " Mary Byrne ", phone: "086 123 4567", programme: "vitality", about: "Had a stent in March.", token });
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
    assert.match(lead?.notes ?? "", /Programme: Vitality 60\+/);
    assert.match(lead?.notes ?? "", /Had a stent/);

    // 2. a repeat from the same contact dedupes to the same lead
    const r2 = await post({ name: "Mary Byrne", phone: "086 123 4567", programme: "heartwise", token });
    assert.equal(r2.status, 200);
    const b2 = (await r2.json()) as { ok: boolean; created: boolean };
    assert.equal(b2.created, false, "same phone -> existing lead, not a duplicate");
    assert.equal(leadCount(), 1);

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

    console.log("api/site/enquiry/route.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
