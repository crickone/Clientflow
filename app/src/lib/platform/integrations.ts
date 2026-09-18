import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getGmailConnection, isDriveConnected, deleteGmailConnection } from "@/lib/gmail";
import { getImapConnection, deleteImapConnection } from "@/lib/imapEmail";
import { listFacebookPages, disconnectFacebookPage } from "@/lib/facebook/pages";
import { listApiKeys, revokeApiKey } from "@/lib/apiKeys";
import { getSendingDomain, refreshDomainStatus, disconnectDomain } from "@/lib/marketing/domains";
import { getMetaConnectionForTenant } from "@/lib/social/publisher";
import { runWithTenant } from "@/lib/db/tenant";

/**
 * Every outside connection a business has, on one board.
 *
 * This is where support questions actually land -- a Gmail that stopped
 * syncing, a domain that will not verify, a Facebook page that dropped --
 * and until now none of it was visible without logging in as the client.
 *
 * ONE RULE runs through the whole file: a secret never leaves the server.
 * Not a refresh token, not a page access token, not an IMAP password, not
 * an API key body. What the console gets is presence, owner, state and
 * timestamps -- enough to answer "is it connected, since when, and by
 * whom", which is the question being asked. Every row here is assembled
 * field by field for that reason, rather than handing back a table row and
 * trusting the far end to drop things.
 */

export type ConnectionState = "connected" | "needs_attention" | "not_connected";

export interface ConnectionRow {
  key: string;
  label: string;
  state: ConnectionState;
  /** The identifying detail: an address, a domain, a page name. Never a credential. */
  identity: string | null;
  detail: string | null;
  connectedAt: number | null;
  lastUsedAt: number | null;
  /** What the console can do to this row, if anything. */
  actions: ("disconnect" | "reverify")[];
}

