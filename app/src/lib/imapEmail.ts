import "server-only";

import { eq, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";

import { authDb } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { clients, emailMessages, imapConnections } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";

/**
 * A tenant's connected IMAP/SMTP mailbox (generic, non-Gmail) — the
 * credential store + CRUD half of the "bring your own mailbox" email
 * connector. Parallels lib/gmail.ts's connection storage (see its
 * "Connection storage" section) but for a plain username/password mailbox
 * (e.g. Microsoft 365, cPanel/Hostinger, or any other IMAP/SMTP host)
 * instead of Google OAuth. IMAP sync, server actions, and UI are later
 * tasks. This module also owns SMTP send (`smtpSend`, nodemailer), a
 * connection-test helper (`testImapConnection`, ImapFlow + nodemailer), and
 * the provider-agnostic thread-key derivation (`threadKeyFor`) that both
 * send and the later IMAP sync use to group messages under
 * `email_messages.gmail_thread_id`.
 *
 * The mailbox password is stored ENCRYPTED (AES-256-GCM via
 * lib/google/tokenCrypto — the same helper Gmail's OAuth tokens use, keyed
 * off EMAIL_TOKEN_SECRET; despite living under a "google" path it's a
 * generic string-encryption utility). `getImapConnection`/`isImapConnected`
 * return only the safe shape (no password, no ciphertext) — the sole
 * plaintext reader is `getImapCredentials`, called server-side by
 * `smtpSend`/`testImapConnection` below (and later IMAP sync) to actually
 * open an IMAP/SMTP connection. NEVER call `getImapCredentials` from a
 * `"use server"` action that returns its result to the client.
 */

export type ImapConnection = {
  // Safe shape — NO password, NO ciphertext.
  tenantId: number;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  fromName: string | null;
  lastSyncAt: number | null; // epoch ms
};

/** Public (safe) view of a tenant's IMAP/SMTP connection — no password. */
export function getImapConnection(tenantId: number): ImapConnection | null {
  const row = authDb
    .select({
      tenantId: imapConnections.tenantId,
      email: imapConnections.email,
      imapHost: imapConnections.imapHost,
      imapPort: imapConnections.imapPort,
      imapSecure: imapConnections.imapSecure,
      smtpHost: imapConnections.smtpHost,
      smtpPort: imapConnections.smtpPort,
      smtpSecure: imapConnections.smtpSecure,
      username: imapConnections.username,
      fromName: imapConnections.fromName,
      lastSyncAt: imapConnections.lastSyncAt,
    })
    .from(imapConnections)
    .where(eq(imapConnections.tenantId, tenantId))
    .get();
  return row ? { ...row, lastSyncAt: row.lastSyncAt ? row.lastSyncAt.getTime() : null } : null;
}

export function isImapConnected(tenantId: number): boolean {
  return Boolean(
    authDb
      .select({ id: imapConnections.id })
      .from(imapConnections)
      .where(eq(imapConnections.tenantId, tenantId))
      .get(),
  );
}

/**
 * Save (create or update) a tenant's IMAP/SMTP connection. Encrypts the
 * mailbox password before it touches disk; UPSERTs by tenantId so a tenant
 * only ever has one row (mirrors saveGmailConnection).
 */
export function saveImapConnection(opts: {
  tenantId: number;
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  fromName?: string;
  connectedByUserId?: number;
}): void {
  const existing = authDb
    .select({ id: imapConnections.id })
    .from(imapConnections)
    .where(eq(imapConnections.tenantId, opts.tenantId))
    .get();
  const values = {
    email: opts.email,
    imapHost: opts.imapHost,
    imapPort: opts.imapPort,
    imapSecure: opts.imapSecure,
    smtpHost: opts.smtpHost,
    smtpPort: opts.smtpPort,
    smtpSecure: opts.smtpSecure,
    username: opts.username,
    passwordEnc: encryptToken(opts.password),
    fromName: opts.fromName ?? null,
    connectedByUserId: opts.connectedByUserId ?? null,
  };
  if (existing) {
    authDb.update(imapConnections).set(values).where(eq(imapConnections.id, existing.id)).run();
  } else {
    authDb.insert(imapConnections).values({ tenantId: opts.tenantId, ...values }).run();
  }
}

export function deleteImapConnection(tenantId: number): void {
  authDb.delete(imapConnections).where(eq(imapConnections.tenantId, tenantId)).run();
}

/**
 * Decrypts and returns the mailbox password alongside the rest of the
 * connection. The ONLY plaintext reader for the stored credential — used by
 * `smtpSend`/`testImapConnection` below, and by IMAP sync (a later task).
 * Exported for those call sites, but MUST NOT be called from a `"use
 * server"` action that returns its result to the client — feed the
 * password straight into a server-side imapflow/nodemailer client, never
 * back out over the wire.
 */
export function getImapCredentials(
  tenantId: number,
): (ImapConnection & { password: string }) | null {
  const row = authDb
    .select()
    .from(imapConnections)
    .where(eq(imapConnections.tenantId, tenantId))
    .get();
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    email: row.email,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    username: row.username,
    fromName: row.fromName,
    lastSyncAt: row.lastSyncAt ? row.lastSyncAt.getTime() : null,
    password: decryptToken(row.passwordEnc),
  };
}

