// Run: npm test -- src/lib/scheduling/rotaRepo.test.ts
//
// The rota repo on a scratch tenant: shifts CRUD and validation, the setting
// switching on with the first shift (and staying off once switched off),
// copy last week, cover resolution, staffing, and the page's data.
import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";
import { getSettings, readKey, setKey } from "@/lib/settings";

import * as repo from "./rotaRepo";

fs.rmSync(path.join(process.cwd(), "data", "tenants", "rota-repo-test"), { recursive: true, force: true });
const scratch = makeScratchTenant("rota-repo-test");

(async () => {
  try {
    await runWithTenant(scratch.tid, async () => {
      // Mon 2030-01-07 .. Sun 2030-01-13. Default hours: Mon-Fri 08:00-20:00, Sat 09:00-16:00, Sun closed.
      assert.equal(repo.rotaOn(), false, "off by default");
      assert.deepEqual(repo.staffCoverFor("2030-01-07"), { mode: "off" });
      assert.equal(repo.weekUnfilled("2030-01-07"), false, "unfilled only matters while on");

      assert.deepEqual(repo.addPerson("  "), { ok: false, error: "Give the person a name." });
      const a = repo.addPerson("Example Therapist");
      const b = repo.addPerson("Second Therapist");
      assert.ok(a.ok && b.ok);
      const aId = (a as { id: number }).id;
      const bId = (b as { id: number }).id;
      assert.deepEqual(repo.rotaPeople().map((p) => p.name), ["Example Therapist", "Second Therapist"]);

      // Validation.
      assert.deepEqual(repo.addShift({ staffId: aId, date: "2030-01-13", start: "09:00", end: "17:00" }), { ok: false, error: "Closed that day, so no shifts." });
      assert.deepEqual(repo.addShift({ staffId: aId, date: "7 Jan", start: "09:00", end: "17:00" }), { ok: false, error: "Give the date as YYYY-MM-DD." });
      assert.deepEqual(repo.addShift({ staffId: 9999, date: "2030-01-07", start: "09:00", end: "17:00" }), { ok: false, error: "That person is not on the rota." });
      assert.equal(repo.rotaOn(), false, "a refused shift does not switch the rota on");

      // First shift switches it on.
      const s1 = repo.addShift({ staffId: aId, date: "2030-01-07", start: "09:00", end: "17:00" });
      assert.ok(s1.ok && s1.id);
      assert.equal(repo.rotaOn(), true, "the first shift switches the rota on");
      assert.deepEqual(repo.addShift({ staffId: aId, date: "2030-01-07", start: "16:00", end: "18:00" }), { ok: false, error: "This overlaps another shift for the same person." });
      const s2 = repo.addShift({ staffId: aId, date: "2030-01-07", start: "17:00", end: "19:00" });
      assert.ok(s2.ok, "a split day is two shifts");
      assert.ok(repo.addShift({ staffId: bId, date: "2030-01-08", start: "13:00", end: "20:00" }).ok);

      // Update and delete.
      assert.deepEqual(repo.updateShift(s2.ok ? s2.id! : 0, { start: "17:00", end: "21:00" }), { ok: false, error: "Shifts have to sit inside opening hours (08:00–20:00)." });
      assert.deepEqual(repo.updateShift(s2.ok ? s2.id! : 0, { start: "17:30", end: "19:30" }), { ok: true, id: s2.ok ? s2.id : undefined });
      assert.deepEqual(repo.updateShift(123456, { start: "09:00", end: "10:00" }), { ok: false, error: "That shift no longer exists." });
      repo.deleteShift(s2.ok ? s2.id! : 0);
      assert.equal(repo.shiftsBetween("2030-01-07", "2030-01-13").length, 2);

      // Cover.
      assert.deepEqual(repo.staffCoverFor("2030-01-07"), { mode: "shifts", shifts: [{ startMin: 540, endMin: 1020 }] });
      assert.deepEqual(repo.staffCoverFor("2030-01-09"), { mode: "shifts", shifts: [] }, "a day with no shifts in a week with some has nobody");
      assert.deepEqual(repo.staffCoverFor("2030-01-14"), { mode: "assumeOne", openMin: 480, closeMin: 1200 }, "an empty week assumes one person in opening hours");
      assert.equal(repo.weekUnfilled("2030-01-16"), true);
      assert.equal(repo.weekUnfilled("2030-01-09"), false);

      // Copy last week into the next, replacing what was there.
      repo.addShift({ staffId: bId, date: "2030-01-15", start: "08:00", end: "10:00" });
      assert.equal(repo.copyWeek("2030-01-07", "2030-01-14"), 2);
      const next = repo.shiftsBetween("2030-01-14", "2030-01-20");
      assert.deepEqual(next.map((s) => [s.staffId, s.date, s.start, s.end]), [
        [aId, "2030-01-14", "09:00", "17:00"],
        [bId, "2030-01-15", "13:00", "20:00"],
      ]);

      // When no source shift fits the opening hours, nothing is copied and the target week is left alone.
      const hoursBefore = getSettings().openingHours;
      setKey("opening_hours", hoursBefore.map((h) => (h.dow === 1 || h.dow === 2 ? { dow: h.dow, closed: true } : h)));
      assert.equal(repo.copyWeek("2030-01-07", "2030-01-14"), 0);
      assert.equal(repo.shiftsBetween("2030-01-14", "2030-01-20").length, 2, "the target week keeps its shifts");
      setKey("opening_hours", hoursBefore);

      // Switching off keeps it off, even when shifts are added later.
      repo.setRotaOn(false);
      assert.equal(repo.rotaOn(), false);
      repo.addShift({ staffId: aId, date: "2030-01-10", start: "09:00", end: "12:00" });
      assert.equal(repo.rotaOn(), false, "only the first-ever shift switches it on");
      assert.equal(readKey<boolean | null>(repo.ROTA_ON_KEY, null), false);
      repo.setRotaOn(true);

      // Inactive people do not count.
      db.update(schema.staff).set({ isActive: false }).where(eq(schema.staff.id, bId)).run();
      assert.deepEqual(repo.rotaPeople().map((p) => p.name), ["Example Therapist"]);
      assert.equal(repo.shiftsBetween("2030-01-14", "2030-01-20").length, 1);
      db.update(schema.staff).set({ isActive: true }).where(eq(schema.staff.id, bId)).run();

      // Staffing.
      const [massage, hbot, infrared] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95, staffing: "setup" },
          { name: "Infrared", colourHex: "#888888", defaultDurationMinutes: 30, defaultPriceEur: 40, staffing: "setup" },
        ])
        .returning()
        .all();
      assert.equal(massage.staffing, "whole", "column default");
      assert.equal(repo.staffingForTherapies([hbot.id, infrared.id]), "setup");
      assert.equal(repo.staffingForTherapies([hbot.id, massage.id]), "whole");
      assert.equal(repo.staffingForTherapies([]), "whole");
      const of = repo.staffingResolver();
      assert.deepEqual(of(JSON.stringify([massage.id, infrared.id])), { staffing: "whole", label: "Deep tissue massage and Infrared" });
      assert.deepEqual(of("not json"), { staffing: "whole", label: "" });
      repo.setTherapyStaffing(massage.id, "setup");
      assert.equal(repo.staffingForTherapies([massage.id]), "setup");
      repo.setTherapyStaffing(massage.id, "whole");
      assert.deepEqual(repo.listTreatmentStaffing().map((t) => [t.name, t.staffing]), [
        ["Deep tissue massage", "whole"],
        ["HBOT", "setup"],
        ["Infrared", "setup"],
      ]);

      // The page's data, with a booking to look at.
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      const base = { clientId: client.id, date: "2030-01-07", startTime: "10:00", endTime: "11:00", totalPriceEur: 0 } as const;
      db.insert(schema.appointments).values({ ...base, status: "scheduled", therapyIds: JSON.stringify([massage.id]) }).run();
      const [clash] = db.insert(schema.appointments).values({ ...base, status: "confirmed", therapyIds: JSON.stringify([hbot.id]) }).returning().all();
      db.insert(schema.appointments).values({ ...base, status: "cancelled", therapyIds: JSON.stringify([massage.id]) }).run();
      const week = repo.loadRotaWeek("2030-01-07");
      assert.equal(week.rotaOn, true);
      assert.equal(week.unfilled, false);
      assert.equal(week.thisWeekShiftCount, 3);
      assert.equal(week.people.length, 2);
      assert.deepEqual(week.lookAt.map((l) => [l.appointmentId, l.reason]), [
        [clash.id, "Only one therapist on at 10:00 and Deep tissue massage is booked then."],
      ]);
      assert.equal(week.treatments.length, 3);
    });
    console.log("rotaRepo: all checks passed.");
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
