// Run: npm test -- src/lib/vouchers/checkout.test.ts
//
// Opening Stripe Checkout for a voucher, against a scratch business with a
// test-mode Stripe account and Stripe itself stubbed (globalThis.fetch):
//   - the signed store token round-trips and refuses tampering;
//   - a valid order writes one pending order and opens Checkout on the
//     business's own account, with kind=voucher metadata and NO platform fee;
//   - a bad order is refused with its field and writes nothing;
//   - Stripe failing marks the order failed and says nothing was charged;
//   - the store switched off, or the flag off, opens nothing.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.EMAIL_TOKEN_SECRET = "voucher-test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";
process.env.STRIPE_API_BASE = "http://stripe.test";
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

type Call = { url: string; method: string; headers: Record<string, string>; body: URLSearchParams };
const calls: Call[] = [];
let stripeFails = false;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: new URLSearchParams(String(init?.body ?? "")) });
  if (stripeFails) return new Response(JSON.stringify({ error: { message: "Stripe is down" } }), { status: 500 });
  if (url.endsWith("/v1/checkout/sessions")) {
    const id = `cs_test_v${calls.length}`;
    return new Response(JSON.stringify({ id, url: `https://checkout.stripe.test/${id}` }), { status: 200 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant, seedTherapy } = requireLocal("./testSupport") as typeof import("./testSupport");
  const store = requireLocal("./store") as typeof import("./store");
  const { startVoucherCheckout } = requireLocal("./checkout") as typeof import("./checkout");
  const { signVoucherStoreToken, verifyVoucherStoreToken } = requireLocal("./storeToken") as typeof import("./storeToken");
  const { DEFAULT_STORE_SETTINGS } = requireLocal("./model") as typeof import("./model");

  await withVoucherTenant("voucher-checkout-test", async (tid, accountId) => {
    const claim = { tenantId: tid, siteId: 1, siteUrl: "https://www.glow.ie" };
    const token = signVoucherStoreToken(claim)!;
    assert.deepEqual(verifyVoucherStoreToken(token), claim, "the token carries the business and its site");
    assert.equal(verifyVoucherStoreToken(token.slice(0, -2) + "xx"), null, "a tampered token is refused");
    assert.equal(verifyVoucherStoreToken(signVoucherStoreToken({ ...claim, siteUrl: "https://www.glow.ie/" })!), null, "no trailing slash");

    const massage = seedTherapy(tid, "Swedish massage", 80);
    const tdb = getTenantDbById(tid);
    const orders = () => tdb.select().from(schema.voucherOrders).all();
    const draft = {
      kind: "amount" as const,
      amountEur: 50,
      therapyId: null,
      toName: "Aoife",
      fromName: "Sean",
      message: "Happy birthday",
      colourwayId: "signature",
      deliverTo: "recipient" as const,
      recipientEmail: "aoife@example.ie",
      deliverOn: null,
      buyerName: "Sean Walsh",
      buyerEmail: "sean@example.ie",
    };

    // Switched off in settings: nothing opens.
    runWithTenant(tid, () => store.saveStoreSettings({ ...DEFAULT_STORE_SETTINGS, enabled: false }));
    let r = await startVoucherCheckout(claim, draft);
    assert.ok(!r.ok && /aren't on sale/.test(r.error));
    assert.equal(orders().length, 0);

    runWithTenant(tid, () => store.saveStoreSettings({ ...DEFAULT_STORE_SETTINGS, enabled: true, therapyIds: [massage] }));

    // A bad order: refused with its field, nothing written, Stripe not called.
    r = await startVoucherCheckout(claim, { ...draft, amountEur: 9999 });
    assert.ok(!r.ok && r.field === "amountEur");
    assert.equal(orders().length, 0);
    assert.equal(calls.length, 0);

    // A good one.
    r = await startVoucherCheckout(claim, draft);
    assert.ok(r.ok && r.url === "https://checkout.stripe.test/cs_test_v1", "the Checkout address comes back");
    const [order] = orders();
    assert.equal(order!.status, "pending");
    assert.equal(order!.stripeSessionId, "cs_test_v1");
    assert.equal(order!.valueCents, 5000);
    assert.equal(order!.siteUrl, "https://www.glow.ie");
    assert.equal(JSON.parse(order!.colourway).id, "signature", "the card's colours are kept on the order");
    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, "http://stripe.test/v1/checkout/sessions");
    assert.equal(call.headers["Stripe-Account"], accountId, "on the business's own Stripe account");
    assert.equal(call.headers["Idempotency-Key"], `voucher-order-${tid}-${order!.id}`);
    assert.equal(call.body.get("line_items[0][quantity]"), "1", "one voucher per checkout");
    assert.equal(call.body.get("line_items[0][price_data][unit_amount]"), "5000");
    assert.equal(call.body.get("line_items[0][price_data][currency]"), "eur");
    assert.equal(call.body.get("metadata[kind]"), "voucher");
    assert.equal(call.body.get("metadata[voucher_order_id]"), String(order!.id));
    assert.equal(call.body.get("payment_intent_data[metadata][kind]"), "voucher");
    assert.equal(call.body.get("success_url"), `https://www.glow.ie/vouchers?paid=${order!.id}&session_id={CHECKOUT_SESSION_ID}`);
    assert.equal(call.body.get("customer_email"), "sean@example.ie");
    assert.ok(![...call.body.keys()].some((k) => k.includes("application_fee")), "no platform fee");

    // A treatment voucher is sold at the treatment's list price.
    r = await startVoucherCheckout(claim, { ...draft, kind: "treatment", amountEur: null, therapyId: massage });
    assert.ok(r.ok);
    assert.equal(calls[1]!.body.get("line_items[0][price_data][unit_amount]"), "8000");
    assert.equal(calls[1]!.body.get("line_items[0][price_data][product_data][name]"), "Gift voucher: Swedish massage");
    assert.ok(![...calls[1]!.body.keys()].some((k) => k.includes("application_fee")), "treatment: no platform fee");

    // Stripe failing: the order is marked failed and the buyer is told nothing was charged.
    stripeFails = true;
    r = await startVoucherCheckout(claim, draft);
    assert.ok(!r.ok && /Nothing was charged/.test(r.error));
    const failed = tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.status, "failed")).all();
    assert.equal(failed.length, 1);
    stripeFails = false;

    // The flag off for this business: refused with the flag's message, no Stripe
    // call, no new order row.
    const callsBefore = calls.length;
    const ordersBefore = orders().length;
    controlSqlite.prepare("UPDATE platform_flags SET allow = '[]' WHERE key = 'voucher_store'").run();
    r = await startVoucherCheckout(claim, draft);
    assert.deepEqual(r, { ok: false, error: "Gift vouchers aren't on sale online yet." }, "flag off: the refusal says the store is not on sale");
    assert.equal(calls.length, callsBefore, "flag off: no new Stripe call");
    assert.equal(orders().length, ordersBefore, "flag off: no new voucher_orders row");
  });

  console.log("vouchers checkout: token, order, Stripe call, refusals; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
