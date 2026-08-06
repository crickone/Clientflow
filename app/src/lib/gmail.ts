import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { db } from "@/lib/db";
import { clients, emailMessages, gmailConnections } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { refreshAccessToken } from "@/lib/google/oauth";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// ─── Connection storage (control plane, one per tenant) ──────────────────────

export type GmailConnection = {
  tenantId: number;
  email: string;
  scope: string | null;
  lastSyncAt: number | null;
};

/** Public (safe) view of a tenant's connection — no tokens. */
export function getGmailConnection(tenantId: number): GmailConnection | null {
  const row = authDb
    .select({
      tenantId: gmailConnections.tenantId,
      email: gmailConnections.email,
      scope: gmailConnections.scope,
      lastSyncAt: gmailConnections.lastSyncAt,
    })
    .from(gmailConnections)
    .where(eq(gmailConnections.tenantId, tenantId))
    .get();
  return row ? { ...row, lastSyncAt: row.lastSyncAt ? row.lastSyncAt.getTime() : null } : null;
}

export function isGmailConnected(tenantId: number): boolean {
  return Boolean(
    authDb
      .select({ id: gmailConnections.id })
      .from(gmailConnections)
      .where(eq(gmailConnections.tenantId, tenantId))
      .get(),
  );
}

export function saveGmailConnection(opts: {
  tenantId: number;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scope: string;
  connectedByUserId?: number;
}): void {
  const expiry = new Date(Date.now() + opts.expiresIn * 1000);
  const existing = authDb
    .select({ id: gmailConnections.id })
    .from(gmailConnections)
    .where(eq(gmailConnections.tenantId, opts.tenantId))
    .get();
  const values = {
    email: opts.email,
    refreshToken: encryptToken(opts.refreshToken),
    accessToken: encryptToken(opts.accessToken),
    tokenExpiry: expiry,
    scope: opts.scope,
    connectedByUserId: opts.connectedByUserId ?? null,
  };
  if (existing) {
    authDb.update(gmailConnections).set(values).where(eq(gmailConnections.id, existing.id)).run();
  } else {
    authDb.insert(gmailConnections).values({ tenantId: opts.tenantId, ...values }).run();
  }
}

export function deleteGmailConnection(tenantId: number): void {
  authDb.delete(gmailConnections).where(eq(gmailConnections.tenantId, tenantId)).run();
}

// ─── Access token (refresh when stale) ───────────────────────────────────────

/** Whether the tenant's connected Google account also granted Drive access. */
export function isDriveConnected(tenantId: number): boolean {
  const conn = getGmailConnection(tenantId);
  return Boolean(conn && (conn.scope ?? "").includes("drive"));
}

/** Fresh Google access token for the tenant (shared by Gmail + Drive). */
export async function getGoogleAccessToken(tenantId: number): Promise<string | null> {
  return getAccessToken(tenantId);
}

async function getAccessToken(tenantId: number): Promise<string | null> {
  const row = authDb
    .select()
    .from(gmailConnections)
    .where(eq(gmailConnections.tenantId, tenantId))
    .get();
  if (!row) return null;

  const stillValid = row.accessToken && row.tokenExpiry && row.tokenExpiry.getTime() > Date.now() + 60_000;
  if (stillValid) return decryptToken(row.accessToken!);

  // Refresh.
  const refreshed = await refreshAccessToken(decryptToken(row.refreshToken));
  authDb
    .update(gmailConnections)
    .set({
      accessToken: encryptToken(refreshed.access_token),
      tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
    })
    .where(eq(gmailConnections.id, row.id))
    .run();
  return refreshed.access_token;
}

