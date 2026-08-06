"use server";

import { revalidatePath } from "next/cache";

import { setActiveTenant } from "@/lib/auth";

/**
 * Set the active clinic for the current session. `setActiveTenant` re-validates
 * membership server-side, so this is safe even though the tenant id comes from
 * the client. Returns ok/err — the CLIENT then does a FULL reload to /dashboard.
 *
 * A full reload (not a soft redirect) is required: the per-tenant theme + logo
 * are injected once in the ROOT layout, which Next does NOT re-render on a soft
 * navigation — so a soft switch would keep the previous clinic's theme until a
 * hard reload. Reloading guarantees the new tenant's chrome renders correctly.
 */
export async function chooseAccount(
  tenantId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await setActiveTenant(tenantId);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return { ok: true };
}
