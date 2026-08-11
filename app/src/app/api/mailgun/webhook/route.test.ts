// Run: npm test -- src/app/api/mailgun/webhook/route.test.ts
//
// Task 7 review fix (FIX 1) — exercises the actual route handler (POST),
// not just the lib functions in lib/marketing/events.ts, mirroring
// f/[slug]/submit/route.test.ts's / api/health/route.test.ts's pattern of
// calling a route.ts export directly with a real (standard Fetch API)
// Request, no server needed. route.ts is deliberately typed against
// Request/Response (not next/server's NextRequest/NextResponse) for exactly
// this reason — see its file banner comment.
//
// Covers:
//   1. Invalid JSON body -> 401 (can't even extract a signature to check).
//   2. Valid JSON, bad/missing signature -> 401.
//   3. Verified signature, but not an event shape parseMailgunEvent acts on
//      (blank recipient) -> 200 ignored (Mailgun must not retry a permanent
//      no-op).
//   4. Verified signature + v:tenantId resolving to a real scratch tenant
//      with a matching campaign_sends row -> 200 ok, AND the row is
//      actually updated by applyEvent — proves the full chain (signature
//      verify -> parse -> resolve -> runWithTenant -> applyEvent -> DB
//      write) is wired end-to-end through the real POST export, not just at
//      the lib level.
//   5. FIX 1 regression: tenant resolution genuinely THROWING must still
//      return 200, never 500. Modelled by registering a real ACTIVE tenant
//      whose db_file points at a path that IS a directory on disk, so
//      better-sqlite3's `new Database(...)` throws synchronously the moment
//      findTenantIdBySendingDomain's domain-fallback scan reaches it — a
//      real instance of the "corrupt/locked DB"/SQLITE_BUSY class of
//      failure the fix guards against, not a mock.
//   6. Verified signature, tenant genuinely unresolved (no v:tenantId, no
//      active tenant anywhere has the sending domain) -> 200 ignored.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// This route -> @/lib/marketing/events -> ./send (normalizeMessageId) ->
// @/lib/email -> @/lib/gmail -> @/lib/db (the ambient `db` proxy) ->
// @/lib/tenants -> @/lib/auth -> `next/navigation`, and separately ->
// @/lib/db/tenant -> react's `cache` — same two-part shim as
// events.test.ts / f/[slug]/submit/route.test.ts (see either's comment):
// react's `cache` throws on load under --conditions=react-server, and
// next/navigation's real module drags in Next's client-router internals for
// a redirect() this code path never actually calls.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in mailgun webhook route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

const SIGNING_KEY = "route-test-signing-key-do-not-use";

function sign(timestamp: string, token: string): string {
  return createHmac("sha256", SIGNING_KEY).update(timestamp + token).digest("hex");
}

