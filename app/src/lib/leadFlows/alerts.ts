import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Lead } from "@/lib/db/schema";
import { getAppBaseUrl } from "@/lib/appUrl";
import { leadNotifies, leadSourceText, personName } from "@/lib/notifications/model";
import { notifyUser } from "@/lib/notifications/notify";

import { firstChars, hotLeadAlertText, newLeadAlertText } from "./alertText";
import { flowNow } from "./clock";
import { STAFF_ALERT_KEY } from "./flowModel";
import { getLeadFlowSettings } from "./settings";

/**
 * Staff alerts for the lead flows. The assignee gets a personal in-app alert
 * (their bell and devices only); the business's alert number gets a
 * WhatsApp from the business WhatsApp, queued for the dispatch ticker. The
 * business-wide bell for new leads and messages is separate and unchanged.
 * Alerts are not held by sending hours: they are for staff.
 */

/** An absolute link to the lead, for a WhatsApp alert. */
export function leadLink(leadId: number): string {
  let base = "http://localhost:3000";
  try {
    base = getAppBaseUrl();
  } catch {
    // no request and no APP_URL: the dev default
  }
  return `${base.replace(/\/+$/, "")}/leads/${leadId}`;
}

export interface StaffAlertInput {
  leadId: number | null;
  /** STAFF_ALERT_KEY (default) for alerts no flow stops; CALL_ALERT_KEY for a scheduled call's. */
  triggerKey?: string;
  dueAt?: number;
  /** An in-app alert for this person... */
  userId?: number | null;
  title?: string;
  body?: string;
  href?: string;
  /** ...and/or this WhatsApp to the alert number. */
  whatsappText?: string | null;
}

/** Queue a staff alert for the dispatch ticker. Nothing to say: nothing queued. */
export function queueStaffAlert(a: StaffAlertInput): void {
  const inApp = a.userId != null && !!a.title;
  if (!inApp && !a.whatsappText) return;
  db.insert(schema.automationQueue)
    .values({
      triggerKey: a.triggerKey ?? STAFF_ALERT_KEY,
      leadId: a.leadId,
      kind: "staff_alert",
      channel: "chat",
      body: a.whatsappText ?? a.title ?? "Staff alert",
      dueAt: new Date(a.dueAt ?? flowNow()),
      payload: JSON.stringify({
        userId: inApp ? a.userId : null,
        title: a.title,
        body: a.body,
        href: a.href,
        whatsappText: a.whatsappText ?? undefined,
      }),
    })
    .run();
}

/** A lead just came in (upsertLead created it). Never throws. */
export function alertNewLead(lead: Lead, actor?: string | null): void {
  try {
    if (!leadNotifies(lead.source, actor)) return;
    const name = personName(lead.firstName, lead.lastName, lead.email || lead.phone || "no name yet");
    const source = leadSourceText(lead.source);
    if (lead.assignedUserId != null) {
      notifyUser(lead.assignedUserId, {
        kind: "lead",
        title: `New lead for you: ${name}`,
        body: `${source}. ${lead.phone || "No phone"}`,
        href: `/leads/${lead.id}`,
        key: `lead-assigned:${lead.id}`,
      });
    }
    if (getLeadFlowSettings().alertWhatsAppTo) {
      queueStaffAlert({ leadId: lead.id, whatsappText: newLeadAlertText({ name, source, phone: lead.phone, link: leadLink(lead.id) }) });
    }
  } catch (err) {
    console.error(`[lead flows] new-lead alert for lead #${lead.id} failed:`, err);
  }
}

/** A reply just made a lead hot. Never throws. */
export function alertHotLead(leadId: number, reply: string | null): void {
  try {
    const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return;
    const name = personName(lead.firstName, lead.lastName, lead.email || lead.phone || "A lead");
    if (lead.assignedUserId != null) {
      notifyUser(lead.assignedUserId, {
        kind: "lead",
        title: `Hot lead: ${name}`,
        body: reply?.trim() ? `Replied: "${firstChars(reply)}"` : "Replied",
        href: `/leads/${leadId}`,
        key: `hot:${leadId}:${flowNow()}`,
      });
    }
    if (getLeadFlowSettings().alertWhatsAppTo) {
      queueStaffAlert({ leadId, whatsappText: hotLeadAlertText({ name, reply, link: leadLink(leadId) }) });
    }
  } catch (err) {
    console.error(`[lead flows] hot-lead alert for lead #${leadId} failed:`, err);
  }
}
