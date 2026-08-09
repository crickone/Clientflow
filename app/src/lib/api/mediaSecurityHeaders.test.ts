/**
 * Unit tests for the shared media/file-serve response-header helper
 * (Batch 2a — neutralises script-bearing SVG on the serve side). Pure, no
 * I/O. Run: npx tsx src/lib/api/mediaSecurityHeaders.test.ts
 */
import assert from "node:assert/strict";

import { mediaSecurityHeaders } from "./mediaSecurityHeaders";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const headers = mediaSecurityHeaders();

ok("returns a plain object", typeof headers === "object" && headers !== null);
ok(
  "has exactly the two documented keys",
  Object.keys(headers).sort().join(",") === "Content-Security-Policy,X-Content-Type-Options",
);
ok("X-Content-Type-Options is nosniff", headers["X-Content-Type-Options"] === "nosniff");

const csp = headers["Content-Security-Policy"];
ok("CSP defaults to 'none'", /default-src\s+'none'/.test(csp));
ok("CSP sandboxes the response (disables script execution)", /(^|;)\s*sandbox(\s|;|$)/.test(csp));
ok("CSP allows inline styles (so SVG/CSS still renders)", /style-src\s+'unsafe-inline'/.test(csp));
ok("CSP allows self + data: images", /img-src\s+'self'\s+data:/.test(csp));
ok("CSP does not allow script-src at all (no explicit script-src directive)", !/script-src/.test(csp));

// Shape must be stable across calls (no hidden mutable state / per-call randomness).
const again = mediaSecurityHeaders();
ok("shape is stable across calls", JSON.stringify(headers) === JSON.stringify(again));

console.log(`\nmediaSecurityHeaders: ${passed} checks passed.`);
