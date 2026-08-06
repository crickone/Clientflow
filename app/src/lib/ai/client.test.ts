/**
 * Unit tests for the shared Claude client + model tiers: the pinned model IDs
 * (incl. the "never Fable" cost guard) and the cents-per-1M cost estimator.
 * Pure, no I/O — never touches ANTHROPIC_API_KEY or the network.
 * Run: npx tsx src/lib/ai/client.test.ts
 */
import assert from "node:assert/strict";

import { MODELS, estCostCents } from "./client";

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

console.log(`\nai/client.test.ts: ${passed} checks passed.`);
