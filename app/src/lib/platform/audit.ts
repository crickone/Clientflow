import "server-only";

import { controlSqlite } from "@/lib/db/control";
import type { PlatformRole } from "./roles";

/**
 * The console's own log: one row per action taken from the platform console,
 * with who took it, which tenant it touched, what changed, and why.
 *
 * Separate from `billing_events`, which stays what it is: a tenant's billing
 * history, written by the billing engine, read on the tenant's Money tab.
 * This table answers a different question -- "what has platform staff been
 * doing" -- across every tenant and across actions that have nothing to do
 * with money. The tenant Timeline merges both.
 *
 * Append-only. Nothing in the product deletes a row, and a failed action is
 * recorded too (`ok: false` with the error): an attempt that was refused is
 * exactly the kind of thing an audit log exists to show.
 */

export interface AuditInput {
  actorUserId: number | null;
  actorEmail: string;
  actorRole: PlatformRole | null;
  tenantId: number | null;
  action: string;
  detail?: unknown;
  reason?: string | null;
  ip?: string | null;
  ok?: boolean;
  error?: string | null;
}

/**
 * Write one audit row. Never throws: an action must not fail because its
 * record failed, and a lost row is logged loudly rather than swallowed
 * silently.
 */
export function recordAudit(input: AuditInput): void {
  try {
    controlSqlite
      .prepare(
        `INSERT INTO platform_audit
           (actor_user_id, actor_email, actor_role, tenant_id, action, detail, reason, ip, ok, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.actorUserId,
        input.actorEmail,
        input.actorRole,
        input.tenantId,
        input.action,
        input.detail === undefined ? null : JSON.stringify(input.detail),
        input.reason ?? null,
        input.ip ?? null,
        input.ok === false ? 0 : 1,
        input.error ?? null,
        Date.now(),
      );
  } catch (err) {
    console.error("[platform-audit] could not record an action:", input.action, err);
  }
}

export interface AuditRow {
  id: number;
  actorUserId: number | null;
  actorEmail: string;
  actorRole: string | null;
  tenantId: number | null;
  tenantName: string | null;
  action: string;
  detail: unknown;
  reason: string | null;
  ip: string | null;
  ok: boolean;
  error: string | null;
  createdAt: number;
}

export interface AuditQuery {
  tenantId?: number | null;
  actorUserId?: number;
  action?: string;
  limit?: number;
  before?: number;
}

/** Most recent first. The tenant name is joined in so the log reads without a second lookup. */
export function listAudit(query: AuditQuery = {}): AuditRow[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (query.tenantId != null) {
    where.push("a.tenant_id = ?");
    args.push(query.tenantId);
  }
  if (query.actorUserId != null) {
    where.push("a.actor_user_id = ?");
    args.push(query.actorUserId);
  }
  if (query.action) {
    where.push("a.action = ?");
    args.push(query.action);
  }
  if (query.before != null) {
    where.push("a.created_at < ?");
    args.push(query.before);
  }
  const limit = Math.min(500, Math.max(1, query.limit ?? 100));
  const rows = controlSqlite
    .prepare(
      `SELECT a.id, a.actor_user_id, a.actor_email, a.actor_role, a.tenant_id, t.name AS tenant_name,
              a.action, a.detail, a.reason, a.ip, a.ok, a.error, a.created_at
       FROM platform_audit a
       LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT ${limit}`,
    )
    .all(...args) as Array<{
    id: number;
    actor_user_id: number | null;
    actor_email: string;
    actor_role: string | null;
    tenant_id: number | null;
    tenant_name: string | null;
    action: string;
    detail: string | null;
    reason: string | null;
    ip: string | null;
    ok: number;
    error: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    actorRole: r.actor_role,
    tenantId: r.tenant_id,
    tenantName: r.tenant_name,
    action: r.action,
    detail: parseDetail(r.detail),
    reason: r.reason,
    ip: r.ip,
    ok: Boolean(r.ok),
    error: r.error,
    createdAt: r.created_at,
  }));
}

function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The caller's IP, for the audit row. Behind Railway's proxy the forwarded header is the real one. */
export function requestIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return req.headers.get("x-real-ip");
}
