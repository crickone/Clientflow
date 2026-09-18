"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type FeatureActionResult = { ok: true; note: string } | { ok: false; error: string };

/** Turn one module on or off. The route owns the rule and the audit row. */
export async function setModuleAction(tenantId: number, key: string, on: boolean): Promise<FeatureActionResult> {
  try {
    const res = await api<{ ok: true; note: string }>(`/tenants/${tenantId}/features`, {
      method: "POST",
      body: { key, on },
    });
    revalidatePath(`/gyms/${tenantId}/features`);
    revalidatePath(`/gyms/${tenantId}`);
    return { ok: true, note: res.note };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
