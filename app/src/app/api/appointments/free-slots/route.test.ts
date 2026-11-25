// Run: npm test -- src/app/api/appointments/free-slots/route.test.ts
//
// The free-slots route on a scratch tenant, against real opening hours,
// appointments and block-outs: a start that would clash with an existing
// booking is marked taken (with the slot check's reason), a closed day and a
// fully blocked day come back closed, and a different treatment at the same
// time is still free. Only the auth gate is stubbed.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in free-slots route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

interface Body {
  ok: boolean;
  error?: string;
  closed?: boolean;
  open?: string;
  close?: string;
  stepMinutes?: number;
  slots?: { time: string; free: boolean; reason?: string }[];
}

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { runWithTenant } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { db } = requireLocal("../../../../lib/db") as typeof import("@/lib/db");
  const schema = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { GET } = requireLocal("./route") as typeof import("./route");

  const slug = "free-slots-route-test";
  const tenantDir = path.join(process.cwd(), "data", "tenants", slug);
  fs.rmSync(tenantDir, { recursive: true, force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Free Slots Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const get = async (query: string) => {
    const res = await GET({ nextUrl: new URL(`http://localhost/api/appointments/free-slots?${query}`) } as never);
    return { status: res.status, body: (await res.json()) as Body };
  };

  try {
    await runWithTenant(tid, async () => {
      const [massage, hbot] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95 },
        ])
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      // 2030-01-07 is a Monday (default hours 08:00-20:00); 2030-01-06 a Sunday (closed).
      db.insert(schema.appointments)
        .values({
          clientId: client.id,
          date: "2030-01-07",
          startTime: "10:00",
          endTime: "11:00",
          status: "scheduled",
          therapyIds: JSON.stringify([massage.id]),
          totalPriceEur: 80,
        })
        .run();
      // A cancelled booking holds nothing.
      db.insert(schema.appointments)
        .values({
          clientId: client.id,
          date: "2030-01-07",
          startTime: "15:00",
          endTime: "16:00",
          status: "cancelled",
          therapyIds: JSON.stringify([massage.id]),
          totalPriceEur: 80,
        })
        .run();
      // Tuesday 2030-01-08 is blocked all day.
      db.insert(schema.blockOuts).values({ type: "one_off", date: "2030-01-08", startTime: "00:00", endTime: "23:59", reason: "Staff training" }).run();

      const monday = await get(`date=2030-01-07&duration=60&therapyIds=${massage.id}`);
      assert.equal(monday.status, 200);
      assert.equal(monday.body.ok, true);
      assert.equal(monday.body.closed, false);
      assert.deepEqual([monday.body.open, monday.body.close, monday.body.stepMinutes], ["08:00", "20:00", 15]);
      const slots = new Map(monday.body.slots!.map((s) => [s.time, s]));
      assert.equal(monday.body.slots![0].time, "08:00", "first start is opening time");
      assert.equal(monday.body.slots![monday.body.slots!.length - 1].time, "19:00", "last start ends at closing");
      assert.equal(monday.body.slots!.length, 45, "08:00 to 19:00 every 15 minutes");
      assert.equal(slots.get("09:00")!.free, true, "ending as the booking starts is fine");
      assert.equal(slots.get("09:15")!.free, false, "overlapping the 10:00 booking is taken");
      assert.equal(slots.get("10:00")!.free, false, "the clashing start is taken");
      assert.ok((slots.get("10:00")!.reason ?? "").length > 0, "a taken start says why");
      assert.equal(slots.get("10:45")!.free, false);
      assert.equal(slots.get("11:00")!.free, true, "starting as the booking ends is fine");
      assert.equal(slots.get("15:00")!.free, true, "a cancelled booking holds nothing");

      const otherTreatment = await get(`date=2030-01-07&duration=60&therapyIds=${hbot.id}`);
      assert.equal(new Map(otherTreatment.body.slots!.map((s) => [s.time, s])).get("10:00")!.free, true, "a different treatment does not clash");

      const sunday = await get(`date=2030-01-06&duration=60&therapyIds=${massage.id}`);
      assert.deepEqual([sunday.body.ok, sunday.body.closed, sunday.body.slots], [true, true, []], "a closed day has no times");

      const blocked = await get(`date=2030-01-08&duration=60&therapyIds=${massage.id}`);
      assert.deepEqual([blocked.body.closed, blocked.body.slots], [true, []], "a day blocked end to end is closed");

      const bad = await get("date=07-01-2030&duration=60");
      assert.equal(bad.status, 400);
      assert.equal(bad.body.ok, false);
      assert.equal((await get("date=2030-01-07&duration=0")).status, 400, "no length is refused");
      assert.equal((await get("date=2030-01-07&duration=abc")).status, 400);
    });
    console.log("free-slots route: all checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
