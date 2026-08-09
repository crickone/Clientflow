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
];

/** id -> label, falling back to the raw id for anything not in the catalog (e.g. a legacy or hand-set model). Never throws. */
export function modelLabel(id: string): string {
  return MODEL_CATALOG.find((m) => m.id === id)?.label ?? id;
}

/** True iff `id` is one of the ids above — the single predicate the picker and `updateAgentModel`'s allowlist both rely on. */
export function isCatalogModel(id: string): boolean {
  return MODEL_CATALOG.some((m) => m.id === id);
}
