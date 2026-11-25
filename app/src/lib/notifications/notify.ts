import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { boundTenantId, resolveCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { classSessions, clients, leads } from "@/lib/db/schema";
import {
  classWhen,
  conversationHref,
  emailNotifies,
  emailThreadHref,
  eurText,
  isAdminOnlyKind,
  leadNotifies,
  leadSourceText,
  messageTitle,
  personName,
  pushRecipients,
  snippet,
  type NotificationKind,
} from "./model";
import { createNotification, prefsForUsers, staffOf, subscriptionsFor } from "./store";
import { sendStaffPush, type PushSender } from "./push";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  /** The same key notifies once, however many times the event is seen. */
  key: string;
  /** A personal alert: in this user's bell and on their devices only. */
  forUserId?: number;
}

let pushSender: PushSender | undefined;
/** Tests only: capture alerts instead of sending them. */
export function setPushSenderForTests(fn: PushSender | undefined): void {
  pushSender = fn;
}

/**
 * THE way to tell staff something happened, for the CURRENT tenant (a
 * runWithTenant binding, else the request's business). Records it for the
 * bell and the pop-up, then sends phone/desktop alerts in the background.
 *
 * Never throws. It is called after a webhook, a sale or a booking has already
 * succeeded, and a notification problem must not turn that into a failure.
 * Returns the new notification's id, or null (a repeat, or it failed).
 */
export function notify(input: NotifyInput): number | null {
  try {
    const tenantId = boundTenantId() ?? resolveCurrentTenant()?.id;
    if (!tenantId) return null;
    const body = snippet(input.body ?? "", 140);
    const id = createNotification({ kind: input.kind, title: snippet(input.title, 120), body, href: input.href, key: input.key, forUserId: input.forUserId ?? null });
    if (id == null) return null;

    // Who gets an alert is worked out now, while the tenant is bound; only
    // the sending happens after the caller has moved on.
    const people = staffOf(tenantId).filter((p) => input.forUserId == null || p.userId === input.forUserId);
    const userIds = pushRecipients(people, prefsForUsers(people.map((p) => p.userId)), { kind: input.kind, adminOnly: isAdminOnlyKind(input.kind) });
    const subs = subscriptionsFor(userIds);
    if (subs.length) {
      void sendStaffPush(tenantId, subs, { title: snippet(input.title, 120), body, url: input.href, tag: `n${id}` }, pushSender).catch((err) =>
        console.error("[notifications] push failed", err),
      );
    }
    return id;
  } catch (err) {
    console.error("[notifications] notify failed", err);
    return null;
  }
}

/** An alert for one person only: their bell and their devices, nobody else's. Never throws. */
export function notifyUser(userId: number, input: Omit<NotifyInput, "forUserId">): number | null {
  return notify({ ...input, forUserId: userId });
}

/** Run `fn` bound to a tenant, swallowing anything it throws. */
function safely<T>(tenantId: number | null, fn: () => T): T | null {
  try {
    return tenantId != null ? runWithTenant(tenantId, fn) : fn();
  } catch (err) {
    console.error("[notifications] notify failed", err);
    return null;
  }
}

// ---- The events ----------------------------------------------------------------

/** An inbound WhatsApp, Messenger or Instagram message, already threaded. */
export function notifyInboundMessage(m: {
  channel: "whatsapp" | "messenger" | "instagram";
  owner: "client" | "lead";
  contactId: number;
  name: string | null;
  text: string;
  messageId: number;
  /** The provider's id for the message, so a webhook delivered twice notifies once. */
  providerMessageId?: string | null;
}): number | null {
  return safely(null, () =>
    notify({
      kind: "message",
      title: messageTitle(m.channel, m.name),
      body: m.text,
      href: conversationHref(m.owner, m.contactId),
      key: m.providerMessageId ? `msg:${m.channel}:${m.providerMessageId}` : `msg:${m.owner}:${m.messageId}`,
    }),
  );
}

/**
 * An inbound email, just stored. Only from a known client or lead, unread,
 * and under 2 hours old (see emailNotifies), so a first sync is silent.
 */
export function notifyInboundEmail(
  tenantId: number,
  e: {
    messageKey: string;
    threadKey: string;
    fromEmail: string | null;
    fromName: string | null;
    subject: string | null;
    snippet: string | null;
    clientId: number | null;
    isRead: boolean;
    at: Date | null;
  },
  now = Date.now(),
): number | null {
  return safely(tenantId, () => {
    const email = (e.fromEmail ?? "").trim().toLowerCase();
    const known =
      e.clientId != null ||
      (email !== "" && db.select({ id: leads.id }).from(leads).where(sql`lower(${leads.email}) = ${email}`).get() != null);
    if (!emailNotifies({ known, isRead: e.isRead, at: e.at ? e.at.getTime() : null, now })) return null;
    const subject = (e.subject ?? "").trim();
    const text = (e.snippet ?? "").trim();
    return notify({
      kind: "message",
      title: messageTitle("email", e.fromName || e.fromEmail),
      body: subject && text ? `${subject}: ${text}` : subject || text,
      href: emailThreadHref(e.threadKey),
      key: `email:${e.messageKey}`,
    });
  });
}

/** A lead was just created (upsertLead returned created: true). */
export function notifyNewLead(lead: { id: number; source: string | null; firstName: string | null; lastName: string | null; email: string | null; phone: string | null }, actor?: string | null): number | null {
  if (!leadNotifies(lead.source, actor)) return null;
  return safely(null, () =>
    notify({
      kind: "lead",
      title: `New lead: ${personName(lead.firstName, lead.lastName, lead.email || lead.phone || "no name yet")}`,
      body: leadSourceText(lead.source),
      href: `/leads/${lead.id}`,
      key: `lead:${lead.id}`,
    }),
  );
}

/** An online offer was paid for and this call won the claim. Admins only. */
export function notifyOfferSale(s: { orderId: number; title: string; cents: number; buyer: string; clientId: number }): number | null {
  return safely(null, () =>
    notify({
      kind: "sale",
      title: `Sale: ${s.title}, ${eurText(s.cents)}`,
      body: s.buyer,
      href: `/clients/${s.clientId}`,
      key: `sale:offer:${s.orderId}`,
    }),
  );
}

/** A gift voucher was paid for and this call won the claim. Admins only. */
export function notifyVoucherSale(s: { orderId: number; title: string; cents: number; buyer: string; code: string }): number | null {
  return safely(null, () =>
    notify({
      kind: "sale",
      title: `Sale: ${s.title}, ${eurText(s.cents)}`,
      body: s.buyer,
      href: `/vouchers/${encodeURIComponent(s.code)}`,
      key: `sale:voucher:${s.orderId}`,
    }),
  );
}

/** A member booked a class in the app. `key` makes a repeat of the same booking a no-op. */
export function notifyClassBooked(sessionId: number, clientId: number, key: string): number | null {
  return safely(null, () => {
    const s = db.select({ name: classSessions.name, date: classSessions.date, startTime: classSessions.startTime }).from(classSessions).where(eq(classSessions.id, sessionId)).get();
    const c = db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(eq(clients.id, clientId)).get();
    if (!s) return null;
    return notify({
      kind: "booking",
      title: `Class booked: ${personName(c?.firstName, c?.lastName, "A member")}`,
      body: classWhen(s.name, s.date, s.startTime),
      href: "/timetable",
      key,
    });
  });
}
