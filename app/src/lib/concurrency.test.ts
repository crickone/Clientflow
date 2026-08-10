// Run: npm test -- src/lib/concurrency.test.ts
//
// Batch 5a (improvement-plan-2026-08.md Theme F1): unit tests for the bounded
// concurrency map extracted for Gmail sync's per-message fetch. Covers what
// the brief calls out specifically: order/association is preserved
// regardless of completion order, concurrency is actually bounded, and one
// failing item doesn't drop or abort the rest.
import assert from "node:assert/strict";
import { mapWithConcurrency } from "./concurrency";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  // ── association is preserved in input order, regardless of completion order ──
  {
    // Reversed artificial delays so the SLOWEST item starts first and the
    // FASTEST finishes first — if results were appended in completion order
    // instead of index order, this would come back scrambled.
    const items = [50, 40, 30, 20, 10, 0, 5];
    const results = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms * 2;
    });
    assert.deepEqual(
      results.map((r) => (r.ok ? r.value : "ERR")),
      items.map((ms) => ms * 2),
      "results stay associated with their input index, not completion order",
    );
    assert.ok(results.every((r) => r.ok), "all items succeeded");
  }

  // ── concurrency is actually bounded ──
  {
    const limit = 3;
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, limit, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i;
    });
    assert.ok(
      maxInFlight <= limit,
      `never more than ${limit} in flight at once (saw ${maxInFlight})`,
    );
    assert.equal(maxInFlight, limit, "actually uses the full pool, not less");
  }

  // ── one failing item doesn't drop or abort the rest (best-effort) ──
  {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (i) => {
      if (i === 3) throw new Error("boom");
      return i * 10;
    });
    assert.equal(results.length, items.length, "a result slot exists for every item");
    assert.equal(results[2].ok, false, "the failing item's slot is marked failed");
    if (!results[2].ok) assert.ok(results[2].error instanceof Error);
    const others = results.filter((_, i) => i !== 2);
    assert.ok(
      others.every((r) => r.ok),
      "every other item still succeeded despite one failure",
    );
    assert.deepEqual(
      others.map((r) => (r.ok ? r.value : null)),
      [10, 20, 40, 50],
      "successful results are still correct and in order",
    );
  }

  // ── edge cases: empty input, limit larger than input, limit <= 0 ──
  {
    assert.deepEqual(await mapWithConcurrency([], 5, async (x) => x), []);
    const small = await mapWithConcurrency([1, 2], 10, async (x) => x + 1);
    assert.deepEqual(small.map((r) => (r.ok ? r.value : null)), [2, 3]);
    const zeroLimit = await mapWithConcurrency([1, 2], 0, async (x) => x + 1);
    assert.deepEqual(
      zeroLimit.map((r) => (r.ok ? r.value : null)),
      [2, 3],
      "a non-positive limit still makes progress (treated as at least 1)",
    );
  }

  console.log("lib/concurrency.test.ts: all assertions passed");
})();
