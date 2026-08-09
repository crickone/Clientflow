/**
 * Sanity tests for the client-safe model catalog (@/lib/ai/modelCatalog) —
 * the single source of truth for the per-agent model picker (AgentDetail),
 * the org-chart chip label (AgentOrgChart), and `updateAgentModel`'s
 * allowlist (registry.ts, see registry.test.ts for the allowlist-side
 * assertions). Pure, no I/O, zero imports in the module under test — this
 * file just proves that contract holds and stays importable from a
 * "use client" component.
 *
 * Extended for multi-provider Task 4 (MP4): the catalog grew from 3 to 7
 * entries (Sonnet 5 + Opus 4.8 native, plus DeepSeek/Kimi K2/Qwen3/GPT-5/
 * Gemini via OpenRouter) — every OpenRouter entry must carry
 * needsOpenRouter:true and resolve a label, and Fable must still never
 * appear.
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
  ok("MODEL_CATALOG has exactly 7 entries (2 Anthropic + 5 OpenRouter)", ids.length === 7);
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
  ok("claude-sonnet-5 is first in the catalog (the default)", MODEL_CATALOG[0]?.id === "claude-sonnet-5");
}

// MP4: five OpenRouter entries now (DeepSeek + Kimi K2 + Qwen3 + GPT-5 +
// Gemini) — every one of them must be flagged needsOpenRouter: true (this is
// what lets AgentDetail render it disabled until OPENROUTER_API_KEY is set),
// carry the "openrouter:" prefix getProvider (@/lib/ai/providers) dispatches
// on, have a non-empty picker note, and resolve a real label via
// modelLabel(). Looping over every OpenRouter entry (rather than hardcoding
// "the one DeepSeek entry" like this block used to) means the next model
// added to the catalog is covered automatically.
{
  const openRouterEntries = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
  ok("exactly five openrouter-provider entries in the catalog", openRouterEntries.length === 5);
  for (const entry of openRouterEntries) {
    ok(`${entry.id}: needsOpenRouter is true`, entry.needsOpenRouter === true);
    ok(`${entry.id}: id carries the "openrouter:" prefix`, entry.id.startsWith("openrouter:"));
    ok(`${entry.id}: has a non-empty picker note`, Boolean(entry.note && entry.note.length > 0));
    ok(`${entry.id}: modelLabel resolves to its own label, not the raw id`, modelLabel(entry.id) === entry.label);
  }
}

// MP4: the four models added in this task, pinned by exact id — each was
// verified live against OpenRouter's model list (see modelCatalog.ts's
// per-entry comments for the sourcing/rationale). Asserting the literal ids
// here means a future accidental rename (e.g. repointing to a "-latest"
// alias, or picking a different Kimi/Qwen/Gemini variant) fails a test
// instead of silently drifting.
{
  const expectedLabels: Record<string, string> = {
    "openrouter:moonshotai/kimi-k2-0905": "Kimi K2",
    "openrouter:qwen/qwen3-235b-a22b-2507": "Qwen3 235B",
    "openrouter:openai/gpt-5": "GPT-5",
    "openrouter:google/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  };
  for (const [id, label] of Object.entries(expectedLabels)) {
    const entry = MODEL_CATALOG.find((m) => m.id === id);
    ok(`${id} is present in MODEL_CATALOG`, Boolean(entry));
    ok(`${id}: provider is openrouter`, entry?.provider === "openrouter");
    ok(`modelLabel(${id}) is "${label}"`, modelLabel(id) === label);
  }
}

console.log(`\nai/modelCatalog.test.ts: ${passed} checks passed.`);
