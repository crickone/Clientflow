import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { appointments, blockOuts, type BlockOut } from "./db/schema";
import { getSettings, type OpeningHour } from "./settings";

/**
 * Convert "HH:mm" to minutes from midnight.
 */
export function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export function minToHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function dayOfWeek(dateIso: string): number {
  return new Date(`${dateIso}T00:00:00`).getDay();
}

export function daysForBlock(b: BlockOut): number[] {
  if (b.daysOfWeek) {
    return b.daysOfWeek
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  }
  if (b.dayOfWeek != null) return [b.dayOfWeek];
  return [];
}

export function listBlockOuts(): BlockOut[] {
  return db.select().from(blockOuts).all();
}

/**
 * Return the block-outs that intersect a given date.
 *  - one_off blocks where date <= dateIso <= endDate (or just date if endDate null)
 *  - recurring blocks where day_of_week matches
 */
export function blockOutsForDate(dateIso: string): BlockOut[] {
  const dow = dayOfWeek(dateIso);
  return db
    .select()
    .from(blockOuts)
    .all()
    .filter((b) => {
      if (b.type === "one_off") {
        const start = b.date ?? "";
        const end = b.endDate ?? b.date ?? "";
        return start <= dateIso && dateIso <= end;
      }
      return daysForBlock(b).includes(dow);
    });
}

export interface OverlapCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a proposed booking against opening hours, block-outs, and other
 * appointments. Two appointments only conflict if they overlap in time AND
 * share at least one therapy (capacity-1-per-therapy model).
 *
 * Times are inclusive-exclusive: [start, end).
 */
export function checkBookingSlot(
  dateIso: string,
  startTime: string,
  durationMinutes: number,
  therapyIds: number[] = [],
  excludeAppointmentId?: number,
): OverlapCheckResult {
  const startMin = hmToMin(startTime);
  const endMin = startMin + durationMinutes;
  const settings = getSettings();

  // 1. Opening hours
  const dow = dayOfWeek(dateIso);
  const oh: OpeningHour | undefined = settings.openingHours.find(
    (o) => o.dow === dow,
  );
  if (!oh || oh.closed) {
    return { ok: false, reason: "Clinic is closed that day." };
  }
  const openMin = hmToMin(oh.open ?? "00:00");
  const closeMin = hmToMin(oh.close ?? "23:59");
  if (startMin < openMin || endMin > closeMin) {
    return {
      ok: false,
      reason: `Outside opening hours (${oh.open}–${oh.close}).`,
    };
  }

  // 2. Block-outs
  const blocks = blockOutsForDate(dateIso);
  for (const b of blocks) {
    const bs = hmToMin(b.startTime);
    const be = hmToMin(b.endTime);
    if (startMin < be && bs < endMin) {
      return { ok: false, reason: `Blocked: ${b.reason}` };
    }
  }

  // 3. Existing appointments — capacity 1 per therapy. Two bookings only
  //    conflict if they share a therapy.
  const buffer = settings.bufferMinutes;
  const mySet = new Set(therapyIds);
  const existing = db
    .select()
    .from(appointments)
    .where(eq(appointments.date, dateIso))
    .all();
  for (const a of existing) {
    if (excludeAppointmentId != null && a.id === excludeAppointmentId) continue;
    if (a.status === "cancelled") continue;
    const as = hmToMin(a.startTime) - buffer;
    const ae = hmToMin(a.endTime) + buffer;
    if (!(startMin < ae && as < endMin)) continue; // no time overlap
    let theirIds: number[] = [];
    try {
      theirIds = JSON.parse(a.therapyIds || "[]");
    } catch {
      // ignore
    }
    const shared = theirIds.filter((id) => mySet.has(id));
    if (shared.length === 0) continue; // different therapy, allowed
    return {
      ok: false,
      reason: `Therapy already booked at this time (appointment #${a.id}, ${a.startTime}–${a.endTime}).`,
    };
  }

  return { ok: true };
}

/**
 * Returns the appointment-friendly working window for a given date based on
 * settings. Used by the calendar header to know how many rows to render.
 */
export function dayWindow(dateIso: string): {
  closed: boolean;
  open: string;
  close: string;
} {
  const dow = dayOfWeek(dateIso);
  const oh = getSettings().openingHours.find((o) => o.dow === dow);
  if (!oh || oh.closed) return { closed: true, open: "00:00", close: "00:00" };
  return { closed: false, open: oh.open ?? "08:00", close: oh.close ?? "20:00" };
}

/**
 * Calendar grid bounds = the union of every weekday's open/close pair, so all
 * days fit in the same vertical range.
 */
export function weekWindow(): { open: string; close: string; slot: number } {
  const settings = getSettings();
  let min = 24 * 60;
  let max = 0;
  for (const oh of settings.openingHours) {
    if (oh.closed) continue;
    min = Math.min(min, hmToMin(oh.open ?? "08:00"));
    max = Math.max(max, hmToMin(oh.close ?? "20:00"));
  }
  if (max === 0) {
    min = 8 * 60;
    max = 20 * 60;
  }
  return {
    open: minToHm(min),
    close: minToHm(max),
    slot: settings.slotLengthMinutes,
  };
}
