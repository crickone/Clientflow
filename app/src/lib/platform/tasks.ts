import "server-only";

import { controlSqlite } from "@/lib/db/control";

/** A thing a platform operator has to do, optionally about one business, optionally by a date. */
export interface Task {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  title: string;
  dueAt: number | null;
  assignedTo: number | null;
  doneAt: number | null;
  createdBy: number;
  createdAt: number;
}

type Raw = { id: number; tenant_id: number | null; tenant_name: string | null; title: string; due_at: number | null; assigned_to: number | null; done_at: number | null; created_by: number; created_at: number };
const toTask = (r: Raw): Task => ({ id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, title: r.title, dueAt: r.due_at, assignedTo: r.assigned_to, doneAt: r.done_at, createdBy: r.created_by, createdAt: r.created_at });
const SELECT = "SELECT k.*, t.name AS tenant_name FROM platform_tasks k LEFT JOIN tenants t ON t.id = k.tenant_id";

export function listTasks(opts: { tenantId?: number; assignedTo?: number; open?: boolean } = {}): Task[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.tenantId !== undefined) { where.push("k.tenant_id = ?"); args.push(opts.tenantId); }
  if (opts.assignedTo !== undefined) { where.push("k.assigned_to = ?"); args.push(opts.assignedTo); }
  if (opts.open) where.push("k.done_at IS NULL");
  const rows = controlSqlite
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY k.done_at IS NOT NULL, k.due_at IS NULL, k.due_at, k.created_at DESC LIMIT 500`)
    .all(...args) as Raw[];
  return rows.map(toTask);
}

export function addTask(input: { tenantId: number | null; title: string; dueAt: number | null; assignedTo: number | null; createdBy: number }): Task {
  const id = Number(
    controlSqlite
      .prepare("INSERT INTO platform_tasks (tenant_id, title, due_at, assigned_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.tenantId, input.title.trim().slice(0, 200), input.dueAt, input.assignedTo, input.createdBy, Date.now()).lastInsertRowid,
  );
  return toTask(controlSqlite.prepare(`${SELECT} WHERE k.id = ?`).get(id) as Raw);
}

export function setTaskDone(id: number, done: boolean): void {
  controlSqlite.prepare("UPDATE platform_tasks SET done_at = ? WHERE id = ?").run(done ? Date.now() : null, id);
}

export function deleteTask(id: number): void {
  controlSqlite.prepare("DELETE FROM platform_tasks WHERE id = ?").run(id);
}

const DUBLIN_TZ = "Europe/Dublin";

/** Start (UTC ms) of the Dublin calendar day containing `ms`. */
function dublinDayStart(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DUBLIN_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  // Wall-clock time in Dublin, read as if it were UTC, gives the offset to undo.
  const wallAsUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  const offset = wallAsUtc - Math.floor(ms / 1000) * 1000;
  return Date.UTC(n("year"), n("month") - 1, n("day")) - offset;
}

/** Buckets by due date, against the given instant (Europe/Dublin day boundaries). */
export function dueBuckets(tasks: Task[], now: number): { overdue: Task[]; today: Task[]; later: Task[]; undated: Task[] } {
  const dayStart = dublinDayStart(now);
  // Next midnight in Dublin, found from a point safely inside the next day (DST days are 23 or 25 hours).
  const dayEnd = dublinDayStart(dayStart + 36 * 3600000);
  const out = { overdue: [] as Task[], today: [] as Task[], later: [] as Task[], undated: [] as Task[] };
  for (const t of tasks) {
    if (t.dueAt === null) out.undated.push(t);
    else if (t.dueAt < dayStart) out.overdue.push(t);
    else if (t.dueAt < dayEnd) out.today.push(t);
    else out.later.push(t);
  }
  return out;
}
