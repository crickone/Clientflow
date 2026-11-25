/**
 * Releasing an imported run's held rows when their flow is switched on.
 * Pure: no DB, no server-only.
 *
 * The import's rule carries on: a message whose time passed while the flow
 * was off is skipped, never sent late, and each run sends at most one
 * message on the day it is released. A finish move whose time passed
 * happens now (it sends nothing itself).
 */
export interface HeldRow {
  id: number;
  runId: number | null;
  kind: string;
  dueAt: number;
}

export interface ReleasePlan {
  cancel: number[];
  queue: { id: number; dueAt: number }[];
}

export function planRelease(rows: HeldRow[], now: number, dayOf: (at: number) => string): ReleasePlan {
  const cancel: number[] = [];
  const queue: { id: number; dueAt: number }[] = [];
  const today = dayOf(now);
  const byRun = new Map<string, HeldRow[]>();
  for (const r of rows) {
    const key = r.runId == null ? `row:${r.id}` : `run:${r.runId}`;
    const list = byRun.get(key);
    if (list) list.push(r);
    else byRun.set(key, [r]);
  }
  for (const list of byRun.values()) {
    let usedToday = false;
    for (const r of [...list].sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)) {
      if (r.kind !== "message") {
        queue.push({ id: r.id, dueAt: Math.max(r.dueAt, now) });
        continue;
      }
      if (r.dueAt < now) {
        cancel.push(r.id);
        continue;
      }
      if (dayOf(r.dueAt) === today) {
        if (usedToday) {
          cancel.push(r.id);
          continue;
        }
        usedToday = true;
      }
      queue.push({ id: r.id, dueAt: r.dueAt });
    }
  }
  return { cancel, queue };
}
