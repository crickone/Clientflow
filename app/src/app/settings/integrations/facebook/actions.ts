"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { disconnectFacebookPage, listFacebookPages } from "@/lib/facebook/pages";
import { setPostingPage } from "@/lib/social/publisher";

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
