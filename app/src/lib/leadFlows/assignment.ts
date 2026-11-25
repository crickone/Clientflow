import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { controlSqlite } from "@/lib/db/control";
import { logActivity } from "@/lib/queries";

import { getLeadFlowSettings } from "./settings";
import { flowTenant } from "./tenant";

/** Who a lead can be assigned to: the business's active staff, by name. */
export interface AssignableStaff {
  userId: number;
  name: string;
  email: string;
  role: "admin" | "staff";
}

export function listAssignableStaff(tenantId: number): AssignableStaff[] {
  return (
    controlSqlite
      .prepare(
        `SELECT u.id AS userId, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS name, u.email AS email, m.role AS role
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ? AND m.is_active = 1 AND u.is_active = 1
         ORDER BY name COLLATE NOCASE`,
      )
      .all(tenantId) as Array<{ userId: number; name: string; email: string; role: string }>
  ).map((r) => ({ ...r, role: r.role === "admin" ? "admin" : "staff" }));
}

export function isAssignable(tenantId: number, userId: number): boolean {
  return listAssignableStaff(tenantId).some((s) => s.userId === userId);
}

/** Assign a lead (ambient tenant), or unassign it with null. */
export function assignLead(leadId: number, userId: number | null): { ok: true } | { ok: false; error: string } {
  const tenant = flowTenant();
  if (!tenant) return { ok: false, error: "No business selected." };
  if (userId != null && !isAssignable(tenant.id, userId)) return { ok: false, error: "That person is not on this account." };
  const res = db.update(schema.leads).set({ assignedUserId: userId }).where(eq(schema.leads.id, leadId)).run();
  if (res.changes === 0) return { ok: false, error: "Lead not found." };
  void logActivity("lead.assigned", userId == null ? `Lead #${leadId} unassigned` : `Lead #${leadId} assigned to user #${userId}`, { leadId, userId });
  return { ok: true };
}

/** Who a brand-new lead goes to: the business default, while that person still works here. Never throws. */
export function defaultAssigneeForNewLead(): number | null {
  try {
    const tenant = flowTenant();
    if (!tenant) return null;
    const id = getLeadFlowSettings().defaultAssigneeUserId;
    return id != null && isAssignable(tenant.id, id) ? id : null;
  } catch {
    return null;
  }
}
