// Run: npm test -- src/lib/ai/falErrors.test.ts
import assert from "node:assert/strict";

import { falErrorMessage } from "./falErrors";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("the TOP_UP lock says top up", falErrorMessage("Image", 403, '{"detail":"User is locked. Reason: TOP_UP."}').includes("out of credit"));
check("exhausted balance too", falErrorMessage("Video", 403, '{"detail":"Exhausted balance"}').includes("fal.ai/dashboard/billing"));
check("a bad key says so", falErrorMessage("Image", 401, "Unauthorized").includes("FAL_KEY"));
check("anything else keeps the raw text", falErrorMessage("Image", 500, "boom") === "Image API error 500: boom");

console.log(`falErrors: ${passed} checks passed`);
