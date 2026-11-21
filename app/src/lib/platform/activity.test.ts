// Run: npm test -- src/lib/platform/activity.test.ts
//
// Each business's week for the console dashboard. A tenant whose database
// cannot be opened still gets a row, with its tenant-DB figures null.
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
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const DAY = 86400000;

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const { createPendingOrder, setOrderStatus } = requireLocal("../offers/store") as typeof import("../offers/store");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { getFleetActivity } = requireLocal("./activity") as typeof import("./activity");
  const { dublinToday } = requireLocal("../billing/dates") as typeof import("../billing/dates");

  const goodSlug = "activity-test-good";
  const badSlug = "activity-test-bad";
  const badFile = `tenants/${badSlug}.db`; // made a directory below, so it cannot open as a database
  const dataDir = path.join(process.cwd(), "data");
  for (const s of [goodSlug, badSlug]) controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(s);
  const ins = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id");
  const goodId = (ins.get(goodSlug, "Activity Good", `tenants/${goodSlug}/${goodSlug}.db`) as { id: number }).id;
  const badId = (ins.get(badSlug, "Activity Bad", badFile) as { id: number }).id;
  fs.mkdirSync(path.join(dataDir, badFile), { recursive: true });

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(goodId, badId);
    for (const p of [path.join("tenants", goodSlug), badFile]) {
      try {
        fs.rmSync(path.join(dataDir, p), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  try {
    const now = Date.now();
    const sqlDay = (offset: number) => dublinToday(new Date(now + offset * DAY));

    await runWithTenant(goodId, async () => {
      upsertLead({ source: "manual", sourceLeadId: "a", fullName: "Recent Lead" });
      upsertLead({ source: "manual", sourceLeadId: "b", fullName: "Old Lead" });

      const tdb = getTenantDbById(goodId);
      const allLeads = tdb.select().from(schema.leads).all();
      assert.equal(allLeads.length, 2);
      tdb.update(schema.leads).set({ createdAt: new Date(now - 2 * DAY) }).where(eq(schema.leads.id, allLeads[0].id)).run();
      tdb.update(schema.leads).set({ createdAt: new Date(now - 10 * DAY) }).where(eq(schema.leads.id, allLeads[1].id)).run();

      // One paid order of 6400 cents, a day ago; one still pending.
      const offer = tdb
        .insert(schema.offers)
        .values({ title: "Test offer", priceCents: 6400, useByDate: "2027-01-01", createdAt: now, updatedAt: now })
        .returning()
        .get();
      const paid = createPendingOrder(offer, "acct_test");
      setOrderStatus(paid.id, "paid");
      tdb.update(schema.offerOrders).set({ createdAt: now - DAY, paidAt: now - DAY }).where(eq(schema.offerOrders.id, paid.id)).run();
      createPendingOrder(offer, "acct_test");

      // Bookings: a class booked 1 day ago (this week), an appointment 10 days ago (the week before).
      const client = tdb.insert(schema.clients).values({ firstName: "A", lastName: "B", phone: "0" }).returning().get();
      const session = tdb
        .insert(schema.classSessions)
        .values({ date: sqlDay(-1), startTime: "10:00", endTime: "11:00", name: "Test class" })
        .returning()
        .get();
      tdb.insert(schema.sessionBookings).values({ sessionId: session.id, clientId: client.id }).run();
      tdb.insert(schema.appointments).values({ clientId: client.id, date: sqlDay(-10), startTime: "09:00", endTime: "10:00" }).run();
    });

    const { rows } = getFleetActivity(now);
    const good = rows.find((r) => r.tenantId === goodId);
    assert.ok(good, "row for the good tenant");
    assert.equal(good.leads7d, 1);
    assert.equal(good.salesCents7d, 6400);
    assert.equal(good.bookings7d, 1);
    assert.equal(good.bookingsPrev7d, 1);
    assert.equal(good.membersActive7d, 0);
    assert.equal(good.lastLoginAt, null);

    const bad = rows.find((r) => r.tenantId === badId);
    assert.ok(bad, "row for the unopenable tenant");
    assert.equal(bad.name, "Activity Bad");
    assert.equal(bad.leads7d, null);
    assert.equal(bad.salesCents7d, null);
    assert.equal(bad.bookings7d, null);
    assert.equal(bad.bookingsPrev7d, null);

    console.log("platform/activity: ok");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
