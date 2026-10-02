// Run: npm test -- src/lib/dashboard/metrics/classesQueries.test.ts
//
// Smoke test: every classesQueries loader once against a scratch tenant
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
  const q = requireLocal("./classesQueries") as typeof import("./classesQueries");

  const slug = "dashboard-classes-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "dashboard-classes-test", `tenants/${slug}/${slug}.db`) as { id: number };
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
  const now = Date.now();
  const today = dublinIso(now);
  const day = (n: number) => addDaysIso(today, n);

  try {
    await runWithTenant(t.id, async () => {
      const mk = (first: string) =>
        db.insert(schema.clients).values({ firstName: first, lastName: "Test", phone: "1" } as never).returning().get();
      const c1 = mk("Ann");
      const c2 = mk("Bob");
      const c3 = mk("Cat");

      const session = (date: string, name: string, status: "scheduled" | "cancelled", instructor: string | null) =>
        db
          .insert(schema.classSessions)
          .values({ date, startTime: "18:00", endTime: "19:00", name, capacity: 2, instructor, status })
          .returning()
          .get();
      const s1 = session(day(-1), "HIIT", "scheduled", "Sam");
      const s2 = session(day(1), "Yoga", "scheduled", null);
      const s3 = session(day(2), "Cancelled", "cancelled", "Sam");

      const book = (sessionId: number, clientId: number, status: "booked" | "attended" | "no_show" | "cancelled") =>
        db.insert(schema.sessionBookings).values({ sessionId, clientId, status }).run();
      book(s1.id, c1.id, "attended");
      book(s1.id, c2.id, "no_show");
      book(s1.id, c3.id, "cancelled");
      book(s2.id, c1.id, "booked");
      book(s2.id, c2.id, "booked");
      book(s3.id, c1.id, "booked");

      const mem = (clientId: number, status: "active" | "expired") =>
        db.insert(schema.clientMemberships).values({ clientId, membershipName: "Unlimited", status, startDate: day(-90) }).run();
      mem(c1.id, "active");
      mem(c3.id, "active");
      mem(c2.id, "expired");

      const fills = q.sessionFills(day(-3), day(3));
      assert.equal(fills.length, 2, "cancelled session excluded");
      const hiit = fills.find((f) => f.name === "HIIT")!;
      assert.deepEqual([hiit.booked, hiit.attended, hiit.noShow, hiit.capacity], [2, 1, 1, 2], "cancelled booking not counted");
      assert.equal(fills.find((f) => f.name === "Yoga")!.booked, 2);
      assert.equal(fills.find((f) => f.name === "Yoga")!.instructor, null);

      assert.equal(q.sessionFills(day(5), day(9)).length, 0);

      assert.equal(q.bookingsMadeIn(now - DAY, now + DAY), 5, "five non-cancelled bookings made just now");
      assert.equal(q.bookingsMadeIn(now - 10 * DAY, now - 5 * DAY), 0);

      const quiet = q.quietActiveMembers(now, 30, 10);
      assert.deepEqual(quiet.map((m) => [m.name, m.lastMs]), [["Cat Test", null]], "attended yesterday and expired members are not quiet");
      const quietLater = q.quietActiveMembers(now + 60 * DAY, 30, 10);
      assert.deepEqual(quietLater.map((m) => m.name), ["Cat Test", "Ann Test"], "never first, then oldest visit");
    });
    console.log("classesQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
