// Run: npm test -- src/lib/voice/usage.test.ts
//
// The voice money path — the part a client reads on a statement and argues
// about, so it is pinned end to end against a real scratch tenant:
//   1. pricing rounding: a sub-20s call (voicemail / no answer) bills
//      NOTHING; everything else rounds UP to the whole minute, per call;
//   2. the entitlement gate: no add-on = refused outright, and the three
//      allowances are consumed in order — trial, then monthly included, then
//      prepaid credits;
//   3. the monthly included-minutes tranche resets by calendar month and a
//      call is never charged against its OWN headroom;
//   4. the runaway-dialler backstop: the monthly spend cap blocks the next
//      dial even when the tenant still holds credits;
//   5. the kill switch, and that metering a finished call NEVER throws (the
//      minutes are already spoken — the debt lands on the balance instead).
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { setAddonStatus } = requireLocal("../billing/addons") as typeof import("../billing/addons");
  const {
    billedMinutesFor,
    costForMinutes,
    getVoicePricePerMinuteCents,
    DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS,
    DEFAULT_VOICE_INCLUDED_MINUTES,
    DEFAULT_VOICE_TRIAL_MINUTES,
    MIN_BILLABLE_SECONDS,
  } = requireLocal("./pricing") as typeof import("./pricing");
  const {
    getVoiceBalanceCents,
    grantVoiceCredits,
    listVoiceLedger,
    setVoiceSuspended,
  } = requireLocal("./credits") as typeof import("./credits");
  const {
    assertVoiceAllowed,
    getMonthUsage,
    includedMinutesRemaining,
    meterVoiceCall,
    setVoiceCapCents,
    trialSecondsRemaining,
    VoiceCapError,
    VoiceNotEnabledError,
  } = requireLocal("./usage") as typeof import("./usage");

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'voice-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('voice-test','Voice Test','tenants/voice-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    for (const tbl of ["voice_credit_ledger", "voice_credits", "voice_usage", "tenant_voice_cap", "tenant_addons"])
      controlSqlite.prepare(`DELETE FROM ${tbl} WHERE tenant_id = ?`).run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };
  const resetUsage = () => {
    controlSqlite.prepare("DELETE FROM voice_usage WHERE tenant_id = ?").run(tid);
  };

  try {
    // ── 1. pure rounding rules ──
    assert.equal(MIN_BILLABLE_SECONDS, 20);
    assert.equal(billedMinutesFor(0), 0, "a 0s call bills nothing");
    assert.equal(billedMinutesFor(19), 0, "a 19s voicemail bills nothing");
    assert.equal(billedMinutesFor(20), 1, "at the threshold, one minute");
    assert.equal(billedMinutesFor(61), 2, "rounds UP to the whole minute, like a telco");
    assert.equal(billedMinutesFor(180), 3);
    assert.equal(getVoicePricePerMinuteCents(), DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS);
    assert.equal(DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS, 45, "45c/minute ex-VAT");
    assert.equal(costForMinutes(3), 135);
    assert.equal(costForMinutes(0), 0);

    // ── 2. no add-on: refused outright, and it is a PRODUCT answer, not a
    // money one (a different error type, so a caller can tell them apart). ──
    assert.throws(() => assertVoiceAllowed(tid), VoiceNotEnabledError);

    // ── 3. TRIAL: the free evaluation. Entitled, charges nothing, bounded. ──
    setAddonStatus(tid, "voice", "trial");
    assert.equal(trialSecondsRemaining(tid), DEFAULT_VOICE_TRIAL_MINUTES * 60);
    assert.equal(DEFAULT_VOICE_TRIAL_MINUTES, 20, "20 free evaluation minutes");
    assert.doesNotThrow(() => assertVoiceAllowed(tid));

    const trialCall = meterVoiceCall(tid, { seconds: 180, ref: "call_trial_1" });
    assert.equal(trialCall.source, "trial");
    assert.equal(trialCall.chargedCents, 0, "trial minutes never touch credits");
    assert.equal(trialCall.billedMinutes, 3);
    assert.equal(getVoiceBalanceCents(tid), 0);
    assert.equal(trialSecondsRemaining(tid), DEFAULT_VOICE_TRIAL_MINUTES * 60 - 180);

    // Burn the rest of the trial: the gate closes, and it says what to do.
    meterVoiceCall(tid, { seconds: DEFAULT_VOICE_TRIAL_MINUTES * 60, ref: "call_trial_2" });
    assert.equal(trialSecondsRemaining(tid), 0);
    assert.throws(() => assertVoiceAllowed(tid), (err: Error) => {
      assert.ok(err instanceof VoiceCapError);
      assert.match(err.message, /trial minutes/i);
      return true;
    });

    // ── 4. ACTIVE: the monthly included-minutes tranche comes first ──
    resetUsage();
    setAddonStatus(tid, "voice", "active");
    assert.equal(includedMinutesRemaining(tid), DEFAULT_VOICE_INCLUDED_MINUTES);
    assert.equal(DEFAULT_VOICE_INCLUDED_MINUTES, 60, "60 minutes included with the €50 add-on");
    assert.doesNotThrow(() => assertVoiceAllowed(tid), "included minutes are enough on their own");

    const included = meterVoiceCall(tid, { seconds: 240, ref: "call_1" });
    assert.equal(included.source, "included");
    assert.equal(included.billedMinutes, 4);
    assert.equal(included.freeMinutes, 4);
    assert.equal(included.chargedCents, 0, "inside the tranche, nothing is debited");
    assert.equal(getVoiceBalanceCents(tid), 0);
    assert.equal(includedMinutesRemaining(tid), 56, "a call is never charged against its OWN headroom");
    assert.deepEqual(getMonthUsage(tid), { seconds: 240, billedMinutes: 4, costCents: 0, calls: 1 });

    // ── 5. a sub-threshold call is recorded but never billed ──
    const voicemail = meterVoiceCall(tid, { seconds: 12, ref: "call_vm" });
    assert.equal(voicemail.source, "free");
    assert.equal(voicemail.billedMinutes, 0);
    assert.equal(voicemail.chargedCents, 0);
    assert.equal(getMonthUsage(tid).calls, 2, "it still happened — the call count includes it");
    assert.equal(includedMinutesRemaining(tid), 56, "and it consumed no allowance");

    // ── 6. the call that STRADDLES the tranche boundary is split: the free
    // part is free, only the overflow is priced. ──
    controlSqlite
      .prepare("UPDATE voice_usage SET billed_minutes = ? WHERE tenant_id = ?")
      .run(DEFAULT_VOICE_INCLUDED_MINUTES - 2, tid);
    grantVoiceCredits(tid, 1000, "test:setup");
    const straddle = meterVoiceCall(tid, { seconds: 300, ref: "call_straddle" });
    assert.equal(straddle.billedMinutes, 5);
    assert.equal(straddle.freeMinutes, 2, "the last 2 included minutes");
    assert.equal(straddle.chargedCents, 3 * DEFAULT_VOICE_PRICE_PER_MINUTE_CENTS, "only the 3 overflow minutes are priced");
    assert.equal(getVoiceBalanceCents(tid), 1000 - 135);
    assert.equal(straddle.source, "credits");

    const ledger = listVoiceLedger(tid, 10);
    assert.equal(ledger[0].deltaCents, -135);
    assert.equal(ledger[0].note, "call_straddle", "the debit is traceable to one conversation");

    // ── 7. allowance gone, credits gone: the gate closes ──
    assert.equal(includedMinutesRemaining(tid), 0);
    assert.doesNotThrow(() => assertVoiceAllowed(tid), "credits still cover it");
    meterVoiceCall(tid, { seconds: 20 * 60, ref: "call_overrun" });
    assert.ok(getVoiceBalanceCents(tid) < 0, "the last call may overshoot — the minutes were already spoken");
    assert.throws(() => assertVoiceAllowed(tid), VoiceCapError, "and the debt blocks the NEXT dial");

    // ── 8. the runaway-dialler backstop: the monthly spend cap blocks a
    // tenant who still HAS credits. ──
    resetUsage();
    grantVoiceCredits(tid, 100_000, "test:setup");
    assert.doesNotThrow(() => assertVoiceAllowed(tid));
    setVoiceCapCents(tid, 500);
    controlSqlite
      .prepare(
        "INSERT INTO voice_usage (tenant_id, yyyymm, cost_cents) VALUES (?, strftime('%Y-%m','now'), 600) ON CONFLICT(tenant_id, yyyymm) DO UPDATE SET cost_cents = 600",
      )
      .run(tid);
    assert.throws(() => assertVoiceAllowed(tid), (err: Error) => {
      assert.match(err.message, /cap/i);
      return true;
    }, "over the monthly cap, credits are irrelevant");
    setVoiceCapCents(tid, 500_00);

    // ── 9. the admin kill switch beats everything ──
    resetUsage();
    setVoiceSuspended(tid, true, "test:admin");
    assert.throws(() => assertVoiceAllowed(tid), /suspended/i);
    setVoiceSuspended(tid, false, "test:admin");
    assert.doesNotThrow(() => assertVoiceAllowed(tid));

    // ── 10. metering a finished call NEVER throws, whatever the balance ──
    assert.doesNotThrow(() => meterVoiceCall(tid, { seconds: 3600, ref: "call_long" }));

    console.log("voice/usage.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
