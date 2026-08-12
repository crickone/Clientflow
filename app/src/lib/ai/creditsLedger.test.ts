// Run: npm test -- src/lib/ai/creditsLedger.test.ts
//
// The AI-credit ledger (prepaid overflow beyond the free tranche). Proves the
// money-safety invariant + the ONE AI-specific divergence from the email
// ledger: a `usage` debit may drive the balance negative (you can't un-burn
// tokens), while grants never can. Same scratch-tenant pattern as usage.test.ts
// (a real throwaway tenant row — ai_credits.tenant_id has an FK and control.ts
// runs with foreign_keys = ON).
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  getAiBalanceCents,
  grantAiCredits,
  recordAiSpend,
  listAiLedger,
  getAiAutoTopup,
  setAiAutoTopup,
  isAiSuspended,
  setAiSuspended,
  getAiMarginBp,
  setAiMarginBp,
  withMargin,
  DEFAULT_AI_MARGIN_BP,
} from "./creditsLedger";

(() => {
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aicredits-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aicredits-test','AI Credits Test','tenants/aicredits-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_credit_ledger WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM ai_credits WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // ── fresh tenant reads as empty ──
    assert.equal(getAiBalanceCents(tid), 0, "never-granted tenant reads 0");
    assert.equal(isAiSuspended(tid), false, "never-suspended reads false");
    assert.deepEqual(
      getAiAutoTopup(tid),
      { enabled: false, thresholdCents: 0, amountCents: 0 },
      "auto-topup defaults off/0/0",
    );
    assert.equal(listAiLedger(tid).length, 0, "no ledger rows yet");

    // ── grant raises balance + writes one ledger row ──
    assert.equal(grantAiCredits(tid, 1000, "admin:test"), 1000, "grant returns new balance");
    assert.equal(getAiBalanceCents(tid), 1000);
    let ledger = listAiLedger(tid);
    assert.equal(ledger.length, 1, "grant wrote one ledger row");
    assert.equal(ledger[0].deltaCents, 1000);
    assert.equal(ledger[0].reason, "topup");
    assert.equal(ledger[0].balanceAfterCents, 1000, "ledger carries authoritative balance_after");
    assert.equal(ledger[0].note, "admin:test", "note carries the actor");

    // ── spend debits + writes a 'usage' row ──
    assert.equal(recordAiSpend(tid, 300, "blog"), 700, "spend returns new balance");
    assert.equal(getAiBalanceCents(tid), 700);
    ledger = listAiLedger(tid);
    assert.equal(ledger[0].deltaCents, -300, "newest row is the spend");
    assert.equal(ledger[0].reason, "usage");
    assert.equal(ledger[0].note, "blog", "usage note carries the agentKey");

    // ── the AI divergence: a usage debit MAY go negative (can't un-burn tokens) ──
    assert.equal(recordAiSpend(tid, 1000, "sales"), -300, "usage debit is allowed to overshoot to negative");
    assert.equal(getAiBalanceCents(tid), -300);

    // ── a top-up first clears the debt, then adds ──
    assert.equal(grantAiCredits(tid, 500, "admin:test", "topup"), 200, "grant nets against the negative balance");
    assert.equal(getAiBalanceCents(tid), 200);

    // ── input validation ──
    assert.throws(() => grantAiCredits(tid, 0, "a"), /positive whole number/, "grant rejects 0");
    assert.throws(() => grantAiCredits(tid, -5, "a"), /positive whole number/, "grant rejects negative");
    assert.throws(() => recordAiSpend(tid, 0, "a"), /positive whole number/, "spend rejects 0");

    // ── margin: default 5%, rounded UP, and configurable ──
    assert.equal(DEFAULT_AI_MARGIN_BP, 500, "default margin is 5.00%");
    const origMargin = getAiMarginBp();
    try {
      setAiMarginBp(500);
      assert.equal(withMargin(1000), 1050, "5% on 1000c = 1050c");
      assert.equal(withMargin(0), 0, "0 raw = 0 billable");
      assert.equal(withMargin(1), 2, "rounds UP so the platform never under-charges (1c → 2c at 5%)");
      setAiMarginBp(1000);
      assert.equal(withMargin(1000), 1100, "10% on 1000c = 1100c");
      assert.throws(() => setAiMarginBp(-1), /between 0 and/, "margin rejects negative");
      assert.throws(() => setAiMarginBp(10_001), /between 0 and/, "margin rejects > 100%");
    } finally {
      setAiMarginBp(origMargin); // restore global setting
    }

    // ── auto-topup config persists (execution is a later, CreatePay task) ──
    setAiAutoTopup(tid, { enabled: true, thresholdCents: 500, amountCents: 2000 });
    assert.deepEqual(getAiAutoTopup(tid), { enabled: true, thresholdCents: 500, amountCents: 2000 });
    assert.equal(getAiBalanceCents(tid), 200, "auto-topup config write does not touch the balance");
    assert.throws(
      () => setAiAutoTopup(tid, { enabled: true, thresholdCents: 500, amountCents: 0 }),
      /greater than 0 when enabled/,
      "enabled auto-topup needs a positive amount",
    );

    // ── suspend kill switch persists independently of balance ──
    setAiSuspended(tid, true, "admin:test");
    assert.equal(isAiSuspended(tid), true);
    assert.equal(getAiBalanceCents(tid), 200, "suspend write does not touch the balance");
    setAiSuspended(tid, false, "admin:test");
    assert.equal(isAiSuspended(tid), false);

    console.log("ai/creditsLedger.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
