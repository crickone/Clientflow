// Run: npm test -- src/app/f/\[slug\]/submit/route.test.ts
//
// Batch 4c (forms public render + submissions, improvement-plan-2026-08.md
// Theme D5): the public submit handler's abuse protections + persistence,
// exercised end-to-end through the actual route handler — mirrors
// src/app/api/health/route.test.ts's pattern of importing and calling a
// route.ts handler directly with a real NextRequest, no server needed.
//
// Covers: a valid submit persists a row under the form's own tenant; a
// missing-required-field submit is rejected (400, nothing persisted); the
// honeypot path is silently "accepted" but nothing is persisted; an oversized
// payload is rejected (413) before any parsing; an unknown slug is rejected
// (404); the no-JS fallback (url-encoded body, no JSON Accept header) gets a
// redirect back to the form page instead of a JSON body.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// This route -> @/lib/publicForms -> @/lib/db/tenant -> react (cache), AND
// (unlike publicForms.test.ts) -> @/lib/queries (logActivity) -> the ambient
// @/lib/db proxy -> @/lib/tenants -> @/lib/auth -> next/navigation — so this
// file needs the FULL two-part shim, same as src/lib/cms/blog.test.ts and
// src/lib/forms.test.ts (see their comments): react's `cache` throws on load
// under --conditions=react-server, and next/navigation's real module drags in
// Next's client-router internals (which themselves need full React — a real
// crash hit while writing this test) for a redirect() this code path never
// actually calls.
//
// NOTE: also deliberately using the global `Request` (not next/server's
// NextRequest) to build requests below — importing next/server as a VALUE
// hits the same problem (it bundles the same React-context internals).
// route.ts is typed against the standard Request/Response for exactly this
// reason — see its file banner comment.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in submit/route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

const FAKE_IP = "10.99.0.1"; // one shared IP for this file — well under the route's rate limit (8/10min)

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { getTenantDbById } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { forms, formQuestions, formSubmissions } = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { POST } = requireLocal("./route") as typeof import("./route");

  // ── scratch tenant (control row + a real tenant db file) + a live contact form ──
  const slug = "route-submit-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Route Submit Test", dbFile) as { id: number };
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

  try {
    const tdb = getTenantDbById(tid);
    const form = tdb
      .insert(forms)
      .values({ type: "contact", title: "Enquiry", status: true, shareSlug: "route-test-enquiry" })
      .returning()
      .get();
    const qName = tdb
      .insert(formQuestions)
      .values({ formId: form.id, section: "main", label: "Full name", fieldType: "short", required: true, position: 0 })
      .returning()
      .get();
    const qMsg = tdb
      .insert(formQuestions)
      .values({ formId: form.id, section: "main", label: "Message", fieldType: "long", required: false, position: 1 })
      .returning()
      .get();
    controlSqlite
      .prepare("INSERT INTO form_share_links (share_slug, tenant_id, form_id) VALUES (?, ?, ?)")
      .run("route-test-enquiry", tid, form.id);

    const submissionCount = () =>
      tdb.select({ id: formSubmissions.id }).from(formSubmissions).where(eq(formSubmissions.formId, form.id)).all().length;

    const jsonPost = (slugParam: string, body: unknown) =>
      POST(
        new Request(`http://localhost/f/${slugParam}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json", "x-forwarded-for": FAKE_IP },
          body: JSON.stringify(body),
        }),
        { params: { slug: slugParam } },
      );

    // ── 1. a valid submit persists a row under the form's own tenant ──
    assert.equal(submissionCount(), 0, "no submissions before the first post");
    const res1 = await jsonPost("route-test-enquiry", {
      [`q_${qName.id}`]: "  Jane Doe  ",
      [`q_${qMsg.id}`]: "Hello there",
    });
    assert.equal(res1.status, 200);
    const body1 = (await res1.json()) as { ok: boolean };
    assert.equal(body1.ok, true);
    assert.equal(submissionCount(), 1, "the valid submit persisted exactly one row");
    const row = tdb.select().from(formSubmissions).where(eq(formSubmissions.formId, form.id)).get();
    assert.equal(row?.tenantId, tid, "the row is stamped with the form's OWN tenant, not client input");
    assert.equal(row?.submitterName, "Jane Doe", "trimmed, sniffed from the 'Full name' label");
    const payload = JSON.parse(row!.payload) as { answers: Array<{ label: string; value: string }> };
    assert.ok(payload.answers.some((a) => a.label === "Message" && a.value === "Hello there"));

    // ── 2. missing the required field is rejected, nothing persisted ──
    const res2 = await jsonPost("route-test-enquiry", { [`q_${qMsg.id}`]: "no name given" });
    assert.equal(res2.status, 400);
    const body2 = (await res2.json()) as { ok: boolean; error?: string };
    assert.equal(body2.ok, false);
    assert.match(body2.error ?? "", /Full name/);
    assert.equal(submissionCount(), 1, "the rejected submit did not persist a row");

    // ── 3. honeypot: silently "ok", but nothing is persisted ──
    const res3 = await jsonPost("route-test-enquiry", {
      [`q_${qName.id}`]: "Bot Name",
      company_website: "http://spam.example",
    });
    assert.equal(res3.status, 200);
    const body3 = (await res3.json()) as { ok: boolean };
    assert.equal(body3.ok, true, "a honeypot hit still reports ok=true, so as not to tip off the bot");
    assert.equal(submissionCount(), 1, "the honeypot submit did NOT persist a row");

    // ── 4. an oversized payload is rejected before any parsing ──
    const res4 = await jsonPost("route-test-enquiry", { [`q_${qName.id}`]: "a".repeat(25_000) });
    assert.equal(res4.status, 413);
    assert.equal(submissionCount(), 1, "the oversized submit did not persist a row");

    // ── 5. an unknown slug is rejected ──
    const res5 = await jsonPost("no-such-slug-anywhere", { [`q_${qName.id}`]: "Jane" });
    assert.equal(res5.status, 404);

    // ── 6. no-JS fallback: url-encoded body, no JSON Accept -> redirect back
    //      to the form page rather than a JSON body ──
    const res6 = await POST(
      new Request("http://localhost/f/route-test-enquiry/submit", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "text/html",
          "x-forwarded-for": FAKE_IP,
        },
        body: new URLSearchParams({ [`q_${qName.id}`]: "No JS Nancy" }).toString(),
      }),
      { params: { slug: "route-test-enquiry" } },
    );
    assert.equal(res6.status, 303, "the no-JS fallback gets a redirect, not a JSON body");
    const location = res6.headers.get("location") ?? "";
    assert.ok(location.includes("/f/route-test-enquiry"), "redirects back to the form page");
    assert.ok(location.includes("ok=1"), "the redirect flags success for the page to read");
    assert.equal(submissionCount(), 2, "the no-JS submit persisted too — it's a normal valid submit, just a different response shape");

    console.log("f/[slug]/submit/route.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
