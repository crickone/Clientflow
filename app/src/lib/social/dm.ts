import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { socialContacts } from "@/lib/db/schema";
import { getCurrentTenant } from "@/lib/db/tenant";
import { GRAPH_BASE } from "@/lib/facebook/graph";
import { getPageTokenForTenant } from "@/lib/facebook/pages";
import type { MessagingEvent } from "@/lib/facebook/webhook";
import { addMessage, findLeadMessageByProviderId, setLeadStatus, upsertLead } from "@/lib/leads";
import { addClientMessage, findClientMessageByProviderId } from "@/lib/clientMessages";
import { logActivity } from "@/lib/queries";

/**
 * Facebook Messenger + Instagram DMs on the lead/client conversation threads.
 *
 * Inbound: the Meta webhook hands each message here (already inside the owning
 * tenant). The sender is matched to a social_contacts row, or becomes a new
 * lead, and the message is threaded exactly like an inbound WhatsApp.
 *
 * Outbound: Meta only lets a business REPLY. Within 24 hours of the customer's
 * last message any reply is allowed; up to 7 days a reply written by a person
 * may go out with the HUMAN_AGENT tag; after that the conversation is closed
 * until the customer writes again. AI auto-replies never use the human tag.
 */

export type DmChannel = "messenger" | "instagram";
type Owner = { ownerType: "lead" | "client"; ownerId: number };

const DAY = 24 * 60 * 60 * 1000;
export const STANDARD_WINDOW_MS = DAY;
export const HUMAN_AGENT_WINDOW_MS = 7 * DAY;

export type ReplyWindow = "open" | "human_only" | "closed";

/** Which reply Meta allows, given when the customer last wrote. Pure. */
export function replyWindow(lastInboundAt: number | null, now: number): ReplyWindow {
  if (!lastInboundAt) return "closed";
  const age = now - lastInboundAt;
  if (age <= STANDARD_WINDOW_MS) return "open";
  if (age <= HUMAN_AGENT_WINDOW_MS) return "human_only";
  return "closed";
}

const CHANNEL_LABEL: Record<DmChannel, string> = { messenger: "Messenger", instagram: "Instagram" };

