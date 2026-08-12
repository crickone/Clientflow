// Run: npm test -- src/lib/ai/aiBilling.test.ts
//
// The tranche → overflow → margin policy that ties the free monthly allowance
// (tenant_ai_cap) to the prepaid credit ledger, exercised end-to-end through
// the two functions the metering chokepoints call: `assertAiAllowed` (the gate)
// and `meterAndCharge` (record usage + bill overflow). Uses a tiny €1 tranche
// so the arithmetic is obvious.
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  assertAiAllowed,
  meterAndCharge,
  getMonthlyUsageCents,
  setTenantCapCents,
  AiCapError,
} from "./usage";
import { getAiBalanceCents, grantAiCredits, setAiSuspended, getAiMarginBp, setAiMarginBp } from "./creditsLedger";
import { estCostCents, MODELS } from "./client";

(() => {
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aibilling-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aibilling-test','AI Billing Test','tenants/aibilling-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const reset = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM ai_credit_ledger WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM ai_credits WHERE tenant_id = ?").run(tid);
  };
  const cleanup = () => {
    reset();
    controlSqlite.prepare("DELETE FROM tenant_ai_cap WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  const origMargin = getAiMarginBp();
  try {
    setAiMarginBp(500); // pin 5% for deterministic arithmetic
    setTenantCapCents(tid, 100); // €1 free tranche

    // Pricing anchors — Sonnet output is $15/1M, so these token counts give
    // round raw costs. If pricing changes, this line fails first (not the math).
    assert.equal(estCostCents(MODELS.sonnet, { inputTokens: 0, outputTokens: 200_000 }), 300, "200k out = 300c raw");
    assert.equal(estCostCents(MODELS.sonnet, { inputTokens: 0, outputTokens: 20_000 }), 30, "20k out = 30c raw");

    // ── A. inside the free tranche, no credits → allowed, nothing billed ──
    reset();
    assert.doesNotThrow(() => assertAiAllowed(tid), "0 usage is inside the free tranche");
    meterAndCharge(tid, "brief", MODELS.sonnet, { inputTokens: 0, outputTokens: 20_000 }); // 30c, under 100c tranche
    assert.equal(getMonthlyUsageCents(tid), 30, "usage recorded");
    assert.equal(getAiBalanceCents(tid), 0, "nothing billed inside the tranche");

    // ── B. a call straddling the tranche bills only the OVERFLOW × margin ──
    reset();
    grantAiCredits(tid, 10_000, "admin:test");
    assert.doesNotThrow(() => assertAiAllowed(tid), "under tranche + has credits");
    meterAndCharge(tid, "blog", MODELS.sonnet, { inputTokens: 0, outputTokens: 200_000 }); // 300c raw
    // freeRemaining = 100, overflow = 300 - 100 = 200, billable = ceil(200 * 1.05) = 210
    assert.equal(getAiBalanceCents(tid), 10_000 - 210, "only the 200c over the tranche is billed, +5% = 210c");

    // ── C. fully past the tranche → the whole next call is billed ──
    assert.doesNotThrow(() => assertAiAllowed(tid), "over tranche but has credits");
    meterAndCharge(tid, "blog", MODELS.sonnet, { inputTokens: 0, outputTokens: 200_000 }); // 300c raw, freeRemaining now 0
    // overflow = 300, billable = ceil(300 * 1.05) = 315
    assert.equal(getAiBalanceCents(tid), 10_000 - 210 - 315, "whole 300c billed once tranche is exhausted");

    // ── D. no credits + over tranche → blocked (the old-cap-equivalent) ──
    reset();
    // one call slips through (still under tranche at gate time) and records its
    // true overflow as debt (can't un-burn tokens): 300c raw, overflow 200 → 210c
    assert.doesNotThrow(() => assertAiAllowed(tid), "first call is under the tranche");
    meterAndCharge(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 200_000 });
    assert.equal(getAiBalanceCents(tid), -210, "the single overshoot is recorded as a small debt");
    assert.throws(() => assertAiAllowed(tid), AiCapError, "over tranche + no credits (negative balance) is blocked");

    // ── E. suspend blocks even inside the tranche ──
    reset();
    setAiSuspended(tid, true, "admin:test");
    assert.throws(() => assertAiAllowed(tid), AiCapError, "suspended tenant is blocked regardless of tranche/credits");
    setAiSuspended(tid, false, "admin:test");
    assert.doesNotThrow(() => assertAiAllowed(tid), "un-suspended is allowed again");

    console.log("ai/aiBilling.test.ts: all assertions passed");
  } finally {
    setAiMarginBp(origMargin);
    cleanup();
  }
})();
