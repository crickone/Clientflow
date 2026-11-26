/**
 * PURE free-slot arithmetic — no DB, no `server-only`, so it loads under the
 * plain-tsx test runner (same convention as pipeline/roles.ts).
 *
 * This module answers "what times are free?" over a date range. It does NOT
 * own the rules for whether a time is free: they live in ./resourceDemand and
 * ./staffDemand, and each is the same function `checkBookingSlot`
 * (@/lib/schedule) uses to validate a single proposed booking. An earlier
 * version of this file reimplemented the overlap test, which meant two copies
 * of the rule and a standing risk that a slot offered here would be refused at
 * booking. One rule each, called twice.
 */

import { firstConflict, type BookedSpan, type Demand, type ResourceLimit } from "./resourceDemand";
import { firstStaffShortfall, type DayCover, type Staffing, type StaffedSpan } from "./staffDemand";

export type { BookedSpan, Demand, ResourceLimit };

/** Minutes from midnight for "HH:mm". Duplicated from @/lib/schedule so this module stays DB-free. */
export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function minToHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One booked or blocked span on a given day, in minutes from midnight. */
export type BusySpan = BookedSpan;

export interface DayAvailability {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Closed days are skipped whole. */
  closed: boolean;
  openMin: number;
  closeMin: number;
  busy: BusySpan[];
  /**
   * Who is on and what is booked, for the staff rule (./staffDemand). Absent
   * or cover "off" means the rule does not apply: today's behaviour.
   */
  staff?: { cover: DayCover; booked: StaffedSpan[] };
}

export interface FreeSlotsInput {
  days: DayAvailability[];
  /** How long the appointment runs. */
  durationMinutes: number;
  /** Dead time enforced either side of an existing booking (settings.bufferMinutes). */
  bufferMinutes: number;
  /** Candidate starts land on this grid, e.g. 15 -> :00 :15 :30 :45. */
  granularityMinutes: number;
  /** What one booking of this service consumes. */
  demand: Demand;
  /** Concurrency per resource. Absent = 1. */
  limits: Map<number, ResourceLimit>;
  /** Nothing before this instant is offered. `{ date, min }` = ISO date + minutes from midnight. */
  earliest: { date: string; min: number };
  /** Stop after this many slots. */
  limit: number;
  /** At most this many per day, so three offers don't all land on Tuesday. */
  maxPerDay?: number;
  /** Who this service needs for the staff rule. Defaults to "whole". */
  staffing?: Staffing;
}

export interface FreeSlot {
  date: string;
  startTime: string;
  endTime: string;
}

/**
 * Every free start time across `days`, earliest first.
 *
 * A candidate survives when it fits inside opening hours and over-subscribes
 * no resource once the buffer is applied.
 */
export function computeFreeSlots(input: FreeSlotsInput): FreeSlot[] {
  const {
    days, durationMinutes, bufferMinutes, granularityMinutes,
    demand, limits, earliest, limit, maxPerDay, staffing,
  } = input;

  if (durationMinutes <= 0 || granularityMinutes <= 0 || limit <= 0) return [];

  const out: FreeSlot[] = [];

  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (out.length >= limit) break;
    if (day.closed) continue;

    // A day entirely in the past contributes nothing; the day containing
    // `earliest` starts from it rather than from opening time.
    if (day.date < earliest.date) continue;
    const floor = day.date === earliest.date ? Math.max(day.openMin, earliest.min) : day.openMin;

    // Round the floor UP onto the grid: an "earliest" of 10:07 with a 15
    // minute grid offers 10:15, never 10:07.
    let start = Math.ceil(floor / granularityMinutes) * granularityMinutes;
    let onThisDay = 0;

    for (; start + durationMinutes <= day.closeMin; start += granularityMinutes) {
      if (out.length >= limit) break;
      if (maxPerDay != null && onThisDay >= maxPerDay) break;

      const end = start + durationMinutes;
      // The SAME rule the booking path enforces — see ./resourceDemand.
      const clash = firstConflict({
        startMin: start,
        endMin: end,
        demand,
        booked: day.busy,
        bufferMinutes,
        limits,
      });
      if (clash) continue;

      // The SAME staff rule the booking path enforces — see ./staffDemand.
      if (
        day.staff &&
        firstStaffShortfall({ startMin: start, endMin: end, staffing: staffing ?? "whole", booked: day.staff.booked, cover: day.staff.cover })
      ) {
        continue;
      }

      out.push({ date: day.date, startTime: minToHm(start), endTime: minToHm(end) });
      onThisDay++;
    }
  }

  return out;
}

/**
 * Pick the slots to actually put in a message. Spreading them over different
 * days beats offering 18:00, 18:15 and 18:30 on the same evening — two
 * genuinely different options read as a choice, three near-identical ones read
 * as a machine reciting a diary.
 */
export function spreadSlots(slots: FreeSlot[], count: number): FreeSlot[] {
  const byDay = new Map<string, FreeSlot[]>();
  for (const s of slots) {
    const list = byDay.get(s.date);
    if (list) list.push(s);
    else byDay.set(s.date, [s]);
  }
  const picked: FreeSlot[] = [];
  // One per day in date order, then a second pass for the remainder, so a
  // tenant with only one open day still gets `count` offers.
  for (let round = 0; picked.length < count && round < 8; round++) {
    let addedThisRound = false;
    for (const list of byDay.values()) {
      if (picked.length >= count) break;
      const next = list[round];
      if (!next) continue;
      picked.push(next);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }
  return picked.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}
