// Run: npm test -- src/lib/scheduling/staffRule.test.ts
//
// The staff rule through both seams on a scratch tenant: the booking check
// (checkBookingSlot), the booking screen's free times (GET
// /api/appointments/free-slots) and the lead engine's search (findFreeSlots
// without its final re-check) agree on the same diary, and with the rota off
// every answer is exactly what it was before any rota data existed.
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") return { guard: async () => null };
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";
import { setKey } from "@/lib/settings";
import { checkBookingSlot } from "@/lib/schedule";
import { eq } from "drizzle-orm";

import { findFreeSlots } from "./availability";
import * as repo from "./rotaRepo";

interface Slot { time: string; free: boolean; reason?: string }
interface Body { ok: boolean; slots: Slot[]; rota: { unfilled: boolean; week: string } }

fs.rmSync(path.join(process.cwd(), "data", "tenants", "staff-rule-test"), { recursive: true, force: true });
const scratch = makeScratchTenant("staff-rule-test");

(async () => {
  const { GET } = await import("@/app/api/appointments/free-slots/route");
  const route = async (date: string, duration: number, ids: number[]) => {
    const res = await GET({ nextUrl: new URL(`http://localhost/api/appointments/free-slots?date=${date}&duration=${duration}&therapyIds=${ids.join(",")}`) } as never);
    return (await res.json()) as Body;
  };
  const freeTimes = (b: Body) => b.slots.filter((s) => s.free).map((s) => s.time);
  // The lead engine's search for a day, without the final re-check.
  const search = (date: string) =>
    findFreeSlots({ limit: 1000, now: new Date("2030-01-06T12:00:00Z"), recheck: false }).slots.filter((s) => s.date === date).map((s) => s.startTime);

  try {
    await runWithTenant(scratch.tid, async () => {
      const [massage, hbot] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80, staffing: "whole" },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95, staffing: "setup" },
        ])
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      // Mon 2030-01-07 and Mon 2030-01-14 (default hours 08:00-20:00): a massage 10:00-11:00 each.
      for (const date of ["2030-01-07", "2030-01-14"]) {
        db.insert(schema.appointments).values({ clientId: client.id, date, startTime: "10:00", endTime: "11:00", status: "scheduled", therapyIds: JSON.stringify([massage.id]), totalPriceEur: 80 }).run();
      }
      // The lead engine offers 60-minute HBOT sessions on a 15-minute grid, no lead time.
      setKey("consultation_minutes", 60);
      setKey("consultation_granularity_minutes", 15);
      setKey("consultation_lead_minutes", 0);
      setKey("consultation_horizon_days", 14);
      setKey("consultation_therapy_ids", [hbot.id]);

      // ── Rota off, no rota data: the baseline every business has today.
      const baseline = await route("2030-01-07", 60, [hbot.id]);
      const baselineSearch = search("2030-01-07");
      assert.equal(baseline.rota.unfilled, false);
      assert.equal(baseline.rota.week, "2030-01-07");
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]).ok, true, "rota off: HBOT beside a massage is allowed, as today");
      assert.deepEqual(freeTimes(baseline), baselineSearch, "rota off: route and search agree");

      // ── Rota on with one person Monday 09:00-17:00.
      const a = repo.addPerson("Example Therapist");
      assert.ok(a.ok);
      const aId = (a as { id: number }).id;
      assert.ok(repo.addShift({ staffId: aId, date: "2030-01-07", start: "09:00", end: "17:00" }).ok);
      assert.equal(repo.rotaOn(), true);

      assert.deepEqual(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]), { ok: false, reason: "Only one therapist on at 10:00 and Deep tissue massage is booked then." });
      assert.deepEqual(checkBookingSlot("2030-01-07", "09:30", 60, [hbot.id]), { ok: false, reason: "Only one therapist on at 10:00 and Deep tissue massage is booked then." });
      assert.equal(checkBookingSlot("2030-01-07", "11:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(checkBookingSlot("2030-01-07", "16:30", 60, [hbot.id]), { ok: false, reason: "Nobody is on the rota then." });
      assert.deepEqual(checkBookingSlot("2030-01-08", "10:00", 60, [hbot.id]), { ok: false, reason: "Nobody is on the rota then." }, "a day with no shifts in a week with some");
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id], undefined).ok, false);

      const on = await route("2030-01-07", 60, [hbot.id]);
      assert.equal(on.rota.unfilled, false);
      for (const s of on.slots) {
        assert.equal(s.free, checkBookingSlot("2030-01-07", s.time, 60, [hbot.id]).ok, `route agrees with the booking check at ${s.time}`);
      }
      assert.deepEqual(freeTimes(on), search("2030-01-07"), "rota on: route and search agree");
      assert.equal(freeTimes(on)[0], "09:00");
      assert.ok(!freeTimes(on).includes("10:00"));
      assert.ok(freeTimes(on).includes("11:00"));
      assert.ok(!freeTimes(on).includes("16:15"), "16:15-17:15 runs past the only shift");
      const taken = on.slots.find((s) => s.time === "10:00")!;
      assert.equal(taken.reason, "Only one therapist on at 10:00 and Deep tissue massage is booked then.", "the reason reaches the booking screen");

      // Two on: the massage and HBOT together are fine.
      const b = repo.addPerson("Second Therapist");
      assert.ok(b.ok);
      assert.ok(repo.addShift({ staffId: (b as { id: number }).id, date: "2030-01-07", start: "09:00", end: "17:00" }).ok);
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(freeTimes(await route("2030-01-07", 60, [hbot.id])), search("2030-01-07"));

      // ── Unfilled week (no shifts week of 14th): one person in opening hours.
      const unfilled = await route("2030-01-14", 60, [hbot.id]);
      assert.equal(unfilled.rota.unfilled, true);
      assert.equal(unfilled.rota.week, "2030-01-14");
      assert.equal(checkBookingSlot("2030-01-14", "10:00", 60, [hbot.id]).ok, false, "one assumed person is busy with the massage");
      assert.equal(checkBookingSlot("2030-01-14", "11:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(freeTimes(unfilled), search("2030-01-14"));

      // ── Adonis's booking tools go through the same check.
      const { executeTool } = await import("@/lib/assistant/tools");
      const ctx = { tenantId: scratch.tid };
      const refused = JSON.parse((await executeTool("create_appointment", { clientName: "Test Client", date: "2030-01-08", startTime: "10:00" }, ctx)).text);
      assert.match(refused.error ?? "", /Nobody is on the rota then/, "Adonis cannot book a day nobody is on");
      const booked = JSON.parse((await executeTool("create_appointment", { clientName: "Test Client", date: "2030-01-07", startTime: "12:00" }, ctx)).text);
      assert.ok(booked.result, "Adonis books a time the rota covers");
      const made = db.select().from(schema.appointments).where(eq(schema.appointments.startTime, "12:00")).get();
      assert.equal(made?.endTime, "13:00", "an hour when no end is given");
      const moved = JSON.parse((await executeTool("reschedule_appointment", { clientName: "Test Client", date: "2030-01-07", startTime: "12:00", newDate: "2030-01-08", newStartTime: "12:00" }, ctx)).text);
      assert.match(moved.error ?? "", /Nobody is on the rota then/, "Adonis cannot move a booking to a day nobody is on");

      // ── Switched off: exactly the baseline again, rota data and all.
      repo.setRotaOn(false);
      const off = await route("2030-01-07", 60, [hbot.id]);
      assert.deepEqual(off.slots, baseline.slots, "rota off: identical to before any rota data");
      assert.deepEqual(search("2030-01-07"), baselineSearch);
      assert.equal(off.rota.unfilled, false);
      assert.equal(checkBookingSlot("2030-01-08", "10:00", 60, [hbot.id]).ok, true);
    });
    console.log("staffRule: all checks passed.");
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
