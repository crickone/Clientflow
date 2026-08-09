/**
 * Unit tests for the shared Claude client + model tiers: the pinned model IDs
 * (incl. the "never Fable" cost guard) and the cents-per-1M cost estimator.
 * Pure, no I/O — never touches ANTHROPIC_API_KEY or the network.
 *
 * Extended for multi-provider Task 4 (MP4): pins the real OpenRouter rates
 * for the four new catalog models (Kimi K2, Qwen3, GPT-5, Gemini), and adds
 * a coverage guard proving every MODEL_CATALOG id has a dedicated PRICING
 * entry — see that block below for why this matters.
 * Run: npx tsx src/lib/ai/client.test.ts
 */
import assert from "node:assert/strict";

import { MODELS, PRICING, estCostCents } from "./client";
import { MODEL_CATALOG } from "./modelCatalog";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Model IDs must be pinned exactly, and Fable must never appear anywhere in
// MODELS — it's deliberately excluded for cost reasons (see client.ts).
check("MODELS.sonnet is claude-sonnet-5", MODELS.sonnet, "claude-sonnet-5");
check("MODELS.opus is claude-opus-4-8", MODELS.opus, "claude-opus-4-8");
check(
  "MODELS.haiku is claude-haiku-4-5-20251001",
  MODELS.haiku,
  "claude-haiku-4-5-20251001",
);
ok(
  "MODELS never mentions fable",
  !/fable/i.test(JSON.stringify(MODELS)),
);

// estCostCents — list pricing, cents per 1M tokens.
// Sonnet: $3/1M in, $15/1M out -> 300c / 1500c
check(
  "1M input + 1M output tokens on sonnet costs 1800c",
  estCostCents(MODELS.sonnet, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
  1800,
);
// cache read is 0.1x input price
check(
  "1M cache-read tokens on sonnet costs 30c (0.1x input price)",
  estCostCents(MODELS.sonnet, {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 1_000_000,
  }),
  30,
);

// MP3: DeepSeek (via OpenRouter) must be priced for real, not silently
// falling back to the Sonnet default in estCostCents (that fallback is meant
// for genuinely-unpriced/legacy ids, not a model the picker actively
// offers) — otherwise the €25/tenant cap is wrong for every agent someone
// switches to it. Read the id from MODEL_CATALOG rather than hardcoding it a
// second time, so a future slug change can't silently desync the two files.
{
  const deepseek = MODEL_CATALOG.find((m) => m.provider === "openrouter");
  assert.ok(deepseek, "MODEL_CATALOG has an OpenRouter (DeepSeek) entry");
  const id = deepseek!.id;
  ok(`PRICING has a dedicated entry for ${id}`, id in PRICING);
  ok(
    "that entry is NOT the Sonnet fallback values (300/1500) — it's priced for real",
    PRICING[id].inCents !== PRICING[MODELS.sonnet].inCents || PRICING[id].outCents !== PRICING[MODELS.sonnet].outCents,
  );
  ok(
    "DeepSeek is in fact cheaper than Sonnet on both input and output (the point of offering a low-cost option)",
    PRICING[id].inCents < PRICING[MODELS.sonnet].inCents && PRICING[id].outCents < PRICING[MODELS.sonnet].outCents,
  );
  check(
    "1M input + 1M output tokens on DeepSeek costs 42c (14c in + 28c out per 1M)",
    estCostCents(id, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    42,
  );
}

// MP4: Kimi K2, Qwen3, GPT-5, and Gemini (all via OpenRouter) — same
// "priced for real, not the Sonnet fallback" guarantee as DeepSeek above,
// pinned per model (rather than looped generically) so a future price edit
// to one model can't silently break another's without a named failure.
// Rates sourced live from openrouter.ai/api/v1/models on 2026-08-09 — see
// modelCatalog.ts's per-entry comments for the exact-slug rationale.
{
  const newModelRates: Record<string, { inCents: number; outCents: number }> = {
    "openrouter:moonshotai/kimi-k2-0905": { inCents: 60, outCents: 250 },
    "openrouter:qwen/qwen3-235b-a22b-2507": { inCents: 9, outCents: 55 },
    "openrouter:openai/gpt-5": { inCents: 125, outCents: 1000 },
    "openrouter:google/gemini-3.1-pro-preview": { inCents: 200, outCents: 1200 },
  };
  for (const [id, expected] of Object.entries(newModelRates)) {
    ok(`MODEL_CATALOG includes ${id}`, MODEL_CATALOG.some((m) => m.id === id));
    check(`PRICING[${id}] matches the sourced OpenRouter rate`, PRICING[id], expected);
    check(
      `1M input + 1M output tokens on ${id} costs ${expected.inCents + expected.outCents}c`,
      estCostCents(id, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
      expected.inCents + expected.outCents,
    );
  }
}

// MP4 coverage guard: every MODEL_CATALOG id must have a dedicated PRICING
// entry. This is the backstop against ANY catalog model — today's four new
// ones, or the next one anybody adds later — silently falling back to the
// Sonnet rate in estCostCents and mis-metering the €25/tenant cap (the exact
// failure mode the DeepSeek entry above was added to prevent, generalised
// to the whole catalog). Deliberately loops over MODEL_CATALOG itself
// rather than a hardcoded id list, so this keeps enforcing itself the next
// time the catalog grows.
{
  ok("MODEL_CATALOG has at least 7 entries for this guard to be meaningful", MODEL_CATALOG.length >= 7);
  for (const { id } of MODEL_CATALOG) {
    ok(`PRICING has a dedicated entry for catalog model ${id}`, id in PRICING);
  }
}

console.log(`\nai/client.test.ts: ${passed} checks passed.`);