export interface ApiKeyView {
  id: number;
  prefix: string;
  label: string | null;
  scopes: string;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

export interface SiteDomainView {
  id: number;
  host: string;
  siteId: number;
  siteName: string | null;
  isPrimary: boolean;
  verifiedAt: number | null;
}

export interface TenantIntegrations {
  connections: ConnectionRow[];
  apiKeys: ApiKeyView[];
  siteDomains: SiteDomainView[];
}

/**
 * When a connection row was created. The `getGmailConnection` /
 * `getImapConnection` views deliberately expose no more than they must (no
 * tokens), and `created_at` is not among the fields they return -- so it is
 * read here rather than widening a deliberately narrow view.
 */
function connectedAt(table: "gmail_connections" | "imap_connections", tenantId: number): number | null {
  const row = controlSqlite
    .prepare(`SELECT created_at FROM ${table} WHERE tenant_id = ?`)
    .get(tenantId) as { created_at: number } | undefined;
  return row?.created_at ?? null;
}

export function listTenantIntegrations(tenantId: number): TenantIntegrations {
  const connections: ConnectionRow[] = [];

  // ── Google (Gmail, and Drive on the same grant) ──────────────────────
  const gmail = getGmailConnection(tenantId);
  connections.push({
    key: "gmail",
    label: "Gmail",
    state: gmail ? "connected" : "not_connected",
    identity: gmail?.email ?? null,
    detail: gmail ? (isDriveConnected(tenantId) ? "Drive access granted too" : "Mail only, no Drive access") : null,
    connectedAt: gmail ? connectedAt("gmail_connections", tenantId) : null,
    lastUsedAt: gmail?.lastSyncAt ?? null,
    actions: gmail ? ["disconnect"] : [],
  });

  // ── IMAP, the other way to bring mail in ─────────────────────────────
  const imap = getImapConnection(tenantId);
  connections.push({
    key: "imap",
    label: "IMAP mailbox",
    state: imap ? "connected" : "not_connected",
    identity: imap?.email ?? null,
    detail: imap ? `${imap.imapHost}:${imap.imapPort}` : null,
    connectedAt: imap ? connectedAt("imap_connections", tenantId) : null,
    lastUsedAt: imap?.lastSyncAt ?? null,
    actions: imap ? ["disconnect"] : [],
  });

  // ── Mailgun sending domain ───────────────────────────────────────────
  const sending = getSendingDomain(tenantId);
  connections.push({
    key: "sending_domain",
    label: "Email sending domain",
    state: sending ? (sending.state === "verified" ? "connected" : "needs_attention") : "not_connected",
    identity: sending?.domain ?? null,
    detail: sending
      ? sending.state === "verified"
        ? "DNS verified"
        : `DNS ${sending.state} — ${sending.dnsRecords.length} record${sending.dnsRecords.length === 1 ? "" : "s"} to set`
      : null,
    connectedAt: sending?.createdAt ?? null,
    lastUsedAt: sending?.verifiedAt ?? null,
    actions: sending ? ["reverify", "disconnect"] : [],
  });

  // ── Facebook pages (lead ads) ────────────────────────────────────────
  const pages = listFacebookPages(tenantId);
  for (const page of pages) {
    connections.push({
      key: `facebook:${page.pageId}`,
      label: "Facebook page (lead ads)",
      state: page.subscribedAt ? "connected" : "needs_attention",
      identity: page.pageName ?? page.pageId,
      detail: page.subscribedAt ? "Subscribed to lead notifications" : "Connected but not receiving leads",
      connectedAt: page.createdAt,
      lastUsedAt: page.subscribedAt,
      actions: ["disconnect"],
    });
  }
  if (pages.length === 0) {
    connections.push({
      key: "facebook",
      label: "Facebook page (lead ads)",
      state: "not_connected",
      identity: null,
      detail: null,
      connectedAt: null,
      lastUsedAt: null,
      actions: [],
    });
  }

  // ── Meta posting (the scheduler's publisher) ─────────────────────────
  const meta = getMetaConnectionForTenant(tenantId);
  connections.push({
    key: "meta_posting",
    label: "Social posting",
    state: meta ? "connected" : "not_connected",
    identity: meta?.pageName ?? meta?.pageId ?? null,
    detail: meta
      ? meta.igUserId
        ? "Facebook and Instagram"
        : "Facebook only — no Instagram account linked"
      : "Scheduled posts wait until this is connected (Meta app review pending)",
    connectedAt: null,
    lastUsedAt: null,
    actions: meta ? ["disconnect"] : [],
  });

  // ── API keys and site domains, listed separately: they are many ──────
  const apiKeys = listApiKeys(tenantId).map(
    (k): ApiKeyView => ({
      id: k.id,
      prefix: k.prefix,
      label: k.label,
      scopes: k.scopes,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
      revokedAt: k.revokedAt,
    }),
  );

  const siteDomains = controlSqlite
    .prepare(
      "SELECT id, host, site_id, is_primary, verified_at FROM site_domains WHERE tenant_id = ? ORDER BY host",
    )
    .all(tenantId) as Array<{ id: number; host: string; site_id: number; is_primary: number; verified_at: number | null }>;

  return {
    connections,
    apiKeys,
    siteDomains: siteDomains.map((d) => ({
      id: d.id,
      host: d.host,
      siteId: d.site_id,
      // Site names live in the TENANT's database, and this function is a
      // control-plane read; the console links by id rather than opening a
      // second connection per row just for a label.
      siteName: null,
      isPrimary: Boolean(d.is_primary),
      verifiedAt: d.verified_at,
    })),
  };
}

export type IntegrationResult = { ok: true; note: string } | { ok: false; error: string };

/**
 * Disconnect one integration. Deliberately narrow: the console can take a
 * connection AWAY, but never create one. Connecting means an OAuth consent
 * or a password, both of which belong to the client, and a console that
 * could mint them would be a console that could read a client's mail
 * without anyone agreeing to it.
 */
export async function disconnectIntegration(tenantId: number, key: string): Promise<IntegrationResult> {
  if (key === "gmail") {
    if (!getGmailConnection(tenantId)) return { ok: false, error: "Gmail is not connected." };
    deleteGmailConnection(tenantId);
    return { ok: true, note: "Gmail disconnected. They will need to reconnect it themselves." };
  }
  if (key === "imap") {
    if (!getImapConnection(tenantId)) return { ok: false, error: "No IMAP mailbox is connected." };
    deleteImapConnection(tenantId);
    return { ok: true, note: "IMAP mailbox disconnected." };
  }
  if (key === "sending_domain") {
    if (!getSendingDomain(tenantId)) return { ok: false, error: "No sending domain is connected." };
    disconnectDomain(tenantId);
    return { ok: true, note: "Sending domain removed. Campaign sends will fail until a new one is verified." };
  }
  if (key.startsWith("facebook:")) {
    const pageId = key.slice("facebook:".length);
    await disconnectFacebookPage(tenantId, pageId);
    return { ok: true, note: "Facebook page disconnected. New lead ads will not reach the pipeline." };
  }
  if (key === "meta_posting") {
    if (!getMetaConnectionForTenant(tenantId)) return { ok: false, error: "Social posting is not connected." };
    // setMetaConnection writes through the ambient tenant's settings.
    const { setMetaConnection } = await import("@/lib/social/publisher");
    runWithTenant(tenantId, () => setMetaConnection(null));
    return { ok: true, note: "Social posting disconnected. Scheduled posts will wait rather than go out." };
  }
  return { ok: false, error: "That connection cannot be disconnected from here." };
}

/** Ask Mailgun again whether the DNS is right. The usual answer to "we've set the records". */
export async function reverifySendingDomain(tenantId: number): Promise<IntegrationResult> {
  const current = getSendingDomain(tenantId);
  if (!current) return { ok: false, error: "No sending domain is connected." };
  try {
    const updated = await refreshDomainStatus(tenantId);
    if (!updated.ok) return { ok: false, error: updated.error };
    const { record } = updated;
    return record.state === "verified"
      ? { ok: true, note: `${record.domain} is verified.` }
      : { ok: true, note: `${record.domain} is still ${record.state}. The DNS records have not all landed yet.` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not check the domain." };
  }
}

export function revokeTenantApiKey(tenantId: number, id: number): IntegrationResult {
  const key = listApiKeys(tenantId).find((k) => k.id === id);
  if (!key) return { ok: false, error: "No such API key." };
  if (key.revokedAt) return { ok: false, error: "That key is already revoked." };
  revokeApiKey(tenantId, id);
  return { ok: true, note: `Key ${key.prefix}… revoked. Anything using it stops working now.` };
}
