import "server-only";

import { randomBytes } from "node:crypto";

import { runWithTenant } from "@/lib/db/tenant";

/**
 * Long imports ("Build from this file") run detached on this persistent
 * `next start` process, so no single HTTP request has to outlive a proxy's
 * timeout. The job is bound to its tenant (runWithTenant, the same binding
 * the chat's durable runs use, so getCurrentTenant works inside it) and to
 * the user who started it; only that tenant and user can read it back. Jobs
 * live in memory on globalThis (one store across hot reloads and route
 * bundles) and are dropped 30 minutes after they finish. A restart loses
 * running jobs: the poller then gets "not found" and says so plainly.
 */

export type JobOwner = { tenantId: number; userId: number };
export type JobState<T> = { status: "running" } | { status: "done"; result: T };

type Job = {
  owner: JobOwner;
  startedAt: number;
  finishedAt: number | null;
  result: unknown;
};

/** A finished job is kept this long for its poller. */
export const JOB_TTL_MS = 30 * 60_000;
/** A job still running after this long is treated as lost. */
export const JOB_MAX_RUN_MS = 20 * 60_000;

const STORE_KEY = "__adonisWorkoutImportJobs";
function store(): Map<string, Job> {
  const g = globalThis as unknown as Record<string, Map<string, Job> | undefined>;
  return (g[STORE_KEY] ??= new Map());
}

function prune(now: number) {
  for (const [id, job] of store()) {
    if (job.finishedAt !== null ? now - job.finishedAt > JOB_TTL_MS : now - job.startedAt > JOB_MAX_RUN_MS) store().delete(id);
  }
}

/**
 * Starts `run` detached inside the owner's tenant and returns the job id at
 * once. A throw is turned into a result by `onError`, so a job always ends.
 */
export function startJob<T>(owner: JobOwner, run: () => Promise<T>, onError: (err: unknown) => T): string {
  const now = Date.now();
  prune(now);
  const id = randomBytes(16).toString("hex");
  const job: Job = { owner: { ...owner }, startedAt: now, finishedAt: null, result: undefined };
  store().set(id, job);
  const finish = (result: T) => {
    job.result = result;
    job.finishedAt = Date.now();
  };
  void runWithTenant(owner.tenantId, async () => {
    try {
      finish(await run());
    } catch (err) {
      finish(onError(err));
    }
  });
  return id;
}

/** The job's state, or null when there is no such job for this tenant and user (or it expired). */
export function readJob<T>(id: string, owner: JobOwner): JobState<T> | null {
  prune(Date.now());
  const job = typeof id === "string" ? store().get(id) : undefined;
  if (!job || job.owner.tenantId !== owner.tenantId || job.owner.userId !== owner.userId) return null;
  if (job.finishedAt === null) return { status: "running" };
  return { status: "done", result: job.result as T };
}

/** Tests only: forget every job. */
export function clearJobsForTests() {
  store().clear();
}
