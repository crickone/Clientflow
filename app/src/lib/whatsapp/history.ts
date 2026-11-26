import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";
import { normalizePhone } from "./phone";
import { missingMessages, type ChatMessage } from "./historyModel";
import { findClientByPhone } from "@/lib/clientMessages";
import { findLeadByPhone } from "@/lib/leads";

/**
 * The whole WhatsApp conversation on a lead, not only what went through
 * Adonis: messages typed on the business's phone, templates an earlier tool
 * (GoHighLevel) sent from the same number, and replies that arrived before
 * the webhook worked. Read from the provider's copy of the chat and stored
 * as lead messages, once each (matched by the provider's message id).
 *
 * Nothing here sends, alerts, scores, moves a card or wakes a flow: it only
 * fills in the record. Runs in the ambient tenant.
 */

const SYNC_EVERY_MS = 5 * 60_000;
const HISTORY_COUNT = 200;
const TIMEOUT_MS = 8_000;
const lastSync = new Map<string, number>();

/** Provider ids this lead's record already has, in any form (its messages, flow sends, broadcasts). */
function knownIds(leadId: number, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const known = new Set<string>();
  const add = (rows: Array<{ id: string | null }>) => rows.forEach((r) => r.id && known.add(r.id));
  add(
    db
      .select({ id: schema.leadMessages.providerMessageId })
      .from(schema.leadMessages)
      .where(and(eq(schema.leadMessages.leadId, leadId), inArray(schema.leadMessages.providerMessageId, ids)))
      .all(),
  );
  add(db.select({ id: schema.automationQueue.providerMessageId }).from(schema.automationQueue).where(inArray(schema.automationQueue.providerMessageId, ids)).all());
  add(db.select({ id: schema.whatsappBroadcastSends.providerMessageId }).from(schema.whatsappBroadcastSends).where(inArray(schema.whatsappBroadcastSends.providerMessageId, ids)).all());
  return known;
}

function insertLeadHistory(leadId: number, msgs: ChatMessage[]): number {
  let added = 0;
  db.transaction((tx) => {
    for (const m of msgs) {
      tx.insert(schema.leadMessages)
        .values({
          leadId,
          direction: m.fromMe ? "outbound" : "inbound",
          channel: "whatsapp",
          content: m.text,
          aiGenerated: false,
          providerMessageId: m.id,
          status: m.fromMe ? "sent" : null,
          sentAt: new Date(m.at),
          createdAt: new Date(m.at),
          // Through the API but not on our record: still not something this page sent.
          origin: m.fromMe ? "phone" : null,
        })
        .run();
      added++;
    }
  });
  return added;
}

/**
 * Bring a lead's WhatsApp chat up to date from the provider. At most once
 * every five minutes per lead; fails soft with a reason.
 */
export async function syncLeadWhatsApp(leadId: number, opts: { force?: boolean } = {}): Promise<{ added: number } | { skipped: string }> {
  const lead = db.select({ id: schema.leads.id, phone: schema.leads.phone }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { skipped: "No such lead." };
  const phone = normalizePhone(lead.phone);
  if (!phone) return { skipped: "No phone number." };
  if (!isWhatsAppConfigured()) return { skipped: "WhatsApp is not connected." };
  const bridge = getWhatsAppBridge();
  if (!bridge.listChat) return { skipped: "This WhatsApp connection has no history." };

  const key = `${getCurrentTenant()?.id ?? 0}:${leadId}`;
  const now = Date.now();
  if (!opts.force && now - (lastSync.get(key) ?? 0) < SYNC_EVERY_MS) return { skipped: "Checked a moment ago." };
  lastSync.set(key, now);

  let history: ChatMessage[];
  try {
    history = await Promise.race([
      bridge.listChat(phone, HISTORY_COUNT),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WhatsApp took too long to answer.")), TIMEOUT_MS)),
    ]);
  } catch (err) {
    lastSync.delete(key);
    return { skipped: err instanceof Error ? err.message : "WhatsApp history failed." };
  }
  const missing = missingMessages(history, knownIds(leadId, history.map((m) => m.id)));
  if (missing.length === 0) return { added: 0 };
  return { added: insertLeadHistory(leadId, missing) };
}

/**
 * Messages the business sent from its own WhatsApp (the phone, WhatsApp Web,
 * another tool), reported by the webhook: put each on the client's or lead's
 * record so the conversation is whole. Unknown numbers are left alone: an
 * outbound message never makes a lead.
 */
export function recordPhoneSent(msgs: Array<ChatMessage & { toPhoneDigits: string }>): number {
  let recorded = 0;
  for (const m of msgs) {
    const phone = normalizePhone(m.toPhoneDigits);
    const lead = findLeadByPhone(phone);
    const client = lead ? undefined : findClientByPhone(phone);
    if (lead) {
      if (knownIds(lead.id, [m.id]).size > 0) continue;
      recorded += insertLeadHistory(lead.id, [m]);
    } else if (client) {
      const seen = db
        .select({ id: schema.clientMessages.id })
        .from(schema.clientMessages)
        .where(and(eq(schema.clientMessages.clientId, client.id), eq(schema.clientMessages.providerMessageId, m.id)))
        .get();
      if (seen) continue;
      db.insert(schema.clientMessages)
        .values({
          clientId: client.id,
          direction: "outbound",
          channel: "whatsapp",
          content: m.text,
          aiGenerated: false,
          providerMessageId: m.id,
          status: "sent",
          sentAt: new Date(m.at),
          createdAt: new Date(m.at),
          origin: "phone",
        })
        .run();
      recorded++;
    }
  }
  return recorded;
}
