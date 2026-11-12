// Run: npm test -- src/lib/format.test.ts
import assert from "node:assert/strict";

import { bytes, dublinDayStartMs, fmtCents } from "./format";

assert.equal(bytes(0), "0 B");
assert.equal(bytes(512), "512 B");
assert.equal(bytes(1536), "1.5 KB");
assert.equal(bytes(3.4 * 1024 * 1024), "3.4 MB");
assert.equal(fmtCents(12345), "€123.45");
assert.equal(fmtCents(5), "€0.05");
assert.equal(dublinDayStartMs("2026-07-01"), Date.UTC(2026, 5, 30, 23, 0, 0));
assert.equal(dublinDayStartMs("2026-01-15"), Date.UTC(2026, 0, 15, 0, 0, 0));
assert.ok(Number.isNaN(dublinDayStartMs("nope")));
console.log("format.test.ts: ok");
