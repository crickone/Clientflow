// The per-tenant model that builds a campaign's assets. Admin-set, validated
// against MODEL_CATALOG, Sonnet fallback. Read/written via the settings KV.
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { readKey, setKey } from "@/lib/settings";

export const CAMPAIGN_MODEL_KEY = "campaignBuildModel";

const CATALOG_IDS = new Set<string>(MODEL_CATALOG.map((m) => m.id));

export function isCampaignBuildModelId(id: string): boolean {
  return CATALOG_IDS.has(id);
}

/** Pure: a current catalog id passes; anything else (unset/unknown/removed) → CONTENT_MODEL. */
export function resolveCampaignBuildModel(raw: string | null | undefined): string {
  return raw && CATALOG_IDS.has(raw) ? raw : CONTENT_MODEL;
}

/** The model the current tenant's campaign generation should use. */
export function getCampaignBuildModel(): string {
  return resolveCampaignBuildModel(readKey<string>(CAMPAIGN_MODEL_KEY, ""));
}

/** Admin setter. Rejects an id not in MODEL_CATALOG. */
export function setCampaignBuildModel(id: string): void {
  if (!isCampaignBuildModelId(id)) throw new Error(`Unknown campaign build model: ${id}`);
  setKey(CAMPAIGN_MODEL_KEY, id);
}
