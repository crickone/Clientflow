import "server-only";

import { and, desc, eq, gt, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Lead, LeadCall } from "@/lib/db/schema";
import { createEvent, deleteEvent } from "@/lib/calendar";
import { addMessage } from "@/lib/leads";
import { personName } from "@/lib/notifications/model";
import { setStageToId } from "@/lib/pipeline/stage";
import { listStages } from "@/lib/pipeline/stageRepo";

import { callBackAlertText } from "./alertText";
import { leadLink, queueStaffAlert } from "./alerts";
import {
  CALL_LENGTH_MINUTES,
  CALL_OUTCOMES,
  callbackDayError,
  callTimeError,
  formatCallDay,
  formatCallTime,
  isCallOutcome,
  outcomeColumn,
  staffCallAlertAt,
  type CallOutcome,
} from "./callPlan";
import { flowNow } from "./clock";
import { CALL_ALERT_KEY, CALL_BOOKED_FLOW, resolveColumn, type ColumnRef } from "./flowModel";
import { startFlow } from "./runs";
import { endOfLocalDay, localParts, morningOf, todayIn } from "./sendingWindow";
import { getLeadFlowSettings } from "./settings";

/**
 * Log a call and Schedule a call, from the lead page and the board card.
 * Every action moves the card as a person would (actor "user"), which stops
 * the lead's flows and cancels any earlier scheduled call's alerts, then
 * sets up what this call needs. Ambient tenant.
 */

export type CallResult = { ok: true; message: string } | { ok: false; error: string };

function moveTo(lead: Lead, ref: ColumnRef, startFlowOnEntry: boolean): { ok: true; name: string } | { ok: false; error: string } {
  const target = resolveColumn(ref, listStages(lead.pipelineId));
  if (!target) return { ok: false, error: "This board has no column for that. Add it under Manage stages." };
  setStageToId(lead.id, target.id, "user", { startFlow: startFlowOnEntry, reenter: true });
  return { ok: true, name: target.name };
}

/** An earlier call still to come is replaced: its diary entry goes. */
function clearUpcomingCall(leadId: number, now: number): void {
  const upcoming = db
    .select({ id: schema.leadCalls.id, eventId: schema.leadCalls.calendarEventId })
    .from(schema.leadCalls)
    .where(and(eq(schema.leadCalls.leadId, leadId), isNotNull(schema.leadCalls.calendarEventId), gt(schema.leadCalls.scheduledFor, now)))
    .all();
  for (const u of upcoming) {
    if (u.eventId != null) deleteEvent(u.eventId);
    db.update(schema.leadCalls).set({ calendarEventId: null }).where(eq(schema.leadCalls.id, u.id)).run();
  }
}

export interface LogCallInput {
  outcome: CallOutcome;
  note?: string | null;
  /** Call back later only: the day they asked for; none = the flow's own delay. */
  callbackDay?: string | null;
}

export function logCall(leadId: number, input: LogCallInput, userId: number | null): CallResult {
  if (!isCallOutcome(input.outcome)) return { ok: false, error: "Pick what happened on the call." };
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.outcome === "call_back") return scheduleCall(leadId, { day: input.callbackDay ?? null }, userId, { logged: true, note });
  const label = CALL_OUTCOMES.find((o) => o.key === input.outcome)!.label;
  const moved = moveTo(lead, outcomeColumn(input.outcome), true);
  if (!moved.ok) return moved;
  db.insert(schema.leadCalls).values({ leadId, kind: "logged", outcome: input.outcome, note, userId, createdAt: flowNow() }).run();
  addMessage({ leadId, direction: "note", channel: "call", content: `Call logged: ${label}.${note ? ` ${note}` : ""}` });
  return { ok: true, message: `Logged. Moved to ${moved.name}.` };
}

export interface ScheduleCallInput {
  /** A call at a time, epoch ms. */
  at?: number | null;
  /** A day without a time, "YYYY-MM-DD". Neither: Call back later with no day. */
  day?: string | null;
}

