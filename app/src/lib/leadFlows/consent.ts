import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { runWithTenant, type TenantDb } from "@/lib/db/tenant";
import { KEEP_ON_REPLY } from "@/lib/automationModel";
import type { SuppressionReason } from "@/lib/marketing/suppress";
import { createUnsubscribeToken } from "@/lib/marketing/unsubscribeToken";
import { isStopReply } from "@/lib/whatsappBroadcastModel";

import { flowNow } from "./clock";
import type { ConsentSource } from "./consentModel";
import { NURTURE_FLOW, PENDING_STATUSES } from "./flowModel";
import { stopFlows } from "./runs";

/**
 * A lead's yes or no to marketing (news and offers). Only Long-term nurture
 * checks it. A yes puts the address on Email campaigns > Contacts, tagged
 * "leads", so the lead keeps getting the normal campaigns after nurture ends
 * and the signed unsubscribe link has a contact to point at.
 */

function clean(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function suppressionReason(conn: TenantDb, email: string): string | null {
  return conn.select({ reason: schema.suppressions.reason }).from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean(email)}`).get()?.reason ?? null;
}

/** The marketing contact for an address, created subscribed and tagged "leads" when missing. */
export function ensureLeadContact(conn: TenantDb, lead: { email: string; firstName: string | null; lastName: string | null; phone: string | null }): number {
  const email = clean(lead.email);
  const found = conn.select({ id: schema.contacts.id, tags: schema.contacts.tags }).from(schema.contacts).where(sql`lower(${schema.contacts.email}) = ${email}`).get();
  if (found) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(found.tags ?? "[]") as string[];
    } catch {
      tags = [];
    }
    if (!tags.includes("leads")) conn.update(schema.contacts).set({ tags: JSON.stringify([...tags, "leads"]), updatedAt: new Date() }).where(eq(schema.contacts.id, found.id)).run();
    return found.id;
  }
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || null;
  return conn
    .insert(schema.contacts)
    .values({ email, name, phone: lead.phone, tags: JSON.stringify(["leads"]), status: "subscribed", source: "lead", subscribedAt: new Date() })
    .returning({ id: schema.contacts.id })
    .get().id;
}

/** The signed unsubscribe link for a lead's address. Throws when EMAIL_TOKEN_SECRET is not set. */
export function unsubscribeUrl(conn: TenantDb, tenantId: number, baseUrl: string, lead: { email: string; firstName: string | null; lastName: string | null; phone: string | null }): string {
  const contactId = ensureLeadContact(conn, lead);
  return `${baseUrl}/u/${createUnsubscribeToken(tenantId, contactId)}`;
}

/**
 * Record a yes or a no, for the ambient tenant. A staff tick never overrides the
 * person's own unsubscribe. A fresh yes on a form or the API lifts an earlier
 * "unsubscribe" suppression unless `liftUnsubscribe` is false (a replayed post
 * of an existing lead must not undo the person's unsubscribe). A "manual"
 * suppression (an operator's do-not-email) is never lifted by any source.
 */
export function setLeadMarketingConsent(
  leadId: number,
  granted: boolean,
  source: ConsentSource,
  options: { liftUnsubscribe?: boolean } = {},
): { ok: true } | { ok: false; error: string } {
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!granted) {
    db.update(schema.leads).set({ marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, leadId)).run();
    stopFlows(leadId, "marketing consent withdrawn", { only: [NURTURE_FLOW] });
    return { ok: true };
  }
  if (lead.email) {
    const reason = suppressionReason(db, lead.email);
    if (reason === "manual") {
      return { ok: false, error: "This address is on your do-not-email list. Remove it there first." };
    }
    if (reason === "unsubscribe") {
      if (source === "staff") {
        return { ok: false, error: "This address unsubscribed from emails. They need to agree again themselves, on a form or in a message." };
      }
      if (options.liftUnsubscribe === false) {
        return { ok: false, error: "This address unsubscribed from emails. A repeated submission does not undo that." };
      }
      // A fresh yes from the person lifts their earlier unsubscribe (never a bounce or a complaint).
      db.delete(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean(lead.email)}`).run();
      db.update(schema.contacts)
        .set({ status: "subscribed", subscribedAt: new Date(), unsubscribedAt: null, updatedAt: new Date() })
        .where(sql`lower(${schema.contacts.email}) = ${clean(lead.email)}`)
        .run();
    }
  }
  db.update(schema.leads).set({ marketingConsentAt: flowNow(), marketingConsentSource: source }).where(eq(schema.leads.id, leadId)).run();
  if (lead.email) ensureLeadContact(db, { email: lead.email, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone });
  return { ok: true };
}

/**
 * A lead replied "STOP" (or another opt-out word) on WhatsApp: marketing
 * consent is withdrawn, so Long-term nurture stops and never starts. Ambient
 * tenant. Fail-soft; returns true when consent was withdrawn.
 */
export function withdrawConsentOnStopReply(leadId: number, text: string): boolean {
  if (!isStopReply(text)) return false;
  try {
    return setLeadMarketingConsent(leadId, false, "api").ok;
  } catch (err) {
    console.error(`[lead flows] consent for lead #${leadId} not withdrawn:`, err);
    return false;
  }
}

/**
 * An address was suppressed (lib/marketing/suppress.ts): nothing more is
 * mailed to it by any flow. An unsubscribe, complaint or manual suppression
 * also clears the lead's consent and stops their flows (a booked call's
 * messages carry on). A bounce only stops the emails.
 */
export function onEmailSuppressed(tenantId: number, email: string, reason: SuppressionReason): void {
  const address = clean(email);
  if (!address) return;
  runWithTenant(tenantId, () => {
    db.update(schema.automationQueue)
      .set({ status: "cancelled", error: reason === "bounce" ? "Not sent: emails to this address bounced." : "Not sent: this address unsubscribed." })
      .where(and(inArray(schema.automationQueue.status, [...PENDING_STATUSES]), eq(schema.automationQueue.channel, "email"), sql`lower(${schema.automationQueue.sendTo}) = ${address}`))
      .run();
    if (reason === "bounce") return;
    const leads = db.select({ id: schema.leads.id }).from(schema.leads).where(sql`lower(${schema.leads.email}) = ${address}`).all();
    for (const l of leads) {
      db.update(schema.leads).set({ marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, l.id)).run();
      stopFlows(l.id, "unsubscribed", { except: KEEP_ON_REPLY });
    }
  });
}
