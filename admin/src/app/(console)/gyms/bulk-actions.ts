"use server";

import { tenantAction, type TenantActionName } from "./[id]/actions";

export type BulkAction = Extract<TenantActionName, "grant-credits" | "grant-ai-credits" | "suspend-ai" | "resume-ai" | "suspend-marketing" | "resume-marketing">;

const ALLOWED: ReadonlySet<string> = new Set(["grant-credits", "grant-ai-credits", "suspend-ai", "resume-ai", "suspend-marketing", "resume-marketing"]);
const MAX_IDS = 200;

export type BulkResult = { done: number; failed: { id: number; error: string }[]; refused?: string };

/**
 * The same per-business action, once per selected business, in order. One
 * failure does not stop the rest; the caller gets both counts. Each call is
 * audited on its own in the main app, so the log reads "granted to A,
 * granted to B", which is what happened.
 */
export async function bulkTenantAction(ids: number[], action: BulkAction, body: Record<string, unknown> = {}): Promise<BulkResult> {
  if (!ALLOWED.has(action)) return { done: 0, failed: [], refused: "That action cannot run in bulk." };
  const list = (Array.isArray(ids) ? ids : []).filter((n) => Number.isInteger(n) && n > 0);
  if (list.length > MAX_IDS) return { done: 0, failed: [], refused: "Select 200 or fewer businesses." };
  let payload: Record<string, unknown> = {};
  if (action === "grant-credits" || action === "grant-ai-credits") {
    const cents = Number(body?.cents);
    if (!Number.isInteger(cents) || cents <= 0) return { done: 0, failed: [], refused: "Give an amount in euro." };
    payload = { cents };
  }
  let done = 0;
  const failed: { id: number; error: string }[] = [];
  for (const id of list) {
    try {
      const r = await tenantAction(id, action, payload);
      if (r.ok) done++;
      else failed.push({ id, error: r.error ?? "failed" });
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return { done, failed };
}
