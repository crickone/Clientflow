/**
 * PURE free-slot arithmetic — no DB, no `server-only`, so it loads under the
 * plain-tsx test runner (same convention as pipeline/roles.ts and
 * pipeline/boardMetrics.ts).
 *
 * The rules here deliberately mirror `checkBookingSlot` (@/lib/schedule),
 * which validates ONE proposed time against the diary. This module answers
 * the opposite question — "what times are free?" — over a date range, from
 * data the caller has already loaded. Keeping the two in step matters: a slot
 * this module offers that `checkBookingSlot` then refuses is a lead being
 * offered a time they cannot have, so `availability.ts` re-checks every slot
 * it is about to hand out and `bookConsultation` re-checks again at the moment
 * of writing. Three passes sounds excessive; it is what stops two leads taking
 * the same Thursday at 18:30 ninety seconds apart.
 *
 * Capacity model, also mirrored from checkBookingSlot: two appointments only
 * conflict if they overlap in time AND share at least one therapy. A
 * consultation with no therapy attached therefore never blocks anything and is
 * never blocked — which is wrong for a one-room clinic, so `availability.ts`
 * passes the tenant's consultation therapy ids in and they take part in the
 * overlap test like any other booking.
 */

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
export interface BusySpan {
  startMin: number;
  endMin: number;
  /** Empty = blocks everything (a block-out). Non-empty = only conflicts with a booking sharing a therapy. */
  therapyIds: number[];
}

export interface DayAvailability {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Closed days are skipped whole. */
  closed: boolean;
  openMin: number;
  closeMin: number;
  busy: BusySpan[];
}

export interface FreeSlotsInput {
  days: DayAvailability[];
  /** How long the appointment runs. */
  durationMinutes: number;
  /** Dead time enforced either side of an existing booking (settings.bufferMinutes). */
  bufferMinutes: number;
  /** Candidate starts land on this grid, e.g. 15 -> :00 :15 :30 :45. */
  granularityMinutes: number;
  /** The therapies this booking occupies; drives the shared-therapy overlap test. */
  therapyIds: number[];
  /** Nothing before this instant is offered. `{ date, min }` = ISO date + minutes from midnight. */
  earliest: { date: string; min: number };
  /** Stop after this many slots. */
  limit: number;
  /** At most this many per day, so three offers don't all land on Tuesday. */
  maxPerDay?: number;
}

export interface FreeSlot {
  date: string;
  startTime: string;
  endTime: string;
}

/** True when [aStart,aEnd) and [bStart,bEnd) overlap. Half-open, so 10:00-10:30 and 10:30-11:00 do not. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Every free start time across `days`, earliest first.
 *
 * A candidate survives when it fits inside opening hours and clashes with no
 * busy span — where "clash" means the two overlap once the buffer is applied
 * AND they share a therapy (or the busy span is a block-out, which shares
 * nothing and blocks everything).
 */
export function computeFreeSlots(input: FreeSlotsInput): FreeSlot[] {
  const {
    days, durationMinutes, bufferMinutes, granularityMinutes,
    therapyIds, earliest, limit, maxPerDay,
  } = input;

  if (durationMinutes <= 0 || granularityMinutes <= 0 || limit <= 0) return [];

  const mine = new Set(therapyIds);
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
      const clashes = day.busy.some((b) => {
        if (!overlaps(start - bufferMinutes, end + bufferMinutes, b.startMin, b.endMin)) return false;
        // A span with no therapies is a block-out: it blocks everything.
        if (b.therapyIds.length === 0) return true;
        return b.therapyIds.some((id) => mine.has(id));
      });
      if (clashes) continue;

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
