// Run: npm test -- src/lib/dashboard/metrics/frontdeskQueries.test.ts
//
// Smoke test: every frontdeskQueries loader once against a scratch tenant
// with a little seeded data. Shape plus at least one non-trivial value each.
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
  const q = requireLocal("./frontdeskQueries") as typeof import("./frontdeskQueries");

  const slug = "dashboard-frontdesk-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "dashboard-frontdesk-test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const { addDaysIso, dublinIso } = requireLocal("./stats") as typeof import("./stats");
  const { dublinLocalToMs } = requireLocal("./frontdesk") as typeof import("./frontdesk");
  const now = Date.now();
  const today = dublinIso(now);
  const day = (n: number) => addDaysIso(today, n);

  try {
    await runWithTenant(t.id, async () => {
      const mkClient = (first: string, dob: string | null) =>
        db.insert(schema.clients).values({ firstName: first, lastName: "Test", phone: "1", dateOfBirth: dob } as never).returning().get();
      const a = mkClient("Ann", `1990-${day(2).slice(5)}`);
      const b = mkClient("Bob", `1985-${day(40).slice(5)}`);
      mkClient("Cat", null);
      const th = db
        .insert(schema.therapies)
        .values({ name: "HBOT", colourHex: "#112233", defaultDurationMinutes: 60, defaultPriceEur: 80 })
        .returning()
        .get();

      const appt = (clientId: number, date: string, status: string, extra: Record<string, unknown> = {}) =>
        db
          .insert(schema.appointments)
          .values({ clientId, date, startTime: "10:00", endTime: "11:00", status, therapyIds: `[${th.id}]`, ...extra } as never)
          .returning()
          .get();

      appt(a.id, day(-40), "completed");
      const c1 = appt(a.id, day(-3), "completed");
      const c2 = appt(b.id, day(-2), "completed");
      appt(b.id, day(-1), "no_show");
      appt(a.id, day(0), "confirmed");
      appt(b.id, day(-1), "cancelled", { cancelledAt: new Date(dublinLocalToMs(day(-1), "10:00") - 2 * 3_600_000), cancelledAtApprox: false });
      appt(b.id, day(-1), "cancelled", { cancelledAt: new Date(now - DAY), cancelledAtApprox: true });
      appt(a.id, day(4), "cancelled", { cancelledAt: new Date(now - 3_600_000), cancelledAtApprox: false });
      for (const ap of [c1, c2]) {
        db.insert(schema.sessions).values({ appointmentId: ap.id, clientId: ap.clientId, therapyId: th.id, date: ap.date, durationMinutes: 60 }).run();
      }
      db.insert(schema.packages).values({
        clientId: a.id, therapyId: th.id, packageName: "Five pack", totalSessions: 5, sessionsUsed: 2,
        pricePaidEur: 300, purchaseDate: day(-20), expiryDate: day(10),
      }).run();
      db.insert(schema.packages).values({
        clientId: b.id, therapyId: th.id, packageName: "Used up", totalSessions: 3, sessionsUsed: 3,
        pricePaidEur: 100, purchaseDate: day(-20), expiryDate: day(10),
      }).run();

      const from = day(-10);
      const to = day(0);

      assert.deepEqual(q.bookingsBetween(from, to), { total: 4, confirmed: 1 }, "cancelled excluded, no-show kept");

      const o = await q.outcomeCounts(from, to);
      assert.deepEqual(o, { completed: 2, noShow: 1, cancelled: 2, total: 5 });

      const bd = q.clientsWithBirthdays();
      assert.equal(bd.length, 2, "client without a date of birth is excluded");
      assert.ok(bd.some((c) => c.name === "Ann Test"));

      assert.equal(q.activeAppointmentsIn(from, to).length, 4);

      const split = await q.serviceSplit(from, to);
      assert.deepEqual(split, [{ label: "HBOT", value: 2, color: "#112233" }]);

      assert.deepEqual(q.newReturningCounts(from, to), { newClients: 1, returning: 1 });

      const lead = q.cancelLeadTimeCounts(Date.parse(`${from}T00:00:00Z`), now + DAY);
      assert.equal(lead.length, 5, "all five buckets, in order");
      assert.equal(lead.find((r) => r.label === "Under 24 hours")!.value, 1);
      assert.equal(lead.find((r) => r.label === "3 to 7 days")!.value, 1);
      assert.equal(lead.reduce((s, r) => s + r.value, 0), 2, "approximate cancel dates are excluded");

      const exp = await q.expiringCredits(10);
      assert.equal(exp.length, 1, "package with no sessions left is excluded");
      assert.equal(exp[0].client, "Ann Test");
      assert.equal(exp[0].left, 3);
    });
    console.log("frontdeskQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