// ─── Thread linking ───────────────────────────────────────────────────────

/**
 * The stable key a message's `email_messages.gmail_thread_id` should share
 * with the rest of its conversation — provider-agnostic despite the column
 * name (a Gmail-era holdover; see emailMessages in db/schema.ts), used by
 * both `smtpSend` below and the later IMAP sync. Mirrors how mail clients
 * group a thread: the ROOT of the References chain (its first, oldest
 * entry) when present, else the message being replied to, else the
 * message's own id. Every candidate is trimmed; a blank/absent value at one
 * precedence level falls through to the next.
 */
export function threadKeyFor(h: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | string | null;
}): string | null {
  const root = rootOfReferences(h.references);
  if (root) return root;
  const inReplyTo = h.inReplyTo?.trim();
  if (inReplyTo) return inReplyTo;
  const messageId = h.messageId?.trim();
  if (messageId) return messageId;
  return null;
}

/** First (oldest/root) non-blank id in a References header — array form or raw whitespace-joined string form. */
function rootOfReferences(references: string[] | string | null | undefined): string | null {
  if (!references) return null;
  const tokens = Array.isArray(references) ? references : references.trim().split(/\s+/);
  for (const raw of tokens) {
    const t = raw.trim();
    if (t) return t;
  }
  return null;
}

// ─── SMTP send ─────────────────────────────────────────────────────────────

/**
 * Tiny local HTML→text fallback for smtpSend's plaintext part. Deliberately
 * NOT imported from lib/email.ts's htmlToText — email.ts imports
 * isImapConnected/smtpSend FROM this module, so the reverse import would be
 * a cycle. Keep in spirit (not byte-for-byte) with that copy.
 */