/** Mailgun's real webhook shape: {signature:{...}, "event-data":{...}}, correctly HMAC-signed unless badSignature is set. */
function mailgunPayload(eventData: Record<string, unknown>, opts: { badSignature?: boolean } = {}) {
  const timestamp = "1700000000";
  const token = "route-test-token";
  const signature = opts.badSignature ? "0".repeat(64) : sign(timestamp, token);
  return { signature: { timestamp, token, signature }, "event-data": eventData };
}

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { getTenantDbById } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { emailCampaigns, campaignSends } =
    requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { POST } = requireLocal("./route") as typeof import("./route");

  const postRaw = (body: string) =>
    POST(
      new Request("http://localhost/api/mailgun/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
  const postJson = (body: unknown) => postRaw(JSON.stringify(body));

  const originalKey = process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
  process.env.MAILGUN_WEBHOOK_SIGNING_KEY = SIGNING_KEY;

  try {
    // ── scratch tenant (control row + a real tenant db file) + one campaign_sends row ──
    const slug = "mailgun-route-test";
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Mailgun Route Test", dbFile) as { id: number };
    const tid = t.id;

    try {
      const tdb = getTenantDbById(tid);
      const campaign = tdb
        .insert(emailCampaigns)
        .values({
          name: "Route Test Campaign",
          subject: "Subject line",
          fromName: "Test Sender",
          fromEmail: "news@route-test.example.com",
          bodyHtml: "Hello there.",
          audience: JSON.stringify({ kind: "all_subscribed" }),
          status: "sending",
        })
        .returning()
        .get();
      tdb
        .insert(campaignSends)
        .values({
          campaignId: campaign.id,
          email: "recipient@example.com",
          providerMessageId: "route-test-msg@mail.example.com",
          status: "sent",
        })
        .run();

      // ── 1. invalid JSON body -> 401 ──
      const res1 = await postRaw("{not valid json");
      assert.equal(res1.status, 401);

      // ── 2. valid JSON, bad signature -> 401 ──
      const res2 = await postJson(
        mailgunPayload(
          {
            event: "delivered",
            recipient: "x@example.com",
            message: { headers: { "message-id": "whatever@mail.example.com" } },
          },
          { badSignature: true },
        ),
      );
      assert.equal(res2.status, 401);

      // ── 2b. no signature block at all -> 401, not a crash ──
      const res2b = await postJson({ "event-data": { event: "delivered", recipient: "x@example.com" } });
      assert.equal(res2b.status, 401);

      // ── 3. verified signature, but not an event shape parseMailgunEvent
      // acts on (blank recipient) -> 200 ignored ──
      const res3 = await postJson(mailgunPayload({ event: "delivered", recipient: "" }));
      assert.equal(res3.status, 200);
      const body3 = (await res3.json()) as { ok: boolean; ignored?: string };
      assert.equal(body3.ok, true);
      assert.equal(body3.ignored, "unrecognized event");

      // ── 4. verified signature + v:tenantId resolving to our scratch
      // tenant + a matching campaign_sends row -> 200 ok, AND the row is
      // actually updated — the full chain wired end-to-end through the real
      // handler. ──
      const res4 = await postJson(
        mailgunPayload({
          event: "delivered",
          recipient: "recipient@example.com",
          message: { headers: { "message-id": "ROUTE-TEST-MSG@Mail.Example.com" } },
          "user-variables": { tenantId: String(tid) },
        }),
      );
      assert.equal(res4.status, 200);
      const body4 = (await res4.json()) as { ok: boolean };
      assert.equal(body4.ok, true);
      const sendRow = tdb
        .select()
        .from(campaignSends)
        .where(eq(campaignSends.providerMessageId, "route-test-msg@mail.example.com"))
        .get();
      assert.equal(
        sendRow?.status,
        "delivered",
        "the route handler's applyEvent call actually persisted, through the real POST export",
      );

      // ── 6. verified signature, tenant genuinely unresolved (no
      // v:tenantId, no active tenant anywhere has this sending domain) ->
      // 200 ignored ──
      const res6 = await postJson(
        mailgunPayload({
          event: "opened",
          recipient: "someone@example.com",
          message: { headers: { "message-id": "unresolved-route-test@mail.example.com" } },
          envelope: { sender: `news@totally-unregistered-route-test-domain-${Date.now()}.example.test` },
        }),
      );
      assert.equal(res6.status, 200);
      const body6 = (await res6.json()) as { ok: boolean; ignored?: string };
      assert.equal(body6.ok, true);
      assert.equal(body6.ignored, "tenant unresolved");

      console.log("api/mailgun/webhook/route.test.ts: core assertions (1,2,2b,3,4,6) passed");
    } finally {
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }

    // ── 5. FIX 1 regression: tenant resolution genuinely THROWING must
    // still return 200, never 500. A real ACTIVE tenant whose db_file
    // points at a path that IS a directory on disk makes
    // better-sqlite3's `new Database(...)` throw synchronously the moment
    // findTenantIdBySendingDomain's domain-fallback scan reaches it while
    // resolving the event below — a real instance of the "corrupt/locked
    // DB"/SQLITE_BUSY class of failure the fix guards against, not a mock.
    // Own scratch tenant + its own try/finally, run separately from the
    // block above so an active-but-broken tenant never leaks into its
    // assertions. ──
    const badSlug = "mailgun-route-test-bad-tenant";
    const badDbFile = `tenants/${badSlug}/${badSlug}.db`;
    const badDbFullPath = path.join(process.cwd(), "data", badDbFile);
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(badSlug);
    fs.mkdirSync(badDbFullPath, { recursive: true }); // a DIRECTORY sitting at the exact db-file path
    const badTenant = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(badSlug, "Bad Tenant (route test)", badDbFile) as { id: number };

    try {
      const res5 = await postJson(
        mailgunPayload({
          event: "delivered",
          recipient: "someone@example.com",
          message: { headers: { "message-id": "route-throw-test@mail.example.com" } },
          envelope: { sender: `news@totally-unique-route-test-domain-${Date.now()}.example.test` },
          // Deliberately NO user-variables.tenantId — forces the
          // domain-fallback scan, which is what iterates every active
          // tenant (including the bad one above) via
          // findTenantIdBySendingDomain.
        }),
      );
      assert.equal(res5.status, 200, "tenant resolution throwing must still return 200, never 500");
      const body5 = (await res5.json()) as { ok: boolean };
      assert.equal(body5.ok, true);
      console.log("api/mailgun/webhook/route.test.ts: FIX 1 regression (5) passed — 200, not 500");
    } finally {
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(badTenant.id);
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", badSlug), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  } finally {
    if (originalKey === undefined) delete process.env.MAILGUN_WEBHOOK_SIGNING_KEY;
    else process.env.MAILGUN_WEBHOOK_SIGNING_KEY = originalKey;
  }

  console.log("api/mailgun/webhook/route.test.ts: all assertions passed");
})();
