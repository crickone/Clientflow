import "server-only";

import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { calendarEvents } from "@/lib/db/schema";

export type CalendarEvent = {
  id: number;
  title: string;
  description: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  location: string | null;
  color: string | null;
};

function map(r: typeof calendarEvents.$inferSelect): CalendarEvent {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    allDay: r.allDay,
    location: r.location,
    color: r.color,
  };
}

/** Events with date in [startDate, endDate] (inclusive, YYYY-MM-DD strings). */
export function listEventsInRange(startDate: string, endDate: string): CalendarEvent[] {
  return db
    .select()
    .from(calendarEvents)
    .where(and(gte(calendarEvents.date, startDate), lte(calendarEvents.date, endDate)))
    .orderBy(asc(calendarEvents.date), asc(calendarEvents.startTime))
    .all()
    .map(map);
}

/** Upcoming events from `fromDate` onward. */
export function listUpcomingEvents(fromDate: string, limit = 8): CalendarEvent[] {
  return db
    .select()
    .from(calendarEvents)
    .where(gte(calendarEvents.date, fromDate))
    .orderBy(asc(calendarEvents.date), asc(calendarEvents.startTime))
    .limit(limit)
    .all()
    .map(map);
}

export type EventInput = {
  title: string;
  description?: string | null;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay: boolean;
  location?: string | null;
  color?: string | null;
};

export function createEvent(input: EventInput, userId?: number): number {
  const row = db
    .insert(calendarEvents)
    .values({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      date: input.date,
      startTime: input.allDay ? null : input.startTime || null,
      endTime: input.allDay ? null : input.endTime || null,
      allDay: input.allDay,
      location: input.location?.trim() || null,
      color: input.color || null,
      createdByUserId: userId ?? null,
    })
    .returning({ id: calendarEvents.id })
    .get();
  return row.id;
}

export function updateEvent(id: number, input: EventInput): void {
  db.update(calendarEvents)
    .set({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      date: input.date,
      startTime: input.allDay ? null : input.startTime || null,
      endTime: input.allDay ? null : input.endTime || null,
      allDay: input.allDay,
      location: input.location?.trim() || null,
      color: input.color || null,
      updatedAt: new Date(),
    })
    .where(eq(calendarEvents.id, id))
    .run();
}

export function deleteEvent(id: number): void {
  db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
}
