// Run: npm test -- src/lib/leadFlows/activity.test.ts
// The People tab's data, on a scratch business: who entered, how far they got,
// what's next, and one person's steps.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

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
  const { controlSqlite } = requireLocal("../db/control") as typeof import("@/lib/db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("@/lib/db/tenant");
  const s = requireLocal("../db/schema") as typeof import("@/lib/db/schema");
  const { flowActivity, runTimeline } = requireLocal("./activity") as typeof import("./activity");

  const slug = "flow-activity-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Flow Activity Test", `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    const tdb = getTenantDbById(tid);
    const key = `test_flow_${Date.now()}`;
    const now = Date.now();
    const lead = tdb.insert(s.leads).values({ firstName: "Test", lastName: "Lead", source: "facebook", phone: "+353870000000" }).returning().get();
    const active = tdb.insert(s.leadFlowRuns).values({ leadId: lead.id, triggerKey: key, status: "active", startedAt: new Date(now - 3 * 864e5) }).returning().get();
    const stopped = tdb.insert(s.leadFlowRuns).values({ leadId: lead.id, triggerKey: key, status: "stopped", stopReason: "replied", startedAt: new Date(now - 9 * 864e5), endedAt: new Date(now - 8 * 864e5) }).returning().get();
    const q = (runId: number, status: "sent" | "queued" | "failed", dueOffsetDays: number, body: string) =>
      tdb.insert(s.automationQueue).values({ triggerKey: key, leadId: lead.id, runId, kind: "message", channel: "whatsapp", body, status, dueAt: new Date(now + dueOffsetDays * 864e5), sentAt: status === "sent" ? new Date(now + dueOffsetDays * 864e5) : null }).run();
    q(active.id, "sent", -3, "Hi Test, thanks for getting in touch.");
    q(active.id, "sent", -1, "Just checking you saw our message.");
    q(active.id, "queued", 1, "Any questions?");
    q(stopped.id, "sent", -9, "Hi Test.");

    await runWithTenant(tid, async () => {
      const all = flowActivity(key);
      assert.deepEqual(all.counts, { entered: 2, active: 1, finished: 0, stopped: 1, replied: 1 });
      assert.equal(all.rows.length, 2);
      assert.equal(all.rows[0].runId, active.id, "newest first");
      assert.equal(all.rows[0].name, "Test Lead");
      assert.equal(all.rows[0].progress.sent, 2);
      assert.equal(all.rows[0].progress.messages, 3);
      assert.ok(all.rows[0].progress.next && all.rows[0].progress.next.dueAt > now, "next step is the queued one");
      const onlyActive = flowActivity(key, { status: "active" });
      assert.equal(onlyActive.rows.length, 1);
      assert.equal(onlyActive.total, 1);
      const t = runTimeline(key, active.id);
      assert.ok(t && t.steps.length === 3 && t.steps[0].body.startsWith("Hi Test"), "steps in order with their text");
      assert.equal(runTimeline("some_other_flow", active.id), null, "a run is only shown under its own flow");
    });
    console.log("flow activity: 11 checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
