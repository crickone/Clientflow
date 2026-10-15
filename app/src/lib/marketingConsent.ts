import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientConsents, contacts, suppressions } from "@/lib/db/schema";
import { suppress } from "@/lib/marketing/suppress";
import { consentStatement, currentConsent, type ConsentChannel } from "@/lib/memberChoicesModel";

/**
 * A member's yes or no to news and offers, for the CURRENT tenant (ambient
 * `db`). Optional, never a condition of using the app. A yes to email puts
 * the member on Email campaigns > Contacts (tagged "members"); a no
 * unsubscribes them there, the same as the unsubscribe link in an email.
 */

export interface MemberConsent {
  granted: boolean;
  at: number | null;
  source: string | null;
}

function suppressionReason(email: string | null): string | null {
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return null;
  return db.select({ reason: suppressions.reason }).from(suppressions).where(sql`lower(${suppressions.email}) = ${clean}`).get()?.reason ?? null;
}

/** The member's current answers. An email unsubscribe link counts as a no, whatever they ticked before. */
export function consentsFor(clientId: number, email: string | null): Record<ConsentChannel, MemberConsent | null> {
  const rows = db.select().from(clientConsents).where(eq(clientConsents.clientId, clientId)).all();
  const cur = currentConsent(rows.map((r) => ({ channel: r.channel, granted: r.granted, at: r.at })));
  const source = (ch: ConsentChannel, at: number) => rows.find((r) => r.channel === ch && r.at === at)?.source ?? null;
  const out: Record<ConsentChannel, MemberConsent | null> = { email: null, sms: null };
  for (const ch of ["email", "sms"] as ConsentChannel[]) {
    const c = cur[ch];
    if (c) out[ch] = { granted: c.granted, at: c.at, source: source(ch, c.at) };
  }
  if (out.email?.granted && suppressionReason(email)) out.email = { granted: false, at: out.email.at, source: "unsubscribe" };
  return out;
}

export function recordConsent(
  tenantId: number,
  client: { id: number; email: string | null; firstName: string; lastName: string; phone: string },
  businessName: string,
  channel: ConsentChannel,
  granted: boolean,
  source: "welcome" | "profile" | "staff" | "unsubscribe",
  meta: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null },
): { ok: true; note?: string } {
  db.insert(clientConsents)
    .values({
      clientId: client.id,
      channel,
      granted,
      statement: consentStatement(channel, businessName),
      source,
      at: Date.now(),
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .run();
  if (channel !== "email") return { ok: true };

  const email = (client.email ?? "").trim().toLowerCase();
  if (!email) return { ok: true, note: "Saved. Add an email address to your details to get emails." };
  if (!granted) {
    suppress(tenantId, email, "unsubscribe");
    return { ok: true };
  }
  // A fresh yes lifts an earlier unsubscribe, but never a bounce or a complaint.
  const reason = suppressionReason(email);
  if (reason === "bounce" || reason === "complaint") return { ok: true, note: "Saved, but emails to this address have bounced. Check your email address with the gym." };
  if (reason) db.delete(suppressions).where(sql`lower(${suppressions.email}) = ${email}`).run();

  const name = `${client.firstName} ${client.lastName}`.trim();
  const existing = db.select().from(contacts).where(sql`lower(${contacts.email}) = ${email}`).get();
  if (existing) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(existing.tags ?? "[]") as string[];
    } catch {
      tags = [];
    }
    if (!tags.includes("members")) tags.push("members");
    db.update(contacts)
      .set({ status: "subscribed", subscribedAt: new Date(), unsubscribedAt: null, tags: JSON.stringify(tags), name: existing.name || name, phone: existing.phone || client.phone, updatedAt: new Date() })
      .where(and(eq(contacts.id, existing.id)))
      .run();
  } else {
    db.insert(contacts)
      .values({ email, name, phone: client.phone, tags: JSON.stringify(["members"]), status: "subscribed", source: "app", subscribedAt: new Date() })
      .run();
  }
  return { ok: true };
}
