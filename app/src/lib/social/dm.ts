import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { socialContacts } from "@/lib/db/schema";
import { boundTenantId, getCurrentTenant } from "@/lib/db/tenant";
import { ingestMessageMediaLater } from "@/lib/inbox/media";
import { mediaPlaceholder, nameFromUrl, type MessageMedia } from "@/lib/inbox/mediaModel";
import { attachmentLabel, checkOutgoingSet, type OutgoingFile } from "@/lib/attachments/outgoingModel";
import { publicFileUrl } from "@/lib/attachments/publicLink";
import { getAppBaseUrl } from "@/lib/appUrl";
import { GRAPH_BASE, metaApiError } from "@/lib/facebook/graph";
import { notePageRefusal } from "@/lib/facebook/health";
import { getPageTokenForTenant } from "@/lib/facebook/pages";
import type { MessagingEvent } from "@/lib/facebook/webhook";
import { addMessage, addToPipeline, fillLeadContact, findLeadMessageByProviderId, setLeadStatus, upsertLead } from "@/lib/leads";
import { hasFormDetails, parseFormDetails } from "./formDetails";
import { participantName } from "./participant";
import { addClientMessage, findClientMessageByProviderId } from "@/lib/clientMessages";
import { splitFullName } from "@/lib/humanName";
import { logActivity } from "@/lib/queries";
import { notifyInboundMessage } from "@/lib/notifications/notify";

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

/**
 * Replying between 24 hours and 7 days needs Meta's Human Agent permission,
 * which an app only gets through App Review. Until the platform's Meta app
 * has it (set META_HUMAN_AGENT_APPROVED=1), Meta refuses those replies with
 * "(#100) Cannot tag messages with 'HUMAN_AGENT' without prior approval", so
 * the reply has to be sent from Meta Business Suite instead.
 */
export function humanAgentApproved(): boolean {
  return process.env.META_HUMAN_AGENT_APPROVED === "1";
}

/** Meta's own inbox, where a person can still reply for up to 7 days. */
export const META_INBOX_URL = "https://business.facebook.com/latest/inbox/all";

export function lateReplyMessage(label: string): string {
  return `It is more than 24 hours since their last ${label} message. Meta only lets Adonis reply within 24 hours, so answer this one in Meta Business Suite, where you can still reply for up to 7 days.`;
}

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
  page: { pageId: string; pageAccessToken: string },
): Promise<{ firstName?: string; lastName?: string; name?: string; username?: string }> {
  const fields = channel === "messenger" ? "first_name,last_name" : "name,username";
  try {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(customerId)}?` + new URLSearchParams({ fields, access_token: page.pageAccessToken }));
    if (res.ok) {
      const b = (await res.json()) as { first_name?: string; last_name?: string; name?: string; username?: string };
      if (b.first_name || b.name || b.username) return { firstName: b.first_name, lastName: b.last_name, name: b.name, username: b.username };
    }
  } catch {
    // fall through to the conversation list
  }
  if (channel !== "messenger") return {};
  try {
    const res = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(page.pageId)}/conversations?` +
        new URLSearchParams({ platform: "messenger", user_id: customerId, fields: "participants", access_token: page.pageAccessToken }),
    );
    if (!res.ok) return {};
    const name = participantName(await res.json(), customerId);
    return name ? { name } : {};
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

