// Run: npm test -- src/lib/pipeline/pipelines.test.ts
//
// One board per campaign. Verifies:
//   - a fresh tenant has the default pipeline (id 1, migration 0005) and its
//     nine seeded stages belong to it;
//   - createPipeline clones the default board's stages onto the new board,
//     with their roles, so the new board has its own entry/won/... stages
//     with DIFFERENT ids;
//   - a lead created for a board lands on that board's entry stage, and one
//     created without a board lands on the default;
//   - role-driven advancement (advanceStage) resolves the role on the LEAD'S
//     board, never the default one;
//   - setStageToId refuses a stage from another board;
//   - listLeadsForBoard is scoped to the board asked for;
//   - creating a campaign (campaigns/store) creates its pipeline.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>`. Same Module._load shim as the other
// tenant-backed tests (react `cache` + next/navigation under the runner's
// --conditions=react-server).
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
    return { redirect: () => { throw new Error("next/navigation.redirect() stub called unexpectedly in pipelines.test.ts"); } };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { listPipelines, createPipeline, defaultPipelineId, pipelineForCampaign, leadPipelineId } =
    requireLocal("./pipelineRepo") as typeof import("./pipelineRepo");
  const { listStages, resolveEntryStageId, resolveStageIdByRole } = requireLocal("./stageRepo") as typeof import("./stageRepo");
  const { advanceStage, currentStageRecord, setStageToId } = requireLocal("./stage") as typeof import("./stage");
  const { upsertLead, listLeadsForBoard } = requireLocal("../leads") as typeof import("../leads");
  const { createCampaign } = requireLocal("../campaigns/store") as typeof import("../campaigns/store");

  const slug = "pipelines-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Pipelines Test", dbFile) as { id: number };
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
    getTenantDbById(tid); // provisions tables + runs migrations (0002 stages, 0005 default pipeline)

    await runWithTenant(tid, async () => {
      // ── the default board ──
      const boards = listPipelines();
      assert.equal(boards.length, 1, "a fresh tenant has exactly one pipeline");
      assert.equal(boards[0].isDefault, true);
      assert.equal(defaultPipelineId(), boards[0].id);
      const defaultStages = listStages();
      assert.equal(defaultStages.length, 9, "the nine seeded stages belong to the default board");
      assert.ok(defaultStages.every((s) => s.pipelineId === boards[0].id));

      // ── a second board, cloned ──
      const summer = createPipeline({ name: "Summer Shape Up", campaignId: 4242 });
      assert.notEqual(summer.id, boards[0].id);
      const summerStages = listStages(summer.id);
      assert.equal(summerStages.length, 9, "the new board gets a copy of every default stage");
      assert.deepEqual(
        summerStages.map((s) => [s.name, s.role]),
        defaultStages.map((s) => [s.name, s.role]),
        "names and roles are cloned in order",
      );
      assert.ok(summerStages.every((s) => !defaultStages.some((d) => d.id === s.id)), "cloned stages have their own ids");
      assert.equal(listStages().length, 9, "the default board is untouched");

      const defaultEntry = resolveEntryStageId();
      const summerEntry = resolveEntryStageId(summer.id);
      assert.ok(defaultEntry && summerEntry && defaultEntry !== summerEntry, "each board has its own entry stage");
      assert.notEqual(resolveStageIdByRole("won"), resolveStageIdByRole("won", summer.id), "each board has its own won stage");

      // ── leads land on the board they were asked for ──
      const onSummer = upsertLead({ source: "landing", firstName: "Aoife", email: "aoife@example.com", pipelineId: summer.id }).lead;
      const onDefault = upsertLead({ source: "manual", firstName: "Brian", email: "brian@example.com" }).lead;
      const onNowhere = upsertLead({ source: "manual", firstName: "Cara", pipelineId: 999_999 }).lead;
      assert.equal(onSummer.pipelineId, summer.id);
      assert.equal(onSummer.stageId, summerEntry, "a campaign lead enters the campaign board's entry stage");
      assert.equal(onDefault.pipelineId, boards[0].id);
      assert.equal(onDefault.stageId, defaultEntry);
      assert.equal(onNowhere.pipelineId, boards[0].id, "an unknown board falls back to the default, never strands the lead");
      assert.equal(leadPipelineId(onSummer.id), summer.id);

      // ── advancement follows the lead's own board ──
      advanceStage(onSummer.id, "engaged");
      const after = currentStageRecord(onSummer.id);
      assert.ok(after && after.role === "engaged", "the lead advanced to the engaged stage");
      assert.equal(after!.pipelineId, summer.id, "...on ITS board, not the default one");
      assert.equal(after!.id, resolveStageIdByRole("engaged", summer.id));

      // ── a stage from another board is refused ──
      setStageToId(onSummer.id, resolveStageIdByRole("booked")!); // the DEFAULT board's booked stage
      assert.equal(currentStageRecord(onSummer.id)!.role, "engaged", "a foreign stage id does not move the lead");
      setStageToId(onSummer.id, resolveStageIdByRole("booked", summer.id)!);
      assert.equal(currentStageRecord(onSummer.id)!.role, "booked", "the same role on its own board does");

      // ── the board view is scoped ──
      const summerBoard = listLeadsForBoard(summer.id);
      assert.deepEqual(summerBoard.map((l) => l.id), [onSummer.id], "the campaign board shows only its own leads");
      const mainBoard = listLeadsForBoard(boards[0].id);
      assert.deepEqual(mainBoard.map((l) => l.id).sort(), [onDefault.id, onNowhere.id].sort());
      assert.equal(listLeadsForBoard().length, 3, "no board given = every lead");

      // ── a campaign brings its board with it ──
      const campaign = createCampaign({ name: "Autumn Reset", slug: "autumn-reset", offer: "x", skipCalendarNote: true });
      const board = pipelineForCampaign(campaign.id);
      assert.ok(board, "create_campaign made a pipeline for the campaign");
      assert.equal(board!.name, "Autumn Reset");
      assert.equal(listStages(board!.id).length, 9);
      assert.equal(listPipelines().length, 3);
    });

    console.log("pipelines.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
