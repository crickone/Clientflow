/**
 * PURE resource arithmetic — no DB, no `server-only`.
 *
 * One idea: a booking consumes units of resources, and a resource is
 * over-subscribed when the bookings overlapping a moment want more of it than
 * it has. Everything the scheduler needs to know about whether two things can
 * happen at once reduces to that.
 *
 * It replaces "two appointments clash if they overlap AND share a therapy",
 * which was never a capacity model — it was one-of-each-therapy-at-a-time,
 * which is right only for a clinic with exactly one of every machine. The same
 * arithmetic now expresses all of:
 *
 *   spa        Massage -> "Treatment rooms" (concurrency 3)   three at once
 *   clinic     HBOT    -> "HBOT chamber"    (concurrency 1)   one at once
 *   small gym  every class -> "The floor"   (concurrency 1)   one class at a time
 *   big gym    Spin -> "Studio A", Yoga -> "Studio B"         both at once
 *
 * Staff are deliberately NOT modelled. A person is a resource too, but a
 * useful staffing model needs "one person can supervise three machines while a
 * massage takes a whole person", and that needs a roster this platform does
 * not have. Spaces and equipment first.
 */

/** resourceId -> units consumed. */
export type Demand = Map<number, number>;

export interface ResourceLimit {
  id: number;
  name: string;
  concurrency: number;
}

/** One booking already in the diary, as minutes from midnight. */
export interface BookedSpan {
  startMin: number;
  endMin: number;
  demand: Demand;
}

/** Sum the demands of several services booked together (one appointment can carry several therapies). */
export function mergeDemand(demands: Demand[]): Demand {
  const total: Demand = new Map();
  for (const d of demands) {
    for (const [id, units] of d) total.set(id, (total.get(id) ?? 0) + units);
  }
  return total;
}

/** Build a demand from rows of (resourceId, units) — the shape a DB join gives back. */
export function demandFrom(rows: { resourceId: number; units: number }[]): Demand {
  const d: Demand = new Map();
  for (const r of rows) d.set(r.resourceId, (d.get(r.resourceId) ?? 0) + r.units);
  return d;
}

export interface ConflictInput {
  /** The proposed booking. */
  startMin: number;
  endMin: number;
  demand: Demand;
  /** Everything already booked that day. */
  booked: BookedSpan[];
  /** Dead time enforced either side of an existing booking. */
  bufferMinutes: number;
  /** Concurrency per resource. A resource absent from here is treated as concurrency 1. */
  limits: Map<number, ResourceLimit>;
}

export interface Conflict {
  resourceId: number;
  resourceName: string;
  /** What would be in use, including this booking. */
  wanted: number;
  concurrency: number;
}

/**
 * The first resource this booking would over-subscribe, or null if it fits.
 *
 * Only spans that actually overlap count, and the buffer widens the PROPOSED
 * booking rather than each existing one — same result, one subtraction instead
 * of thousands. Half-open throughout: 09:00-09:20 and 09:20-09:40 do not
 * overlap, so a zero-buffer diary can run back-to-back appointments.
 *
 * A booking that consumes nothing (no therapies recorded) conflicts with
 * nothing. That is correct arithmetic and a poor assumption about a clinic, so
 * callers that care give untyped bookings a default demand rather than letting
 * this decide.
 */
export function firstConflict(input: ConflictInput): Conflict | null {
  const { startMin, endMin, demand, booked, bufferMinutes, limits } = input;
  if (demand.size === 0) return null;

  const from = startMin - bufferMinutes;
  const to = endMin + bufferMinutes;

  const inUse: Demand = new Map();
  for (const b of booked) {
    if (!(from < b.endMin && b.startMin < to)) continue;
    for (const [id, units] of b.demand) {
      if (!demand.has(id)) continue; // a resource this booking doesn't want cannot block it
      inUse.set(id, (inUse.get(id) ?? 0) + units);
    }
  }

  for (const [id, units] of demand) {
    const limit = limits.get(id);
    const concurrency = limit?.concurrency ?? 1;
    const wanted = (inUse.get(id) ?? 0) + units;
    if (wanted > concurrency) {
      return { resourceId: id, resourceName: limit?.name ?? `resource #${id}`, wanted, concurrency };
    }
  }
  return null;
}

/** Plain-English reason for an operator or an agent to relay. */
export function conflictReason(c: Conflict): string {
  return c.concurrency === 1
    ? `${c.resourceName} is already in use at that time.`
    : `${c.resourceName} is fully booked at that time (${c.concurrency} at once).`;
}
