"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type HealthActionResult = { ok: true; note: string } | { ok: false; error: string };

export type HealthOp = { op: "clear-stuck" } | { op: "retry-queue"; queue: "nurture" | "posts" };

/** Carries one repair to the health route, which owns the rules and the audit row. */
export async function healthAction(tenantId: number, body: HealthOp): Promise<HealthActionResult> {
  try {
    const res = await api<{ ok: true; note: string }>(`/tenants/${tenantId}/health`, { method: "POST", body });
    revalidatePath(`/gyms/${tenantId}/health`);
    revalidatePath("/health");
    return { ok: true, note: res.note };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