async function gmailFetch(
  tenantId: number,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  let token = await getAccessToken(tenantId);
  if (!token) throw new Error("Gmail is not connected.");
  let res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    // Force a refresh and retry once.
    authDb
      .update(gmailConnections)
      .set({ tokenExpiry: new Date(0) })
      .where(eq(gmailConnections.tenantId, tenantId))
      .run();
    token = await getAccessToken(tenantId);
    res = await fetch(`${GMAIL_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  }
  return res;
}

/** The connected mailbox's email address (also confirms the token works). */
export async function fetchGmailProfile(
  accessToken: string,
): Promise<{ emailAddress: string; historyId: string }> {
  const res = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { emailAddress: string; historyId: string };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

function encodeHeaderWord(value: string): string {
  // RFC 2047 encode when non-ASCII, else pass through.
  return /[^\x00-\x7F]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

function toBase64Url(buf: Buffer | string): string {
  return (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildMime(opts: {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [
    `From: ${encodeHeaderWord(opts.fromName)} <${opts.fromEmail}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);
  const body = Buffer.from(opts.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

export type GmailSendResult =
  | { ok: true; id: string; threadId: string }
  | { ok: false; error: string };

export async function gmailSend(
  tenantId: number,
  opts: {
    fromName: string;
    fromEmail: string;
    to: string;
    subject: string;
    html: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<GmailSendResult> {
  try {
    const raw = toBase64Url(
      buildMime({
        fromName: opts.fromName,
        fromEmail: opts.fromEmail,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        inReplyTo: opts.inReplyTo,
        references: opts.references,
      }),
    );
    const res = await gmailFetch(tenantId, "/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
    });
    if (!res.ok) return { ok: false, error: `Gmail send failed: ${res.status} ${await res.text()}` };
    const data = (await res.json()) as { id: string; threadId: string };
    return { ok: true, id: data.id, threadId: data.threadId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gmail send error" };
  }
}

// ─── Inbox sync ───────────────────────────────────────────────────────────────

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

function headerVal(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractBody(payload: GmailPart | undefined): { html: string; text: string } {
  let html = "";
  let text = "";
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.mimeType === "text/html" && p.body?.data) html ||= decodeB64Url(p.body.data);
    else if (p.mimeType === "text/plain" && p.body?.data) text ||= decodeB64Url(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(payload);
  return { html, text };
}

/** Parse "Name <addr@x>" → {name, email}. */
function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

/**
 * Pull recent messages from Gmail into the tenant's email_messages store. Deduped
 * on gmail_message_id, so it's safe to run repeatedly. On-demand (no Pub/Sub).
 * Must run in the CURRENT tenant's context (writes go through the `db` proxy).
 */
export async function syncGmailInbox(
  tenantId: number,
  opts?: { days?: number; max?: number },
): Promise<{ ok: true; synced: number } | { ok: false; error: string }> {
  const days = opts?.days ?? 30;
  const max = opts?.max ?? 40;
  try {
    const listRes = await gmailFetch(
      tenantId,
      `/messages?maxResults=${max}&q=${encodeURIComponent(`newer_than:${days}d -in:chats`)}`,
    );
    if (!listRes.ok) return { ok: false, error: `Gmail list failed: ${listRes.status}` };
    const list = (await listRes.json()) as { messages?: { id: string; threadId: string }[] };
    const ids = list.messages ?? [];

    // Build a quick email→clientId map for linking.
    const clientRows = db
      .select({ id: clients.id, email: clients.email })
      .from(clients)
      .all();
    const clientByEmail = new Map<string, number>();
    for (const c of clientRows) if (c.email) clientByEmail.set(c.email.toLowerCase(), c.id);

    let synced = 0;
    for (const { id } of ids) {
      const existing = db
        .select({ id: emailMessages.id })
        .from(emailMessages)
        .where(eq(emailMessages.gmailMessageId, id))
        .get();
      if (existing) continue;

      const msgRes = await gmailFetch(tenantId, `/messages/${id}?format=full`);
      if (!msgRes.ok) continue;
      const msg = (await msgRes.json()) as GmailMessage;
      const headers = msg.payload?.headers;
      const from = parseAddress(headerVal(headers, "From"));
      const to = parseAddress(headerVal(headers, "To"));
      const direction: "in" | "out" = msg.labelIds?.includes("SENT") ? "out" : "in";
      const counterparty = direction === "out" ? to.email : from.email;
      const clientId = clientByEmail.get(counterparty) ?? null;
      const { html, text } = extractBody(msg.payload);

      db.insert(emailMessages)
        .values({
          gmailMessageId: msg.id,
          gmailThreadId: msg.threadId,
          direction,
          fromEmail: from.email || null,
          fromName: from.name || null,
          toEmail: to.email || null,
          subject: headerVal(headers, "Subject") || null,
          snippet: msg.snippet ?? null,
          bodyHtml: html || null,
          bodyText: text || null,
          clientId,
          internalDate: msg.internalDate ? new Date(Number(msg.internalDate)) : null,
          isRead: direction === "out",
        })
        .run();
      synced++;
    }

    authDb
      .update(gmailConnections)
      .set({ lastSyncAt: new Date() })
      .where(eq(gmailConnections.tenantId, tenantId))
      .run();
    return { ok: true, synced };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Gmail sync error" };
  }
}

// ─── Reads for the UI ─────────────────────────────────────────────────────────

export type EmailMessageRow = {
  id: number;
  gmailMessageId: string;
  gmailThreadId: string | null;
  direction: "in" | "out";
  fromEmail: string | null;
  fromName: string | null;
  toEmail: string | null;
  subject: string | null;
  snippet: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  clientId: number | null;
  internalDate: number | null;
  isRead: boolean;
};

function mapRow(r: typeof emailMessages.$inferSelect): EmailMessageRow {
  return {
    id: r.id,
    gmailMessageId: r.gmailMessageId,
    gmailThreadId: r.gmailThreadId,
    direction: r.direction,
    fromEmail: r.fromEmail,
    fromName: r.fromName,
    toEmail: r.toEmail,
    subject: r.subject,
    snippet: r.snippet,
    bodyHtml: r.bodyHtml,
    bodyText: r.bodyText,
    clientId: r.clientId,
    internalDate: r.internalDate ? r.internalDate.getTime() : null,
    isRead: r.isRead,
  };
}

/** Latest message per thread, newest first — the inbox list. */
export function listEmailThreads(limit = 100): EmailMessageRow[] {
  const rows = db
    .select()
    .from(emailMessages)
    .orderBy(desc(emailMessages.internalDate))
    .limit(400)
    .all();
  const seen = new Set<string>();
  const out: EmailMessageRow[] = [];
  for (const r of rows) {
    const key = r.gmailThreadId ?? String(r.id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapRow(r));
    if (out.length >= limit) break;
  }
  return out;
}

/** All messages in one thread, oldest first (for the thread view). */
export function listThreadMessages(threadId: string): EmailMessageRow[] {
  return db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.gmailThreadId, threadId))
    .orderBy(emailMessages.internalDate)
    .all()
    .map(mapRow);
}

/** Mark every inbound message in a thread as read (called when it's opened). */
export function markThreadRead(threadId: string): void {
  db.update(emailMessages)
    .set({ isRead: true })
    .where(and(eq(emailMessages.gmailThreadId, threadId), eq(emailMessages.direction, "in")))
    .run();
}

/** Messages exchanged with a specific client (their profile Email tab). */
export function listClientThreadMessages(clientId: number): EmailMessageRow[] {
  return db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.clientId, clientId))
    .orderBy(desc(emailMessages.internalDate))
    .all()
    .map(mapRow);
}

export function getEmailMessage(id: number): EmailMessageRow | null {
  const r = db.select().from(emailMessages).where(eq(emailMessages.id, id)).get();
  return r ? mapRow(r) : null;
}

// ─── Search + attachments (for the AI assistant / invoice bundling) ───────────

/** Raw Gmail search — returns matching message IDs for a Gmail query string. */
export async function gmailSearchMessageIds(
  tenantId: number,
  q: string,
  max = 50,
): Promise<{ id: string; threadId: string }[]> {
  const res = await gmailFetch(
    tenantId,
    `/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: { id: string; threadId: string }[] };
  return data.messages ?? [];
}

export type GmailAttachmentMeta = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
};

function collectAttachments(part: GmailPart | undefined, out: GmailAttachmentMeta[]) {
  if (!part) return;
  if (part.filename && part.body?.attachmentId) {
    out.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    });
  }
  part.parts?.forEach((p) => collectAttachments(p, out));
}

export type GmailMessageDetail = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: number | null;
  snippet: string;
  attachments: GmailAttachmentMeta[];
};

/** Fetch a message's headers + attachment metadata (no attachment bytes). */
export async function gmailGetMessageDetail(
  tenantId: number,
  id: string,
): Promise<GmailMessageDetail | null> {
  const res = await gmailFetch(tenantId, `/messages/${id}?format=full`);
  if (!res.ok) return null;
  const msg = (await res.json()) as GmailMessage;
  const headers = msg.payload?.headers;
  const attachments: GmailAttachmentMeta[] = [];
  collectAttachments(msg.payload, attachments);
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject: headerVal(headers, "Subject"),
    from: headerVal(headers, "From"),
    date: msg.internalDate ? Number(msg.internalDate) : null,
    snippet: msg.snippet ?? "",
    attachments,
  };
}

/** Download one attachment's bytes. */
export async function gmailDownloadAttachment(
  tenantId: number,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  const res = await gmailFetch(tenantId, `/messages/${messageId}/attachments/${attachmentId}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: string };
  if (!data.data) return null;
  return Buffer.from(data.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
