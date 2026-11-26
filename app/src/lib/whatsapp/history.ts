import "server-only";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";
import { normalizePhone } from "./phone";
import { missingMessages, type ChatMessage } from "./historyModel";
import { findClientByPhone } from "@/lib/clientMessages";
import { findLeadByPhone } from "@/lib/leads";

/**
 * The whole WhatsApp conversation on a lead or a client, not only what went
 * through Adonis: messages typed on the business's phone, templates an
 * earlier tool (GoHighLevel) sent from the same number, and replies that
 * arrived before the person had a record here. Read from the provider's copy
 * of the chat and stored as lead or client messages, once each (matched by
 * the provider's message id).
 *
 * Nothing here sends, alerts, scores, moves a card or wakes a flow: it only
 * fills in the record. Runs in the ambient tenant.
 */

export type HistoryOwner = { type: "lead" | "client"; id: number };

const SYNC_EVERY_MS = 5 * 60_000;
const HISTORY_COUNT = 200;
const TIMEOUT_MS = 8_000;
const lastSync = new Map<string, number>();

/** Provider ids this record already has, in any form (its messages, flow sends, broadcasts). */
function knownIds(owner: HistoryOwner, ids: string[]): Set<string> {
  if (ids.length === 0) return new Set();
  const known = new Set<string>();
  const add = (rows: Array<{ id: string | null }>) => rows.forEach((r) => r.id && known.add(r.id));
  if (owner.type === "lead") {
    add(
      db
        .select({ id: schema.leadMessages.providerMessageId })
        .from(schema.leadMessages)
        .where(and(eq(schema.leadMessages.leadId, owner.id), inArray(schema.leadMessages.providerMessageId, ids)))
        .all(),
    );
  } else {
    add(
      db
        .select({ id: schema.clientMessages.providerMessageId })
        .from(schema.clientMessages)
        .where(and(eq(schema.clientMessages.clientId, owner.id), inArray(schema.clientMessages.providerMessageId, ids)))
        .all(),
    );
  }
  add(db.select({ id: schema.automationQueue.providerMessageId }).from(schema.automationQueue).where(inArray(schema.automationQueue.providerMessageId, ids)).all());
  add(db.select({ id: schema.whatsappBroadcastSends.providerMessageId }).from(schema.whatsappBroadcastSends).where(inArray(schema.whatsappBroadcastSends.providerMessageId, ids)).all());
  return known;
}

function insertHistory(owner: HistoryOwner, msgs: ChatMessage[]): number {
  let added = 0;
  db.transaction((tx) => {
    for (const m of msgs) {
      const row = {
        direction: m.fromMe ? ("outbound" as const) : ("inbound" as const),
        channel: "whatsapp" as const,
        content: m.text,
        aiGenerated: false,
        providerMessageId: m.id,
        status: m.fromMe ? ("sent" as const) : null,
        sentAt: new Date(m.at),
        createdAt: new Date(m.at),
        // Through the API but not on our record: still not something this page sent.
        origin: m.fromMe ? "phone" : null,
      };
      if (owner.type === "lead") tx.insert(schema.leadMessages).values({ leadId: owner.id, ...row }).run();
      else tx.insert(schema.clientMessages).values({ clientId: owner.id, ...row }).run();
      added++;
    }
  });
  return added;
}

function ownerPhone(owner: HistoryOwner): string | null {
  const row =
    owner.type === "lead"
      ? db.select({ phone: schema.leads.phone }).from(schema.leads).where(eq(schema.leads.id, owner.id)).get()
      : db.select({ phone: schema.clients.phone }).from(schema.clients).where(eq(schema.clients.id, owner.id)).get();
  if (!row) return null;
  return normalizePhone(row.phone) || "";
}

/**
 * Bring a lead's or client's WhatsApp chat up to date from the provider. At
 * most once every five minutes per record unless forced; fails soft with a reason.
 */
