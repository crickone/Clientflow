"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type MoneyActionResult = { ok: true; note: string } | { ok: false; error: string };

export type MoneyOp =
  | { op: "set-price"; cents: number | null }
  | { op: "add-credit"; cents: number; description: string; reason: string }
  | { op: "cancel-credit"; creditId: number }
  | { op: "refund"; invoiceId: number; reason: string };

/** Owner-only in the API; this only carries the request and reports a refusal. */
export async function moneyAction(tenantId: number, body: MoneyOp): Promise<MoneyActionResult> {
  try {
    const res = await api<{ ok: true; note: string }>(`/tenants/${tenantId}/money`, { method: "POST", body });
    revalidatePath(`/gyms/${tenantId}/money`);
    revalidatePath(`/gyms/${tenantId}`);
    return { ok: true, note: res.note };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
