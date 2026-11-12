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

/** True when the id is an active member of the platform team. */
export function isActivePlatformStaff(userId: number): boolean {
  return Boolean(controlSqlite.prepare("SELECT 1 FROM users WHERE id = ? AND is_platform_admin = 1 AND is_active = 1").get(userId));
}

export const NOT_STAFF_ERROR = "That person is not on the platform team.";
