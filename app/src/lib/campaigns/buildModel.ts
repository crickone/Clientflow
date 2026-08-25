// The per-tenant model that builds a campaign's assets. Admin-set, validated
// against CAMPAIGN_MODEL_CHOICES, Sonnet fallback. Read/written via the
// settings KV.
//
// A curated subset: the native Anthropic tiers PLUS two cheap, strong-for-
// generation OpenRouter open models. Campaign generation routes an
// `openrouter:`-prefixed build model through `meteredComplete`
// (@/lib/ai/metered → getProvider().streamTurn), the provider-neutral one-shot,
// while native models keep going through `meteredCreate` (native Anthropic
// direct, with adaptive thinking + prompt caching). Every id here has a
// `PRICING` entry (@/lib/ai/client), so the €-estimate + per-tenant metering
// both work. NOT the full MODEL_CATALOG (@/lib/ai/modelCatalog): the pricier
// open models (Kimi, Qwen, GPT-5, Gemini) are deliberately left off — this list
// is the cost/quality picks that make sense for a batch generation job. The
// OpenRouter options need OPENROUTER_API_KEY (getProvider throws without it):
// the hub page only offers them when it's set, and getCampaignBuildModel below
// falls back to the native default if a stored OpenRouter id ever loses its key.
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

/** The campaign build-model options: native Anthropic tiers + two cheap OpenRouter open models. Each id has a PRICING entry; OpenRouter ids run via meteredComplete (see the file header). */
export const CAMPAIGN_MODEL_CHOICES: { id: string; label: string; hint: string }[] = [
  { id: MODELS.haiku, label: "Haiku 4.5", hint: "Fastest — lowest cost" },
  { id: MODELS.sonnet, label: "Sonnet 5", hint: "Balanced — default" },
  { id: MODELS.opus, label: "Opus 4.8", hint: "Highest quality — dearest" },
  { id: "openrouter:deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", hint: "Open model — very low cost" },
  { id: "openrouter:z-ai/glm-5.2", label: "GLM 5.2", hint: "Open model — low cost, strong" },
];

const CAMPAIGN_MODEL_IDS = new Set<string>(CAMPAIGN_MODEL_CHOICES.map((c) => c.id));

export function isCampaignBuildModelId(id: string): boolean {
  return CAMPAIGN_MODEL_IDS.has(id);
}

/** Pure: an offered choice id passes; anything else (unset/unknown/removed/a NON-offered OpenRouter id) → CONTENT_MODEL. Key-gating for offered OpenRouter ids happens in getCampaignBuildModel below, which can read env. */
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
  const model = resolveCampaignBuildModel(readKey<string>(CAMPAIGN_MODEL_KEY, ""));
  // An OpenRouter build model needs OPENROUTER_API_KEY (getProvider throws
  // without it); if a stored OpenRouter id has lost its key, fall back to the
  // native default rather than failing every generation call.
  if (model.startsWith("openrouter:") && !process.env.OPENROUTER_API_KEY) return CONTENT_MODEL;
  return model;
}

/** Admin setter. Rejects an id not in CAMPAIGN_MODEL_CHOICES (incl. any MODEL_CATALOG-only OpenRouter id). */
export async function setCampaignBuildModel(id: string): Promise<void> {
  if (!isCampaignBuildModelId(id)) throw new Error(`Unknown campaign build model: ${id}`);
  const { setKey } = await import("@/lib/settings");
  setKey(CAMPAIGN_MODEL_KEY, id);
}
