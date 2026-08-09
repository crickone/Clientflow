// Run: npm test -- src/lib/agents/runStore.test.ts
//
// DR1 (durable runs): runStore.ts is the tenant-scoped persistence layer a
// run on the specialist chat route (/api/agents/[key]/chat) writes to as it
// streams and once it finishes, so the run survives a client disconnect and
// (DR2) can later be resumed. This test proves the store's contract in
// isolation — no HTTP, no model calls (the disconnect-survival behaviour
// itself is integration-level, relying on Railway running this app as a
// persistent Node process rather than anything unit-testable here; see the
// task report):
//   1. createRun -> getRun round-trips a fresh row (status 'running', empty
//      text, the given conversationId/agentKey/model, pending/artifacts/error
//      all null).
//   2. updateRunText persists the accumulated text of an in-flight run
//      without changing its status.
//   3. finishRun sets the terminal status + text, and JSON round-trips
//      pending/artifacts through getRun — proven both with non-empty arrays
//      (awaiting_approval) AND with empty arrays (done, which must come back
//      as `null`, not `[]` — see the doc comment on finishRun) — and an
//      error finish WITHOUT a `text` override leaves the last-persisted text
//      alone rather than blanking a partial answer.
//   4. getLatestRun returns the most-recently-created run for a conversation
//      and ignores runs under other conversationIds.
//   5. pruneRuns (called opportunistically by createRun) deletes runs older
//      than 24h, both when called directly and via that opportunistic call.
//   6. Stale guard: a 'running' row whose updated_at is forced >3 minutes
//      into the past is reported by getRun AND getLatestRun as 'error' —
//      WITHOUT mutating the underlying row (a concurrent genuinely-alive run
//      must never be clobbered by a reader).
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// exact pattern of src/lib/db/agentsTable.test.ts / src/lib/agents/registry.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// runStore.ts -> @/lib/db/tenant, which imports React's server-only `cache`
// at module load (a top-level `export const getCurrentTenant = cache(...)`).
// Under the runner's `--conditions=react-server`, npm's react "react-server"
// entry point is a stub that THROWS on load (same issue + fix as
// db/agentsTable.test.ts and agents/registry.test.ts). Shim `react` with an
// identity `cache` BEFORE tenant.ts (transitively, via runStore.ts) is
// required, so the real code path loads unchanged. Installed via a dynamic
// require (below) rather than a static import, since a static `import ...
// from "./runStore"` would be hoisted and evaluated before this shim runs.
// (runStore.ts's `PendingWrite`/`ToolArtifact` imports are `import type`
// only, so they're erased entirely — this file never needs to shim anything
// from the runAgentTurn/assistant-tools import chains.)
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as registry.test.ts).
(async () => {
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { agentRuns } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const { createRun, updateRunText, finishRun, getRun, getLatestRun, pruneRuns } =
    requireLocal("./runStore") as typeof import("./runStore");

  // ── scratch tenant (control row + a real tenant DB file, so
  // getTenantDbById() resolves it and openTenantDb() runs ensureTenantTables,
  // giving us a real `agent_runs` table to exercise — not a hardcoded,
  // never-provisioned id) ──
  const slug = "agents-run-store-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents RunStore Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), {
        recursive: true,
        force: true,
      });
    } catch {
      // best effort
    }
  };

  try {
    const db = getTenantDbById(tid);

    // ════════════════════════════════════════════════════════════════════
    // 1. createRun -> getRun round-trips a fresh row
    // ════════════════════════════════════════════════════════════════════
    const runId = createRun(tid, { conversationId: "convo-1", agentKey: "sales", model: "claude-sonnet-5" });
    assert.equal(typeof runId, "string", "createRun returns a string id");
    assert.ok(runId.length > 0, "createRun's id is non-empty");

    const fresh = getRun(tid, runId);
    assert.ok(fresh, "getRun finds the just-created row");
    assert.equal(fresh!.status, "running", "a fresh run starts 'running'");
    assert.equal(fresh!.text, "", "a fresh run has empty text");
    assert.equal(fresh!.conversationId, "convo-1");
    assert.equal(fresh!.agentKey, "sales");
    assert.equal(fresh!.model, "claude-sonnet-5");
    assert.equal(fresh!.pending, null, "no pending writes yet");
    assert.equal(fresh!.artifacts, null, "no artifacts yet");
    assert.equal(fresh!.error, null, "no error yet");
    assert.equal(typeof fresh!.createdAt, "number", "createdAt is a numeric ms epoch");
    assert.equal(typeof fresh!.updatedAt, "number", "updatedAt is a numeric ms epoch");

    // ════════════════════════════════════════════════════════════════════
    // 2. updateRunText persists interim text without changing status
    // ════════════════════════════════════════════════════════════════════
    updateRunText(tid, runId, "Here's what I found so far...");
    const midStream = getRun(tid, runId);
    assert.equal(midStream!.text, "Here's what I found so far...", "updateRunText persists the accumulated text");
    assert.equal(midStream!.status, "running", "updateRunText does not change status");

    // ════════════════════════════════════════════════════════════════════
    // 3a. finishRun('awaiting_approval') JSON round-trips pending + artifacts
    // ════════════════════════════════════════════════════════════════════
    const pending = [{ name: "send_client_email", input: { clientId: 1, subject: "Hi" }, summary: "Email client #1" }];
    const artifacts = [{ url: "/dl/abc", filename: "invoices.zip", label: "Invoices" }];
    finishRun(tid, runId, {
      status: "awaiting_approval",
      text: "I'd like to send this email — approve?",
      pending,
      artifacts,
    });
    const awaiting = getRun(tid, runId);
    assert.equal(awaiting!.status, "awaiting_approval");
    assert.equal(awaiting!.text, "I'd like to send this email — approve?");
    assert.deepEqual(awaiting!.pending, pending, "pending round-trips through JSON exactly");
    assert.deepEqual(awaiting!.artifacts, artifacts, "artifacts round-trips through JSON exactly");
    assert.equal(awaiting!.error, null);

    // ════════════════════════════════════════════════════════════════════
    // 3b. finishRun('done') with EMPTY pending/artifacts arrays stores/
    //     returns null, not "[]" — matches runAgentTurn's contract that both
    //     are always arrays (never undefined), even when nothing was
    //     collected.
    // ════════════════════════════════════════════════════════════════════
    const doneRunId = createRun(tid, { conversationId: "convo-1", agentKey: "sales", model: "claude-sonnet-5" });
    finishRun(tid, doneRunId, { status: "done", text: "All done, nothing to approve.", pending: [], artifacts: [] });
    const done = getRun(tid, doneRunId);
    assert.equal(done!.status, "done");
    assert.equal(done!.text, "All done, nothing to approve.");
    assert.equal(done!.pending, null, "an empty pending array is stored/returned as null, not []");
    assert.equal(done!.artifacts, null, "an empty artifacts array is stored/returned as null, not []");

    // ════════════════════════════════════════════════════════════════════
    // 3c. finishRun('error') WITHOUT a `text` override leaves the
    //     last-persisted text in place (the chat route's catch blocks rely
    //     on this to keep a partial answer visible alongside the error)
    // ════════════════════════════════════════════════════════════════════
    const errRunId = createRun(tid, { conversationId: "convo-1", agentKey: "sales", model: "claude-sonnet-5" });
    updateRunText(tid, errRunId, "Partial answer before it broke...");
    finishRun(tid, errRunId, { status: "error", error: "Assistant error" });
    const errored = getRun(tid, errRunId);
    assert.equal(errored!.status, "error");
    assert.equal(errored!.error, "Assistant error");
    assert.equal(
      errored!.text,
      "Partial answer before it broke...",
      "finishRun without `text` preserves the last updateRunText value",
    );

    // ════════════════════════════════════════════════════════════════════
    // 4. getLatestRun returns the most-recently-created run for a
    //    conversation and ignores other conversations. created_at defaults
    //    to whole-second SQLite `unixepoch()`, so force distinct values
    //    directly (bypassing the public API) rather than racing real time —
    //    but recent-past ones (a few seconds ago), NOT near-epoch: every
    //    createRun below opportunistically calls pruneRuns (>24h cutoff)
    //    FIRST, so an epoch-old fake timestamp on an earlier row would get
    //    deleted by the very next createRun call in this same test.
    // ════════════════════════════════════════════════════════════════════
    const convo2 = "convo-latest-test";
    const now = Date.now();
    const runA = createRun(tid, { conversationId: convo2, agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns).set({ createdAt: new Date(now - 3_000) }).where(eq(agentRuns.id, runA)).run();
    const runB = createRun(tid, { conversationId: convo2, agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns).set({ createdAt: new Date(now - 2_000) }).where(eq(agentRuns.id, runB)).run();
    const runC = createRun(tid, { conversationId: convo2, agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns).set({ createdAt: new Date(now - 1_000) }).where(eq(agentRuns.id, runC)).run();
    // A run under a DIFFERENT conversation, timestamped even later — must
    // never be picked as convo2's latest.
    const otherConvoRun = createRun(tid, { conversationId: "some-other-convo", agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns).set({ createdAt: new Date(now) }).where(eq(agentRuns.id, otherConvoRun)).run();

    const latest = getLatestRun(tid, convo2);
    assert.ok(latest, "getLatestRun finds a row for convo2");
    assert.equal(latest!.id, runC, "getLatestRun returns the row with the greatest created_at for THIS conversation");

    // ════════════════════════════════════════════════════════════════════
    // 5. pruneRuns (called opportunistically inside createRun) deletes runs
    //    older than 24h — exercised both directly and via that opportunistic
    //    call — without touching fresh rows from the tests above.
    // ════════════════════════════════════════════════════════════════════
    const staleRunId = createRun(tid, { conversationId: "convo-prune", agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }) // 25h ago
      .where(eq(agentRuns.id, staleRunId))
      .run();
    assert.ok(getRun(tid, staleRunId), "sanity: the 25h-old row exists before pruning");
    pruneRuns(tid); // exercised directly...
    assert.equal(getRun(tid, staleRunId), undefined, "pruneRuns deletes a run older than 24h");
    assert.ok(getRun(tid, runId), "pruneRuns must not touch a fresh row from an earlier test");

    // ...and opportunistically via createRun, on a second stale row.
    const staleRunId2 = createRun(tid, { conversationId: "convo-prune", agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(agentRuns.id, staleRunId2))
      .run();
    createRun(tid, { conversationId: "convo-prune", agentKey: "sales", model: "claude-sonnet-5" }); // triggers pruneRuns internally
    assert.equal(getRun(tid, staleRunId2), undefined, "createRun's opportunistic pruneRuns call also deletes a stale row");

    // ════════════════════════════════════════════════════════════════════
    // 6. Stale guard: a 'running' row whose updated_at is forced >3 minutes
    //    into the past is reported as 'error' by getRun AND getLatestRun,
    //    WITHOUT mutating the stored row (a concurrent genuinely-alive run
    //    must not be clobbered by a reader).
    // ════════════════════════════════════════════════════════════════════
    const staleRunning = createRun(tid, { conversationId: "convo-stale", agentKey: "sales", model: "claude-sonnet-5" });
    db.update(agentRuns)
      .set({ updatedAt: new Date(Date.now() - 4 * 60 * 1000) }) // 4 minutes ago > the 3-minute guard
      .where(eq(agentRuns.id, staleRunning))
      .run();

    const staleViaGetRun = getRun(tid, staleRunning);
    assert.equal(staleViaGetRun!.status, "error", "getRun reports an orphaned 'running' row as 'error'");
    assert.match(staleViaGetRun!.error ?? "", /interrupted/i, "the stale-guard error explains what happened");

    const staleViaLatest = getLatestRun(tid, "convo-stale");
    assert.equal(staleViaLatest!.status, "error", "getLatestRun applies the same stale guard");

    const rawRow = db.select().from(agentRuns).where(eq(agentRuns.id, staleRunning)).get();
    assert.equal(rawRow?.status, "running", "the stale guard does NOT mutate the stored row — only the returned view");

    console.log("runStore.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
