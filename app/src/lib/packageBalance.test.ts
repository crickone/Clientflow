// Run: npm test -- src/lib/packageBalance.test.ts
//
// A prepaid package holds a session for every booking on it that hasn't
// happened yet; a cancelled booking gives it back.
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
  const { bookedByPackage } = requireLocal("./packageBalance") as typeof import("./packageBalance");

  const slug = "package-balance-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Package Balance Test", `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    const tdb = getTenantDbById(tid);
    const client = tdb.insert(s.clients).values({ firstName: "Ann", lastName: "Buyer", phone: "+353870000000" }).returning().get();
    const therapy = tdb.insert(s.therapies).values({ name: "Infrared", defaultDurationMinutes: 12, defaultPriceEur: 50, colourHex: "#ff6600" }).returning().get();
    const pkg = tdb.insert(s.packages).values({
      clientId: client.id, therapyId: therapy.id, packageName: "Black Friday Infrared", totalSessions: 2,
      pricePaidEur: 100, purchaseDate: "2026-11-24", expiryDate: "2026-12-08",
    }).returning().get();
    const book = (status: "scheduled" | "cancelled" | "completed") => {
      const a = tdb.insert(s.appointments).values({ clientId: client.id, date: "2026-12-01", startTime: "10:00", endTime: "10:12", status, therapyIds: JSON.stringify([therapy.id]) }).returning().get();
      tdb.insert(s.payments).values({ clientId: client.id, appointmentId: a.id, packageId: pkg.id, amountEur: 0, paymentMethod: "package" }).run();
      return a.id;
    };
    const kept = book("scheduled");
    book("cancelled");
    book("completed");

    await runWithTenant(tid, async () => {
      assert.equal(bookedByPackage([pkg.id]).get(pkg.id), 1, "only the upcoming booking holds a session");
      assert.equal(bookedByPackage([pkg.id], kept).get(pkg.id) ?? 0, 0, "a booking can be left out (rebooking it)");
      assert.equal(bookedByPackage([]).size, 0);
    });
    console.log("packageBalance: 3 checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
