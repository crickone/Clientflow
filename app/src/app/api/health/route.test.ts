// Run: npm test -- src/app/api/health/route.test.ts
//
// Batch 1 (production safety net): GET /api/health returns ok on a working
// control DB, and the body shape leaks nothing beyond ok+ts (no auth on this
// route, so the response must stay boring on purpose).
import assert from "node:assert/strict";
import { GET } from "./route";

(async () => {
  const res = await GET();
  assert.equal(res.status, 200, "the control DB is reachable in this test env, so health must report 200");

  const body = (await res.json()) as { ok: boolean; ts?: string };
  assert.equal(body.ok, true);
  assert.equal(typeof body.ts, "string", "ts must be a string timestamp");
  assert.ok(!Number.isNaN(Date.parse(body.ts!)), "ts must be a parseable date");

  // Nothing sensitive: exactly {ok, ts} on the success path — no tenant data,
  // no version string, no internal paths.
  assert.deepEqual(Object.keys(body).sort(), ["ok", "ts"]);

  console.log("api/health/route.test.ts: all assertions passed");
})();
