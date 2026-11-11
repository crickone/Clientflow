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
  const id = Number(
    controlSqlite
      .prepare("INSERT INTO job_runs (key, label, started_at) VALUES (?, ?, ?)")
      .run(key, label, startedAt).lastInsertRowid,
  );
  try {
    const out = await fn();
    const finishedAt = Date.now();
    controlSqlite
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 1, duration_ms = ?, detail = ? WHERE id = ?")
      .run(finishedAt, finishedAt - startedAt, out === undefined ? null : safeJson(out), id);
    return out;
  } catch (err) {
    const finishedAt = Date.now();
    controlSqlite
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 0, duration_ms = ?, error = ? WHERE id = ?")
      .run(finishedAt, finishedAt - startedAt, err instanceof Error ? err.message : String(err), id);
    throw err;
  }
}

function safeJson(v: unknown): string | null {
  try {
    return JSON.stringify(v);
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