export function scheduleCall(leadId: number, input: ScheduleCallInput, userId: number | null, opts: { logged?: boolean; note?: string | null } = {}): CallResult {
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  const now = flowNow();
  const settings = getLeadFlowSettings();
  const name = personName(lead.firstName, lead.lastName, lead.phone || lead.email || "this lead");
  // The alert goes to the lead's assignee, else to whoever scheduled the call.
  const alertTo = lead.assignedUserId ?? userId;
  const record = (patch: Partial<typeof schema.leadCalls.$inferInsert>) =>
    db.insert(schema.leadCalls)
      .values({ leadId, kind: opts.logged ? "logged" : "scheduled", outcome: opts.logged ? "call_back" : null, note: opts.note ?? null, userId, createdAt: now, ...patch })
      .run();

  if (input.at != null) {
    const err = callTimeError(input.at, now);
    if (err) return { ok: false, error: err };
    clearUpcomingCall(leadId, now);
    const moved = moveTo(lead, "role:booked", false);
    if (!moved.ok) return moved;
    startFlow(leadId, CALL_BOOKED_FLOW, { callAt: input.at });
    const start = formatCallTime(input.at);
    const eventId = createEvent(
      {
        title: `Call: ${name}`,
        description: [lead.phone, `/leads/${leadId}`].filter(Boolean).join("\n"),
        date: localParts(input.at).date,
        startTime: start,
        endTime: formatCallTime(input.at + CALL_LENGTH_MINUTES * 60_000),
        allDay: false,
        color: "#3b82f6",
      },
      userId ?? undefined,
    );
    queueStaffAlert({
      leadId,
      triggerKey: CALL_ALERT_KEY,
      dueAt: staffCallAlertAt(now, input.at),
      userId: alertTo,
      title: `Call in 10 minutes: ${name}`,
      body: lead.phone ?? "No phone on file",
      href: `/leads/${leadId}`,
    });
    record({ scheduledFor: input.at, calendarEventId: eventId });
    const when = `${formatCallDay(input.at)} at ${start}`;
    addMessage({ leadId, direction: "note", channel: "call", content: `Call booked for ${when}.` });
    return { ok: true, message: `Call booked for ${when}. Moved to ${moved.name}.` };
  }

  if (input.day) {
    const err = callbackDayError(input.day, todayIn(now));
    if (err) return { ok: false, error: err };
    clearUpcomingCall(leadId, now);
    const moved = moveTo(lead, "key:call_back", false);
    if (!moved.ok) return moved;
    const morning = Math.max(now, morningOf(input.day, settings.window));
    queueStaffAlert({
      leadId,
      triggerKey: CALL_ALERT_KEY,
      dueAt: morning,
      userId: alertTo,
      title: `Call back today: ${name}`,
      body: lead.phone ?? "No phone on file",
      href: `/leads/${leadId}`,
      whatsappText: settings.alertWhatsAppTo ? callBackAlertText({ name, phone: lead.phone, link: leadLink(leadId) }) : null,
    });
    // Not reached by the end of that day (no call logged, card not moved): Call back later starts.
    db.insert(schema.automationQueue)
      .values({
        triggerKey: CALL_ALERT_KEY,
        leadId,
        kind: "callback_check",
        channel: "chat",
        body: `Call back check for ${input.day}`,
        dueAt: new Date(endOfLocalDay(input.day)),
        payload: JSON.stringify({ day: input.day }),
      })
      .run();
    record({ scheduledDay: input.day });
    const dayText = formatCallDay(morningOf(input.day, settings.window));
    addMessage({ leadId, direction: "note", channel: "call", content: `Call back on ${dayText}.` });
    return { ok: true, message: `Call back on ${dayText}. Moved to ${moved.name}.` };
  }

  // No day: the Call back later flow starts after its own first delay.
  const moved = moveTo(lead, "key:call_back", true);
  if (!moved.ok) return moved;
  record({});
  addMessage({ leadId, direction: "note", channel: "call", content: "Call back later, no day set." });
  return { ok: true, message: `Moved to ${moved.name}.` };
}

/** The lead's calls, newest first. */
export function listLeadCalls(leadId: number): LeadCall[] {
  return db.select().from(schema.leadCalls).where(eq(schema.leadCalls.leadId, leadId)).orderBy(desc(schema.leadCalls.createdAt), desc(schema.leadCalls.id)).limit(20).all();
}
