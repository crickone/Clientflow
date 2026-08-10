import "server-only";

import { eq } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { imapConnections } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";

/**
 * A tenant's connected IMAP/SMTP mailbox (generic, non-Gmail) — the
 * credential store + CRUD half of the "bring your own mailbox" email
 * connector. Parallels lib/gmail.ts's connection storage (see its
 * "Connection storage" section) but for a plain username/password mailbox
 * (e.g. Microsoft 365, cPanel/Hostinger, or any other IMAP/SMTP host)
 * instead of Google OAuth. SMTP send, IMAP sync, server actions, and UI are
 * later tasks — this module is only the control-plane table, connection
 * CRUD, and the one internal credential reader they'll build on.
 *
 * The mailbox password is stored ENCRYPTED (AES-256-GCM via
 * lib/google/tokenCrypto — the same helper Gmail's OAuth tokens use, keyed
 * off EMAIL_TOKEN_SECRET; despite living under a "google" path it's a
 * generic string-encryption utility). `getImapConnection`/`isImapConnected`
 * return only the safe shape (no password, no ciphertext) — the sole
 * plaintext reader is `getImapCredentials`, which later tasks call
 * server-side to actually open an IMAP/SMTP connection. NEVER call
 * `getImapCredentials` from a `"use server"` action that returns its result
 * to the client.
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
 * connection. The ONLY plaintext reader for the stored credential — for
 * SMTP send / IMAP sync / a "test connection" action (later tasks). Exported
 * for those call sites, but MUST NOT be called from a `"use server"` action
 * that returns its result to the client — feed the password straight into a
 * server-side imapflow/nodemailer client, never back out over the wire.
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
