"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { isAssignable } from "@/lib/leadFlows/assignment";
import { saveLeadFlowSettings } from "@/lib/leadFlows/settings";
import { validateLeadFlowSettings, type LeadFlowSettingsInput } from "@/lib/leadFlows/settingsModel";

/** Save the business's lead follow-up settings. Admins only. */
export async function saveLeadFollowUpsAction(input: LeadFlowSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const tenantId = getCurrentMembership()?.tenant.id;
  if (!tenantId) return { ok: false, error: "No business selected." };
  const checked = validateLeadFlowSettings(input);
  if (!checked.ok) return checked;
  if (checked.value.defaultAssigneeUserId != null && !isAssignable(tenantId, checked.value.defaultAssigneeUserId)) {
    return { ok: false, error: "That person is not on this account." };
  }
  saveLeadFlowSettings(checked.value);
  revalidatePath("/settings/lead-follow-ups");
  return { ok: true };
}
