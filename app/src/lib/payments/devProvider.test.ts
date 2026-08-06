// Run: npx tsx src/lib/payments/devProvider.test.ts
import assert from "node:assert/strict";
import { devProvider, DEV_TOKENS } from "./devProvider";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported. An uncaught rejection from this IIFE still
// crashes the process with a non-zero exit code, matching the pass/fail
// signal scripts/test.mjs relies on for every *.test.ts file.
(async () => {
  const cap = await devProvider.createCaptureSession({
    tenantId: 7, amountCents: 12177, returnUrl: "/billing/activate", sessionRef: "cs_test1",
  });
  assert.equal(cap.sessionRef, "cs_test1");
  assert.equal(cap.redirectUrl, "/dev/pay/cs_test1");

  const ok = await devProvider.chargeToken({ token: DEV_TOKENS.ok, amountCents: 12177, currency: "EUR", invoiceRef: "inv_1" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.match(ok.gatewayRef, /^dev_/);

  const bad = await devProvider.chargeToken({ token: DEV_TOKENS.decline, amountCents: 12177, currency: "EUR", invoiceRef: "inv_2" });
  assert.deepEqual(bad, { ok: false, reason: "declined", message: "Card declined (dev token)" });

  const unknown = await devProvider.chargeToken({ token: "tok_garbage", amountCents: 1, currency: "EUR", invoiceRef: "inv_3" });
  assert.equal(unknown.ok, false);

  assert.deepEqual(await devProvider.refund("dev_x", 100), { ok: true });
  console.log("devProvider.test.ts: all assertions passed");
})();