async function fetchProfile(
  channel: DmChannel,
  customerId: string,
  pageToken: string,
): Promise<{ firstName?: string; lastName?: string; name?: string; username?: string }> {
  const fields = channel === "messenger" ? "first_name,last_name" : "name,username";
  try {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(customerId)}?` + new URLSearchParams({ fields, access_token: pageToken }));
    if (!res.ok) return {};
    const b = (await res.json()) as { first_name?: string; last_name?: string; name?: string; username?: string };
    return { firstName: b.first_name, lastName: b.last_name, name: b.name, username: b.username };
  } catch {
    return {};
  }
}

function findContact(channel: DmChannel, externalId: string, pageId: string) {
  return db
    .select()
    .from(socialContacts)
    .where(and(eq(socialContacts.channel, channel), eq(socialContacts.externalId, externalId), eq(socialContacts.pageId, pageId)))
    .get();
}

function storeMessage(owner: Owner, input: { direction: "inbound" | "outbound"; channel: DmChannel; content: string; providerMessageId: string; sentAt: Date; aiGenerated?: boolean }) {
  return owner.ownerType === "lead"
    ? addMessage({ leadId: owner.ownerId, ...input, status: input.direction === "outbound" ? "sent" : undefined })
    : addClientMessage({ clientId: owner.ownerId, ...input, status: input.direction === "outbound" ? "sent" : undefined });
}

export interface RecordedInbound extends Owner {
  messageId: number;
  created: boolean;
}

/**
 * File one webhook message on its conversation. Echoes (the business's own
 * sends) are recorded as outbound unless we already stored them when sending.
 * Returns the inbound row for triage, or null for an echo / duplicate.
 */
export async function recordDmEvent(ev: MessagingEvent, page: { pageId: string; pageAccessToken: string }): Promise<RecordedInbound | null> {
  if (findLeadMessageByProviderId(ev.messageId) || findClientMessageByProviderId(ev.messageId)) return null;

  let contact = findContact(ev.channel, ev.customerId, page.pageId);
  let created = false;
  if (!contact) {
    if (ev.isEcho) return null; // the business wrote first to someone we have never seen: nothing to thread under
    const profile = await fetchProfile(ev.channel, ev.customerId, page.pageAccessToken);
    const display = profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username || null;
    const { lead, created: isNew } = upsertLead({
      source: ev.channel,
      sourceLeadId: `${page.pageId}:${ev.customerId}`,
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.firstName ? undefined : profile.name,
      notes: `Started a conversation on ${CHANNEL_LABEL[ev.channel]}${profile.username ? ` (@${profile.username})` : ""}.`,
    });
    created = isNew;
    db.insert(socialContacts)
      .values({
        channel: ev.channel,
        externalId: ev.customerId,
        pageId: page.pageId,
        ownerType: "lead",
        ownerId: lead.id,
        name: display,
        username: profile.username ?? null,
      })
      .onConflictDoNothing()
      .run();
    contact = findContact(ev.channel, ev.customerId, page.pageId);
    if (!contact) return null;
  }

  const owner: Owner = { ownerType: contact.ownerType, ownerId: contact.ownerId };
  const sentAt = new Date(ev.timestamp);
  const stored = storeMessage(owner, {
    direction: ev.isEcho ? "outbound" : "inbound",
    channel: ev.channel,
    content: ev.text,
    providerMessageId: ev.messageId,
    sentAt,
  });
  if (ev.isEcho) return null;

  db.update(socialContacts).set({ lastInboundAt: sentAt }).where(eq(socialContacts.id, contact.id)).run();
  if (owner.ownerType === "lead") setLeadStatus(owner.ownerId, "replied");
  await logActivity(
    `${ev.channel}.inbound`,
    `${CHANNEL_LABEL[ev.channel]} message from ${contact.name ?? contact.username ?? "a new contact"}`,
    owner.ownerType === "lead" ? { leadId: owner.ownerId } : { clientId: owner.ownerId },
  );
  return { ...owner, messageId: stored.id, created };
}

export interface DmTarget {
  channel: DmChannel;
  externalId: string;
  pageId: string;
  window: ReplyWindow;
}

/** The DM conversation a reply to this lead/client would go to: the one they wrote on most recently. */
export function getDmTarget(ownerType: "lead" | "client", ownerId: number, now = Date.now()): DmTarget | null {
  const row = db
    .select()
    .from(socialContacts)
    .where(and(eq(socialContacts.ownerType, ownerType), eq(socialContacts.ownerId, ownerId)))
    .orderBy(desc(socialContacts.lastInboundAt))
    .get();
  if (!row) return null;
  return {
    channel: row.channel,
    externalId: row.externalId,
    pageId: row.pageId,
    window: replyWindow(row.lastInboundAt ? row.lastInboundAt.getTime() : null, now),
  };
}

export interface SendDmInput {
  subjectType: "lead" | "client";
  subjectId: number;
  text: string;
  /** An AI wrote it with no person in between (auto-reply). Never gets the 7-day human tag. */
  aiGenerated?: boolean;
}

/**
 * Reply on the contact's Messenger / Instagram conversation and record it.
 * Throws with a plain reason when Meta would refuse (window closed, Page
 * disconnected), so the caller keeps the draft.
 */
export async function sendDm(input: SendDmInput): Promise<{ messageId: number; providerMessageId: string; channel: DmChannel }> {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty.");
  const target = getDmTarget(input.subjectType, input.subjectId);
  if (!target) throw new Error("This contact has no Messenger or Instagram conversation.");
  const label = CHANNEL_LABEL[target.channel];
  if (target.window === "closed") {
    throw new Error(`${label} only allows replies within 7 days of the customer's last message. Wait for them to write again.`);
  }
  if (target.window === "human_only" && input.aiGenerated) {
    throw new Error(`It is more than 24 hours since the customer's last ${label} message, so only a reply written by a person can be sent.`);
  }
  const token = getPageTokenForTenant(getCurrentTenant().id, target.pageId);
  if (!token) throw new Error("The Facebook Page for this conversation is no longer connected.");

  const body: Record<string, unknown> = {
    recipient: { id: target.externalId },
    message: { text },
    ...(target.window === "open" ? { messaging_type: "RESPONSE" } : { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }),
  };
  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(target.pageId)}/messages?` + new URLSearchParams({ access_token: token }), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
  if (!res.ok || !json.message_id) throw new Error(json.error?.message || `${label} send failed (${res.status}).`);

  const stored = storeMessage(
    { ownerType: input.subjectType, ownerId: input.subjectId },
    { direction: "outbound", channel: target.channel, content: text, providerMessageId: json.message_id, sentAt: new Date(), aiGenerated: input.aiGenerated },
  );
  await logActivity(`${target.channel}.sent`, `${label} reply sent`, input.subjectType === "lead" ? { leadId: input.subjectId } : { clientId: input.subjectId });
  return { messageId: stored.id, providerMessageId: json.message_id, channel: target.channel };
}
