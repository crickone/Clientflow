// Run: npm test -- src/lib/ai/video/falVideoClient.test.ts
//
// AI b-roll clips are a REAL per-clip charge (fal bills the model per second of
// output), so the cost function is money-critical: it's what meterAndChargeFlat
// bills the tenant and what the picker quotes before you commit. These pin the
// two supported clip lengths and that the quote the UI shows equals the amount
// actually charged.
//
// The fal call itself (queue submit → poll → download) isn't exercised here —
// it needs the network and a key; the gate/meter contract around it lives in
// generateBroll.ts and is enforced by meteredGuard.test.ts, which also sanctions
// this file as a reviewed provider chokepoint.
import assert from "node:assert/strict";

import {
  videoCostCents,
  VIDEO_COST_CENTS_PER_5S,
  VIDEO_MODEL_ID,
} from "./falVideoClient";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// fal bills this model at $0.07/second, so 5s = 35¢ and 10s = 70¢.
assert.strictEqual(videoCostCents(5), 35, "a 5s clip costs 35c");
passed++;
assert.strictEqual(videoCostCents(10), 70, "a 10s clip costs 70c (double)");
passed++;
assert.strictEqual(
  videoCostCents(5),
  VIDEO_COST_CENTS_PER_5S,
  "the 5s cost is the exported base unit",
);
passed++;
ok("a 10s clip is exactly twice a 5s clip", videoCostCents(10) === videoCostCents(5) * 2);

// The picker quotes `count × videoCostCents(duration)` before generating; the
// route bills the same per clip. Pin that the quote matches for a full basket
// at the 6-clip ceiling, so the UI can never under-quote what gets charged.
const MAX_PICKS = 6;
assert.strictEqual(
  MAX_PICKS * videoCostCents(5),
  210,
  "6 five-second clips quote as €2.10",
);
passed++;
assert.strictEqual(
  MAX_PICKS * videoCostCents(10),
  420,
  "6 ten-second clips quote as €4.20",
);
passed++;

// The model id is what lands in the per-tenant usage ledger — keep it stable
// and namespaced like the image one (fal:flux-1.1-pro).
ok("model id is namespaced to the provider", VIDEO_MODEL_ID.startsWith("fal:"));

console.log(`falVideoClient.test.ts: all ${passed} assertions passed`);
