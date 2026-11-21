// Run: cd app && npx tsx src/lib/platform/queueReason.test.ts
import assert from "node:assert/strict";

import { queueReason } from "./queueReason";

assert.equal(queueReason(null), null);
assert.equal(queueReason("   "), null);
assert.equal(queueReason("  WhatsApp\n  not connected "), "WhatsApp not connected");
const long = "x".repeat(200);
assert.equal(queueReason(long)!.length, 120);
assert.ok(queueReason(long)!.endsWith("..."));
console.log("queueReason: ok");