function htmlToTextLocal(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip characters that would break a `"Name" <addr>` From header. */
function sanitizeFromName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim() || "Mailbox";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Best-effort bookkeeping row for a message `smtpSend` just sent — recorded
 * so it shows up in the Communication inbox next to Gmail/Resend sends.
 * Targets the TARGET tenant's own DB via getTenantDbById(tenantId),
 * deliberately not the ambient `db` request proxy: smtpSend can run for a
 * tenant other than the current request's (e.g. a background job), and
 * writing through `db` in that case would silently land in the wrong
 * tenant's database. Logged and swallowed on failure — a bookkeeping miss
 * must never turn an already-sent email into a reported failure.
 */
function recordSentMessage(
  tenantId: number,
  fromEmail: string,
  opts: {
    fromName: string;
    to: string;
    subject: string;
    html: string;
    inReplyTo?: string;
    references?: string;
  },
  messageId: string,
  text: string,
): void {
  try {
    const tdb = getTenantDbById(tenantId);
    const clientRow = tdb
      .select({ id: clients.id })
      .from(clients)
      .where(eq(sql`lower(${clients.email})`, opts.to.trim().toLowerCase()))
      .get();
    tdb
      .insert(emailMessages)
      .values({
        gmailMessageId: messageId,
        gmailThreadId:
          threadKeyFor({ messageId, inReplyTo: opts.inReplyTo, references: opts.references }) ?? messageId,
        direction: "out",
        fromEmail,
        fromName: opts.fromName || null,
        toEmail: opts.to,
        subject: opts.subject,
        snippet: text.replace(/\s+/g, " ").trim().slice(0, 140),
        bodyHtml: opts.html,
        bodyText: text,
        clientId: clientRow?.id ?? null,
        internalDate: new Date(),
        isRead: true,
      })
      .run();
  } catch (err) {
    console.error("[imapEmail] smtpSend: failed to record sent message:", err);
  }
}

/**
 * Send one email through the tenant's connected SMTP mailbox (nodemailer).
 * Decrypts credentials via getImapCredentials — errors if the tenant has no
 * IMAP/SMTP connection. On success, nodemailer's returned Message-ID becomes
 * `id`, and the send is best-effort recorded as an outbound email_messages
 * row (see recordSentMessage). Never throws — any failure (missing
 * connection, transport/auth error) comes back as `{ok:false,error}`.
 */
export async function smtpSend(
  tenantId: number,
  opts: {
    fromName: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const creds = getImapCredentials(tenantId);
    if (!creds) {
      return { ok: false, error: "No IMAP/SMTP mailbox connected for this tenant." };
    }

    const transporter = createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpSecure,
      auth: { user: creds.username, pass: creds.password },
    });

    const text = opts.text ?? htmlToTextLocal(opts.html);
    try {
      const info = await transporter.sendMail({
        from: `"${sanitizeFromName(opts.fromName)}" <${creds.email}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text,
        replyTo: opts.replyTo,
        inReplyTo: opts.inReplyTo,
        references: opts.references,
      });

      recordSentMessage(tenantId, creds.email, opts, info.messageId, text);

      return { ok: true, id: info.messageId };
    } finally {
      transporter.close();
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ─── Connection test ───────────────────────────────────────────────────────

/**
 * Verifies a candidate IMAP/SMTP credential pair actually works — one
 * short-lived IMAP connect+logout, plus an SMTP transport.verify(). Used
 * before saveImapConnection persists a mailbox (and to re-check one already
 * saved). Never throws; always closes/logs out of what it opens.
 */
export async function testImapConnection(creds: {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const client = new ImapFlow({
      host: creds.imapHost,
      port: creds.imapPort,
      secure: creds.imapSecure,
      auth: { user: creds.username, pass: creds.password },
      logger: false,
    });
    let imapError: string | null = null;
    try {
      await client.connect();
    } catch (err) {
      imapError = `Couldn't connect to IMAP (${creds.imapHost}:${creds.imapPort}): ${errorMessage(err)}`;
    } finally {
      try {
        await client.logout();
      } catch {
        // best-effort — nothing to log out of if connect() never succeeded
      }
    }
    if (imapError) return { ok: false, error: imapError };

    const transporter = createTransport({
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpSecure,
      auth: { user: creds.username, pass: creds.password },
    });
    let smtpError: string | null = null;
    try {
      await transporter.verify();
    } catch (err) {
      smtpError = `Couldn't verify SMTP (${creds.smtpHost}:${creds.smtpPort}): ${errorMessage(err)}`;
    } finally {
      transporter.close();
    }
    if (smtpError) return { ok: false, error: smtpError };

    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
