// Run: npm test -- src/lib/dashboard/metrics/breakdownQueries.test.ts
//
// The rows behind the money tiles, against a scratch tenant: each list must
// add up to the number its tile shows.
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
  const q = requireLocal("./breakdownQueries") as typeof import("./breakdownQueries");
  const b = requireLocal("./breakdown") as typeof import("./breakdown");
  const fq = requireLocal("./financeQueries") as typeof import("./financeQueries");
  const { revenueSummary } = requireLocal("./finance") as typeof import("./finance");
  const { prepaidOutstanding } = requireLocal("../../queries") as typeof import("../../queries");
  const { addDaysIso, dublinIso } = requireLocal("./stats") as typeof import("./stats");

  const slug = "dashboard-breakdown-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "dashboard-breakdown-test", `tenants/${slug}/${slug}.db`) as { id: number };
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
      const c = mkClient("Cat");
      const hbot = db.insert(schema.therapies).values({ name: "HBOT", colourHex: "#112233", defaultDurationMinutes: 60, defaultPriceEur: 80 }).returning().get();
      const pemf = db.insert(schema.therapies).values({ name: "PEMF", colourHex: "#445566", defaultDurationMinutes: 60, defaultPriceEur: 60 }).returning().get();

      const appt = db
        .insert(schema.appointments)
        .values({ clientId: a.id, date: day(-2), startTime: "10:00", endTime: "11:00", status: "completed", totalPriceEur: 120, therapyIds: JSON.stringify([hbot.id, pemf.id]) } as never)
        .returning()
        .get();
      db.insert(schema.appointments).values({ clientId: c.id, date: day(-1), startTime: "09:00", endTime: "10:00", status: "cancelled", totalPriceEur: 99, therapyIds: "[]" } as never).run();

      const pkgA = db.insert(schema.packages).values({
        clientId: a.id, therapyId: hbot.id, packageName: "Five pack", totalSessions: 5, sessionsUsed: 2,
        pricePaidEur: 300, purchaseDate: day(-20), expiryDate: day(10),
      }).returning().get();
      db.insert(schema.packages).values({
        clientId: c.id, therapyId: hbot.id, packageName: "Old pack", totalSessions: 3, sessionsUsed: 0,
        pricePaidEur: 150, purchaseDate: day(-200), expiryDate: day(-1),
      }).run();
      db.insert(schema.packages).values({
        clientId: c.id, therapyId: pemf.id, packageName: "Used up", totalSessions: 2, sessionsUsed: 2,
        pricePaidEur: 100, purchaseDate: day(-20), expiryDate: day(10),
      }).run();
      const v1 = db.insert(schema.giftVouchers).values({
        code: "BV1", purchaserName: "Pat", recipientName: "Ann", valueEur: 100, balanceEur: 60, isRedeemed: false,
        purchaseDate: day(-2), expiryDate: day(100), createdAt: at(-2),
      } as never).returning().get();
      db.insert(schema.giftVouchers).values({
        code: "BV2", purchaserName: "Pat", valueEur: 70, balanceEur: 70, isRedeemed: false,
        purchaseDate: day(-300), expiryDate: day(-5), createdAt: at(-300),
      } as never).run();

      const pay = (v: Record<string, unknown>) => db.insert(schema.payments).values(v as never).run();
      pay({ clientId: a.id, amountEur: 120, paymentMethod: "card", appointmentId: appt.id, createdAt: at(-2) });
      pay({ clientId: a.id, amountEur: 300, paymentMethod: "bank_transfer", packageId: pkgA.id, createdAt: at(-3) });
      pay({ clientId: c.id, amountEur: 40, paymentMethod: "voucher", voucherId: v1.id, createdAt: at(-1) });
      pay({ clientId: c.id, amountEur: 25, paymentMethod: "cash", notes: "Water bottle", createdAt: at(-1) });
      pay({ clientId: c.id, amountEur: 500, paymentMethod: "card", createdAt: at(-60) });

      const from = at(-10).getTime();
      const to = now + 1000;

      const lines = q.paymentLines(from, to);
      assert.equal(lines.length, 4, "the old payment is outside the range");
      assert.deepEqual(lines.map((l) => l.clientName), ["Cat Test", "Cat Test", "Ann Test", "Ann Test"], "newest first, with names");
      const forOf = (amount: number) => lines.find((l) => l.amount === amount)!.forWhat;
      assert.match(forOf(120), /^HBOT, PEMF on /, "an appointment payment names its services");
      assert.equal(forOf(300), "Five pack");
      assert.equal(forOf(40), "Gift voucher BV1");
      assert.equal(forOf(25), "Water bottle");

      const tile = revenueSummary(fq.paymentsIn(from, to));
      assert.equal(b.sumAmounts(b.revenueLines(lines)), tile.total, "Payments received rows add up to the tile");
      assert.equal(b.spendByClient(lines).length, tile.clients, "Spend per client lists the clients the average divides by");
      assert.equal(b.sumAmounts(lines), 485, "All payments includes redemptions");

      const pkgs = q.packagesWithCredit(today);
      assert.deepEqual(pkgs.map((p) => p.packageName), ["Five pack"], "expired and used-up packages are not owed");
      const vouchers = q.openVouchers(today);
      assert.deepEqual(vouchers.map((v) => [v.code, v.balance]), [["BV1", 60]], "expired voucher is not owed");
      const deferred = b.sumAmounts(pkgs.map((p) => ({ amount: b.packageValueLeft(p) }))) + b.sumAmounts(vouchers.map((v) => ({ amount: v.balance })));
      assert.equal(deferred, prepaidOutstanding(today), "Deferred revenue rows add up to the tile");
      assert.equal(deferred, 240);

      const svc = q.serviceLines(day(-10), day(0));
      assert.equal(svc.length, 1, "only completed appointments");
      assert.equal(svc[0].services, "HBOT, PEMF");
      assert.deepEqual(q.serviceTotals(day(-10), day(0)), [
        { label: "HBOT", value: 60, count: 1 },
        { label: "PEMF", value: 60, count: 1 },
      ]);
      assert.deepEqual(
        q.serviceTotals(day(-10), day(0)).map((s) => ({ label: s.label, value: s.value })),
        await fq.revenueByService(day(-10), day(0), 99),
        "By service matches the Revenue by service tile",
      );

      assert.equal(q.activePackages().length, 3, "Package use lists every active package");
    });
    console.log("breakdownQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
