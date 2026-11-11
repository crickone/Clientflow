import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * One row per background job run. Wrap a job in `recordJobRun` and the
 * console's Jobs page (Tier 3) can show when it last ran, how long it took
 * and why it failed. A failure is recorded and rethrown, so the job's own
 * retry logic is unchanged.
 */
export interface JobRunRow {
  id: number;
  key: string;
  label: string;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
  error: string | null;
  durationMs: number | null;
  detail: unknown;
}

export async function recordJobRun<T>(key: string, label: string, fn: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  let id: number | null = null;
  try {
    id = Number(
      controlSqlite
        .prepare("INSERT INTO job_runs (key, label, started_at) VALUES (?, ?, ?)")
        .run(key, label, startedAt).lastInsertRowid,
    );
  } catch (err) {
    console.error("[jobs] could not record start of", key, err);
  }
  let out: T;
  try {
    out = await fn();
  } catch (err) {
    if (id !== null) {
      try {
        const finishedAt = Date.now();
        controlSqlite
          .prepare("UPDATE job_runs SET finished_at = ?, ok = 0, duration_ms = ?, error = ? WHERE id = ?")
          .run(finishedAt, finishedAt - startedAt, err instanceof Error ? err.message : String(err), id);
      } catch (recErr) {
        console.error("[jobs] could not record failure of", key, recErr);
      }
    }
    throw err;
  }
  if (id !== null) {
    try {
      const finishedAt = Date.now();
      controlSqlite
        .prepare("UPDATE job_runs SET finished_at = ?, ok = 1, duration_ms = ?, detail = ? WHERE id = ?")
        .run(finishedAt, finishedAt - startedAt, out === undefined ? null : safeJson(out), id);
    } catch (recErr) {
      console.error("[jobs] could not record finish of", key, recErr);
    }
  }
  return out;
}

const DAY_MS = 86400000;

/** Drop job runs and health snapshots older than keepDays. */
export function pruneHistory(now = Date.now(), keepDays = 90): { jobRuns: number; snapshots: number } {
  const cutoff = now - keepDays * DAY_MS;
  const jobRuns = controlSqlite.prepare("DELETE FROM job_runs WHERE started_at < ?").run(cutoff).changes;
  const snapshots = controlSqlite.prepare("DELETE FROM health_snapshots WHERE at < ?").run(cutoff).changes;
  return { jobRuns, snapshots };
}

function safeJson(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 4000 ? j : null;
  } catch {
    return null;
  }
}

type Raw = {
  id: number; key: string; label: string; started_at: number; finished_at: number | null;
  ok: number | null; error: string | null; duration_ms: number | null; detail: string | null;
};

function toRow(r: Raw): JobRunRow {
  let detail: unknown = null;
  if (r.detail) {
    try { detail = JSON.parse(r.detail); } catch { detail = r.detail; }
  }
  return {
    id: r.id, key: r.key, label: r.label, startedAt: r.started_at, finishedAt: r.finished_at,
    ok: r.ok === null ? null : r.ok === 1, error: r.error, durationMs: r.duration_ms, detail,
  };
}

/** Newest first. */
export function listJobRuns(opts: { key?: string; limit?: number } = {}): JobRunRow[] {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  const rows = opts.key
    ? controlSqlite.prepare("SELECT * FROM job_runs WHERE key = ? ORDER BY started_at DESC, id DESC LIMIT ?").all(opts.key, limit)
    : controlSqlite.prepare("SELECT * FROM job_runs ORDER BY started_at DESC, id DESC LIMIT ?").all(limit);
  return (rows as Raw[]).map(toRow);
}

/** The most recent run of every job that has ever run. */
export function latestJobRuns(): JobRunRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT j.* FROM job_runs j
       JOIN (SELECT key, MAX(id) AS id FROM job_runs GROUP BY key) m ON m.id = j.id
       ORDER BY j.key`,
    )
    .all() as Raw[];
  return rows.map(toRow);
}
