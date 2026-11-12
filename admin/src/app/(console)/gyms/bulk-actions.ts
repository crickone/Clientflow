"use server";

import { tenantAction, type TenantActionName } from "./[id]/actions";

export type BulkAction = Extract<TenantActionName, "grant-credits" | "grant-ai-credits" | "suspend-ai" | "resume-ai" | "suspend-marketing" | "resume-marketing">;

/**
 * The same per-business action, once per selected business, in order. One
 * failure does not stop the rest; the caller gets both counts. Each call is
 * audited on its own in the main app, so the log reads "granted to A,
 * granted to B", which is what happened.
 */
export async function bulkTenantAction(ids: number[], action: BulkAction, body: Record<string, unknown> = {}) {
  let done = 0;
  const failed: { id: number; error: string }[] = [];
  for (const id of ids.slice(0, 200)) {
    const r = await tenantAction(id, action, body);
    if (r.ok) done++;
    else failed.push({ id, error: r.error ?? "failed" });
  }
  return { done, failed };
}
