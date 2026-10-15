import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { classSessions, sessionBookings } from "@/lib/db/schema";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { memberCheckin } from "@/lib/checkins";
import { memberHabits } from "@/lib/habits";
import { clientsWithPush, getPrefs, isPushConfigured, sendToClient } from "@/lib/push";
import { dateKey, addDays } from "@/lib/trainingProgress";
import { checkinNudge, classReminderDue, dublinToMs, habitNudge } from "@/lib/remindersModel";

/**
 * The ticker's reminder pass for one business, once a minute: class, check-in
 * and habit reminders to members who turned notifications on. Each is keyed
 * so it goes once. The business is named explicitly (no request here).
 */
export async function dispatchReminders(tenantId: number, now = Date.now()): Promise<number> {
  if (!isPushConfigured()) return 0;
  const people = clientsWithPush();
  if (people.length === 0) return 0;
  const business = getBusinessProfileForTenant(tenantId).businessName || "Your gym";
  const today = dateKey(now);
  let sent = 0;

  // Classes: booked sessions today and tomorrow, for people with push on.
  const booked = db
    .select({ bookingId: sessionBookings.id, clientId: sessionBookings.clientId, name: classSessions.name, date: classSessions.date, start: classSessions.startTime })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(eq(sessionBookings.status, "booked"), inArray(sessionBookings.clientId, people), inArray(classSessions.date, [today, addDays(today, 1)])))
    .all();
  for (const b of booked) {
    if (!classReminderDue(dublinToMs(b.date, b.start), now)) continue;
    if (!getPrefs(b.clientId).classes) continue;
    sent += await sendToClient(b.clientId, { title: `${b.name} at ${b.start}`, body: `Your class at ${business} starts at ${b.start}. Can't make it? Cancel in the app.`, url: "/app/timetable" }, `class:${b.bookingId}`);
  }

  for (const clientId of people) {
    const prefs = getPrefs(clientId);
    if (prefs.checkins) {
      const c = memberCheckin(clientId);
      const nudge = c ? checkinNudge(c, now) : null;
      if (nudge) {
        sent += await sendToClient(
          clientId,
          nudge.kind === "due"
            ? { title: "Your weekly check-in is due", body: "Two minutes: how the week went, and a photo if your coach asks for one.", url: "/app/checkin" }
            : { title: "Your check-in is still waiting", body: `${business} hasn't got this week's check-in yet. It only takes a couple of minutes.`, url: "/app/checkin" },
          nudge.key,
        );
      }
    }
    if (prefs.habits) {
      const h = memberHabits(clientId);
      if (h) {
        const done = h.habits.filter((x) => h.tickedToday.has(x.id)).length;
        const key = habitNudge(h.today, done, h.habits.length, now);
        if (key) {
          sent += await sendToClient(
            clientId,
            { title: done === 0 ? "Today's habits" : `${done} of ${h.habits.length} habits done`, body: h.streak > 0 ? `Tick the rest to keep your ${h.streak}-day streak going.` : "A few minutes before bed. Tick them off in the app.", url: "/app/habits" },
            key,
          );
        }
      }
    }
  }
  return sent;
}
