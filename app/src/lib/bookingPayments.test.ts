// Run: npm test -- src/lib/bookingPayments.test.ts
//
// Cancelling or deleting a booking removes the payment it recorded when it
// was made; a gift voucher it drew on gets the amount back; online (Stripe)
// payments are never removed.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("@/lib/db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("./db/tenant") as typeof import("@/lib/db/tenant");
  const s = requireLocal("./db/schema") as typeof import("@/lib/db/schema");
  const { voidBookingPayments } = requireLocal("./bookingPayments") as typeof import("./bookingPayments");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");

  const slug = "booking-payments-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Booking Payments Test", `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    const tdb = getTenantDbById(tid);
    const client = tdb.insert(s.clients).values({ firstName: "Ann", lastName: "Buyer", phone: "+353870000001" }).returning().get();
    const appt = (time: string) =>
      tdb.insert(s.appointments).values({ clientId: client.id, date: "2026-12-01", startTime: time, endTime: "11:00", therapyIds: "[]" }).returning().get().id;

    const cashAppt = appt("10:00");
    tdb.insert(s.payments).values({ clientId: client.id, appointmentId: cashAppt, amountEur: 80, paymentMethod: "voucher" }).run();
    const onlineAppt = appt("12:00");
    tdb.insert(s.payments).values({ clientId: client.id, appointmentId: onlineAppt, amountEur: 64, paymentMethod: "card", notes: "Online: Black Friday (Stripe pi_x)" }).run();
    const voucherAppt = appt("14:00");
    const v = tdb.insert(s.giftVouchers).values({ code: `TEST-${Date.now()}`, purchaserName: "Gift", valueEur: 100, balanceEur: 50, purchaseDate: "2026-11-01", expiryDate: "2031-11-01", isRedeemed: false }).returning().get();
    const pay = tdb.insert(s.payments).values({ clientId: client.id, appointmentId: voucherAppt, voucherId: v.id, amountEur: 50, paymentMethod: "voucher" }).returning().get();
    tdb.insert(s.voucherRedemptions).values({ voucherId: v.id, amountEur: 50, appointmentId: voucherAppt, paymentId: pay.id, createdAt: Date.now() } as never).run();

    await runWithTenant(tid, async () => {
      assert.equal(voidBookingPayments(cashAppt), 1, "the booking's own payment is removed");
      assert.equal(tdb.select().from(s.payments).where(eq(s.payments.appointmentId, cashAppt)).all().length, 0);
      assert.equal(voidBookingPayments(onlineAppt), 0, "an online payment is never removed");
      assert.equal(voidBookingPayments(voucherAppt), 1);
      const after = tdb.select().from(s.giftVouchers).where(eq(s.giftVouchers.id, v.id)).get()!;
      assert.equal(after.balanceEur, 100, "the voucher gets its €50 back");
      assert.equal(tdb.select().from(s.voucherRedemptions).where(eq(s.voucherRedemptions.paymentId, pay.id)).all().length, 0, "and the redemption is gone");
      assert.equal(voidBookingPayments(cashAppt), 0, "running it twice does nothing");
    });
    console.log("bookingPayments: 7 checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
