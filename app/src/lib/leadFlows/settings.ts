import "server-only";

import { readKey, readKeyForTenant, setKey } from "@/lib/settings";

import { LEAD_FLOW_SETTINGS_KEY, parseLeadFlowSettings, type LeadFlowSettings } from "./settingsModel";

/** The current tenant's lead follow-up settings (ambient tenant: request or runWithTenant). */
export function getLeadFlowSettings(): LeadFlowSettings {
  return parseLeadFlowSettings(readKey<unknown>(LEAD_FLOW_SETTINGS_KEY, null));
}

/** The same, for an explicit tenant (background jobs). */
export function getLeadFlowSettingsForTenant(tenantId: number): LeadFlowSettings {
  return parseLeadFlowSettings(readKeyForTenant<unknown>(tenantId, LEAD_FLOW_SETTINGS_KEY, null));
}

/** Save a value already checked by validateLeadFlowSettings. */
export function saveLeadFlowSettings(value: LeadFlowSettings): void {
  setKey(LEAD_FLOW_SETTINGS_KEY, value);
}
