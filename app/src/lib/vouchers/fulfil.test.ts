// Run: npm test -- src/lib/vouchers/fulfil.test.ts
//
// From a paid Checkout to a delivered voucher, in a scratch business, with
// the mailer stubbed (no network):
//   - unpaid and wrong-amount sessions make nothing;
//   - the webhook and the return page both fulfilling makes ONE voucher;
//   - the voucher: online, balance = value, expiry 5 years on, its own token;
//   - receipt to the buyer always; gift now, or by the ticker at 09:00 Irish
//     time on the chosen day, once; a failed gift waits for staff, Resend works;
//   - refunds: unused -> cancelled, part-used -> flagged, not a voucher -> false;
//   - the Stripe webhook routes kind=voucher events here and leaves offers alone,
//     and a business with no sender falls back to the platform sender.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.EMAIL_TOKEN_SECRET = "voucher-test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";
process.env.STRIPE_API_BASE = "http://stripe.test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_vouchers";
delete process.env.RESEND_API_KEY;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { NextRequest } = requireLocal("next/server") as typeof import("next/server");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const store = requireLocal("./store") as typeof import("./store");
  const fulfil = requireLocal("./fulfil") as typeof import("./fulfil");
  const deliver = requireLocal("./deliver") as typeof import("./deliver");
  const model = requireLocal("./model") as typeof import("./model");
  const webhook = requireLocal("../../app/api/stripe/webhook/route") as typeof import("../../app/api/stripe/webhook/route");

  type Sent = { to: string; subject: string; html: string };
  const sent: Sent[] = [];
  let mailerFails = false;
  const mailer = async (_tid: number, m: Sent) => {
    sent.push(m);
    return mailerFails ? { ok: false as const, error: "mailbox full" } : { ok: true as const, id: "m1" };
  };

  await withVoucherTenant("voucher-fulfil-test", async (tid, accountId) => {
    const tdb = getTenantDbById(tid);
    const colourway = model.colourways(["#2f4a3a"])[0]!;
    const base: import("./model").ValidOrder = {
      kind: "amount",
      valueCents: 5000,
      therapyId: null,
      therapyName: null,
      toName: "Aoife",
      fromName: "Sean",
      message: "Happy birthday <3",
      colourwayId: colourway.id,
      deliverTo: "recipient",
      recipientEmail: "aoife@example.ie",
      deliverOn: null,
      buyerName: "Sean Walsh",
      buyerEmail: "sean@example.ie",
    };
    let n = 0;
    const order = (o: Partial<import("./model").ValidOrder> = {}) =>
      runWithTenant(tid, () => {
        const row = store.createPendingVoucherOrder({ ...base, ...o }, { colourway, stripeAccountId: accountId, siteId: null, siteUrl: "https://www.glow.ie" });
        n++;
        store.setVoucherOrderSession(row.id, `cs_test_${n}`);
        return { ...row, session: `cs_test_${n}`, pi: `pi_test_${n}` };
      });
    const session = (o: { id: number; session: string; pi: string }, extra: Partial<import("../stripe/api").CheckoutSession> = {}) => ({
      id: o.session,
      payment_status: "paid" as const,
      amount_total: 5000,
      currency: "eur",
      payment_intent: o.pi,
      client_reference_id: String(o.id),
      ...extra,
    });
    const vouchers = () => tdb.select().from(schema.giftVouchers).all();
    const getOrder = (id: number) => tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.id, id)).get()!;
    const now = Date.UTC(2026, 10, 23, 12);

    // Unpaid, wrong amount, someone else's account: nothing.
    const a = order();
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a, { payment_status: "unpaid" }), mailer, now)).status, "unpaid");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a, { amount_total: 100 }), mailer, now)).status, "mismatch");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, "acct_other", session(a), mailer, now)).status, "not_found");
    assert.equal(vouchers().length, 0);

    // Webhook and return page together: one voucher.
    const [r1, r2] = await Promise.all([
      fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now),
      fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), ["already", "fulfilled"], "only one caller fulfils");
    assert.equal(vouchers().length, 1, "one voucher");
    assert.equal((await fulfil.fulfilVoucherCheckout(tid, accountId, session(a), mailer, now)).status, "already", "a late webhook changes nothing");
    const v = vouchers()[0]!;
    assert.equal(v.source, "online");
    assert.equal(v.kind, "amount");
    assert.equal(v.valueEur, 50);
    assert.equal(v.balanceEur, 50);
    assert.equal(v.purchaseDate, "2026-11-23");
    assert.equal(v.expiryDate, "2031-11-23", "five years, the legal floor");
    assert.match(v.code, /^GC-\d{4}-[A-Z2-9]{4}$/, "the business's own prefix (Glow Clinic)");
    assert.equal(v.viewToken?.length, 24);
    assert.equal(v.purchaserName, "Sean", "the card's From line");
    assert.equal(v.recipientName, "Aoife");
    assert.equal(v.colourway, JSON.stringify(colourway));
    const paidA = getOrder(a.id);
    assert.equal(paidA.status, "paid");
    assert.equal(paidA.giftVoucherId, v.id);
    assert.equal(paidA.paymentIntentId, a.pi);
    assert.equal(sent.length, 2, "receipt and gift, once each");
    assert.equal(sent[0]!.to, "sean@example.ie");
    assert.ok(sent[0]!.html.includes(`https://www.glow.ie/v/${v.viewToken}`), "the receipt carries the voucher link");
    assert.equal(sent[1]!.to, "aoife@example.ie");
    assert.equal(sent[1]!.subject, "Sean sent you a gift from Glow Clinic");
    assert.ok(sent[1]!.html.includes("Happy birthday &lt;3"), "the message is escaped");
    assert.ok(!/Renova/.test(sent[0]!.html + sent[1]!.html), "nothing from another business");
    assert.ok(paidA.deliveredAt, "the gift is marked delivered");

    // Sent to the buyer: the receipt is the delivery.
    sent.length = 0;
    const b = order({ deliverTo: "buyer", recipientEmail: null });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(b), mailer, now);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "sean@example.ie");
    assert.ok(getOrder(b.id).deliveredAt);

    // A dated gift: receipt now, gift at 09:00 Irish time on the day, once.
    sent.length = 0;
    const c = order({ deliverOn: "2027-07-15" });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(c), mailer, now);
    assert.deepEqual(sent.map((s) => s.to), ["sean@example.ie"], "only the receipt so far");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 7, 59), mailer), 0, "not before 09:00 Irish summer time");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 8, 0), mailer), 1, "09:00 Irish time is 08:00 UTC in July");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, Date.UTC(2027, 6, 15, 8, 1), mailer), 0, "never twice");
    assert.deepEqual(sent.map((s) => s.to), ["sean@example.ie", "aoife@example.ie"]);

    // A failed gift waits for staff; Resend sends it.
    sent.length = 0;
    mailerFails = true;
    const d = order();
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(d), mailer, now);
    assert.equal(getOrder(d.id).deliveryError, "mailbox full");
    assert.equal(getOrder(d.id).deliveredAt, null);
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, now + 60_000, mailer), 0, "not retried every minute");
    mailerFails = false;
    const again = await deliver.resendVoucherEmails(tid, d.id, mailer);
    assert.ok(again.ok);
    assert.equal(getOrder(d.id).deliveryError, null);
    assert.ok(getOrder(d.id).deliveredAt);

    // Refunds.
    assert.equal(fulfil.refundVoucherOrder(tid, "pi_unknown"), false, "not a voucher: the offers handle it");
    assert.equal(fulfil.refundVoucherOrder(tid, b.pi, now), true);
    const vb = tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, getOrder(b.id).giftVoucherId!)).get()!;
    assert.equal(vb.balanceEur, 0, "an unused voucher is cancelled");
    assert.equal(vb.cancelledAt, now);
    assert.equal(getOrder(b.id).status, "refunded");
    const vc = getOrder(c.id).giftVoucherId!;
    tdb.update(schema.giftVouchers).set({ balanceEur: 20 }).where(eq(schema.giftVouchers.id, vc)).run();
    assert.equal(fulfil.refundVoucherOrder(tid, c.pi, now), true);
    const vcRow = tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, vc)).get()!;
    assert.equal(vcRow.cancelledAt, null, "a part-used voucher is not cancelled");
    assert.equal(vcRow.balanceEur, 20);
    assert.equal(getOrder(c.id).status, "refunded", "the order shows the refund for staff");

    // The webhook: kind=voucher goes to the voucher store.
    const sign = (body: string) => {
      const t = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac("sha256", "whsec_test_vouchers").update(`${t}.${body}`, "utf8").digest("hex");
      return `t=${t},v1=${sig}`;
    };
    const post = (event: object) => {
      const raw = JSON.stringify(event);
      return webhook.POST(new NextRequest("https://app.test/api/stripe/webhook", { method: "POST", body: raw, headers: { "stripe-signature": sign(raw) } }));
    };
    const e = order({ deliverTo: "buyer", recipientEmail: null });
    let res = await post({ type: "checkout.session.completed", account: accountId, data: { object: { ...session(e), metadata: { kind: "voucher", voucher_order_id: String(e.id) } } } });
    assert.equal(res.status, 200);
    const paidE = getOrder(e.id);
    assert.equal(paidE.status, "paid", "the webhook fulfilled the voucher order");
    assert.match(paidE.deliveryError ?? "", /Platform email isn't configured/, "no business sender: it tried the platform sender, and the failure waits for staff");
    const f = order();
    res = await post({ type: "checkout.session.expired", account: accountId, data: { object: { id: f.session, metadata: { kind: "voucher" } } } });
    assert.equal(res.status, 200);
    assert.equal(getOrder(f.id).status, "expired");
    res = await post({ type: "charge.refunded", account: accountId, data: { object: { payment_intent: e.pi, refunded: true } } });
    assert.equal(res.status, 200);
    assert.equal(getOrder(e.id).status, "refunded", "a refund finds the voucher order by its payment id");

    // The dispatch ticker reaches a due gift (the real sender: no email set up here, so it records why).
    const g = order({ deliverOn: "2026-01-01" });
    await fulfil.fulfilVoucherCheckout(tid, accountId, session(g), mailer, now);
    tdb.update(schema.voucherOrders).set({ deliveredAt: null, deliveryError: null }).where(eq(schema.voucherOrders.id, g.id)).run();
    const { runDispatchForTenant } = requireLocal("../dispatch/ticker") as typeof import("../dispatch/ticker");
    const summary = await runDispatchForTenant(tid, "http://localhost:3000");
    assert.equal(summary.vouchersSent, 0);
    assert.match(getOrder(g.id).deliveryError ?? "", /Platform email isn't configured/, "the ticker tried to send the due gift");
  });

  console.log("vouchers fulfil: one voucher per payment, delivery, refunds, webhook routing; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
