// Run: npm test -- src/lib/vouchers/email.test.ts
//
// The receipt and the gift email (branded per business, escaped), the logo
// rule for inboxes, the platform-sender fallback, and gift delivery from a
// seeded paid order: sent once, a failure kept for staff, Resend.
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
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant } = requireLocal("./testSupport") as typeof import("./testSupport");
  const email = requireLocal("./email") as typeof import("./email");
  const deliver = requireLocal("./deliver") as typeof import("./deliver");
  const { colourways } = requireLocal("./model") as typeof import("./model");

  const colourway = colourways(["#2f4a3a"])[0]!;
  const brand = { businessName: "Glow & Co", email: "hello@glow.ie", phone: "083 000 0000", website: "glow.ie", logoUrl: null };

  // ── rendering ───────────────────────────────────────────────────────────
  const gift = email.renderGiftEmail({
    brand,
    colourway,
    fromName: "Sean <b>",
    toName: "Aoife",
    message: "Enjoy <script>alert(1)</script>",
    title: "€50",
    code: "GC-2026-DTA9",
    expiry: "2031-11-23",
    revealUrl: "https://www.glow.ie/v/tok",
  });
  assert.equal(gift.subject, "Sean <b> sent you a gift from Glow & Co", "subjects are plain text");
  assert.ok(gift.html.includes("Sean &lt;b&gt; sent you a gift"), "names are escaped in the body");
  assert.ok(!gift.html.includes("<script>"), "the message is escaped");
  assert.ok(gift.html.includes('href="https://www.glow.ie/v/tok"'), "one button to the gift page");
  assert.ok(gift.html.includes(colourway.base), "the card wears the chosen colourway");
  assert.ok(gift.html.includes("Glow &amp; Co"), "the business's own name");
  assert.ok(gift.html.includes("call 083 000 0000"), "how to book");
  assert.ok(gift.html.includes("23 November 2031"));
  assert.ok(!/Renova|renovacellular/i.test(gift.html), "nothing from another business");

  const receipt = (deliverTo: "buyer" | "recipient", deliverOn: string | null) =>
    email.renderReceiptEmail({
      brand,
      colourway,
      buyerName: "Sean Walsh",
      toName: "Aoife",
      title: "€50",
      paidEur: 50,
      code: "GC-2026-DTA9",
      expiry: "2031-11-23",
      revealUrl: "https://www.glow.ie/v/tok",
      deliverTo,
      recipientEmail: deliverTo === "recipient" ? "aoife@example.ie" : null,
      deliverOn,
    });
  assert.equal(receipt("buyer", null).subject, "Your Glow & Co gift voucher");
  assert.ok(receipt("buyer", null).html.includes("Thanks, Sean. You paid €50"));
  assert.ok(receipt("buyer", null).html.includes("Here is your voucher."));
  assert.ok(receipt("recipient", null).html.includes("We have emailed it to Aoife at aoife@example.ie."));
  assert.ok(receipt("recipient", "2026-12-24").html.includes("on 24 December 2026 at 9am"));
  assert.ok(receipt("buyer", null).html.includes("https://www.glow.ie/v/tok"), "the receipt always carries the voucher link");

  // ── the logo an inbox can show ─────────────────────────────────────────
  assert.equal(email.absoluteLogoUrl("/sites/glow/assets/logo.png", "https://www.glow.ie"), "https://www.glow.ie/sites/glow/assets/logo.png");
  assert.equal(email.absoluteLogoUrl("/sites/glow/logo.png", "http://localhost:3000/site/glow"), "http://localhost:3000/sites/glow/logo.png");
  assert.equal(email.absoluteLogoUrl("https://cdn.glow.ie/l.jpg", null), "https://cdn.glow.ie/l.jpg");
  assert.equal(email.absoluteLogoUrl("/logo.svg", "https://www.glow.ie"), null, "Gmail drops SVG");
  assert.equal(email.absoluteLogoUrl("data:image/png;base64,xx", "https://www.glow.ie"), null);
  assert.equal(email.absoluteLogoUrl(null, "https://www.glow.ie"), null);

  await withVoucherTenant("voucher-email-test", async (tid, accountId) => {
    // ── the fallback: no business sender, so the platform sender is tried ──
    const r = await runWithTenant(tid, () => email.sendVoucherEmail(tid, { to: "a@b.ie", subject: "s", html: "<p>h</p>" }));
    assert.ok(!r.ok && /Platform email isn't configured/.test(r.error), "it reached the platform sender");

    // ── delivering a seeded paid gift ──────────────────────────────────────
    const tdb = getTenantDbById(tid);
    const [v] = tdb
      .insert(schema.giftVouchers)
      .values({ code: "GC-2026-AAAA", purchaserName: "Sean", recipientName: "Aoife", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23", source: "online", colourway: JSON.stringify(colourway), viewToken: "t".repeat(24) })
      .returning()
      .all();
    const [o] = tdb
      .insert(schema.voucherOrders)
      .values({
        kind: "amount", valueCents: 5000, buyerName: "Sean Walsh", buyerEmail: "sean@example.ie", recipientName: "Aoife", recipientEmail: "aoife@example.ie",
        fromName: "Sean", colourway: JSON.stringify(colourway), deliverTo: "recipient", deliverOn: "2026-12-24", status: "paid",
        stripeAccountId: accountId, giftVoucherId: v!.id, siteUrl: "https://www.glow.ie", createdAt: Date.now(),
      })
      .returning()
      .all();
    const sent: string[] = [];
    let fails = false;
    const mailer = async (_t: number, m: { to: string }) => {
      sent.push(m.to);
      return fails ? { ok: false as const, error: "bounced" } : { ok: true as const, id: "x" };
    };
    const at9 = Date.UTC(2026, 11, 24, 9); // winter: 09:00 Irish time is 09:00 UTC
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, at9 - 60_000, mailer), 0, "not before nine");
    assert.equal(await deliver.dispatchDueVoucherGifts(tid, at9, mailer), 1);
    assert.equal(await deliver.deliverGift(tid, o!.id, mailer, at9), "skipped", "a delivered gift is not sent again");
    assert.deepEqual(sent, ["aoife@example.ie"]);

    fails = true;
    const res = await deliver.resendVoucherEmails(tid, o!.id, mailer);
    assert.ok(!res.ok && res.error === "bounced");
    const row = () => tdb.select().from(schema.voucherOrders).where(eq(schema.voucherOrders.id, o!.id)).get()!;
    assert.equal(row().deliveryError, "bounced", "staff see why");
    assert.equal(row().deliveredAt, null);
    fails = false;
    assert.ok((await deliver.resendVoucherEmails(tid, o!.id, mailer)).ok, "Resend works once the address is fixed");
    assert.equal(row().deliveryError, null);

    tdb.update(schema.giftVouchers).set({ cancelledAt: Date.now() }).where(eq(schema.giftVouchers.id, v!.id)).run();
    tdb.update(schema.voucherOrders).set({ deliveredAt: null }).where(eq(schema.voucherOrders.id, o!.id)).run();
    assert.equal(await deliver.deliverGift(tid, o!.id, mailer, at9), "skipped", "a cancelled voucher is never sent");
  });

  console.log("vouchers email: rendering, logo rule, fallback, delivery; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
