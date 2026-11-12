import "server-only";

import { controlSqlite } from "@/lib/db/control";

/** A positive-integer tenant id from a URL segment that names a real business, else null. */
export function parseTenantId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return controlSqlite.prepare("SELECT 1 FROM tenants WHERE id = ?").get(id) ? id : null;
}

/** A positive-integer id from user input, else null. */
export function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return raw !== null && raw !== "" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function noteBelongs(noteId: number, tenantId: number): boolean {
  return Boolean(controlSqlite.prepare("SELECT 1 FROM tenant_notes WHERE id = ? AND tenant_id = ?").get(noteId, tenantId));
}

export function taskBelongs(taskId: number, tenantId: number): boolean {
  return Boolean(controlSqlite.prepare("SELECT 1 FROM platform_tasks WHERE id = ? AND tenant_id = ?").get(taskId, tenantId));
}
