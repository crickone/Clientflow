// Run: npm test -- src/lib/format.test.ts
import assert from "node:assert/strict";

import { bytes, fmtCents } from "./format";

assert.equal(bytes(0), "0 B");
assert.equal(bytes(512), "512 B");
assert.equal(bytes(1536), "1.5 KB");
assert.equal(bytes(3.4 * 1024 * 1024), "3.4 MB");
assert.equal(fmtCents(12345), "€123.45");
assert.equal(fmtCents(5), "€0.05");
console.log("format.test.ts: ok");
