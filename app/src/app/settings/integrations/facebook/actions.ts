"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { disconnectFacebookPage, listFacebookPages } from "@/lib/facebook/pages";
import { setPostingPage } from "@/lib/social/publisher";
import { discoverAdAccounts, getGrantToken, saveAdAccounts, setAdAccountInUse } from "@/lib/facebook/grants";

/** Disconnect (revoke) one of the current tenant's connected Pages. Admin-only, tenant-scoped. */
export async function disconnectFacebookPageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return { ok: false, error: "No tenant in context." };
  await disconnectFacebookPage(membership.tenant.id, pageId);
  revalidatePath("/settings/integrations/facebook");
  return { ok: true };
}

/** Choose which connected Page scheduled posts go out from. Admin-only, tenant-scoped. */
export async function setPostingPageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return { ok: false, error: "No tenant in context." };
  if (!listFacebookPages(membership.tenant.id).some((p) => p.pageId === pageId)) {
    return { ok: false, error: "That Page is not connected to this account." };
  }
  setPostingPage(pageId);
  revalidatePath("/settings/integrations/facebook");
  return { ok: true };
}

/**
 * Look for the tenant's ad accounts again with the stored grant, without a new
 * Facebook login. Admin-only, tenant-scoped. Returns how many were found.
 */
export async function refreshAdAccountsAction(): Promise<{ ok: boolean; found?: number; error?: string }> {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return { ok: false, error: "No tenant in context." };
  const token = getGrantToken(membership.tenant.id);
  if (!token) return { ok: false, error: "Reconnect Facebook first." };
  try {
    const accounts = await discoverAdAccounts(token);
    if (accounts.length) saveAdAccounts(membership.tenant.id, accounts);
    revalidatePath("/settings/integrations/facebook");
    return { ok: true, found: accounts.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach Facebook." };
  }
}

/** Choose, or stop using, an ad account the connection reaches. Admin-only, tenant-scoped. */
export async function setAdAccountInUseAction(adAccountId: string, inUse: boolean): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return { ok: false, error: "No tenant in context." };
  if (!setAdAccountInUse(membership.tenant.id, adAccountId, inUse)) {
    return { ok: false, error: "That ad account is not part of this connection." };
  }
  revalidatePath("/settings/integrations/facebook");
  revalidatePath("/marketing/ads");
  return { ok: true };
}
