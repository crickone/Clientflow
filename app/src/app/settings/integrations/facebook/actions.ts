"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { disconnectFacebookPage } from "@/lib/facebook/pages";

/** Disconnect (revoke) one of the current tenant's connected Pages. Admin-only, tenant-scoped. */
export async function disconnectFacebookPageAction(pageId: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return { ok: false, error: "No tenant in context." };
  await disconnectFacebookPage(membership.tenant.id, pageId);
  revalidatePath("/settings/integrations/facebook");
  return { ok: true };
}
