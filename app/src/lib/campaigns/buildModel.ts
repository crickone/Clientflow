// The per-tenant model that builds a campaign's assets. Admin-set, validated
// against CAMPAIGN_MODEL_CHOICES, Sonnet fallback. Read/written via the
// settings KV.
//
// Deliberately NOT MODEL_CATALOG (@/lib/ai/modelCatalog, the agent-chat
// picker): campaign generation runs through `meteredCreate`
// (@/lib/ai/metered), which calls native Anthropic DIRECTLY — it has no
// OpenRouter/provider routing (that only exists in the agent-chat loop
// `runAgentTurn`). MODEL_CATALOG carries 6 `openrouter:`-prefixed entries
// that would pass `isCatalogModel` yet break every campaign generation call
// the moment one was selected (Anthropic rejects the unknown model id). This
// list is instead the 3 models `meteredCreate` can actually run AND that have
// a `PRICING` entry — Haiku (a cheaper-than-Sonnet option, since MODEL_CATALOG
// itself has no Haiku entry to filter down to), Sonnet (the default), Opus.
//
// `@/lib/settings` is imported DYNAMICALLY inside the async getters below (not
// at module scope): it transitively imports React's server-only `cache()`,
// whose npm "react-server" entry throws on load under the pure test runner's
// `--conditions=react-server`. Deferring the import keeps the pure
// `resolveCampaignBuildModel`/`isCampaignBuildModelId` importable without that
// crash (same pattern as lib/marketing/campaignRadar.ts) — no test shim needed.
// In production (real Next.js react-server runtime) the dynamic import always
// resolves; the getters are only ever called from async request/action paths.
import { MODELS, CONTENT_MODEL } from "@/lib/ai/client";

export const CAMPAIGN_MODEL_KEY = "campaignBuildModel";

/** The only models `meteredCreate` can run — native Anthropic, each with a PRICING entry. Labels match MODEL_CATALOG's Sonnet/Opus entries. */
export const CAMPAIGN_MODEL_CHOICES: { id: string; label: string; hint: string }[] = [
  { id: MODELS.haiku, label: "Haiku 4.5", hint: "Fastest — lowest cost" },
  { id: MODELS.sonnet, label: "Sonnet 5", hint: "Balanced — default" },
  { id: MODELS.opus, label: "Opus 4.8", hint: "Highest quality — dearest" },
];

const CAMPAIGN_MODEL_IDS = new Set<string>(CAMPAIGN_MODEL_CHOICES.map((c) => c.id));

export function isCampaignBuildModelId(id: string): boolean {
  return CAMPAIGN_MODEL_IDS.has(id);
}

/** Pure: a current choice id passes; anything else (unset/unknown/removed/an OpenRouter id) → CONTENT_MODEL. */
export function resolveCampaignBuildModel(raw: string | null | undefined): string {
  return raw && CAMPAIGN_MODEL_IDS.has(raw) ? raw : CONTENT_MODEL;
}

/** id -> label, falling back to the raw id for anything outside CAMPAIGN_MODEL_CHOICES. Never throws. */
export function campaignModelLabel(id: string): string {
  return CAMPAIGN_MODEL_CHOICES.find((c) => c.id === id)?.label ?? id;
}

/** The model the current tenant's campaign generation should use. */
export async function getCampaignBuildModel(): Promise<string> {
  const { readKey } = await import("@/lib/settings");
  return resolveCampaignBuildModel(readKey<string>(CAMPAIGN_MODEL_KEY, ""));
}

/** Admin setter. Rejects an id not in CAMPAIGN_MODEL_CHOICES (incl. any MODEL_CATALOG-only OpenRouter id). */
export async function setCampaignBuildModel(id: string): Promise<void> {
  if (!isCampaignBuildModelId(id)) throw new Error(`Unknown campaign build model: ${id}`);
  const { setKey } = await import("@/lib/settings");
  setKey(CAMPAIGN_MODEL_KEY, id);
}
