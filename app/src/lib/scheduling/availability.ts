import "server-only";
import { and, gte, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { appointments, blockOuts } from "@/lib/db/schema";
import { getSettings, readKey } from "@/lib/settings";
import { daysForBlock, dayOfWeek, checkBookingSlot } from "@/lib/schedule";
import { computeFreeSlots, spreadSlots, hmToMin, type DayAvailability, type FreeSlot } from "./freeSlots";
import { allResourceIds, demandForTherapies, demandResolver, resourceLimits } from "./resourceRepo";

/**
 * "What times can I offer this lead?" — the diary side of the lead engine.
 *
 * The arithmetic lives in ./freeSlots (pure, tested). This module is only the
 * data-loading shell: it reads opening hours, block-outs and the appointments
 * in range ONCE for the whole window and hands them over. Both it and
 * `checkBookingSlot` apply the SAME conflict rule (./resourceDemand), so a
 * slot offered here is a slot the booking path accepts. The final re-check
 * through `checkBookingSlot` is kept anyway: it is cheap over a handful of
 * slots, it catches a diary that moved between loading and offering, and it
 * fails closed.
 *
 * Time zone: every date here is a Europe/Dublin calendar date, never the
 * server's (Railway runs UTC, the clinic does not). See @/lib/billing/dates
 * for the same treatment in billing.
 */

const DUBLIN_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const DUBLIN_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface ConsultationConfig {
  /** How long a consultation runs. */
  durationMinutes: number;
  /** Candidate start times land on this grid. */
  granularityMinutes: number;
  /** Never offer a slot sooner than this from now — nobody books a 4pm at 3:55. */
  leadMinutes: number;
  /** How far ahead to look. */
  horizonDays: number;
  /** Therapies a consultation occupies. Empty means it clashes with nothing, which is wrong for a single-room clinic — see the note in freeSlots.ts. */
  therapyIds: number[];
}

const DEFAULTS: ConsultationConfig = {
  durationMinutes: 20,
  granularityMinutes: 15,
  leadMinutes: 120,
  horizonDays: 14,
  therapyIds: [],
};

/** Per-tenant overrides, all optional, all read from the same settings table the rest of the app uses. */
export function consultationConfig(): ConsultationConfig {
  return {
    durationMinutes: Number(readKey("consultation_minutes", DEFAULTS.durationMinutes)),
    granularityMinutes: Number(readKey("consultation_granularity_minutes", DEFAULTS.granularityMinutes)),
    leadMinutes: Number(readKey("consultation_lead_minutes", DEFAULTS.leadMinutes)),
    horizonDays: Number(readKey("consultation_horizon_days", DEFAULTS.horizonDays)),
    therapyIds: readKey<number[]>("consultation_therapy_ids", DEFAULTS.therapyIds),
  };
}

/** Add `n` days to an ISO date without going near local-time Date parsing. */
function addDays(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export interface AvailabilityWindow {
  /** Free slots, earliest first, already re-validated. */
  slots: FreeSlot[];
  /** What the caller asked for, so a message can say "20 minutes". */
  config: ConsultationConfig;
}

/**
 * Free slots across the configured horizon.
 *
 * `now` is injectable so a caller (and a test) can pin the clock; it defaults
 * to the real one.
 */
export function findFreeSlots(opts: { limit?: number; maxPerDay?: number; now?: Date } = {}): AvailabilityWindow {
  const config = consultationConfig();
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 24;

  const today = DUBLIN_YMD.format(now);
  const [nowH, nowM] = DUBLIN_HM.format(now).split(":").map(Number);
  const earliestMin = nowH * 60 + nowM + config.leadMinutes;

  // The lead time can push past midnight; roll the floor onto the right day
  // rather than offering nothing today and everything tomorrow at 00:00.
  let earliestDate = today;
  let earliestMinOnDay = earliestMin;
  while (earliestMinOnDay >= 24 * 60) {
    earliestMinOnDay -= 24 * 60;
    earliestDate = addDays(earliestDate, 1);
  }

  const lastDate = addDays(today, Math.max(1, config.horizonDays));
  const { openingHours, bufferMinutes } = getSettings();

  // One query each, for the whole window.
  const booked = db
    .select({
      date: appointments.date,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      therapyIds: appointments.therapyIds,
    })
    .from(appointments)
    .where(and(gte(appointments.date, earliestDate), lte(appointments.date, lastDate), ne(appointments.status, "cancelled")))
    .all();
  const allBlocks = db.select().from(blockOuts).all();

  const limits = resourceLimits();
  const demandOf = demandResolver();
  const myDemand = demandForTherapies(config.therapyIds);
  // A block-out closes the place, so it has to occupy everything — including
  // the virtual resources standing in for unmapped therapies. A span that
  // demands nothing blocks nothing (see resourceDemand.ts).
  const everything = new Map(allResourceIds().map((id) => [id, Number.MAX_SAFE_INTEGER]));

  const byDate = new Map<string, typeof booked>();
  for (const a of booked) {
    const list = byDate.get(a.date);
    if (list) list.push(a);
    else byDate.set(a.date, [a]);
  }

  const days: DayAvailability[] = [];
  for (let i = 0; ; i++) {
    const date = addDays(earliestDate, i);
    if (date > lastDate) break;
    const oh = openingHours.find((o) => o.dow === dayOfWeek(date));
    if (!oh || oh.closed) {
      days.push({ date, closed: true, openMin: 0, closeMin: 0, busy: [] });
      continue;
    }

    const busy = (byDate.get(date) ?? []).map((a) => ({
      startMin: hmToMin(a.startTime),
      endMin: hmToMin(a.endTime),
      demand: demandOf(a.therapyIds),
    }));

    for (const b of allBlocks) {
      const hits = b.type === "one_off"
        ? (b.date ?? "") <= date && date <= (b.endDate ?? b.date ?? "")
        : daysForBlock(b).includes(dayOfWeek(date));
      if (!hits) continue;
      busy.push({ startMin: hmToMin(b.startTime), endMin: hmToMin(b.endTime), demand: everything });
    }

    days.push({
      date,
      closed: false,
      openMin: hmToMin(oh.open ?? "00:00"),
      closeMin: hmToMin(oh.close ?? "23:59"),
      busy,
    });
  }

  const candidates = computeFreeSlots({
    days,
    durationMinutes: config.durationMinutes,
    bufferMinutes,
    granularityMinutes: config.granularityMinutes,
    demand: myDemand,
    limits,
    earliest: { date: earliestDate, min: earliestMinOnDay },
    limit: limit * 3, // over-fetch so `spreadSlots` has room to pick across days
    maxPerDay: opts.maxPerDay,
  });

  // Fail closed against the booking API's own validator.
  const slots = candidates
    .filter((s) => checkBookingSlot(s.date, s.startTime, config.durationMinutes, config.therapyIds).ok)
    .slice(0, limit);

  return { slots, config };
}

/**
 * The two or three slots to actually put in a message, spread across days.
 * This is what `offer_slots` hands the model — never the raw diary.
 */
export function offerableSlots(count = 2, now?: Date): AvailabilityWindow {
  const { slots, config } = findFreeSlots({ limit: 24, maxPerDay: 3, now });
  return { slots: spreadSlots(slots, count), config };
}
