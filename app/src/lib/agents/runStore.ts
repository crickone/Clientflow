import "server-only";

import crypto from "node:crypto";
import { desc, eq, lt } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { agentRuns, type AgentRun } from "@/lib/db/schema";
import type { PendingWrite } from "@/lib/agents/runAgentTurn";
import type { ToolArtifact } from "@/lib/assistant/tools";

/**
 * Durable run store (DR1) — tenant-scoped persistence for an agent run on the
 * specialist chat route (`/api/agents/[key]/chat`, the same loop the
 * dashboard Orchestrator and every specialist use). The route already runs
 * `runAgentTurn` inside a detached `void runWithTenant(async () => {…})` IIFE
 * that keeps executing after the SSE Response has returned (Railway runs this
 * app as a persistent `next start` Node process, not serverless) — the ONLY
 * thing that used to kill that work early was aborting on `req.signal`. This
 * store is what makes the now-uninterrupted run *recoverable*: the route
 * writes progress here as it streams and the terminal outcome once the loop
 * ends, so a client that disconnected (refresh/navigate/close) can, in a
 * follow-up task (DR2), reconnect and pick the run back up instead of losing
 * it. See `.superpowers/sdd/durableruns-design.md`.
 *
 * Every function takes an explicit `tenantId` and resolves the DB via
 * `getTenantDbById` — never the ambient request-scoped `db` proxy — because
 * the run this store manages is itself accessed from BOTH request scope
 * (creating it) and the detached post-response IIFE (persisting to it), the
 * same reason the route already binds the whole loop with `runWithTenant`.
 */

export type RunStatus = "running" | "awaiting_approval" | "done" | "error";

/** A run row with its JSON columns parsed back into real arrays. */
export interface RunRecord {
  id: string;
  conversationId: string;
  agentKey: string;
  model: string;
  status: RunStatus;
  text: string;
  pending: PendingWrite[] | null;
  artifacts: ToolArtifact[] | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

// A `running` row untouched for this long is almost certainly an orphan —
// the server restarted/redeployed mid-run and nothing ever called
// `finishRun` — not a genuinely slow turn (the 8-turn cap + per-call model
// timeouts keep a live run's updates far more frequent than this).
const STALE_MS = 3 * 60 * 1000;
// `agent_runs` is a rolling log of recent activity, not a permanent record —
// prune anything older than a day so it never grows unbounded.
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

function toRecord(row: AgentRun): RunRecord {
  return {
    id: row.id,
    conversationId: row.conversationId,
    agentKey: row.agentKey,
    model: row.model,
    status: row.status as RunStatus,
    text: row.text,
    pending: row.pending ? (JSON.parse(row.pending) as PendingWrite[]) : null,
    artifacts: row.artifacts ? (JSON.parse(row.artifacts) as ToolArtifact[]) : null,
    error: row.error,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * Stale guard: report (never persist — a concurrent reader must not clobber a
 * run that is actually still alive) a `running` row whose `updatedAt` is
 * older than `STALE_MS` as `error` instead, so a DR2 poller waiting on a
 * terminal status can never hang forever on a run orphaned by a redeploy.
 */
function withStaleGuard(rec: RunRecord): RunRecord {
  if (rec.status === "running" && Date.now() - rec.updatedAt > STALE_MS) {
    return { ...rec, status: "error", error: "Run interrupted (server restarted)." };
  }
  return rec;
}

/**
 * Start a new run row (`status: 'running'`, empty text) and return its id.
 * Opportunistically prunes this tenant's old runs first — see `pruneRuns`;
 * cheap, and means no separate cron is needed to keep the table bounded.
 */
export function createRun(
  tenantId: number,
  args: { conversationId: string; agentKey: string; model: string },
): string {
  pruneRuns(tenantId);
  const id = crypto.randomUUID();
  getTenantDbById(tenantId)
    .insert(agentRuns)
    .values({
      id,
      conversationId: args.conversationId,
      agentKey: args.agentKey,
      model: args.model,
    })
    .run();
  return id;
}

/**
 * Persist the accumulated text of an in-flight run. This function itself
 * writes unconditionally on every call — THROTTLING (at most ~every 750ms,
 * plus on every tool boundary) is the caller's responsibility (the chat
 * route's `onText`/`onTool`), so a fast-streaming turn doesn't hit the DB
 * once per token.
 */
export function updateRunText(tenantId: number, runId: string, text: string): void {
  getTenantDbById(tenantId)
    .update(agentRuns)
    .set({ text, updatedAt: new Date() })
    .where(eq(agentRuns.id, runId))
    .run();
}

/**
 * Write the terminal (or awaiting-approval) outcome of a run. `text` is
 * optional: the error paths (a caught exception mid-loop, or an `AiCapError`
 * before any text ever streamed) call this WITHOUT it, deliberately leaving
 * whatever `updateRunText` last persisted in place rather than blanking a
 * partial answer just because the turn ended in error. `pending`/`artifacts`
 * are JSON-stringified when non-empty, else stored as SQL NULL.
 */
export function finishRun(
  tenantId: number,
  runId: string,
  args: {
    status: RunStatus;
    text?: string;
    pending?: PendingWrite[];
    artifacts?: ToolArtifact[];
    error?: string;
  },
): void {
  getTenantDbById(tenantId)
    .update(agentRuns)
    .set({
      status: args.status,
      ...(args.text !== undefined ? { text: args.text } : {}),
      pending: args.pending?.length ? JSON.stringify(args.pending) : null,
      artifacts: args.artifacts?.length ? JSON.stringify(args.artifacts) : null,
      error: args.error ?? null,
      updatedAt: new Date(),
    })
    .where(eq(agentRuns.id, runId))
    .run();
}

/** Fetch one run, tenant-scoped. See `withStaleGuard` for the orphan check. */
export function getRun(tenantId: number, runId: string): RunRecord | undefined {
  const row = getTenantDbById(tenantId).select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
  return row ? withStaleGuard(toRecord(row)) : undefined;
}

/**
 * Most recent run for a conversation — DR2 uses this on reload to find an
 * in-flight (or just-finished) run to resume/render. Same stale guard as
 * `getRun`.
 */
export function getLatestRun(tenantId: number, conversationId: string): RunRecord | undefined {
  const row = getTenantDbById(tenantId)
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.conversationId, conversationId))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1)
    .get();
  return row ? withStaleGuard(toRecord(row)) : undefined;
}

/** Delete this tenant's runs older than 24h. Called opportunistically from `createRun`. */
export function pruneRuns(tenantId: number): void {
  const cutoff = new Date(Date.now() - PRUNE_AGE_MS);
  getTenantDbById(tenantId).delete(agentRuns).where(lt(agentRuns.createdAt, cutoff)).run();
}
