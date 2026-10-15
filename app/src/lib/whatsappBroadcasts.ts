import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientConsents, clientMemberships, clients, whatsappBroadcastSends, whatsappBroadcasts } from "@/lib/db/schema";
import { addClientMessage } from "@/lib/clientMessages";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";
import { inSendingHours, PER_TICK, renderBroadcast } from "@/lib/whatsappBroadcastModel";

/**
 * WhatsApp broadcasts for the CURRENT tenant (ambient `db`; the ticker binds
 * it with runWithTenant). Only members whose latest answer to "Text or
 * WhatsApp me news and offers" is yes, with a phone number, ever get one.
 * The list is fixed when the broadcast is sent; each message re-checks the
 * member's answer, so a STOP between send and delivery is honoured.
 */

export type Broadcast = typeof whatsappBroadcasts.$inferSelect;
export type Audience = "everyone" | "active";

export const AUDIENCE_LABEL: Record<Audience, string> = {
  everyone: "Everyone who said yes to WhatsApp",
  active: "Only those with an active membership",
};

/** Members whose latest WhatsApp answer is yes. */
function optedInIds(): Set<number> {
  const rows = db
    .select({ clientId: clientConsents.clientId, granted: clientConsents.granted, at: clientConsents.at })
    .from(clientConsents)
    .where(eq(clientConsents.channel, "sms"))
    .orderBy(asc(clientConsents.at), asc(clientConsents.id))
    .all();
  const latest = new Map<number, boolean>();
  for (const r of rows) latest.set(r.clientId, r.granted);
  return new Set([...latest].filter(([, g]) => g).map(([id]) => id));
}

export function isOptedIn(clientId: number): boolean {
  const r = db
    .select({ granted: clientConsents.granted })
    .from(clientConsents)
    .where(and(eq(clientConsents.clientId, clientId), eq(clientConsents.channel, "sms")))
    .orderBy(desc(clientConsents.at), desc(clientConsents.id))
    .get();
  return r?.granted === true;
}

export function audienceFor(kind: Audience): { id: number; firstName: string; lastName: string; phone: string }[] {
  const ids = [...optedInIds()];
  if (ids.length === 0) return [];
  let people = db
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName, phone: clients.phone })
    .from(clients)
    .where(inArray(clients.id, ids))
    .all()
    .filter((c) => (c.phone ?? "").replace(/\D/g, "").length >= 7);
  if (kind === "active") {
    const active = new Set(
      db.select({ clientId: clientMemberships.clientId }).from(clientMemberships).where(eq(clientMemberships.status, "active")).all().map((r) => r.clientId),
    );
    people = people.filter((p) => active.has(p.id));
  }
  return people.sort((a, b) => a.firstName.localeCompare(b.firstName));
}

export function audienceCounts(): Record<Audience, number> {
  return { everyone: audienceFor("everyone").length, active: audienceFor("active").length };
}

export interface BroadcastRow extends Broadcast {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  queued: number;
}

function withCounts(b: Broadcast): BroadcastRow {
  const counts = db
    .select({ status: whatsappBroadcastSends.status, n: sql<number>`count(*)` })
    .from(whatsappBroadcastSends)
    .where(eq(whatsappBroadcastSends.broadcastId, b.id))
    .groupBy(whatsappBroadcastSends.status)
    .all();
  const c = (s: string) => Number(counts.find((x) => x.status === s)?.n ?? 0);
  const out = { ...b, sent: c("sent"), failed: c("failed"), skipped: c("skipped"), queued: c("queued") + c("sending"), total: 0 };
  out.total = out.sent + out.failed + out.skipped + out.queued;
  return out;
}

export function listBroadcasts(): BroadcastRow[] {
  return db.select().from(whatsappBroadcasts).orderBy(desc(whatsappBroadcasts.createdAt)).all().map(withCounts);
}

export function getBroadcast(id: number): BroadcastRow | null {
  const b = db.select().from(whatsappBroadcasts).where(eq(whatsappBroadcasts.id, id)).get();
  return b ? withCounts(b) : null;
}

