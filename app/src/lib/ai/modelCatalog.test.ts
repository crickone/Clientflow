/**
 * Sanity tests for the client-safe model catalog (@/lib/ai/modelCatalog) —
 * the single source of truth for the per-agent model picker (AgentDetail),
 * the org-chart chip label (AgentOrgChart), and `updateAgentModel`'s
 * allowlist (registry.ts, see registry.test.ts for the allowlist-side
 * assertions). Pure, no I/O, zero imports in the module under test — this
 * file just proves that contract holds and stays importable from a
 * "use client" component.
 * Run: npm test -- src/lib/ai/modelCatalog.test.ts
 */
import assert from "node:assert/strict";

import { MODEL_CATALOG, isCatalogModel, modelLabel } from "./modelCatalog";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Every catalog id is unique — a duplicate would make modelLabel/
// isCatalogModel ambiguous (Array.prototype.find silently picks the first
// match) without ever surfacing as an error.
{
  const ids = MODEL_CATALOG.map((m) => m.id);
  ok("MODEL_CATALOG is non-empty", ids.length > 0);
  ok("every MODEL_CATALOG id is unique", new Set(ids).size === ids.length);
}

// modelLabel: known id -> its label; unknown id -> the id itself, verbatim,
// never a throw and never the string "undefined".
ok("modelLabel(claude-sonnet-5) is Sonnet 5", modelLabel("claude-sonnet-5") === "Sonnet 5");
ok("modelLabel(claude-opus-4-8) is Opus 4.8", modelLabel("claude-opus-4-8") === "Opus 4.8");
ok(
  "modelLabel of an unknown id returns the id verbatim",
  modelLabel("some-unknown-model-id") === "some-unknown-model-id",
);

// isCatalogModel mirrors modelLabel's known/unknown split — this predicate is
// what the picker uses to decide whether to show the "Current: <raw id>"
// fallback line for an agent whose `model` column holds something no longer
// (or never) in the catalog.
ok("isCatalogModel(claude-sonnet-5) is true", isCatalogModel("claude-sonnet-5"));
ok("isCatalogModel(unknown id) is false", !isCatalogModel("some-unknown-model-id"));

// Fable must never be selectable. It's not (and must never be) in the
// catalog — this is what actually makes the picker unable to render it,
// independent of registry.ts's own allowlist backstop (see registry.test.ts).
ok("claude-fable-5 is not in MODEL_CATALOG", !MODEL_CATALOG.some((m) => m.id === "claude-fable-5"));
ok("isCatalogModel(claude-fable-5) is false", !isCatalogModel("claude-fable-5"));
ok("no catalog id contains the substring 'fable' (case-insensitive)", !/fable/i.test(JSON.stringify(MODEL_CATALOG)));

// Anthropic default unchanged — Sonnet 5 must still be present as the
// anthropic-provider entry with no needsOpenRouter gate.
{
  const sonnet = MODEL_CATALOG.find((m) => m.id === "claude-sonnet-5");
  ok("claude-sonnet-5 is present and provider:anthropic", sonnet?.provider === "anthropic");
  ok("claude-sonnet-5 does not require OpenRouter", !sonnet?.needsOpenRouter);
}

// Exactly one OpenRouter (DeepSeek) entry, flagged needsOpenRouter: true —
// this is what lets AgentDetail render it disabled until OPENROUTER_API_KEY
// is set, and its id must carry the "openrouter:" prefix getProvider
// (@/lib/ai/providers) dispatches on.
{
  const openRouterEntries = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
  ok("exactly one openrouter-provider entry in the catalog", openRouterEntries.length === 1);
  const deepseek = openRouterEntries[0];
  ok("the OpenRouter entry has needsOpenRouter: true", deepseek?.needsOpenRouter === true);
  ok(
    "the OpenRouter entry's id carries the 'openrouter:' prefix getProvider dispatches on",
    Boolean(deepseek?.id.startsWith("openrouter:")),
  );
  ok("the OpenRouter entry has a non-empty picker note", Boolean(deepseek?.note && deepseek.note.length > 0));
}

console.log(`\nai/modelCatalog.test.ts: ${passed} checks passed.`);
