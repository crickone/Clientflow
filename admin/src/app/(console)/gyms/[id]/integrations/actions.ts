"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

/**
 * Server actions for the Integrations tab. The rules and the audit row live
 * in `/tenants/:id/integrations`; these only carry the request.
 */
export type IntegrationActionResult = { ok: true; note: string } | { ok: false; error: string };

export type IntegrationOp =
  | { op: "disconnect"; key: string; reason?: string }
  | { op: "reverify-domain" }
  | { op: "revoke-api-key"; keyId: number; reason?: string };

export async function integrationAction(
  tenantId: number,
  body: IntegrationOp,
): Promise<IntegrationActionResult> {
  try {
    const res = await api<{ ok: true; note: string }>(`/tenants/${tenantId}/integrations`, {
      method: "POST",
      body,
    });
    revalidatePath(`/gyms/${tenantId}/integrations`);
    return { ok: true, note: res.note };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
