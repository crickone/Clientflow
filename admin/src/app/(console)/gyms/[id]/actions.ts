"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type TenantActionName =
  | "suspend"
  | "reactivate"
  | "exempt"
  | "unexempt"
  | "charge-now"
  | "mark-paid"
  | "waive"
  | "comp"
  | "venue-type"
  | "offboard";

/**
 * Single funnel for every per-tenant billing action. Posts to the platform API
 * (which returns `{ok:true}` or a 400 `{ok:false,error}`), revalidates the
 * affected routes, and hands the client a `{ok,error?}` it can surface inline.
 * Never throws — a failed request becomes `{ok:false}`.
 */
export async function tenantAction(
  id: number,
  action: TenantActionName,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await api(`/tenants/${id}/${action}`, { method: "POST", body: body ?? {} });
    revalidatePath(`/gyms/${id}`);
    revalidatePath("/gyms");
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Action failed" };
  }
}
