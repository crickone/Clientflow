// Run: npm test -- src/lib/adonisMap/evals/fixture.test.ts

import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() stub called in a test"); },
      notFound: () => { throw new Error("notFound() stub called in a test"); },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { withScratchTenant } = requireLocal("../testSupport") as typeof import("../testSupport");
  const { seedClinic, seedGym } = requireLocal("./fixture") as typeof import("./fixture");
  const { computeTruth } = requireLocal("./truth") as typeof import("./truth");
  const { mapFind, mapGet } = requireLocal("../query") as typeof import("../query");
  const { addDays, dublinDate } = requireLocal("../engine") as typeof import("../engine");

  const today = dublinDate(Date.now());
  const sorted = (xs: unknown[]) => xs.map(String).sort();
  await withScratchTenant("adonis-eval-gym-test", async (gymId) => {
    await withScratchTenant("adonis-eval-clinic-test", async (clinicId) => {
      const known = seedGym(gymId, today);
      const clinic = seedClinic(clinicId, today);
      const env = { tenantId: gymId };
      const find = (input: Record<string, unknown>) => mapFind(env, { limit: 50, ...input }).rows;
      const names = (rows: Record<string, unknown>[]) => sorted(rows.map((r) => r.name ?? r.personName));

      assert.deepEqual(names(find({ type: "Person", where: [{ field: "stage", op: "eq", value: "lapsed" }, { field: "leadScore", op: "gt", value: 70 }] })), sorted(known.lapsedHighScore));
      assert.deepEqual(
        names(find({ type: "Person", where: [{ field: "lastVisit", op: "lt", value: addDays(today, -30) }, { link: "packages", exists: true, where: [{ field: "sessionsLeft", op: "gt", value: 0 }, { field: "status", op: "eq", value: "active" }] }] })),
        sorted(known.noVisitPackageLeft),
      );
      // Package rows have their own `name` (the package's), so read the owner from personName.
      assert.deepEqual(sorted(find({ type: "Package", where: [{ field: "sessionsUsed", op: "eq", value: 0 }] }).map((r) => r.personName)), sorted(known.neverUsedPackage));
      assert.deepEqual(names(find({ type: "Order", where: [{ field: "status", op: "in", value: ["pending", "expired"] }, { field: "createdAt", op: "gte", value: addDays(today, -7) }] })), sorted(known.unfinishedCheckout));
      assert.deepEqual(
        names(find({ type: "Person", where: [
          { link: "orders", exists: true, where: [{ field: "offer", op: "contains", value: "Black Friday" }, { field: "status", op: "eq", value: "paid" }] },
          { link: "bookings", exists: false, where: [{ field: "date", op: "gte", value: addDays(today, -9) }] },
        ] })),
        sorted(known.blackFridayNoBooking),
      );
      const hot = [{ field: "kind", op: "eq", value: "lead" }, { field: "source", op: "eq", value: "facebook" }, { field: "leadScore", op: "gt", value: 60 }];
      const hotNames = [
        ...names(find({ type: "Person", where: [...hot, { field: "lastContactedAt", op: "isNull", value: true }] })),
        ...names(find({ type: "Person", where: [...hot, { field: "lastContactedAt", op: "lt", value: addDays(today, -5) }] })),
      ].sort();
      assert.deepEqual(hotNames, sorted(known.facebookHotUncontacted));
      assert.deepEqual(names(find({ type: "Conversation", where: [{ field: "waitingForReply", op: "eq", value: true }] })), sorted(known.waitingForReply));
      assert.deepEqual(names(find({ type: "Person", where: [{ field: "kind", op: "eq", value: "client" }, { field: "pipelineStage", op: "isNull", value: false }] })), sorted(known.leadsAlreadyClients));
      assert.deepEqual(names(find({ type: "Person", where: [{ field: "campaign", op: "eq", value: "Autumn reset" }, { field: "stage", op: "eq", value: "member" }] })), sorted(known.autumnMembers));

      assert.equal(mapGet(env, { type: "Class", id: `k:${known.fullClass.id}`, include: [] }).object.placesLeft, 0, "the next Tuesday HIIT is full");
      assert.equal(mapGet(env, { type: "Class", id: `k:${known.spinPlaces.id}`, include: [] }).object.placesLeft, 4);
      const niamh = find({ type: "Person", where: [{ field: "name", op: "eq", value: "Niamh Byrne" }] })[0];
      assert.equal(niamh.lifetimeSpendEur, known.niamhSpendEur);
      const sean = find({ type: "Person", where: [{ field: "name", op: "eq", value: "Sean Byrne" }] })[0];
      assert.equal(sean.kind, "lead");
      assert.equal(sean.possibleMatches, 1);

      const truth = computeTruth({ gymId, clinicId, today, gym: known, clinicNames: clinic.names });
      assert.ok(truth.bookingsLastWeek.kept < truth.bookingsWeekBefore.kept, "bookings dropped last week");
      assert.equal(truth.topTherapy, "HBOT");
      assert.ok(truth.plans.Monthly > 0 && truth.plans.Student > 0);
      assert.ok(truth.noShowTwice.includes("Dylan Burke") && truth.noShowTwice.includes("Erin Nash"));
      assert.ok(truth.joinedRecentFewVisits.includes("Peter Coyle") && !truth.joinedRecentFewVisits.includes("Niamh Byrne"));
      assert.equal(truth.autumnMembers, 2);
      assert.ok(truth.membersNotContacted60.length > 20 && !truth.membersNotContacted60.includes("Niamh Byrne"));
      assert.ok(!truth.halfEmptyLastWeek.includes("HIIT"), "cancelled HIIT is not counted as half empty");
      assert.equal(clinic.names.length, 6);
    });
  });
  console.log("fixture.test.ts: all assertions passed");
})();
