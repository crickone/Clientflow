// Run: npm test -- src/lib/vouchers/redeem.test.ts
//
// Paying for a booking with a voucher, in a scratch business:
//   - a money voucher pays up to its balance; the rest needs another method
//     and is a second payment; the change stays on the voucher;
//   - a treatment voucher pays one session of its treatment at today's price
//     and is used up; it is refused for a different treatment;
//   - expired = allowed (the form warns); cancelled, used up, unknown and
//     price-less bookings are refused with nothing written;
//   - every use is one voucher_redemptions row, and balance = value - uses.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

process.env.STRIPE_SECRET_KEY = "sk_test_vouchers";

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

(async () => {
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { withVoucherTenant, seedTherapy } = requireLocal("./testSupport") as typeof import("./testSupport");
  const { redeemAtBooking, lookupVoucher, recordVoucherUse, VoucherBalanceError } = requireLocal("./redeem") as typeof import("./redeem");
  const { balanceFrom } = requireLocal("./model") as typeof import("./model");

  await withVoucherTenant("voucher-redeem-test", (tid) =>
    runWithTenant(tid, () => {
      const tdb = getTenantDbById(tid);
      const massage = seedTherapy(tid, "Swedish massage", 80);
      const facial = seedTherapy(tid, "Facial", 60);
      const [client] = tdb.insert(schema.clients).values({ firstName: "Aoife", lastName: "Byrne", phone: "0870000000" }).returning().all();
      const appt = (therapyId: number, price: number) =>
        tdb
          .insert(schema.appointments)
          .values({ clientId: client!.id, date: "2026-12-01", startTime: "10:00", endTime: "11:00", status: "scheduled", therapyIds: JSON.stringify([therapyId]), totalPriceEur: price })
          .returning()
          .all()[0]!.id;
      const voucher = (code: string, v: Partial<typeof schema.giftVouchers.$inferInsert> = {}) =>
        tdb
          .insert(schema.giftVouchers)
          .values({ code, purchaserName: "Sean", recipientName: "Aoife", valueEur: 50, balanceEur: 50, purchaseDate: "2026-11-23", expiryDate: "2031-11-23", ...v })
          .returning()
          .all()[0]!;
      const get = (id: number) => tdb.select().from(schema.giftVouchers).where(eq(schema.giftVouchers.id, id)).get()!;
      const uses = (id: number) => tdb.select().from(schema.voucherRedemptions).where(eq(schema.voucherRedemptions.voucherId, id)).all();
      const pays = (apptId: number) => tdb.select().from(schema.payments).where(eq(schema.payments.appointmentId, apptId)).all();
      const now = Date.UTC(2026, 11, 1, 10);
      const book = (code: string, apptId: number, price: number, therapyId: number, secondaryMethod: string | null = null) =>
        redeemAtBooking({ code, clientId: client!.id, appointmentId: apptId, priceEur: price, therapyIds: [therapyId], secondaryMethod, userId: 7, now });

      // Money voucher short of the price: refused until another method is chosen.
      const v50 = voucher("GC-2026-AAAA");
      const a1 = appt(massage, 80);
      const short = book("GC-2026-AAAA", a1, 80, massage);
      assert.ok(!short.ok && short.error === "The voucher pays €50 of €80. Choose how the other €30 is paid.");
      assert.equal(pays(a1).length, 0, "nothing written");
      assert.equal(uses(v50.id).length, 0);
      assert.equal(get(v50.id).balanceEur, 50);
      const paid = book("gc-2026-aaaa ", a1, 80, massage, "card");
      assert.ok(paid.ok && paid.voucherEur === 50 && paid.remainderEur === 30, "lower case and stray spaces are fine");
      assert.deepEqual(pays(a1).map((p) => [p.paymentMethod, p.amountEur, p.voucherId]), [["voucher", 50, v50.id], ["card", 30, null]], "two payments");
      assert.deepEqual(uses(v50.id).map((u) => [u.amountEur, u.appointmentId, u.redeemedByUserId]), [[50, a1, 7]], "one redemption, who and where");
      assert.equal(get(v50.id).balanceEur, 0);
      assert.equal(get(v50.id).isRedeemed, true);
      const again = book("GC-2026-AAAA", appt(massage, 80), 80, massage, "cash");
      assert.ok(!again.ok && again.error === "This voucher has been used.");

      // Money voucher with change: the balance carries to the next visit.
      const v100 = voucher("GC-2026-BBBB", { valueEur: 100, balanceEur: 100 });
      const a2 = appt(facial, 30);
      assert.ok(book("GC-2026-BBBB", a2, 30, facial).ok, "covers it, no second method needed");
      assert.equal(get(v100.id).balanceEur, 70);
      assert.equal(lookupVoucher("GC-2026-BBBB", "2026-12-01")?.state, "part_used");
      const a3 = appt(massage, 80);
      assert.ok(book("GC-2026-BBBB", a3, 80, massage, "cash").ok);
      assert.equal(get(v100.id).balanceEur, 0);
      assert.equal(balanceFrom(100, uses(v100.id).map((u) => u.amountEur)), get(v100.id).balanceEur, "balance = value - redemptions");

      // Treatment voucher: today's price, whatever it cost, then used up.
      const vt = voucher("GC-2026-CCCC", { kind: "treatment", therapyId: massage, valueEur: 70, balanceEur: 70 });
      assert.ok(!book("GC-2026-CCCC", appt(facial, 60), 60, facial).ok, "not for a different treatment");
      const wrong = book("GC-2026-CCCC", appt(facial, 60), 60, facial);
      assert.ok(!wrong.ok && wrong.error === "This voucher is for Swedish massage.");
      const a4 = appt(massage, 80);
      const t = book("GC-2026-CCCC", a4, 80, massage);
      assert.ok(t.ok && t.voucherEur === 80 && t.remainderEur === 0, "the whole session, at today's EUR 80");
      assert.deepEqual(pays(a4).map((p) => [p.paymentMethod, p.amountEur]), [["voucher", 80]]);
      assert.deepEqual(uses(vt.id).map((u) => u.amountEur), [70], "the voucher's own value comes off");
      assert.equal(get(vt.id).balanceEur, 0);

      // Expired: a warning, still taken.
      voucher("GC-2026-DDDD", { expiryDate: "2026-11-30" });
      assert.equal(lookupVoucher("GC-2026-DDDD", "2026-12-01")?.expired, true);
      const old = book("GC-2026-DDDD", appt(facial, 40), 40, facial);
      assert.ok(old.ok && old.expired, "expired is allowed and reported");

      // Refused, nothing written.
      voucher("GC-2026-EEEE", { cancelledAt: now, balanceEur: 0 });
      const a5 = appt(facial, 40);
      const cancelled = book("GC-2026-EEEE", a5, 40, facial);
      assert.ok(!cancelled.ok && cancelled.error === "This voucher was cancelled.");
      const unknown = book("NOPE-0000", a5, 40, facial);
      assert.ok(!unknown.ok && unknown.error === "Voucher not found.");
      voucher("GC-2026-FFFF");
      const free = book("GC-2026-FFFF", a5, 0, facial);
      assert.ok(!free.ok && /no price/.test(free.error));
      assert.equal(pays(a5).length, 0);

      // A treatment voucher for a treatment with no price pays nothing: refused, still unused.
      const free2 = seedTherapy(tid, "Consultation", 0);
      const vf = voucher("GC-2026-GGGG", { kind: "treatment", therapyId: free2, valueEur: 40, balanceEur: 40 });
      const a6 = appt(free2, 40);
      const nothing = book("GC-2026-GGGG", a6, 40, free2, "cash");
      assert.ok(!nothing.ok, "a treatment voucher with no treatment price is refused");
      assert.equal(pays(a6).length, 0);
      assert.equal(uses(vf.id).length, 0);
      assert.equal(get(vf.id).balanceEur, 40);

      // Two uses read the same balance: the second would overspend and is refused with nothing written.
      const vr = voucher("GC-2026-HHHH", { valueEur: 50, balanceEur: 50 });
      const a7 = appt(massage, 40);
      const a8 = appt(massage, 40);
      const useOf = (appointmentId: number) => ({
        voucherId: vr.id, redemptionEur: 40, paymentEur: 40, clientId: client!.id, appointmentId, packageId: null, userId: 7, note: null,
        remainder: { amountEur: 5, method: "cash" as const, note: "rest" },
      });
      recordVoucherUse(useOf(a7), now);
      assert.equal(get(vr.id).balanceEur, 10);
      assert.throws(() => recordVoucherUse(useOf(a8), now), VoucherBalanceError, "a second use over the remaining balance is refused");
      assert.equal(pays(a8).length, 0, "no payment rows left behind");
      assert.equal(uses(vr.id).length, 1, "no second redemption");
      assert.equal(get(vr.id).balanceEur, 10, "balance untouched");
      const viaBooking = book("GC-2026-HHHH", a8, 40, massage, "cash");
      assert.ok(viaBooking.ok && viaBooking.voucherEur === 10, "a fresh booking only takes what is left");
    }),
  );

  console.log("vouchers redeem: split payments, treatment vouchers, refusals; all passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
