// The per-tenant model that builds a campaign's assets. Admin-set, validated
// against MODEL_CATALOG, Sonnet fallback. Read/written via the settings KV.
//
// `@/lib/settings` is imported DYNAMICALLY inside the async getters below (not
// at module scope): it transitively imports React's server-only `cache()`,
// whose npm "react-server" entry throws on load under the pure test runner's
// `--conditions=react-server`. Deferring the import keeps the pure
// `resolveCampaignBuildModel`/`isCampaignBuildModelId` importable without that
// crash (same pattern as lib/marketing/campaignRadar.ts) — no test shim needed.
// In production (real Next.js react-server runtime) the dynamic import always
// resolves; the getters are only ever called from async request/action paths.
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";

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
export async function getCampaignBuildModel(): Promise<string> {
  const { readKey } = await import("@/lib/settings");
  return resolveCampaignBuildModel(readKey<string>(CAMPAIGN_MODEL_KEY, ""));
}

/** Admin setter. Rejects an id not in MODEL_CATALOG. */
export async function setCampaignBuildModel(id: string): Promise<void> {
  if (!isCampaignBuildModelId(id)) throw new Error(`Unknown campaign build model: ${id}`);
  const { setKey } = await import("@/lib/settings");
  setKey(CAMPAIGN_MODEL_KEY, id);
}