export function broadcastRecipients(id: number) {
  return db
    .select({
      id: whatsappBroadcastSends.id,
      status: whatsappBroadcastSends.status,
      error: whatsappBroadcastSends.error,
      sentAt: whatsappBroadcastSends.sentAt,
      clientId: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(whatsappBroadcastSends)
    .innerJoin(clients, eq(clients.id, whatsappBroadcastSends.clientId))
    .where(eq(whatsappBroadcastSends.broadcastId, id))
    .orderBy(asc(clients.firstName))
    .all();
}

export function createBroadcast(name: string): number {
  const [row] = db
    .insert(whatsappBroadcasts)
    .values({ name: name.trim().slice(0, 120) || "WhatsApp broadcast", createdAt: Date.now() })
    .returning({ id: whatsappBroadcasts.id })
    .all();
  return row.id;
}

export function saveDraft(id: number, patch: { name: string; message: string; audience: Audience }): boolean {
  return (
    db
      .update(whatsappBroadcasts)
      .set({ name: patch.name.trim().slice(0, 120) || "WhatsApp broadcast", message: patch.message.slice(0, 1200), audience: patch.audience })
      .where(and(eq(whatsappBroadcasts.id, id), eq(whatsappBroadcasts.status, "draft")))
      .run().changes > 0
  );
}

export function deleteBroadcast(id: number): boolean {
  return db.delete(whatsappBroadcasts).where(and(eq(whatsappBroadcasts.id, id), eq(whatsappBroadcasts.status, "draft"))).run().changes > 0;
}

/** Fix the list and start sending now (or at `sendAt`). The ticker does the sending. */
export function launchBroadcast(id: number, sendAt: number | null): { ok: true; count: number } | { ok: false; error: string } {
  const b = db.select().from(whatsappBroadcasts).where(eq(whatsappBroadcasts.id, id)).get();
  if (!b || b.status !== "draft") return { ok: false, error: "This broadcast has already been sent." };
  const people = audienceFor(b.audience);
  if (people.length === 0) return { ok: false, error: "Nobody in this audience has said yes to WhatsApp messages yet." };
  const now = Date.now();
  db.transaction((tx) => {
    tx.insert(whatsappBroadcastSends)
      .values(people.map((p) => ({ broadcastId: id, clientId: p.id, status: "queued" as const })))
      .run();
    tx.update(whatsappBroadcasts)
      .set({ status: sendAt && sendAt > now ? "scheduled" : "sending", sendAt: sendAt && sendAt > now ? sendAt : now, startedAt: sendAt && sendAt > now ? null : now })
      .where(eq(whatsappBroadcasts.id, id))
      .run();
  });
  return { ok: true, count: people.length };
}

/** Stop a broadcast: whatever hasn't gone yet won't. */
export function cancelBroadcast(id: number): boolean {
  const b = db.select().from(whatsappBroadcasts).where(eq(whatsappBroadcasts.id, id)).get();
  if (!b || (b.status !== "scheduled" && b.status !== "sending")) return false;
  db.update(whatsappBroadcastSends)
    .set({ status: "skipped", error: "Broadcast stopped" })
    .where(and(eq(whatsappBroadcastSends.broadcastId, id), eq(whatsappBroadcastSends.status, "queued")))
    .run();
  db.update(whatsappBroadcasts).set({ status: "cancelled", finishedAt: Date.now() }).where(eq(whatsappBroadcasts.id, id)).run();
  return true;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The ticker's step, once a minute per business: send the next few queued
 * messages, inside Irish daytime hours, through the business's WhatsApp.
 * Returns how many went.
 */
export async function dispatchDueBroadcasts(tenantId: number, now = Date.now()): Promise<number> {
  const due = db
    .select()
    .from(whatsappBroadcasts)
    .where(inArray(whatsappBroadcasts.status, ["scheduled", "sending"]))
    .orderBy(asc(whatsappBroadcasts.sendAt))
    .all()
    .filter((b) => (b.sendAt ?? 0) <= now);
  if (due.length === 0) return 0;
  if (!inSendingHours(now) || !isWhatsAppConfigured()) return 0;

  for (const b of due) {
    if (b.status === "scheduled") db.update(whatsappBroadcasts).set({ status: "sending", startedAt: now }).where(eq(whatsappBroadcasts.id, b.id)).run();
  }

  // The ticker has no request, so the business is named explicitly.
  const business = getBusinessProfileForTenant(tenantId).businessName;
  const bridge = getWhatsAppBridge();
  let sent = 0;
  for (const b of due) {
    const queued = db
      .select({ id: whatsappBroadcastSends.id, clientId: whatsappBroadcastSends.clientId })
      .from(whatsappBroadcastSends)
      .where(and(eq(whatsappBroadcastSends.broadcastId, b.id), eq(whatsappBroadcastSends.status, "queued")))
      .orderBy(asc(whatsappBroadcastSends.id))
      .limit(PER_TICK - sent)
      .all();
    for (const q of queued) {
      // Claim the row before anything else: two ticker passes (a slow tick,
      // or a second copy of the module in dev) must never send it twice.
      const claimed = db
        .update(whatsappBroadcastSends)
        .set({ status: "sending" })
        .where(and(eq(whatsappBroadcastSends.id, q.id), eq(whatsappBroadcastSends.status, "queued")))
        .run().changes;
      if (claimed === 0) continue;
      const c = db.select().from(clients).where(eq(clients.id, q.clientId)).get();
      if (!c || !isOptedIn(q.clientId) || !c.phone) {
        db.update(whatsappBroadcastSends).set({ status: "skipped", error: !c?.phone ? "No phone number" : "Said no to WhatsApp messages" }).where(eq(whatsappBroadcastSends.id, q.id)).run();
        continue;
      }
      const text = renderBroadcast(b.message, c, business);
      try {
        if (sent > 0) await pause(2000 + Math.floor(Math.random() * 2000));
        const { providerMessageId } = await bridge.sendText(c.phone, text);
        db.update(whatsappBroadcastSends).set({ status: "sent", providerMessageId, sentAt: Date.now() }).where(eq(whatsappBroadcastSends.id, q.id)).run();
        addClientMessage({ clientId: c.id, direction: "outbound", channel: "whatsapp", content: text, providerMessageId, status: "sent", sentAt: new Date() });
        sent++;
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 300) : "Send failed";
        db.update(whatsappBroadcastSends).set({ status: "failed", error: msg }).where(eq(whatsappBroadcastSends.id, q.id)).run();
        // A dropped connection fails every message the same way: stop and try next minute.
        if (/not connected|unauthori[sz]ed|401|403|disconnected/i.test(msg)) {
          db.update(whatsappBroadcastSends).set({ status: "queued", error: null }).where(eq(whatsappBroadcastSends.id, q.id)).run();
          return sent;
        }
      }
    }
    const left = db
      .select({ n: sql<number>`count(*)` })
      .from(whatsappBroadcastSends)
      .where(and(eq(whatsappBroadcastSends.broadcastId, b.id), inArray(whatsappBroadcastSends.status, ["queued", "sending"])))
      .get();
    if (Number(left?.n ?? 0) === 0) db.update(whatsappBroadcasts).set({ status: "sent", finishedAt: Date.now() }).where(eq(whatsappBroadcasts.id, b.id)).run();
    if (sent >= PER_TICK) break;
  }
  return sent;
}
