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
    id: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
    provider: "anthropic",
    note: "Balanced default — best all-round tool use.",
  },
  {
    id: "claude-opus-5-5",
    label: "Opus 5.5",
    provider: "anthropic",
    note: "Most capable — for the hardest tasks.",
  },
  {
    // DeepSeek V4.1 Flash (2026-09-10), successor to the V4 Flash "0731"
    // snapshot this slot used to carry. A bare id: OpenRouter has not issued
    // a dated snapshot of 4.1, and its bare ids name one release rather than
    // a moving "-latest". Verified live against openrouter.ai/api/v1/models
    // on 2026-10-01 -- see the matching PRICING entry in @/lib/ai/client.
    id: "openrouter:deepseek/deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model — lowest cost; tool use is good but benchmark before relying on it.",
  },
  {
    // Kimi K2.6 (2026-04-20), the newest of the plain agentic K2 line, chosen
    // by the operator on 2026-10-01 over Kimi K3. K3 is newer but $0.66 /
    // $10.00 per M tokens -- four times K2's output price -- which would make
    // this slot's "great value" note untrue; K2.6 is cheaper than the K2
    // 0905 it replaces. Verified live against openrouter.ai/api/v1/models on
    // 2026-10-01 -- see the matching PRICING entry in @/lib/ai/client.
    id: "openrouter:moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model — excellent agentic tool use, great value.",
  },
  {
    // Qwen 3.8 Flash (2026-08-26), chosen by the operator on 2026-10-01 to
    // replace Qwen3 235B A22B 2507. About the same cost as the model it
    // replaces, with a 1M-token context where that had 262K. Served by a
    // single OpenRouter provider (Alibaba) at the time of writing. Verified
    // live against openrouter.ai/api/v1/models on 2026-10-01 -- see the
    // matching PRICING entry in @/lib/ai/client.
    id: "openrouter:qwen/qwen3.8-flash",
    label: "Qwen 3.8 Flash",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model — very low cost, 1M-token context, solid tool use.",
  },
  {
    // Z.ai's GLM 5.3 (bare "glm-5.3", NOT the ":batch" async variant, nor the
    // -flash / -flashx / -prime siblings). Successor to GLM 5.2, which was
    // the newest GLM OpenRouter served when this slot was added. Output is
    // dearer than 5.2's listed rate was then, so the note no longer says
    // "very low cost". Verified live against openrouter.ai/api/v1/models on
    // 2026-10-01 -- see the matching PRICING entry in @/lib/ai/client.
    id: "openrouter:z-ai/glm-5.3",
    label: "GLM 5.3",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "Open model — 1M-token context, low cost, strong agentic tool use.",
  },
  {
    // OpenAI's flagship, routed through OpenRouter rather than a native
    // OpenAI integration (there isn't one -- this app is Anthropic-native;
    // see multiprovider-design.md). GPT-6.1 Sol (2026-09-29) is the newest
    // mainline OpenAI model, chosen by the operator on 2026-10-01 to replace
    // GPT-5. "Sol" is the mainline tier; "-pro" variants, "Luna" (the cheap
    // tier) and "Astra" ($10 / $50, the same band as Claude Fable, which this
    // catalog excludes on cost) are deliberately not listed. Verified live
    // against openrouter.ai/api/v1/models on 2026-10-01 -- see the matching
    // PRICING entry in @/lib/ai/client.
    id: "openrouter:openai/gpt-6.1-sol",
    label: "GPT-6.1 Sol",
    provider: "openrouter",
    needsOpenRouter: true,
    note: "OpenAI flagship — top-tier reasoning, premium price.",
  },
  {
    // Unchanged on 2026-10-01: OpenRouter lists no Gemini Pro newer than
    // this (only the 3.5-3.8 Flash line), so it is still the current pick.
    //
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
    note: "Google flagship — huge 1M-token context, mid-premium price.",
  },
];

/** id -> label, falling back to the raw id for anything not in the catalog (e.g. a legacy or hand-set model). Never throws. */
/**
 * Models no longer offered, but which an agent's stored `model` may still
 * name until the tenant migration reaches their database. Labelled so the UI
 * reads "Opus 4.8" rather than a raw id — a retired model is still worth
 * naming plainly to whoever is looking at it.
 */
const RETIRED_LABELS: Record<string, string> = {
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-5": "Opus 5",
  "claude-sonnet-5": "Sonnet 5",
  "openrouter:deepseek/deepseek-v4-flash-0731": "DeepSeek V4 Flash",
  "openrouter:moonshotai/kimi-k2-0905": "Kimi K2",
  "openrouter:qwen/qwen3-235b-a22b-2507": "Qwen3 235B",
  "openrouter:z-ai/glm-5.2": "GLM 5.2",
  "openrouter:openai/gpt-5": "GPT-5",
};

export function modelLabel(id: string): string {
  return MODEL_CATALOG.find((m) => m.id === id)?.label ?? RETIRED_LABELS[id] ?? id;
}

/** True iff `id` is one of the ids above — the single predicate the picker and `updateAgentModel`'s allowlist both rely on. */
export function isCatalogModel(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}
