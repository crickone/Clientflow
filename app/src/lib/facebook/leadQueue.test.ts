// Run: npm test -- src/lib/facebook/leadQueue.test.ts
//
// Meta sends a lead-ad notification once and never again. The webhook used to
// fetch the lead on the spot and only LOG a failure, so a lead that arrived
// while Facebook refused the Page's token was lost for good, and nothing on
// screen said the connection had stopped working. This replays that:
//
//   1. Facebook refuses the token: the lead is KEPT (pending, retried later),
//      the Page is marked for reconnect, the business is alerted once.
//   2. Reconnecting clears the mark and brings the waiting lead in.
//   3. A repeat notification is a no-op; the lead exists once.
//   4. A lead still failing after 7 days is marked failed, not dropped.
//   5. The retry timing, and which Meta errors count as a refused connection.
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
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const pages = requireLocal("./pages") as typeof import("./pages");
  const queue = requireLocal("./leadQueue") as typeof import("./leadQueue");
  const health = requireLocal("./health") as typeof import("./health");
  const model = requireLocal("./leadQueueModel") as typeof import("./leadQueueModel");
  const graph = requireLocal("./graph") as typeof import("./graph");

  // ── 5. pure rules first ──
  const MIN = 60_000;
  assert.equal(model.retryDelayMs(1), 1 * MIN, "first retry after a minute");
  assert.equal(model.retryDelayMs(7), 60 * MIN, "then hourly");
  assert.equal(model.retryDelayMs(40), 60 * MIN, "and stays hourly");
  assert.equal(model.isExpired(0, model.GIVE_UP_AFTER_MS - 1), false);
  assert.equal(model.isExpired(0, model.GIVE_UP_AFTER_MS), true);
  assert.equal(graph.isConnectionRefused(new graph.MetaApiError("x", 190, 460, 400)), true, "invalid token");
  assert.equal(graph.isConnectionRefused(new graph.MetaApiError("x", 200, null, 403)), true, "permission withdrawn");
  assert.equal(graph.isConnectionRefused(new graph.MetaApiError("x", 4, null, 400)), false, "a rate limit is not a refusal");
  assert.equal(graph.isConnectionRefused(new Error("network")), false, "nor is a network error");

  // ── scratch business with a real tenant database ──
  const slug = "lead-queue-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Lead Queue Test", dbFile) as { id: number }).id;
  const PAGE = "lq-page";
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM meta_lead_queue WHERE page_id = ?").run(PAGE);
    controlSqlite.prepare("DELETE FROM facebook_pages WHERE page_id = ?").run(PAGE);
    controlSqlite.prepare("DELETE FROM tenant_alerts WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  // Facebook, faked: refuses the token until `refusing` is turned off.
  let refusing = true;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/subscribed_apps")) return new Response('{"success":true}', { status: 200 });
    if (refusing) {
      return new Response(JSON.stringify({ error: { message: "Error validating access token: the user has not authorized application.", code: 190, error_subcode: 458 } }), { status: 400 });
    }
    const id = url.match(/v\d+\.\d+\/([^?]+)/)?.[1] ?? "x";
    return new Response(
      JSON.stringify({ id, created_time: "2026-11-11T10:00:00+0000", field_data: [{ name: "full_name", values: ["Jo Test"] }, { name: "email", values: [`${id}@example.com`] }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  const row = (leadgenId: string) =>
    controlSqlite.prepare("SELECT status, attempts, next_attempt_at, tenant_id FROM meta_lead_queue WHERE leadgen_id = ?").get(leadgenId) as
      | { status: string; attempts: number; next_attempt_at: number; tenant_id: number | null }
      | undefined;
  const leadsFor = (leadgenId: string) =>
    getTenantDbById(tid).select().from(schema.leads).where(eq(schema.leads.sourceLeadId, leadgenId)).all();

  try {
    controlSqlite
      .prepare("INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token) VALUES (?, ?, ?, ?)")
      .run(tid, PAGE, "Test Clinic", pages.sealPageToken("EAAtoklq00000000000000000000000000"));

    // ── 1. Facebook refuses: the lead is kept, the Page is flagged ──
    const t0 = Date.now();
    queue.enqueueLead("lq-1", PAGE, t0);
    assert.equal(await queue.processDueLeads({ leadgenIds: ["lq-1"], now: t0 }), 0);
    assert.equal(row("lq-1")?.status, "pending", "the lead is kept, not dropped");
    assert.equal(row("lq-1")?.attempts, 1);
    assert.equal(row("lq-1")?.tenant_id, tid);
    assert.ok((row("lq-1")?.next_attempt_at ?? 0) >= t0 + MIN, "retried in a minute");
    assert.equal(health.connectionProblems(tid).length, 1, "the Page is marked for reconnect");
    assert.ok(
      controlSqlite.prepare("SELECT 1 FROM tenant_alerts WHERE tenant_id = ? AND key = ?").get(tid, `fb-page-refused:${PAGE}`),
      "the admins are alerted (once: the slot is claimed)",
    );
    assert.equal(await queue.processDueLeads({ now: t0 + 1000 }), 0, "not retried before it is due");
    assert.equal(row("lq-1")?.attempts, 1);
    assert.deepEqual(queue.stuckLeadCounts(tid), { waiting: 1, failed: 0 });

    // ── 2. Reconnecting clears the mark and brings the lead in ──
    refusing = false;
    assert.equal(await pages.claimPage(tid, { id: PAGE, name: "Test Clinic", access_token: "EAAtoklq11111111111111111111111111" }, 1), "connected");
    assert.equal(health.connectionProblems(tid).length, 0, "a reconnect clears the mark");
    assert.ok((row("lq-1")?.next_attempt_at ?? Infinity) <= Date.now(), "the waiting lead is due at once");
    assert.equal(await queue.processDueLeads(), 1);
    assert.equal(row("lq-1")?.status, "done");
    assert.equal(leadsFor("lq-1").length, 1, "the lead reached the business");
    assert.deepEqual(queue.stuckLeadCounts(tid), { waiting: 0, failed: 0 });

    // ── 3. Meta repeats itself: nothing new ──
    queue.enqueueLead("lq-1", PAGE);
    assert.equal(await queue.processDueLeads({ leadgenIds: ["lq-1"] }), 0);
    assert.equal(leadsFor("lq-1").length, 1, "still one lead");

    // ── 4. Seven days of failure: marked failed, not dropped ──
    refusing = true;
    const old = Date.now() - model.GIVE_UP_AFTER_MS - 1;
    queue.enqueueLead("lq-2", PAGE, old);
    await queue.processDueLeads({ leadgenIds: ["lq-2"] });
    assert.equal(row("lq-2")?.status, "failed");
    assert.deepEqual(queue.stuckLeadCounts(tid), { waiting: 0, failed: 1 });

    console.log("leadQueue: leads survive a refused token, reconnect brings them in, 7-day give-up; 27 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
