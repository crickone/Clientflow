// Run: npm test -- src/lib/dashboard/metrics/financeQueries.test.ts
//
// Smoke test: every financeQueries loader once against a scratch tenant
// with a little seeded data. Asserts the revenue-method exclusion and the
// churn denominator.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./financeQueries") as typeof import("./financeQueries");
  const { addDaysIso, dublinIso } = requireLocal("./stats") as typeof import("./stats");

  const slug = "dashboard-finance-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "dashboard-finance-test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const today = dublinIso(now);
  const day = (n: number) => addDaysIso(today, n);
  const at = (n: number) => new Date(now + n * DAY);

  try {
    await runWithTenant(t.id, async () => {
      const mkClient = (first: string) =>
        db.insert(schema.clients).values({ firstName: first, lastName: "Test", phone: "1" } as never).returning().get();
      const a = mkClient("Ann");
      const b = mkClient("Bob");
      const hbot = db.insert(schema.therapies).values({ name: "HBOT", colourHex: "#112233", defaultDurationMinutes: 60, defaultPriceEur: 80 }).returning().get();
      const pemf = db.insert(schema.therapies).values({ name: "PEMF", colourHex: "#445566", defaultDurationMinutes: 60, defaultPriceEur: 60 }).returning().get();

      const pay = (clientId: number, amountEur: number, paymentMethod: string, createdAt: Date) =>
        db.insert(schema.payments).values({ clientId, amountEur, paymentMethod, createdAt } as never).run();
      pay(a.id, 100, "card", at(-3));
      pay(a.id, 50, "cash", at(-2));
      pay(b.id, 30, "bank_transfer", at(-1));
      pay(b.id, 80, "voucher", at(-1));
      pay(b.id, 40, "package", at(-1));
      pay(b.id, 500, "card", at(-60));

      const from = at(-10).getTime();
      const to = now + 1000;

      const rows = q.paymentsIn(from, to);
      assert.equal(rows.length, 5, "five payments in range, the old one excluded");
      assert.equal(rows.filter((r) => ["cash", "card", "bank_transfer"].includes(r.method)).reduce((s, r) => s + r.amount, 0), 180);

      const top = await q.topSpenders(rows, 8);
      assert.deepEqual(top.map((x) => [x.name, x.total]), [["Ann Test", 150], ["Bob Test", 30]], "voucher and package excluded from spend");

      db.insert(schema.giftVouchers).values({
        code: "V1", purchaserName: "P", valueEur: 100, balanceEur: 60, isRedeemed: false,
        purchaseDate: day(-2), expiryDate: day(100), createdAt: at(-2),
      } as never).run();
      db.insert(schema.giftVouchers).values({
        code: "V2", purchaserName: "P", valueEur: 50, balanceEur: 0, isRedeemed: true, redeemedAt: at(-1),
        purchaseDate: day(-40), expiryDate: day(100), createdAt: at(-40),
      } as never).run();
      db.insert(schema.giftVouchers).values({
        code: "V3", purchaserName: "P", valueEur: 70, balanceEur: 70, isRedeemed: false,
        purchaseDate: day(-300), expiryDate: day(-5), createdAt: at(-300),
      } as never).run();
      const v = q.voucherStats(from, to, today);
      assert.deepEqual(v, { outstanding: 60, soldCount: 1, soldValue: 100, redeemedCount: 1, redeemedValue: 50 }, "expired voucher is not outstanding");

      const appt = (clientId: number, date: string, status: string, price: number, ids: number[]) =>
        db.insert(schema.appointments).values({ clientId, date, startTime: "10:00", endTime: "11:00", status, totalPriceEur: price, therapyIds: JSON.stringify(ids) } as never).run();
      appt(a.id, day(-3), "completed", 100, [hbot.id, pemf.id]);
      appt(a.id, day(-2), "completed", 80, [hbot.id]);
      appt(b.id, day(-2), "cancelled", 999, [hbot.id]);
      appt(b.id, day(-60), "completed", 999, [pemf.id]);
      const svc = await q.revenueByService(day(-10), day(0), 8);
      assert.deepEqual(svc, [{ label: "HBOT", value: 130 }, { label: "PEMF", value: 50 }]);

      db.insert(schema.packages).values({
        clientId: a.id, therapyId: hbot.id, packageName: "Five pack", totalSessions: 5, sessionsUsed: 2,
        pricePaidEur: 300, purchaseDate: day(-20), expiryDate: day(10),
      }).run();
      const pk = await q.packageUse();
      assert.equal(pk.activeCount, 1);
      assert.equal(pk.sold, 5);
      assert.equal(pk.used, 2);

      const plan = db.insert(schema.membershipPlans).values({ name: "Monthly", priceCents: 4900 }).returning().get();
      const mem = (client: number, createdAt: Date, endedAt: Date | null, status: string, next: string | null) =>
        db.insert(schema.clientMemberships).values({
          membershipId: plan.id, clientId: client, membershipName: "Monthly", priceCents: 4900, status, startDate: today, nextBillingDate: next, createdAt, endedAt,
        } as never).run();
      mem(a.id, at(-100), null, "active", day(3));
      mem(b.id, at(-100), at(-4), "cancelled", null);
      mem(a.id, at(-100), at(-30), "cancelled", null);
      mem(b.id, at(-5), at(-2), "cancelled", null);
      mem(b.id, at(-1), null, "active", day(40));
      const c = q.churnCounts(from, to);
      assert.deepEqual(c, { ended: 2, activeAtStart: 2 }, "denominator is memberships active at range start; the one ended earlier or created later is excluded");

      const ev = q.membershipEvents(from, to);
      assert.equal(ev.created.length, 2);
      assert.equal(ev.ended.length, 2);

      const rn = await q.renewalsBetween(day(0), day(14), 10);
      assert.equal(rn.length, 1, "only the renewal inside the window");
      assert.equal(rn[0].client, "Ann Test");
      assert.equal(rn[0].plan, "Monthly");
      assert.equal(rn[0].amountCents, 4900);
      assert.equal(rn[0].date, day(3));
    });
    console.log("financeQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
