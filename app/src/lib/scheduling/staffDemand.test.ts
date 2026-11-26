// Run: npm test -- src/lib/scheduling/staffDemand.test.ts
import assert from "node:assert/strict";

import {
  firstStaffShortfall,
  neededFor,
  onShiftAt,
  staffShortfallReason,
  staffingOf,
  type DayCover,
  type StaffedSpan,
} from "./staffDemand";

const h = (hm: string) => {
  const [a, b] = hm.split(":").map(Number);
  return a * 60 + b;
};
const span = (s: string, e: string, staffing: "whole" | "setup", label: string): StaffedSpan => ({
  startMin: h(s), endMin: h(e), staffing, label,
});
const shifts = (...pairs: [string, string][]): DayCover => ({
  mode: "shifts",
  shifts: pairs.map(([s, e]) => ({ startMin: h(s), endMin: h(e) })),
});
const try_ = (s: string, e: string, staffing: "whole" | "setup", booked: StaffedSpan[], cover: DayCover) =>
  firstStaffShortfall({ startMin: h(s), endMin: h(e), staffing, booked, cover });

const massage = span("10:00", "11:00", "whole", "Deep tissue massage");
const hbot = span("10:00", "11:00", "setup", "HBOT");
const infrared = span("10:00", "11:00", "setup", "Infrared");
const ONE = shifts(["09:00", "17:00"]);
const TWO = shifts(["09:00", "17:00"], ["09:00", "17:00"]);

// staffingOf: whole if any is whole; an appointment with no therapies needs a person.
assert.equal(staffingOf(["setup", "setup"]), "setup");
assert.equal(staffingOf(["setup", "whole"]), "whole");
assert.equal(staffingOf([]), "whole");

// neededFor: one per whole, plus one if any setup.
assert.equal(neededFor([]), 0);
assert.equal(neededFor([{ staffing: "setup" }, { staffing: "setup" }]), 1);
assert.equal(neededFor([{ staffing: "whole" }, { staffing: "setup" }, { staffing: "setup" }]), 2);
assert.equal(neededFor([{ staffing: "whole" }, { staffing: "whole" }]), 2);

// onShiftAt is half-open.
assert.equal(onShiftAt(ONE, h("09:00")), 1);
assert.equal(onShiftAt(ONE, h("17:00")), 0);
assert.equal(onShiftAt(TWO, h("12:00")), 2);
assert.equal(onShiftAt({ mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") }, h("18:59")), 1);
assert.equal(onShiftAt({ mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") }, h("19:00")), 0);

// Rota off changes nothing.
assert.equal(try_("10:00", "11:00", "whole", [massage, massage, massage], { mode: "off" }), null);

// One on: a massage blocks the machines, and the reverse.
assert.ok(try_("10:00", "11:00", "setup", [massage], ONE));
assert.ok(try_("10:30", "11:30", "whole", [hbot], ONE));
// One on: two machines together are fine.
assert.equal(try_("10:00", "11:00", "setup", [hbot], ONE), null);
assert.equal(try_("10:00", "11:00", "setup", [hbot, infrared], ONE), null);
// One on: back to back is fine (half-open).
assert.equal(try_("11:00", "12:00", "setup", [massage], ONE), null);
assert.equal(try_("09:00", "10:00", "whole", [massage], ONE), null);

// Two on: a massage plus the machines is fine; a third need is refused.
assert.equal(try_("10:00", "11:00", "setup", [massage], TWO), null);
assert.equal(try_("10:00", "11:00", "whole", [hbot, infrared], TWO), null);
assert.ok(try_("10:00", "11:00", "whole", [massage, hbot], TWO));
assert.ok(try_("10:00", "11:00", "whole", [massage, massage], TWO));

// A combined massage-plus-infrared appointment needs one person: one on, nothing else booked, fits.
assert.equal(try_("10:00", "11:30", staffingOf(["whole", "setup"]), [], ONE), null);

// Partial overlap at shift edges: second person leaves at 13:00.
const SPLIT = shifts(["09:00", "17:00"], ["09:00", "13:00"]);
assert.equal(try_("12:00", "13:00", "setup", [span("12:00", "13:00", "whole", "Facial")], SPLIT), null);
const late = try_("12:30", "13:30", "setup", [span("12:00", "14:00", "whole", "Facial")], SPLIT);
assert.ok(late);
assert.equal(late!.atMin, h("13:00"), "fails first at the moment the second person leaves");
assert.equal(late!.needed, 2);
assert.equal(late!.onShift, 1);

// Starting before the shift: nobody on at the start.
const early = try_("08:30", "09:30", "whole", [], ONE);
assert.ok(early);
assert.equal(early!.atMin, h("08:30"));
assert.equal(early!.onShift, 0);

// Nobody on at all.
const nobody = try_("10:00", "11:00", "setup", [], shifts());
assert.ok(nobody);
assert.equal(staffShortfallReason(nobody!), "Nobody is on the rota then.");

// Unfilled week counts as one person during opening hours.
const assumed: DayCover = { mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") };
assert.equal(try_("10:00", "11:00", "whole", [], assumed), null);
assert.ok(try_("10:00", "11:00", "whole", [massage], assumed));

// Reasons, in words.
const one = try_("14:00", "15:00", "setup", [span("14:00", "15:00", "whole", "Deep tissue massage")], ONE);
assert.equal(staffShortfallReason(one!), "Only one therapist on at 14:00 and Deep tissue massage is booked then.");
const many = try_("10:00", "11:00", "whole", [massage, hbot], TWO);
assert.equal(staffShortfallReason(many!), "Only 2 therapists on at 10:00 and Deep tissue massage and HBOT are booked then.");
const three = try_("10:00", "11:00", "whole", [massage, span("10:00", "11:00", "whole", "Facial"), hbot], shifts(["09:00", "17:00"], ["09:00", "17:00"], ["09:00", "17:00"]));
assert.equal(staffShortfallReason(three!), "Only 3 therapists on at 10:00 and Deep tissue massage, Facial and HBOT are booked then.");
const unnamed = try_("10:00", "11:00", "whole", [span("10:00", "11:00", "whole", "")], ONE);
assert.equal(staffShortfallReason(unnamed!), "Only one therapist on at 10:00 and another booking is booked then.");

// An empty or inverted proposal never fails.
assert.equal(try_("10:00", "10:00", "whole", [massage], shifts()), null);

console.log("staffDemand: all checks passed.");