export async function syncWhatsAppHistory(owner: HistoryOwner, opts: { force?: boolean } = {}): Promise<{ added: number } | { skipped: string }> {
  const phone = ownerPhone(owner);
  if (phone === null) return { skipped: owner.type === "lead" ? "No such lead." : "No such client." };
  if (!phone) return { skipped: "No phone number." };
  if (!isWhatsAppConfigured()) return { skipped: "WhatsApp is not connected." };
  const bridge = getWhatsAppBridge();
  if (!bridge.listChat) return { skipped: "This WhatsApp connection has no history." };

  const key = `${getCurrentTenant()?.id ?? 0}:${owner.type}:${owner.id}`;
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
  const missing = missingMessages(history, knownIds(owner, history.map((m) => m.id)));
  if (missing.length === 0) return { added: 0 };
  return { added: insertHistory(owner, missing) };
}

export const syncLeadWhatsApp = (leadId: number, opts: { force?: boolean } = {}) => syncWhatsAppHistory({ type: "lead", id: leadId }, opts);
export const syncClientWhatsApp = (clientId: number, opts: { force?: boolean } = {}) => syncWhatsAppHistory({ type: "client", id: clientId }, opts);

/** Whose record a WhatsApp number's messages go on: the client, else the lead (as the webhook threads them). */
export function historyOwnerForPhone(phone: string): HistoryOwner | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const client = findClientByPhone(normalized);
  if (client) return { type: "client", id: client.id };
  const lead = findLeadByPhone(normalized);
  return lead ? { type: "lead", id: lead.id } : null;
}

const backfilling = new Set<number>();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fill in every chat the records are behind on: for each WhatsApp contact
 * (lib/whatsapp/contactsSync) whose chat has moved since the newest WhatsApp
 * message on its client's or lead's record, read the chat in. One chat at a
 * time, gently. Runs after each contacts import. Returns what it did.
 */
export async function backfillWhatsAppHistory(opts: { gapMs?: number } = {}): Promise<{ checked: number; added: number; records: number }> {
  const tenantId = getCurrentTenant()?.id ?? 0;
  if (backfilling.has(tenantId) || !isWhatsAppConfigured()) return { checked: 0, added: 0, records: 0 };
  backfilling.add(tenantId);
  try {
    const chats = db
      .select({ phone: schema.whatsappContacts.phone, lastChatAt: schema.whatsappContacts.lastChatAt })
      .from(schema.whatsappContacts)
      .where(isNotNull(schema.whatsappContacts.lastChatAt))
      .orderBy(desc(schema.whatsappContacts.lastChatAt))
      .all();
    const leadLast = new Map(
      db
        .select({ id: schema.leadMessages.leadId, at: sql<number>`max(${schema.leadMessages.createdAt})` })
        .from(schema.leadMessages)
        .where(eq(schema.leadMessages.channel, "whatsapp"))
        .groupBy(schema.leadMessages.leadId)
        .all()
        .map((r) => [r.id, Number(r.at)]),
    );
    const clientLast = new Map(
      db
        .select({ id: schema.clientMessages.clientId, at: sql<number>`max(${schema.clientMessages.createdAt})` })
        .from(schema.clientMessages)
        .where(eq(schema.clientMessages.channel, "whatsapp"))
        .groupBy(schema.clientMessages.clientId)
        .all()
        .map((r) => [r.id, Number(r.at)]),
    );
    let checked = 0;
    let added = 0;
    let records = 0;
    for (const chat of chats) {
      const owner = historyOwnerForPhone(chat.phone);
      if (!owner) continue;
      const last = (owner.type === "lead" ? leadLast : clientLast).get(owner.id) ?? 0;
      if ((chat.lastChatAt ?? 0) <= last + 60_000) continue;
      checked++;
      const r = await syncWhatsAppHistory(owner, { force: true });
      if ("added" in r && r.added > 0) {
        added += r.added;
        records++;
      }
      await pause(opts.gapMs ?? 300);
    }
    return { checked, added, records };
  } finally {
    backfilling.delete(tenantId);
  }
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
    const owner = historyOwnerForPhone(m.toPhoneDigits);
    if (!owner) continue;
    if (knownIds(owner, [m.id]).size > 0) continue;
    recorded += insertHistory(owner, [m]);
  }
  return recorded;
}
