/**
 * Pure unit tests for resource conflict arithmetic. No I/O, no DB.
 * Run: npm test -- src/lib/scheduling/resourceDemand.test.ts
 *
 * The four business shapes in the module header each get a case here, because
 * "a spa can take three massages at once and a one-floor gym cannot take two
 * classes" is the whole point of the model and should fail loudly if it breaks.
 */
import assert from "node:assert/strict";

import {
  firstConflict, conflictReason, demandFrom, mergeDemand,
  type BookedSpan, type ResourceLimit,
} from "./resourceDemand";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const limits = (...rs: ResourceLimit[]) => new Map(rs.map((r) => [r.id, r]));
const HBOT = { id: 1, name: "HBOT chamber", concurrency: 1 };
const ROOMS = { id: 2, name: "Treatment rooms", concurrency: 3 };
const FLOOR = { id: 3, name: "The floor", concurrency: 1 };

const span = (startMin: number, endMin: number, demand: [number, number][]): BookedSpan =>
  ({ startMin, endMin, demand: new Map(demand) });

const base = { startMin: 600, endMin: 660, bufferMinutes: 0 };

// ------------------------------------------------------------------ helpers
check("demandFrom sums repeats", [...demandFrom([{ resourceId: 1, units: 1 }, { resourceId: 1, units: 2 }])], [[1, 3]]);
check("mergeDemand adds across services",
  [...mergeDemand([new Map([[1, 1]]), new Map([[1, 1], [2, 1]])])].sort(), [[1, 2], [2, 1]]);
check("demandFrom of nothing is empty", demandFrom([]).size, 0);

// -------------------------------------------------- clinic: one of each machine
check(
  "a second HBOT at the same time is refused",
  firstConflict({ ...base, demand: new Map([[1, 1]]), booked: [span(600, 660, [[1, 1]])], limits: limits(HBOT) }),
  { resourceId: 1, resourceName: "HBOT chamber", wanted: 2, concurrency: 1 },
);
check(
  "a different machine at the same time is fine",
  firstConflict({ ...base, demand: new Map([[2, 1]]), booked: [span(600, 660, [[1, 1]])], limits: limits(HBOT, ROOMS) }),
  null,
);

// ------------------------------------------------------ spa: three rooms
const twoMassages = [span(600, 660, [[2, 1]]), span(600, 660, [[2, 1]])];
check(
  "a third massage fits three rooms",
  firstConflict({ ...base, demand: new Map([[2, 1]]), booked: twoMassages, limits: limits(ROOMS) }),
  null,
);
check(
  "a fourth does not",
  firstConflict({ ...base, demand: new Map([[2, 1]]), booked: [...twoMassages, span(600, 660, [[2, 1]])], limits: limits(ROOMS) }),
  { resourceId: 2, resourceName: "Treatment rooms", wanted: 4, concurrency: 3 },
);

// ------------------------------------------- small gym: everything wants the floor
check(
  "two classes cannot share one floor, even though they are different classes",
  firstConflict({ ...base, demand: new Map([[3, 1]]), booked: [span(600, 660, [[3, 1]])], limits: limits(FLOOR) }),
  { resourceId: 3, resourceName: "The floor", wanted: 2, concurrency: 1 },
);

// ------------------------------------------------------------------- timing
check(
  "no overlap, no conflict",
  firstConflict({ ...base, demand: new Map([[1, 1]]), booked: [span(660, 720, [[1, 1]])], limits: limits(HBOT) }),
  null,
);
check(
  "touching spans do not overlap (half-open)",
  firstConflict({ ...base, demand: new Map([[1, 1]]), booked: [span(540, 600, [[1, 1]])], limits: limits(HBOT) }),
  null,
);
check(
  "a buffer makes touching spans conflict",
  firstConflict({ ...base, bufferMinutes: 15, demand: new Map([[1, 1]]), booked: [span(540, 600, [[1, 1]])], limits: limits(HBOT) })?.resourceId,
  1,
);
check(
  "a partial overlap still conflicts",
  firstConflict({ ...base, demand: new Map([[1, 1]]), booked: [span(630, 690, [[1, 1]])], limits: limits(HBOT) })?.resourceId,
  1,
);

// -------------------------------------------------------------- units and gaps
check(
  "a service taking two units of a three-concurrency resource leaves room for one more",
  firstConflict({ ...base, demand: new Map([[2, 1]]), booked: [span(600, 660, [[2, 2]])], limits: limits(ROOMS) }),
  null,
);
check(
  "...but not for two more",
  firstConflict({ ...base, demand: new Map([[2, 2]]), booked: [span(600, 660, [[2, 2]])], limits: limits(ROOMS) })?.wanted,
  4,
);
check(
  "a booking that consumes nothing conflicts with nothing",
  firstConflict({ ...base, demand: new Map(), booked: [span(600, 660, [[1, 1]])], limits: limits(HBOT) }),
  null,
);
check(
  "an unknown resource defaults to concurrency 1",
  firstConflict({ ...base, demand: new Map([[99, 1]]), booked: [span(600, 660, [[99, 1]])], limits: new Map() }),
  { resourceId: 99, resourceName: "resource #99", wanted: 2, concurrency: 1 },
);

// ------------------------------------------------------------------ wording
check("reason for a single resource", conflictReason({ resourceId: 1, resourceName: "HBOT chamber", wanted: 2, concurrency: 1 }),
  "HBOT chamber is already in use at that time.");
check("reason names the limit when there is more than one",
  conflictReason({ resourceId: 2, resourceName: "Treatment rooms", wanted: 4, concurrency: 3 }),
  "Treatment rooms is fully booked at that time (3 at once).");

console.log(`resourceDemand: ${passed} checks passed.`);
