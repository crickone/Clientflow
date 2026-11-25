// Run: npm test -- src/lib/pipeline/followUpColumns.db.test.ts
//
// Against a real scratch tenant: a fresh business gets the five follow-up
// columns with their keys, a new campaign board copies them, and a lead in
// No answer who replies is moved to Hot lead.
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
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { listStages, resolveStageIdByRole } = requireLocal("./stageRepo") as typeof import("./stageRepo");
  const { createPipeline } = requireLocal("./pipelineRepo") as typeof import("./pipelineRepo");
  const stage = requireLocal("./stage") as typeof import("./stage");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const slug = "follow-up-columns-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Follow Up Columns Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
  };

  try {
    await runWithTenant(tid, async () => {
      const cols = listStages();
      assert.equal(cols.length, 14, "nine default columns plus five follow-up columns");
      const keys = cols.filter((c) => c.systemKey).map((c) => c.systemKey);
      assert.deepEqual(keys, ["no_answer", "call_back", "thinking", "nurture", "undelivered"], "in board order, with their keys");
      assert.ok(cols.filter((c) => c.systemKey).every((c) => c.role === null), "follow-up columns have no role");

      const board = createPipeline({ name: "Summer" });
      const copied = listStages(board.id);
      assert.equal(copied.filter((c) => c.systemKey).length, 5, "a new board copies the follow-up columns and their keys");

      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:fu@example.com", fullName: "Follow Up", email: "fu@example.com" });
      const noAnswer = cols.find((c) => c.systemKey === "no_answer")!;
      stage.setStageToId(lead.id, noAnswer.id);
      stage.onInboundFromLead(lead.id);
      assert.equal(getLead(lead.id)!.stageId, resolveStageIdByRole("engaged"), "a reply moves a No answer lead to Hot lead");
    });
    console.log("followUpColumns.db: seeded, cloned, pulled out on reply; 5 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
