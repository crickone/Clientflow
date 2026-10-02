// Run: npm test -- src/lib/dashboard/data/salesQueries.test.ts
//
// Smoke test: every salesQueries loader once against a scratch tenant
// with a little seeded data. Shape plus at least one non-trivial value each.
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
  const q = requireLocal("./salesQueries") as typeof import("./salesQueries");

  const slug = "dashboard-sales-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Sales Test", `tenants/${slug}/${slug}.db`) as { id: number };
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
  const H = 3_600_000;
  const at = (ms: number) => new Date(ms);

  try {
    await runWithTenant(t.id, async () => {
      const stages = q.allStages();
      const pid = stages[0]?.pipelineId ?? 1;
      const byRole = (r: string) => stages.find((s) => s.role === r && s.pipelineId === pid);
      let sNew = byRole("new");
      if (!sNew) {
        // Scratch tenants may not seed stages: create the few we need.
        const mk = (name: string, position: number, role: string | null) =>
          db.insert(schema.pipelineStages).values({ pipelineId: pid, name, colour: "#000", position, role }).returning().get();
        mk("New", 1, "new");
        mk("Engaged", 2, "engaged");
        mk("No-show", 3, "no_show");
        mk("Won", 4, "won");
        mk("Lost", 5, "lost");
        mk("Lapsed", 6, "lapsed");
        sNew = byRole("new");
      }
      const st = q.allStages();
      const role = (r: string) => st.find((s) => s.role === r)!;
      const sEngaged = role("engaged");
      const sWon = role("won");
      const sLost = role("lost");
      const sNoShow = role("no_show");

      const mkLead = (o: { first: string; stageId: number | null; createdMs: number; updatedMs?: number }) =>
        db.insert(schema.leads).values({
          firstName: o.first, source: "form", campaign: "Spring",
          stageId: o.stageId, pipelineId: pid,
          createdAt: at(o.createdMs), updatedAt: at(o.updatedMs ?? o.createdMs),
        } as never).returning().get();

      // Waiting 3h, no reply: breaches. Waiting 3h but replied: no. Waiting 10 min: no. Draft reply only: breaches.
      const breach = mkLead({ first: "Breach", stageId: sNew!.id, createdMs: now - 3 * H });
      const replied = mkLead({ first: "Replied", stageId: sNew!.id, createdMs: now - 3 * H });
      const fresh = mkLead({ first: "Fresh", stageId: sNew!.id, createdMs: now - H / 6 });
      const draftOnly = mkLead({ first: "Draft", stageId: null, createdMs: now - 3 * H });
      const engaged = mkLead({ first: "Engaged", stageId: sEngaged.id, createdMs: now - 3 * H });
      const won = mkLead({ first: "Won", stageId: sWon.id, createdMs: now - 2 * DAY, updatedMs: now - 20 * DAY });
      const stale = mkLead({ first: "Stale", stageId: sEngaged.id, createdMs: now - 30 * DAY, updatedMs: now - 20 * DAY });
      const lost = mkLead({ first: "Lost", stageId: sLost.id, createdMs: now - 2 * DAY, updatedMs: now - 20 * DAY });
      const lapsed = mkLead({ first: "Lapsed", stageId: role("lapsed")?.id ?? sLost.id, createdMs: now - 2 * DAY, updatedMs: now - 20 * DAY });

      db.insert(schema.leadMessages).values([
        { leadId: replied.id, direction: "outbound", channel: "sms", content: "hi", sentAt: at(now - 2 * H) },
        { leadId: draftOnly.id, direction: "outbound", channel: "sms", content: "draft" },
      ]).run();

      const ev = (leadId: number, fromStageId: number | null, toStageId: number, atMs: number) =>
        ({ leadId, pipelineId: pid, fromStageId, toStageId, actor: "user" as const, at: at(atMs) });
      db.insert(schema.leadStageEvents).values([
        ev(won.id, null, sNew!.id, now - 2 * DAY),
        ev(won.id, sNew!.id, sWon.id, now - DAY),
        ev(engaged.id, sNew!.id, sEngaged.id, now - DAY),
        ev(engaged.id, sEngaged.id, sNoShow.id, now - DAY + H),
        ev(lost.id, sNew!.id, sLost.id, now - DAY),
      ]).run();

      assert.equal(q.slaBreachCount(now), 2, "breach + draft-only; replied, fresh and non-entry stages excluded");

      assert.equal(q.countLeadsIn(from, to), 8);
      const created = q.leadsCreatedIn(from, to);
      assert.equal(created.length, 8, "stale lead was created 30 days ago");
      assert.deepEqual(q.conversionIn(from, to), { won: 1, total: 8 });
      assert.equal(q.wonLeadsIn(from, to), 1);

      const op = q.openPipelineCount();
      assert.equal(op.open, 6, "everything except won, lost, lapsed");
      assert.ok(op.pipelines >= 1);

      const funnel = q.funnelSteps(from, to);
      assert.ok(funnel.length > 0);
      assert.ok(funnel.every((f) => typeof f.label === "string" && typeof f.value === "number"));
      assert.ok(!funnel.some((f) => f.label === sNoShow.name), "no_show is a side branch, not a funnel step");
      assert.ok(!funnel.some((f) => f.label === sLost.name));
      assert.equal(funnel.find((f) => f.label === sEngaged.name)!.value, 1);

      const dist = q.stageDistribution();
      assert.equal(dist.reduce((s, r) => s + r.value, 0), 8, "the stageless lead is not in any stage bar");

      const tis = q.avgTimeInStageDays(from, to);
      assert.ok(Array.isArray(tis));
      assert.ok(tis.every((r) => r.stays > 0 && typeof r.value === "number"));

      const med = q.medianLeadToWonDays(from, to);
      assert.ok(med === null || med >= 0);

      const wl = q.wonLostSeries(from, to);
      assert.ok(wl.length > 0);
      assert.equal(wl.reduce((s, r) => s + Number(r.Won), 0), 1);
      assert.equal(wl.reduce((s, r) => s + Number(r.Lost), 0), 1);

      const stl = q.staleLeads(now, 10);
      assert.deepEqual(stl.map((l) => l.firstName), ["Stale"], "open leads only: won, lost and lapsed excluded");
      void lapsed;
    });
    console.log("salesQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
