"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type DataActionResult =
  | { ok: true; note?: string; data?: unknown }
  | { ok: false; error: string };

export type DataOp =
  | { op: "backup" }
  | { op: "export-person"; kind: "client" | "lead"; personId: number }
  | { op: "delete-person"; kind: "client" | "lead"; personId: number; reason: string };

/** Carries one data operation. The route owns the role check and the audit row. */
export async function dataAction(tenantId: number, body: DataOp): Promise<DataActionResult> {
  try {
    const res = await api<{ ok: true; note?: string; data?: unknown }>(`/tenants/${tenantId}/data`, {
      method: "POST",
      body,
    });
    revalidatePath(`/gyms/${tenantId}/data`);
    return { ok: true, note: res.note, data: res.data };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
