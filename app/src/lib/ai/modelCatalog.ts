/**
 * The curated, user-visible model catalog for the per-agent model picker
 * (`AgentDetail`'s ModelCard) and the org-chart chip (`AgentOrgChart`).
 *
 * CLIENT-SAFE BY DESIGN — this file has ZERO imports and no secrets, so it
 * can be imported directly by "use client" components. `@/lib/ai/client`'s
 * `MODELS`/`PRICING` can't cross that boundary (that module starts with
 * `import "server-only"`), which is exactly why `AgentDetail.tsx` and
 * `AgentOrgChart.tsx` used to each hand-maintain their OWN copy of the
 * id -> label map (`MODEL_OPTIONS` / `MODEL_LABEL`). This file is the single
 * source of truth those two duplicates are replaced with. `registry.ts`'s
 * `updateAgentModel` allowlist also reads `MODEL_CATALOG` (server-side —
 * importing a client-safe leaf module creates no cycle).
 *
 * Fable is deliberately NEVER listed here. The picker can only ever render
 * what's in this array, so leaving Fable off the catalog is what makes it
 * unselectable from the UI in the first place; `updateAgentModel`'s allowlist
 * (fed by this same array) is the server-side backstop for any other caller.
 */
export interface ModelChoice {
  /** Stored verbatim in `agents.model`; also what `getProvider` (@/lib/ai/providers) and `PRICING` (@/lib/ai/client) key off of. */
  id: string;
  /** Short UI label, e.g. "Sonnet 5". */
  label: string;
  provider: "anthropic" | "openrouter";
  /** true -> requires `OPENROUTER_API_KEY` to actually run. The picker renders the option disabled until the server reports the key is configured. */
  needsOpenRouter?: boolean;
  /** One-line picker hint shown under the label. */
  note?: string;
}

export const MODEL_CATALOG: ModelChoice[] = [
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    note: "Balanced default — best all-round tool use.",
  },
  {
    id: "claude-opus-4-8",
    label: "Opus 4.8",
    provider: "anthropic",
    note: "Most capable — for the hardest tasks.",
  },
  {
    // Dated snapshot ("0731"), deliberately NOT the "-latest" alias — see the
    // matching PRICING entry in @/lib/ai/client for why a pinned id matters
    // here (a "-latest" repoint could silently change both behaviour and
    // price out from under an already-priced PRICING entry).
    id: "openrouter:deepseek/deepseek-v4-flash-0731",
    label: "DeepSeek V4 Flash",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model via OpenRouter — lowest cost; tool use is good but benchmark before relying on it.",
  },
  {
    // Dated refresh ("0905") over the bare "kimi-k2" (0711 release, 131K
    // context, no structured_outputs support) and over "kimi-k2-thinking" (a
    // distinct reasoning-tuned sibling, not the plain agentic model this
    // entry is meant to be) — 0905 adds a larger 262K context and
    // structured-outputs support at the same OpenRouter price, making it the
    // current best tool-use pick still branded plain "Kimi K2". Verified
    // live against openrouter.ai/api/v1/models on 2026-08-09 — see the
    // matching PRICING entry in @/lib/ai/client for the sourced price.
    id: "openrouter:moonshotai/kimi-k2-0905",
    label: "Kimi K2",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model via OpenRouter — excellent agentic tool use, great value.",
  },
  {
    // "-2507" dated refresh of Qwen3 235B A22B Instruct (a post-training
    // update over the earlier undated "qwen3-235b-a22b") — the flagship
    // OPEN-WEIGHT Qwen3 checkpoint, distinct from Alibaba's closed
    // "qwen3-max"/"qwen3.8-max" tier (9-20x pricier). Verified live against
    // openrouter.ai/api/v1/models on 2026-08-09 — see the matching PRICING
    // entry in @/lib/ai/client for the sourced price.
    id: "openrouter:qwen/qwen3-235b-a22b-2507",
    label: "Qwen3 235B",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model via OpenRouter — cheapest option here, solid tool use.",
  },
  {
    // OpenAI's flagship, routed through OpenRouter rather than a native
    // OpenAI integration (there isn't one — this app is Anthropic-native;
    // see multiprovider-design.md). Bare "gpt-5" (NOT -mini/-nano/-pro/-codex,
    // and not the newer 5.1/5.2/... line) is OpenAI's primary GPT-5 id.
    // Verified live against openrouter.ai/api/v1/models on 2026-08-09 — see
    // the matching PRICING entry in @/lib/ai/client for the sourced price.
    id: "openrouter:openai/gpt-5",
    label: "GPT-5",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "OpenAI flagship via OpenRouter — top-tier reasoning, premium price.",
  },
  {
    // Google's current flagship "Pro" tier — still shipping under "-preview"
    // naming (Gemini 2.5 Pro spent months the same way before the suffix was
    // dropped); there is no non-preview "gemini-3.1-pro" id yet, so this is
    // the current best flagship pick. OpenRouter's listed price is the BASE
    // (<200K prompt tokens) tier — see the matching PRICING entry in
    // @/lib/ai/client for the >200K-token pricing caveat this flat model
    // can't represent. Verified live against openrouter.ai/api/v1/models on
    // 2026-08-09.
    id: "openrouter:google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Google flagship via OpenRouter — huge 1M-token context, mid-premium price.",
  },
];

/** id -> label, falling back to the raw id for anything not in the catalog (e.g. a legacy or hand-set model). Never throws. */
export function modelLabel(id: string): string {
  return MODEL_CATALOG.find((m) => m.id === id)?.label ?? id;
}

/** True iff `id` is one of the ids above — the single predicate the picker and `updateAgentModel`'s allowlist both rely on. */
export function isCatalogModel(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}
