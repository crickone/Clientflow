// Run: npm test -- src/lib/pipeline/hotLead.test.ts
//
// A lead moves to Hot lead on its own when it replies or its score reaches 70,
// forward only, and the card keeps the reason. Real scratch tenant DB.
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
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in hotLead.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");

  const slug = "hot-lead-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Hot Lead Test", dbFile) as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    const { hotReasonFromScore, HOT_SCORE } = requireLocal("./stage") as typeof import("./stage");
    assert.equal(HOT_SCORE, 70);
    assert.equal(hotReasonFromScore(69, "book"), null);
    assert.equal(hotReasonFromScore(70, "book"), "asked to book");
    assert.equal(hotReasonFromScore(85, "call"), "keen to talk");
    assert.equal(hotReasonFromScore(90, "nurture"), "showing intent");
    assert.equal(hotReasonFromScore(90, null), "showing intent");

    runWithTenant(tid, () => {
      const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
      const { onLeadScored, onInboundFromLead, setStageToId } = requireLocal("./stage") as typeof import("./stage");
      const { listStages } = requireLocal("./stageRepo") as typeof import("./stageRepo");
      const db = getTenantDbById(tid);
      const row = (id: number) => db.select().from(schema.leads).where(eq(schema.leads.id, id)).get()!;

      const { lead } = upsertLead({ source: "manual", firstName: "Ada", email: "ada@example.com", actor: "user" });
      const stages = listStages(lead.pipelineId);
      const hot = stages.find((s) => s.role === "engaged")!;
      const booked = stages.find((s) => s.role === "booked")!;
      assert.ok(hot && booked, "default pipeline has Hot lead and Booked stages");

      // 1. a warm score leaves the lead where it is.
      onLeadScored(lead.id, 55, "book");
      assert.equal(row(lead.id).stageId, lead.stageId);
      assert.equal(row(lead.id).hotReason, null);

      // 2. a hot score moves it, with the reason kept for the card.
      onLeadScored(lead.id, 82, "book");
      assert.equal(row(lead.id).stageId, hot.id);
      assert.equal(row(lead.id).hotReason, "asked to book");

      // 3. a lead further on (Booked) is never pulled back to Hot lead.
      setStageToId(lead.id, booked.id, "user");
      onLeadScored(lead.id, 95, "call");
      assert.equal(row(lead.id).stageId, booked.id);

      // 4. a reply moves a new lead to Hot lead with "replied".
      const { lead: b } = upsertLead({ source: "manual", firstName: "Bea", email: "bea@example.com", actor: "user" });
      onInboundFromLead(b.id);
      assert.equal(row(b.id).stageId, hot.id);
      assert.equal(row(b.id).hotReason, "replied");
    });
    console.log("hotLead.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
