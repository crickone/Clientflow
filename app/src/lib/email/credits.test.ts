// Run: npm test -- src/lib/email/credits.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  DEFAULT_EMAIL_PRICE_PER_1000_CENTS,
  EMAIL_PRICE_KEY,
  EmailCreditsError,
  assertCreditsAvailable,
  costForRecipients,
  getAutoTopup,
  getEmailBalanceCents,
  getEmailPricePer1000Cents,
  grantCredits,
  listLedger,
  recordCreditSpend,
  setAutoTopup,
  setEmailPricePer1000Cents,
} from "./credits";

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as apiKeys.test.ts).
(async () => {
  // ── scratch tenant (control row only) ──
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'email-credits-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('email-credits-test','Email Credits Test','tenants/email-credits-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;

  // email_credit_price_cents is a GLOBAL platform_settings key (not
  // tenant-scoped) — capture whatever it was before this run so `finally` can
  // restore it exactly, instead of leaking a test price into the real app /
  // other test files sharing this same control.db.
  const priceBefore = controlSqlite
    .prepare("SELECT value FROM platform_settings WHERE key = ?")
    .get(EMAIL_PRICE_KEY) as { value: string } | undefined;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM email_credit_ledger WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM email_credits WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    if (priceBefore) {
      controlSqlite
        .prepare("UPDATE platform_settings SET value = ? WHERE key = ?")
        .run(priceBefore.value, EMAIL_PRICE_KEY);
    } else {
      controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(EMAIL_PRICE_KEY);
    }
  };

  try {
    // ── sparse defaults: a brand new tenant has no row yet ──
    assert.equal(getEmailBalanceCents(tid), 0);
    assert.deepEqual(getAutoTopup(tid), { enabled: false, thresholdCents: 0, amountCents: 0 });

    // ── price: force the UNSET (default-fallback) state deterministically,
    // regardless of whatever this shared control.db had configured before ──
    controlSqlite.prepare("DELETE FROM platform_settings WHERE key = ?").run(EMAIL_PRICE_KEY);
    assert.equal(getEmailPricePer1000Cents(), DEFAULT_EMAIL_PRICE_PER_1000_CENTS);

    // ── costForRecipients rounding at the default price (200c/1000) ──
    // ceil(n * 200 / 1000):
    assert.equal(costForRecipients(1), 1); // ceil(0.2)   = 1
    assert.equal(costForRecipients(500), 100); // ceil(100)   = 100
    assert.equal(costForRecipients(1000), 200); // ceil(200)   = 200
    assert.equal(costForRecipients(1001), 201); // ceil(200.2) = 201

    // ── price setter: round-trip + bounds ──
    setEmailPricePer1000Cents(0);
    assert.equal(getEmailPricePer1000Cents(), 0);
    assert.equal(costForRecipients(1000), 0, "price 0 => free");
    setEmailPricePer1000Cents(10_000);
    assert.equal(getEmailPricePer1000Cents(), 10_000);
    assert.throws(() => setEmailPricePer1000Cents(-1), /between 0 and 10000/);
    assert.throws(() => setEmailPricePer1000Cents(10_001), /between 0 and 10000/);
    assert.throws(() => setEmailPricePer1000Cents(1.5), /between 0 and 10000/);
    setEmailPricePer1000Cents(DEFAULT_EMAIL_PRICE_PER_1000_CENTS); // restore for the rest of this run

    // ── grantCredits raises balance + writes a ledger row w/ correct balance_after ──
    grantCredits(tid, 500, "admin:chris@clientflow.ie", "topup");
    assert.equal(getEmailBalanceCents(tid), 500);
    let ledger = listLedger(tid);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].deltaCents, 500);
    assert.equal(ledger[0].reason, "topup");
    assert.equal(ledger[0].balanceAfterCents, 500);
    assert.equal(ledger[0].note, "admin:chris@clientflow.ie");
    assert.equal(ledger[0].campaignId, null);

    // a second grant compounds on top of the first (proves read-then-write,
    // not a blind overwrite) and reason can be 'adjustment'
    grantCredits(tid, 250, "admin:ops", "adjustment");
    assert.equal(getEmailBalanceCents(tid), 750);
    ledger = listLedger(tid);
    assert.equal(ledger.length, 2, "newest first — index 0 is the latest row");
    assert.equal(ledger[0].deltaCents, 250);
    assert.equal(ledger[0].reason, "adjustment");
    assert.equal(ledger[0].balanceAfterCents, 750);

    // ── assertCreditsAvailable: passes at balance==cost, throws just above ──
    assert.doesNotThrow(() => assertCreditsAvailable(tid, 750));
    assert.throws(() => assertCreditsAvailable(tid, 751), EmailCreditsError);

    // ── recordCreditSpend decrements + ledger reason='send' + correct balance_after ──
    recordCreditSpend(tid, 300, 42, "system:campaign-send");
    assert.equal(getEmailBalanceCents(tid), 450);
    ledger = listLedger(tid);
    assert.equal(ledger[0].deltaCents, -300);
    assert.equal(ledger[0].reason, "send");
    assert.equal(ledger[0].campaignId, 42);
    assert.equal(ledger[0].balanceAfterCents, 450);
    assert.equal(ledger[0].note, "system:campaign-send");

    // ── a spend exceeding balance throws EmailCreditsError and writes NOTHING ──
    const ledgerCountBefore = listLedger(tid, 1000).length;
    assert.throws(() => recordCreditSpend(tid, 999_999, 42, "system"), EmailCreditsError);
    assert.equal(getEmailBalanceCents(tid), 450, "balance unchanged after a failed spend");
    assert.equal(
      listLedger(tid, 1000).length,
      ledgerCountBefore,
      "no ledger row written on a failed spend",
    );

    // ── auto-topup: setter round-trip (config-only — balance untouched) ──
    setAutoTopup(tid, { enabled: true, thresholdCents: 1000, amountCents: 5000 });
    assert.deepEqual(getAutoTopup(tid), { enabled: true, thresholdCents: 1000, amountCents: 5000 });
    assert.equal(getEmailBalanceCents(tid), 450, "auto-topup config write doesn't touch balance");

    // ── auto-topup: setter bounds ──
    assert.throws(
      () => setAutoTopup(tid, { enabled: false, thresholdCents: -1, amountCents: 0 }),
      /threshold/i,
    );
    assert.throws(
      () => setAutoTopup(tid, { enabled: false, thresholdCents: 0, amountCents: -1 }),
      /amount/i,
    );
    assert.throws(
      () => setAutoTopup(tid, { enabled: false, thresholdCents: 0, amountCents: 100_000_000 }),
      /amount/i,
    );
    assert.throws(
      () => setAutoTopup(tid, { enabled: true, thresholdCents: 0, amountCents: 0 }),
      /greater than 0/i,
      "enabling with a 0 top-up amount would be a silent no-op",
    );
    // bounds rejections must not have mutated the last-good config
    assert.deepEqual(getAutoTopup(tid), { enabled: true, thresholdCents: 1000, amountCents: 5000 });

    console.log("credits.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
