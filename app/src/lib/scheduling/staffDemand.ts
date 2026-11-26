/**
 * PURE staff arithmetic: no DB, no `server-only`.
 *
 * The rule: at any moment, the people needed are one for each appointment in
 * progress that includes a "whole" therapy (a therapist is with the client the
 * whole time), plus one if any appointment in progress has only "setup"
 * therapies (a therapist sets those up and can look after several at once).
 * One appointment that carries several therapies is one client doing them one
 * after another, so it needs at most one person: it counts as "whole" if any
 * of its therapies is "whole". Needed may not exceed the people on shift at
 * any moment of the proposed booking.
 *
 * Called from the same two seams as ./resourceDemand: `checkBookingSlot`
 * (@/lib/schedule) and `computeFreeSlots` (./freeSlots), so a time offered is
 * a time the booking path accepts.
 *
 * No buffer applies here: the buffer is dead time for a room or machine, and
 * a therapist can finish one client at 10:00 and start the next at 10:00.
 * Half-open throughout, as in ./resourceDemand.
 */

export type Staffing = "whole" | "setup";

/** One booking already in the diary, as minutes from midnight. `label` names its treatments for the reason text. */
export interface StaffedSpan {
  startMin: number;
  endMin: number;
  staffing: Staffing;
  label: string;
}

export interface ShiftSpan {
  startMin: number;
  endMin: number;
}

/**
 * Who is on, for one day.
 *  off        the business does not use the rota: the rule never applies.
 *  assumeOne  the rota is on but this week has no shifts: one person during opening hours.
 *  shifts     the week has shifts: these are the people on this day (none means nobody).
 */
export type DayCover =
  | { mode: "off" }
  | { mode: "assumeOne"; openMin: number; closeMin: number }
  | { mode: "shifts"; shifts: ShiftSpan[] };

/** An appointment's staffing from its therapies. No therapies needs a person, to fail safe. */
export function staffingOf(list: Staffing[]): Staffing {
  if (list.length === 0) return "whole";
  return list.some((s) => s === "whole") ? "whole" : "setup";
}

/** People on shift at minute `t`. */
export function onShiftAt(cover: DayCover, t: number): number {
  if (cover.mode === "off") return Number.POSITIVE_INFINITY;
  if (cover.mode === "assumeOne") return cover.openMin <= t && t < cover.closeMin ? 1 : 0;
  let n = 0;
  for (const s of cover.shifts) if (s.startMin <= t && t < s.endMin) n++;
  return n;
}

/** People needed by appointments that are all in progress together. */
export function neededFor(spans: { staffing: Staffing }[]): number {
  let whole = 0;
  let setup = false;
  for (const s of spans) {
    if (s.staffing === "whole") whole++;
    else setup = true;
  }
  return whole + (setup ? 1 : 0);
}

export interface StaffShortfall {
  /** The first minute the booking would leave too few people on. */
  atMin: number;
  needed: number;
  onShift: number;
  /** The other bookings in progress at that minute. */
  others: StaffedSpan[];
}

/**
 * The first moment this booking would need more people than are on, or null.
 *
 * Needed and on-shift only change where a booking or a shift starts or ends,
 * so checking the proposal's start and every such edge inside it is exact.
 */
export function firstStaffShortfall(input: {
  startMin: number;
  endMin: number;
  staffing: Staffing;
  booked: StaffedSpan[];
  cover: DayCover;
}): StaffShortfall | null {
  const { startMin, endMin, staffing, booked, cover } = input;
  if (cover.mode === "off" || endMin <= startMin) return null;

  const overlapping = booked.filter((b) => b.startMin < endMin && startMin < b.endMin);
  const points = new Set<number>([startMin]);
  const inside = (t: number) => {
    if (startMin < t && t < endMin) points.add(t);
  };
  for (const b of overlapping) {
    inside(b.startMin);
    inside(b.endMin);
  }
  if (cover.mode === "assumeOne") {
    inside(cover.openMin);
    inside(cover.closeMin);
  } else {
    for (const s of cover.shifts) {
      inside(s.startMin);
      inside(s.endMin);
    }
  }

  for (const t of [...points].sort((a, b) => a - b)) {
    const others = overlapping.filter((b) => b.startMin <= t && t < b.endMin);
    const needed = neededFor([...others, { staffing }]);
    const onShift = onShiftAt(cover, t);
    if (needed > onShift) return { atMin: t, needed, onShift, others };
  }
  return null;
}

function hm(mins: number): string {
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Plain-English reason for the operator, the booking screen or an agent. */
export function staffShortfallReason(s: StaffShortfall): string {
  if (s.onShift === 0) return "Nobody is on the rota then.";
  const labels = s.others.map((o) => o.label.trim()).filter(Boolean);
  const what =
    labels.length > 0
      ? `${listWords(labels)} ${s.others.length === 1 ? "is" : "are"}`
      : s.others.length === 1
        ? "another booking is"
        : "other bookings are";
  const people = s.onShift === 1 ? "Only one therapist on" : `Only ${s.onShift} therapists on`;
  return `${people} at ${hm(s.atMin)} and ${what} booked then.`;
}
