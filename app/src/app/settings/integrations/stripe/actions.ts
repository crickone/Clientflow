"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/queries";
import { deauthorizeAccount, getAccount } from "@/lib/stripe/api";
import { getStripeConnection, removeStripeConnection, updateStripeAccountStatus } from "@/lib/stripe/connection";

export async function refreshStripeAction(): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  const conn = getStripeConnection(tenantId);
  if (!conn) return { ok: false, error: "Stripe isn't connected." };
  const r = await getAccount(conn.accountId);
  if (!r.ok) return { ok: false, error: r.error };
  updateStripeAccountStatus(tenantId, r.data);
  revalidatePath("/settings/integrations/stripe");
  return { ok: true };
}

export async function disconnectStripeAction(): Promise<{ ok: boolean }> {
  const me = await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  const conn = getStripeConnection(tenantId);
  if (conn) {
    // Best effort: revoke our access on Stripe's side too. The local record
    // goes either way, so the Buy buttons stop at once.
    await deauthorizeAccount(conn.accountId);
    removeStripeConnection(tenantId);
    await logActivity("stripe_disconnected", `Stripe disconnected by ${me.email}`, { accountId: conn.accountId });
  }
  revalidatePath("/settings/integrations/stripe");
  return { ok: true };
}
