// Run: npm test -- src/lib/ai/altText.test.ts
//
// Batch 3a (AI cap metering): generateAltText is the BACKGROUND/AUTO
// representative site (upload + regenerate-alt flows call it, best-effort).
// Proves:
//   1. An over-cap tenant gets a clean `null` back — never a throw — so an
//      alt-text call never breaks an upload or a backfill. assertUnderCap
//      runs FIRST inside the try (before the API-key guard), so this is a
//      genuine proof the CAP causes the null, not a coincidental null from
//      this environment's missing ANTHROPIC_API_KEY (deliberately unset here,
//      same as every other AI-call test in this repo — see
//      tools.marketing.test.ts's note) or an unsupported mime type.
//   2. recordUsage buckets a "media"/MODELS.haiku call correctly, so a real
//      successful call (which this test environment can't make — no Claude
//      credentials) would show up right in the per-agent/per-model spend
//      dashboard.
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { generateAltText } from "./altText";
import { recordUsage, getMonthlyUsageByAgent, getMonthlyUsageByModel } from "./usage";
import { MODELS } from "./client";

(async () => {
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'alttext-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('alttext-test','AltText Test','tenants/alttext-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // Push the tenant over its cap. 2,000,000 output tokens on sonnet
    // ($15/1M out) -> 3000c, over the 2500c cap.
    recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });

    // A tiny 1x1 PNG — a supported mime with real (if trivial) bytes. Content
    // doesn't matter: the cap check fires before any bytes are sent anywhere.
    const onePixelPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    const result = await generateAltText(onePixelPng, "image/png", "test image", tid);
    assert.equal(
      result,
      null,
      "an over-cap tenant gets a clean null, not a throw — background/best-effort callers must never break on the cap",
    );

    // ── recordUsage buckets a "media"/MODELS.haiku call correctly (the exact
    // agentKey+model generateAltText uses internally) — reusing the same
    // (already over-cap) tenant is fine; recordUsage itself doesn't consult
    // the cap, it just records. ──
    recordUsage(tid, "media", MODELS.haiku, { inputTokens: 200, outputTokens: 20 });
    const byAgent = getMonthlyUsageByAgent(tid);
    const byModel = getMonthlyUsageByModel(tid);
    assert.ok(
      "media" in byAgent,
      "recordUsage bucketed the call under the 'media' agentKey generateAltText uses",
    );
    assert.ok(
      byModel.some((r) => r.model === MODELS.haiku),
      "recordUsage bucketed the call under MODELS.haiku, the model generateAltText calls",
    );

    console.log("ai/altText.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
