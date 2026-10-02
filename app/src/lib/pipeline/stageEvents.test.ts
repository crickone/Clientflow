// Run: npm test -- src/lib/pipeline/stageEvents.test.ts
//
// Lead stage history recorder against a real scratch tenant DB.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in stageEvents.test.ts");
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

  const slug = "stage-events-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Stage Events Test", dbFile) as { id: number };
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
    runWithTenant(tid, () => {
      const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
      const { setStageToId, writeStageId } = requireLocal("./stage") as typeof import("./stage");
      const { listStages, deleteStageWithMove } = requireLocal("./stageRepo") as typeof import("./stageRepo");
      const { recordStageEvent } = requireLocal("./stageEvents") as typeof import("./stageEvents");
      const events = () =>
        getTenantDbById(tid).select().from(schema.leadStageEvents).orderBy(schema.leadStageEvents.id).all();

      // 1. creating a lead records entry into its first stage, from nothing.
      const { lead } = upsertLead({ source: "manual", firstName: "Ada", email: "ada@example.com", actor: "user" });
      let ev = events();
      assert.equal(ev.length, 1);
      assert.equal(ev[0].leadId, lead.id);
      assert.equal(ev[0].fromStageId, null);
      assert.equal(ev[0].toStageId, lead.stageId);
      assert.equal(ev[0].actor, "user");

      // 2. a manual move records from -> to with the actor passed.
      const stages = listStages(lead.pipelineId);
      const target = stages.find((s) => s.id !== lead.stageId)!;
      setStageToId(lead.id, target.id, "agent");
      ev = events();
      assert.equal(ev.length, 2);
      assert.equal(ev[1].fromStageId, lead.stageId);
      assert.equal(ev[1].toStageId, target.id);
      assert.equal(ev[1].actor, "agent");

      // 3. writing the same stage again records nothing.
      writeStageId(lead.id, target.id, "same", "system");
      assert.equal(events().length, 2);

      // 4. recordStageEvent never throws, even on a broken connection argument.
      assert.doesNotThrow(() =>
        recordStageEvent(null as never, { leadId: 1, pipelineId: 1, fromStageId: 1, toStageId: 2, actor: "system" }),
      );

      // 5. deleting a stage records a move for every lead on it.
      const other = stages.find((s) => s.id !== target.id && s.id !== lead.stageId)!;
      deleteStageWithMove(target.id, other.id);
      ev = events();
      assert.equal(ev.length, 3);
      assert.equal(ev[2].fromStageId, target.id);
      assert.equal(ev[2].toStageId, other.id);
      assert.equal(ev[2].actor, "user");
    });
    console.log("stageEvents.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
