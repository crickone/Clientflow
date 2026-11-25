// Run: npm test -- src/app/api/appointments/route.test.ts
//
// The booking screen's body (lib/booking/bookingPayload) against the REAL
// POST /api/appointments on a scratch tenant: the redesign must not change
// what the server records for any path. Checked here: an existing client
// paying cash, a walk-in, a prepaid package (valued at what the package cost
// per session, not the list price), a new package sold at booking, and the
// slot check refusing a clash with its own message. Only the auth gate is
// stubbed (there is no request session in this runner).
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") return { guard: async () => null };
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in appointments route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../../lib/db/control") as typeof import("@/lib/db/control");
  const { runWithTenant } = requireLocal("../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { db } = requireLocal("../../../lib/db") as typeof import("@/lib/db");
  const schema = requireLocal("../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { EMPTY_NEW_PACKAGE, bookingFormData } = requireLocal("../../../lib/booking/bookingPayload") as typeof import("@/lib/booking/bookingPayload");
  const { POST } = requireLocal("./route") as typeof import("./route");
  type BookingDraft = import("@/lib/booking/bookingPayload").BookingDraft;

  const slug = "appointments-route-test";
  // A fresh tenant database every run: rows left by an earlier run would
  // clash with this one's bookings.
  const tenantDir = path.join(process.cwd(), "data", "tenants", slug);
  fs.rmSync(tenantDir, { recursive: true, force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Appointments Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const post = async (d: BookingDraft) => {
    const res = await POST(new Request("http://localhost/api/appointments", { method: "POST", body: bookingFormData(d) }) as never);
    return { status: res.status, body: (await res.json()) as { ok: boolean; id?: number; error?: string } };
  };

  try {
    await runWithTenant(tid, async () => {
      const [therapy] = db
        .insert(schema.therapies)
        .values({ name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 })
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      const [pkg] = db
        .insert(schema.packages)
        .values({
          clientId: client.id,
          therapyId: therapy.id,
          packageName: "Test offer",
          totalSessions: 1,
          pricePaidEur: 64,
          purchaseDate: "2029-12-01",
          expiryDate: "2030-12-31",
        })
        .returning()
        .all();
      const [tpl] = db
        .insert(schema.packageTemplates)
        .values({ name: "Five pack", therapyId: therapy.id, totalSessions: 5, priceEur: 350, validityMonths: 6 })
        .returning()
        .all();

      // 2030-01-07 is a Monday: open 08:00-20:00 on the default hours.
      const draft = (over: Partial<BookingDraft>): BookingDraft => ({
        clientMode: "existing",
        clientId: client.id,
        walkIn: { firstName: "", lastName: "", email: "", phone: "" },
        therapyIds: [therapy.id],
        date: "2030-01-07",
        startTime: "09:00",
        durationMinutes: 60,
        priceEur: 80,
        paymentMethod: "cash",
        packageMode: "existing",
        packageId: null,
        newPackage: EMPTY_NEW_PACKAGE,
        voucherCode: "",
        secondaryPaymentMethod: null,
        notes: "",
        ...over,
      });
      const apptOf = (id: number) => db.select().from(schema.appointments).where(eq(schema.appointments.id, id)).get()!;
      const paymentsOf = (id: number) => db.select().from(schema.payments).where(eq(schema.payments.appointmentId, id)).all();

      // Existing client, cash.
      const cash = await post(draft({ notes: "First visit" }));
      assert.equal(cash.status, 200, JSON.stringify(cash.body));
      const cashAppt = apptOf(cash.body.id!);
      assert.deepEqual(
        [cashAppt.clientId, cashAppt.startTime, cashAppt.endTime, cashAppt.totalPriceEur, cashAppt.notes, cashAppt.status],
        [client.id, "09:00", "10:00", 80, "First visit", "scheduled"],
      );
      assert.deepEqual(paymentsOf(cash.body.id!).map((p) => [p.paymentMethod, p.amountEur]), [["cash", 80]]);

      // The same treatment at an overlapping time is refused by the slot check.
      const clash = await post(draft({ startTime: "09:30" }));
      assert.equal(clash.status, 409, "a clashing time is refused");
      assert.equal(clash.body.ok, false);
      assert.ok(clash.body.error && clash.body.error.length > 0, "with the slot check's own message");

      // Walk-in.
      const walk = await post(
        draft({ clientMode: "walk_in", clientId: null, startTime: "10:00", walkIn: { firstName: "Walk", lastName: "", email: "", phone: "" } }),
      );
      assert.equal(walk.status, 200, JSON.stringify(walk.body));
      const walker = db.select().from(schema.clients).where(eq(schema.clients.id, apptOf(walk.body.id!).clientId)).get()!;
      assert.deepEqual([walker.firstName, walker.lastName, walker.phone], ["Walk", "—", "—"]);

      // Prepaid package: valued at EUR 64, a EUR 0 package payment.
      const prepaid = await post(draft({ startTime: "11:00", paymentMethod: "package", packageId: pkg.id, priceEur: 64 }));
      assert.equal(prepaid.status, 200, JSON.stringify(prepaid.body));
      assert.equal(apptOf(prepaid.body.id!).totalPriceEur, 64);
      assert.deepEqual(paymentsOf(prepaid.body.id!).map((p) => [p.paymentMethod, p.amountEur, p.packageId]), [["package", 0, pkg.id]]);

      // That package's one session is now booked: a second use is refused.
      const again = await post(draft({ startTime: "13:00", paymentMethod: "package", packageId: pkg.id, priceEur: 64 }));
      assert.equal(again.status, 409, "a package with its session already booked is refused");

      // New package sold at booking, from a template.
      const sold = await post(
        draft({ startTime: "14:00", paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: tpl.id, paymentMethod: "card" } }),
      );
      assert.equal(sold.status, 200, JSON.stringify(sold.body));
      assert.equal(apptOf(sold.body.id!).totalPriceEur, 0, "the session is covered by the new package");
      const soldPayments = paymentsOf(sold.body.id!);
      assert.ok(soldPayments.some((p) => p.paymentMethod === "card" && p.amountEur === 350), "the package sale is recorded");
      const created = db
        .select()
        .from(schema.packages)
        .where(and(eq(schema.packages.clientId, client.id), eq(schema.packages.packageName, "Five pack")))
        .get();
      assert.ok(created && created.totalSessions === 5, "the package is created for the client");
    });
    console.log("appointments POST: booking screen payloads accepted, 6 paths checked.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