function storeMessage(
  owner: Owner,
  input: {
    direction: "inbound" | "outbound";
    channel: DmChannel;
    content: string;
    providerMessageId: string | null;
    sentAt: Date;
    aiGenerated?: boolean;
    media?: MessageMedia[];
    /** Defaults to "sent" on an outbound row. */
    status?: "sent" | "failed";
    error?: string;
  },
) {
  const { status, ...rest } = input;
  const row = { ...rest, status: status ?? (input.direction === "outbound" ? ("sent" as const) : undefined) };
  return owner.ownerType === "lead" ? addMessage({ leadId: owner.ownerId, ...row }) : addClientMessage({ clientId: owner.ownerId, ...row });
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
    const profile = await fetchProfile(ev.channel, ev.customerId, page);
    const display = profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username || null;
    const { lead, created: isNew } = upsertLead({
      source: ev.channel,
      sourceLeadId: `${page.pageId}:${ev.customerId}`,
      firstName: profile.firstName,
      lastName: profile.lastName,
      fullName: profile.firstName ? undefined : profile.name,
      notes: `Started a conversation on ${CHANNEL_LABEL[ev.channel]}${profile.username ? ` (@${profile.username})` : ""}.`,
      // A direct message is a conversation, not a lead: it stays in the Inbox until someone adds them.
      inboxOnly: true,
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
  // Photos and files (theirs or the business's own echo): fetched after the row exists, never awaited.
  ingestMessageMediaLater({
    tenantId: boundTenantId() ?? getCurrentTenant().id,
    owner: owner.ownerType,
    messageId: stored.id,
    attachments: ev.attachments.map((a) => ({ kind: a.type, sources: [{ url: a.url }], name: a.type === "file" ? nameFromUrl(a.url) : undefined })),
  });
  if (ev.isEcho) return null;

  db.update(socialContacts).set({ lastInboundAt: sentAt }).where(eq(socialContacts.id, contact.id)).run();
  let senderName = contact.name ?? contact.username ?? null;
  if (owner.ownerType === "lead") {
    setLeadStatus(owner.ownerId, "replied");
    // A click-to-Messenger ad form arrives as "Full name: ... / Email: ... / Phone number: ..." in the message itself.
    const form = parseFormDetails(ev.text);
    if (hasFormDetails(form)) {
      fillLeadContact(owner.ownerId, form);
      // An ad's Messenger form is an enquiry: it goes on the board as a lead.
      addToPipeline(owner.ownerId, "system");
    }
    // The first profile lookup can fail (Meta's name access, a slow API): try again while we still have no name.
    if (!contact.name && !created) {
      const profile = await fetchProfile(ev.channel, ev.customerId, page);
      const display = profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username || null;
      if (display) {
        senderName = display;
        db.update(socialContacts).set({ name: display, username: profile.username ?? contact.username ?? null }).where(eq(socialContacts.id, contact.id)).run();
        const split = profile.firstName ? { firstName: profile.firstName, lastName: profile.lastName ?? null } : splitFullName(profile.name);
        fillLeadContact(owner.ownerId, split);
      }
    }
  }
  await logActivity(
    `${ev.channel}.inbound`,
    `${CHANNEL_LABEL[ev.channel]} message from ${contact.name ?? contact.username ?? "a new contact"}`,
    owner.ownerType === "lead" ? { leadId: owner.ownerId } : { clientId: owner.ownerId },
  );
  notifyInboundMessage({
    channel: ev.channel,
    owner: owner.ownerType,
    contactId: owner.ownerId,
    name: senderName,
    text: ev.text,
    messageId: stored.id,
    providerMessageId: ev.messageId,
  });
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
  /** The words. May be empty when files are attached. */
  text?: string;
  /** An AI wrote it with no person in between (auto-reply). Never gets the 7-day human tag. */
  aiGenerated?: boolean;
  /** Files to send after the text, one message each. */
  attachments?: OutgoingFile[];
}

/**
 * Why Meta would refuse a reply in this window, or null when it may go. The
 * same rules for text and files. Pure.
 */
export function dmSendRefusal(window: ReplyWindow, opts: { label: string; aiGenerated?: boolean; humanAgentApproved: boolean }): string | null {
  if (window === "closed") {
    return `${opts.label} only allows replies within 7 days of the customer's last message. Wait for them to write again.`;
  }
  if (window === "human_only" && opts.aiGenerated) {
    return `It is more than 24 hours since the customer's last ${opts.label} message, so only a reply written by a person can be sent.`;
  }
  if (window === "human_only" && !opts.humanAgentApproved) return lateReplyMessage(opts.label);
  return null;
}

/** RESPONSE inside 24 hours; the HUMAN_AGENT tag up to 7 days. */
function messagingFields(window: ReplyWindow): { messaging_type: string; tag?: string } {
  return window === "open" ? { messaging_type: "RESPONSE" } : { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
}

const META_ATTACHMENT_TYPE: Record<MessageMedia["kind"], "image" | "video" | "audio" | "file"> = {
  image: "image",
  video: "video",
  audio: "audio",
  file: "file",
};

/**
 * Messenger only (Instagram takes a URL, see dmAttachmentUrlBody). The
 * multipart body that uploads one file with a reply: `recipient` and
 * `message` as JSON strings, the messaging type (and tag) for the window,
 * and the file as `filedata`. Pure.
 */
export function dmAttachmentForm(input: {
  recipientId: string;
  window: ReplyWindow;
  file: { kind: MessageMedia["kind"]; mime: string; name?: string; bytes: Buffer };
}): FormData {
  const form = new FormData();
  form.set("recipient", JSON.stringify({ id: input.recipientId }));
  const type = META_ATTACHMENT_TYPE[input.file.kind] ?? "file";
  form.set("message", JSON.stringify({ attachment: { type, payload: { is_reusable: false } } }));
  const m = messagingFields(input.window);
  form.set("messaging_type", m.messaging_type);
  if (m.tag) form.set("tag", m.tag);
  const name = input.file.name?.trim() || `${type}`;
  form.set("filedata", new Blob([new Uint8Array(input.file.bytes)], { type: input.file.mime }), name);
  return form;
}

/**
 * The JSON body that sends one file on Instagram. Instagram takes a file only
 * by URL (no multipart upload), so the URL is a short-lived signed public link
 * Meta fetches (lib/attachments/publicLink.ts). Same window fields as text. Pure.
 */
export function dmAttachmentUrlBody(input: { recipientId: string; window: ReplyWindow; kind: MessageMedia["kind"]; url: string }): Record<string, unknown> {
  const type = META_ATTACHMENT_TYPE[input.kind] ?? "file";
  return {
    recipient: { id: input.recipientId },
    message: { attachment: { type, payload: { url: input.url } } },
    ...messagingFields(input.window),
  };
}

/** How long a file send may take before it is given up on. */
export const DM_FILE_TIMEOUT_MS = 60_000;

/**
 * Reply on the contact's Messenger / Instagram conversation and record it.
 * Text goes first, then each file as its own message and row. Throws with a
 * plain reason when Meta would refuse (window closed, Page disconnected), or
 * when nothing at all was sent, so the caller keeps the draft. A file Meta
 * refuses after something went is stored as a failed row with its reason.
 */
export async function sendDm(input: SendDmInput): Promise<{ messageId: number; providerMessageId: string; channel: DmChannel; failed: string[]; failedFiles: string[] }> {
  const text = (input.text ?? "").trim();
  const files = input.attachments ?? [];
  if (!text && files.length === 0) throw new Error("Message is empty.");
  const target = getDmTarget(input.subjectType, input.subjectId);
  if (!target) throw new Error("This contact has no Messenger or Instagram conversation.");
  const label = CHANNEL_LABEL[target.channel];
  if (files.length) {
    const set = checkOutgoingSet(files.map((f) => ({ size: f.bytes.length })), target.channel);
    if (!set.ok) throw new Error(set.error);
  }
  const refusal = dmSendRefusal(target.window, { label, aiGenerated: input.aiGenerated, humanAgentApproved: humanAgentApproved() });
  if (refusal) throw new Error(refusal);
  const tenantId = boundTenantId() ?? getCurrentTenant().id;
  const token = getPageTokenForTenant(tenantId, target.pageId);
  if (!token) throw new Error("The Facebook Page for this conversation is no longer connected.");

  const url = `${GRAPH_BASE}/${encodeURIComponent(target.pageId)}/messages?` + new URLSearchParams({ access_token: token });
  const post = async (init: RequestInit): Promise<string> => {
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", ...init });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new Error(`${label} took more than a minute to take the file. Check the conversation before you send it again.`);
      }
      throw err;
    }
    const json = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
    if (!res.ok || !json.message_id) {
      const err = metaApiError(json, res.status, `${label} send failed (${res.status}).`);
      if (/HUMAN_AGENT/.test(err.message)) throw new Error(lateReplyMessage(label));
      // A refused token marks the Page for reconnect and tells the admins.
      if (await notePageRefusal(target.pageId, err).catch(() => false)) {
        throw new Error(`Facebook stopped accepting this Page's connection. Reconnect Facebook in Settings, then send again. (${err.message})`);
      }
      throw err;
    }
    return json.message_id;
  };
  const owner: Owner = { ownerType: input.subjectType, ownerId: input.subjectId };
  const store = (row: { content: string; providerMessageId: string | null; media?: MessageMedia[]; status?: "sent" | "failed"; error?: string }) =>
    storeMessage(owner, { direction: "outbound", channel: target.channel, sentAt: new Date(), aiGenerated: input.aiGenerated, ...row });

  let first: { messageId: number; providerMessageId: string } | null = null;
  if (text) {
    const body: Record<string, unknown> = {
      recipient: { id: target.externalId },
      message: { text },
      ...messagingFields(target.window),
    };
    const providerMessageId = await post({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const stored = store({ content: text, providerMessageId });
    first = { messageId: stored.id, providerMessageId };
  }

  // As in sendWhatsApp: failures before anything went wait, so a send where nothing went stores nothing.
  const failed: string[] = [];
  const failedFiles: string[] = [];
  let waiting: Array<{ media: MessageMedia; error: string }> = [];
  for (const f of files) {
    try {
      let init: RequestInit;
      if (target.channel === "instagram") {
        // Instagram fetches the file from a URL; Messenger takes the upload.
        const link = publicFileUrl(getAppBaseUrl(), { tenantId, file: f.media.file });
        if (!link) throw new Error("Files can't be sent on Instagram from this server yet.");
        init = {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dmAttachmentUrlBody({ recipientId: target.externalId, window: target.window, kind: f.media.kind, url: link })),
        };
      } else {
        init = {
          body: dmAttachmentForm({ recipientId: target.externalId, window: target.window, file: { kind: f.media.kind, mime: f.media.mime, name: f.media.name, bytes: f.bytes } }),
        };
      }
      const providerMessageId = await post({ ...init, signal: AbortSignal.timeout(DM_FILE_TIMEOUT_MS) });
      for (const w of waiting) store({ content: mediaPlaceholder(w.media.kind), providerMessageId: null, media: [w.media], status: "failed", error: w.error });
      waiting = [];
      const stored = store({ content: mediaPlaceholder(f.media.kind), providerMessageId, media: [f.media] });
      if (!first) first = { messageId: stored.id, providerMessageId };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed.push(`${attachmentLabel(f.media)}: ${reason}`);
      failedFiles.push(f.media.file);
      if (first) store({ content: mediaPlaceholder(f.media.kind), providerMessageId: null, media: [f.media], status: "failed", error: reason });
      else waiting.push({ media: f.media, error: reason });
    }
  }
  if (!first) throw new Error(failed.length === 1 ? failed[0] : `Nothing was sent. ${failed.join(" ")}`);

  await logActivity(`${target.channel}.sent`, `${label} reply sent`, input.subjectType === "lead" ? { leadId: input.subjectId } : { clientId: input.subjectId });
  return { ...first, channel: target.channel, failed, failedFiles };
}

const NAME_FILL_EVERY_MS = 6 * 60 * 60 * 1000;
const NAME_FILL_BATCH = 25;
const lastNameFill = new Map<number, number>();

/**
 * Leads that came in from Messenger or Instagram without a name (the lookup
 * failed when they first wrote): look the name up again and fill it in. Only
 * empty names are filled; nothing typed by staff is overwritten. At most every
 * six hours per business, 25 people a pass. Runs inside the tenant (ticker).
 */
export async function fillMissingDmNamesIfStale(tenantId: number, now = Date.now()): Promise<number> {
  if (now - (lastNameFill.get(tenantId) ?? 0) < NAME_FILL_EVERY_MS) return 0;
  lastNameFill.set(tenantId, now);
  const nameless = db
    .select()
    .from(socialContacts)
    .where(and(eq(socialContacts.ownerType, "lead"), isNull(socialContacts.name)))
    .limit(NAME_FILL_BATCH)
    .all();
  let filled = 0;
  for (const c of nameless) {
    const token = getPageTokenForTenant(tenantId, c.pageId);
    if (!token) continue;
    const profile = await fetchProfile(c.channel as DmChannel, c.externalId, { pageId: c.pageId, pageAccessToken: token });
    const display = profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.username || null;
    if (!display) continue;
    db.update(socialContacts).set({ name: display, username: profile.username ?? c.username ?? null }).where(eq(socialContacts.id, c.id)).run();
    const split = profile.firstName ? { firstName: profile.firstName, lastName: profile.lastName ?? null } : splitFullName(profile.name);
    if (fillLeadContact(c.ownerId, split)) filled++;
  }
  return filled;
}
