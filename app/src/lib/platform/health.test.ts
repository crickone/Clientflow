// Run: npm test -- src/lib/platform/health.test.ts
//
// Platform Console v2, slice 5 (Health). What has to hold:
//
//   - a healthy, fully-migrated tenant reports no alerts;
//   - a missing migration, a failed queue item and a stuck generation each
//     raise exactly one alert, and the counts behind them are right;
//   - the deep integrity check runs only when asked;
//   - the repairs do what they say: clearing stuck generations marks them
//     failed with the message the editor already shows, and re-queuing a
//     failed item puts it back as queued with its error cleared;
//   - a tenant whose database file is gone does not throw — it reports the
//     problem, because a health page that crashes on the broken tenant is
//     the one case it exists for.
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
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in health.test.ts"); } };
  }
  if (request === "next/headers") {
    return { cookies: () => { throw new Error("no request scope"); }, headers: () => { throw new Error("no request scope"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const health = requireLocal("./health") as typeof import("./health");

  const slug = "health-test";
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Health Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;
  // A tenant whose registry row points at a file that does not exist.
  const brokenTid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 0) RETURNING id")
      .get(`${slug}-gone`, "Health Gone", `tenants/${slug}-gone/nope.db`) as { id: number }
  ).id;

  const cleanup = () => {
    for (const t of [tid, brokenTid]) controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // Provisioning opens the database and runs every migration.
    const tdb = getTenantDbById(tid);
    const raw = (tdb as unknown as { $client: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: () => unknown } } }).$client;

    // ── a fresh, fully-migrated tenant is healthy ────────────────────────
    let h = health.getTenantHealth(tid, { deep: true });
    assert.equal(h.dbExists, true);
    assert.ok(h.dbBytes > 0, "the database file has a size");
    assert.equal(h.integrity, "ok", "the deep check runs when asked");
    assert.equal(h.migrations.applied, h.migrations.expected, "every migration has run on a fresh tenant");
    assert.deepEqual(h.migrations.missing, []);
    assert.equal(h.stuckGenerations, 0);
    assert.deepEqual(h.alerts, [], "a fresh tenant raises no alerts");
    assert.ok(h.queues.some((q) => q.key === "nurture"), "the nurture queue is reported");
    assert.ok(h.queues.some((q) => q.key === "posts"), "the post queue is reported");
    assert.ok(h.schedulers.length >= 3, "the background jobs are reported");

    // The shallow read skips the integrity check.
    assert.equal(health.getTenantHealth(tid).integrity, "unknown", "the integrity check is opt-in");

    // ── a failed nurture message raises exactly one alert ────────────────
    raw
      .prepare(
        "INSERT INTO automation_queue (trigger_key, lead_id, channel, subject, body, send_to, due_at, status, error) VALUES ('campaign_signup', 1, 'email', 's', 'b', 'x@test.local', ?, 'failed', 'no provider')",
      )
      .run(Date.now() - 1000);
    raw
      .prepare(
        "INSERT INTO automation_queue (trigger_key, lead_id, channel, subject, body, send_to, due_at, status) VALUES ('campaign_signup', 1, 'email', 's', 'b', 'x@test.local', ?, 'queued')",
      )
      .run(Date.now() - 1000);
    raw
      .prepare(
        "INSERT INTO automation_queue (trigger_key, lead_id, channel, subject, body, send_to, due_at, status) VALUES ('campaign_signup', 1, 'email', 's', 'b', 'x@test.local', ?, 'queued')",
      )
      .run(Date.now() + 86_400_000);

    h = health.getTenantHealth(tid);
    const nurture = h.queues.find((q) => q.key === "nurture")!;
    assert.equal(nurture.failed, 1);
    assert.equal(nurture.due, 1, "a queued message past its time is due");
    assert.equal(nurture.waiting, 1, "one queued for tomorrow is waiting, not due");
    assert.equal(h.alerts.filter((a) => a.message.includes("nurture")).length, 1, "one alert for the failed message");

    // ── a stuck generation ───────────────────────────────────────────────
    raw
      .prepare("INSERT INTO carousel_sets (name, generation_status, generation_started_at) VALUES ('Stuck', 'writing', ?)")
      .run(Date.now() - 60 * 60 * 1000);
    raw
      .prepare("INSERT INTO carousel_sets (name, generation_status, generation_started_at) VALUES ('Running', 'writing', ?)")
      .run(Date.now());

    h = health.getTenantHealth(tid);
    assert.equal(h.stuckGenerations, 1, "only the long-dead run counts as stuck; one started now is still running");
    assert.ok(h.alerts.some((a) => a.message.includes("stuck")), "a stuck generation raises an alert");

    // ── the repairs ──────────────────────────────────────────────────────
    const cleared = health.clearStuckGenerations(tid);
    assert.ok(cleared.ok, "clearing works");
    assert.match(cleared.ok ? cleared.note : "", /Cleared 1/);
    const stuckRow = raw.prepare("SELECT generation_status AS s, generation_error AS e FROM carousel_sets WHERE name = 'Stuck'") as unknown as {
      get: () => { s: string; e: string };
    };
    const after = stuckRow.get();
    assert.equal(after.s, "failed", "a cleared design reads as failed, which is what the editor shows");
    assert.match(after.e, /restarted/i, "…with the message the editor already uses");
    const runningRow = raw.prepare("SELECT generation_status AS s FROM carousel_sets WHERE name = 'Running'") as unknown as {
      get: () => { s: string };
    };
    assert.equal(runningRow.get().s, "writing", "a live run is untouched");
    assert.equal(health.getTenantHealth(tid).stuckGenerations, 0);
    assert.match(health.clearStuckGenerations(tid).ok ? "Nothing was stuck." : "", /Nothing/, "clearing twice is a no-op, not an error");

    const requeued = health.retryFailedQueue(tid, "nurture");
    assert.ok(requeued.ok, "re-queuing works");
    assert.match(requeued.ok ? requeued.note : "", /Re-queued 1/);
    h = health.getTenantHealth(tid);
    assert.equal(h.queues.find((q) => q.key === "nurture")!.failed, 0, "nothing is failed any more");
    assert.equal(h.queues.find((q) => q.key === "nurture")!.due, 2, "the re-queued message is due again");

    // ── a broken tenant reports, rather than throws ──────────────────────
    const broken = health.getTenantHealth(brokenTid, { deep: true });
    assert.equal(broken.dbExists, false);
    assert.ok(broken.alerts.some((a) => a.level === "bad" && /missing/i.test(a.message)), "the missing file is reported as bad");

    // ── the fleet view covers active tenants and never throws ────────────
    const fleet = health.getFleetHealth();
    assert.ok(fleet.tenants.some((t) => t.tenantId === tid), "the active tenant is in the fleet view");
    assert.equal(fleet.tenants.some((t) => t.tenantId === brokenTid), false, "an inactive tenant is left out");
    assert.ok(fleet.schedulers.length >= 3);

    console.log("health.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
