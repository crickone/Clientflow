import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { openStored, SEALED_PREFIX } from "./pageTokenAtRest";
import { splitFullName } from "@/lib/humanName";
import { GRAPH_BASE } from "./graph";
import type { GraphPage } from "./grants";
import type { NormalizedLeadInput } from "@/lib/leads";

/**
 * Facebook Page connections (control-plane) + the Graph API calls the native
 * lead-gen integration needs. Stored control-plane (facebook_pages, via raw
 * controlSqlite prepared statements like apiKeys.ts) because the leadgen webhook
 * has NO session and must resolve the owning tenant + Page token from an
 * incoming page_id. Page access tokens are secrets — never returned to the UI or
 * put in a thrown/logged string, and sealed at rest (sealPageToken) with the
 * same key as every other stored token.
 */

/** Encrypt a Page token for storage, marked as sealed. Empty stays empty (the revoked marker). */
export function sealPageToken(plain: string): string {
  return plain ? SEALED_PREFIX + encryptToken(plain) : "";
}

/**
 * The usable Page token from a stored value: sealed (prefixed), sealed before
 * the prefix existed, or plaintext from before 2026-10-22 (re-sealed at boot by
 * control.ts). One this key cannot read comes back empty, so the Page shows as
 * needing a reconnect instead of sending garbage to Meta.
 */
export function openPageToken(stored: string): string {
  return openStored(stored, { decrypt: decryptToken });
}


/** How a claim went: connected here, or held by another business (left there). */
export type ClaimResult = "connected" | "elsewhere";

/**
 * Connect one Page to `tenantId`, atomically. The claim succeeds only when no
 * OTHER business holds the Page live: a new row, a row this business already
 * has, or a row someone disconnected. It is one conditional write, so two
 * businesses connecting at the same moment cannot both win, and nothing above
 * it can forget the rule. Subscribes the Page to our webhook (best-effort).
 *
 * This is the only function that writes a Page's owner. 2026-11-10: the old
 * save reassigned any Page the token listed to whoever connected last, which
 * moved the Adonis Agent Page into Optimal Health's account.
 */
export async function claimPage(tenantId: number, page: GraphPage, connectedByUserId: number): Promise<ClaimResult> {
  const held = controlSqlite
    .prepare("SELECT tenant_id FROM facebook_pages WHERE page_id = ? AND revoked_at IS NULL")
    .get(page.id) as { tenant_id: number } | undefined;
  if (held && held.tenant_id !== tenantId) return "elsewhere";

  let subscribedAt: number | null = null;
  try {
    if (await subscribePageToWebhook(page.id, page.access_token ?? "")) subscribedAt = Date.now();
  } catch (err) {
    // best-effort: the connection is stored either way and can be retried.
    console.error(`[facebook] Page ${page.id} subscribe threw:`, err);
  }
  const igUserId = page.instagram_business_account?.id ?? null;
  const igUsername = page.instagram_business_account?.username ?? null;
  const token = sealPageToken(page.access_token ?? "");

  const claimed = controlSqlite.transaction(() => {
    controlSqlite
      .prepare(
        `INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, connected_by_user_id, subscribed_at, ig_user_id, ig_username)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(page_id) DO NOTHING`,
      )
      .run(tenantId, page.id, page.name ?? null, token, connectedByUserId, subscribedAt, igUserId, igUsername);
    // Ours, or free: take it. Live elsewhere: changes nothing.
    const res = controlSqlite
      .prepare(
        `UPDATE facebook_pages SET tenant_id = ?, page_name = ?, page_access_token = ?, connected_by_user_id = ?,
           subscribed_at = ?, ig_user_id = ?, ig_username = ?, revoked_at = NULL
         WHERE page_id = ? AND (tenant_id = ? OR revoked_at IS NOT NULL)`,
      )
      .run(tenantId, page.name ?? null, token, connectedByUserId, subscribedAt, igUserId, igUsername, page.id, tenantId);
    return res.changes > 0;
  })();
  if (!claimed) {
    console.log(`[facebook] Page ${page.id} left with another business: connected there`);
    return "elsewhere";
  }
  return "connected";
}

/**
 * After OAuth. Facebook's Page list is recorded as OFFERS, not connections:
 * the never-expiring business login returns every Page the integration was
 * ever given and does not say which were ticked. Then:
 *
 * - Pages this business already has connected get their fresh tokens.
 * - A business with no Page yet, offered exactly one Page nobody else holds,
 *   gets that one: the obvious case, so a first connect stays one click.
 * - Everything else waits for the business to pick it in Settings.
 *
 * A Page this business disconnected is never reconnected by a reconnect: a
 * disconnect is a decision, and only picking the Page again undoes it.
 */
export async function applyConnectedPages(
  tenantId: number,
  pages: GraphPage[],
  connectedByUserId: number,
): Promise<{ connected: string[]; waiting: number }> {
  recordPageOffers(tenantId, pages);
  const mine = new Set(listFacebookPages(tenantId).map((p) => p.pageId));
  const connected: string[] = [];

  for (const page of pages) {
    if (mine.has(page.id) && (await claimPage(tenantId, page, connectedByUserId)) === "connected") {
      connected.push(page.name ?? page.id);
    }
  }

  if (mine.size === 0) {
    const free = pages.filter((p) => !pageHeldElsewhere(tenantId, p.id) && !disconnectedHere(tenantId, p.id));
    if (free.length === 1 && (await claimPage(tenantId, free[0], connectedByUserId)) === "connected") {
      connected.push(free[0].name ?? free[0].id);
    }
  }

  const waiting = listPageOffers(tenantId).filter((o) => o.status === "available").length;
  return { connected, waiting };
}

function pageHeldElsewhere(tenantId: number, pageId: string): boolean {
  const row = controlSqlite
    .prepare("SELECT tenant_id FROM facebook_pages WHERE page_id = ? AND revoked_at IS NULL")
    .get(pageId) as { tenant_id: number } | undefined;
  return Boolean(row && row.tenant_id !== tenantId);
}

function disconnectedHere(tenantId: number, pageId: string): boolean {
  return Boolean(
    controlSqlite.prepare("SELECT 1 FROM facebook_pages WHERE page_id = ? AND tenant_id = ? AND revoked_at IS NOT NULL").get(pageId, tenantId),
  );
}

/** Replace the business's offer list with what Facebook returned this time. */
export function recordPageOffers(tenantId: number, pages: GraphPage[]): void {
  const now = Date.now();
  controlSqlite.transaction(() => {
    controlSqlite.prepare("DELETE FROM facebook_page_offers WHERE tenant_id = ?").run(tenantId);
    const ins = controlSqlite.prepare(
      "INSERT OR REPLACE INTO facebook_page_offers (tenant_id, page_id, page_name, ig_username, offered_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (const p of pages) ins.run(tenantId, p.id, p.name ?? null, p.instagram_business_account?.username ?? null, now);
  })();
}

export interface PageOffer {
  pageId: string;
  pageName: string | null;
  igUsername: string | null;
  /** available: the business can connect it. elsewhere: another business has it. */
  status: "available" | "elsewhere";
}

/** Pages Facebook offered this business that it has not connected (no tokens). */
export function listPageOffers(tenantId: number): PageOffer[] {
  const rows = controlSqlite
    .prepare(
      `SELECT o.page_id, o.page_name, o.ig_username, f.tenant_id AS holder
         FROM facebook_page_offers o
         LEFT JOIN facebook_pages f ON f.page_id = o.page_id AND f.revoked_at IS NULL
        WHERE o.tenant_id = ? AND (f.tenant_id IS NULL OR f.tenant_id != ?)
        ORDER BY o.page_name COLLATE NOCASE`,
    )
    .all(tenantId, tenantId) as Array<{ page_id: string; page_name: string | null; ig_username: string | null; holder: number | null }>;
  return rows.map((r) => ({
    pageId: r.page_id,
    pageName: r.page_name,
    igUsername: r.ig_username,
    status: r.holder === null ? "available" : "elsewhere",
  }));
}

/** Whether Facebook offered this business this Page on its last connect. */
export function wasOffered(tenantId: number, pageId: string): boolean {
  return Boolean(controlSqlite.prepare("SELECT 1 FROM facebook_page_offers WHERE tenant_id = ? AND page_id = ?").get(tenantId, pageId));
}

/** The Page webhook fields we use: lead ads, then Messenger (which also carries Instagram DMs). */
const PAGE_FIELDS_FULL = "leadgen,messages,messaging_postbacks,message_echoes";

/**
 * Subscribe a Page to the app's webhook. Messaging fields need pages_messaging;
 * if the grant lacks it the whole call fails, so fall back to leads alone
 * rather than leave the Page unsubscribed. Returns whether Graph confirmed it.
 */
export async function subscribePageToWebhook(pageId: string, pageAccessToken: string): Promise<boolean> {
  // True only when MESSAGES are subscribed. If Meta refuses the full set, fall
  // back to leadgen so lead ads still arrive, but report false: this used to
  // count a leadgen-only subscription as success, so Settings ticked "Messages
  // and lead ads" for a Page that would never deliver a DM. Meta's reason is
  // logged either way (never the token).
  for (const fields of [PAGE_FIELDS_FULL, "leadgen"]) {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ subscribed_fields: fields, access_token: pageAccessToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (res.ok && body.success !== false) {
      console.log(`[facebook] Page ${pageId} subscribed to ${fields}`);
      return fields === PAGE_FIELDS_FULL;
    }
    console.error(`[facebook] Page ${pageId} subscribe to ${fields} failed (${res.status}): ${body.error?.message ?? "no reason given"}`);
  }
  return false;
}

export interface ResolvedPage {
  tenantId: number;
  pageAccessToken: string;
  pageName: string | null;
}

/** Webhook resolution: owning tenant + Page token for an incoming page_id (live connections only). */
export function getFacebookPageByPageId(pageId: string): ResolvedPage | null {
  const row = controlSqlite
    .prepare("SELECT tenant_id, page_access_token, page_name FROM facebook_pages WHERE page_id = ? AND revoked_at IS NULL")
    .get(pageId) as { tenant_id: number; page_access_token: string; page_name: string | null } | undefined;
  if (!row) return null;
  return { tenantId: row.tenant_id, pageAccessToken: openPageToken(row.page_access_token), pageName: row.page_name };
}

export interface MessagingPage {
  tenantId: number;
  pageId: string;
  pageAccessToken: string;
}

/**
 * Webhook resolution for a DM: Messenger events name the Page, Instagram events
 * name the Instagram account linked to a Page. Live connections only.
 */
export function getPageForMessagingAccount(channel: "messenger" | "instagram", accountId: string): MessagingPage | null {
  const column = channel === "messenger" ? "page_id" : "ig_user_id";
  const row = controlSqlite
    .prepare(
      `SELECT tenant_id, page_id, page_access_token FROM facebook_pages WHERE ${column} = ? AND revoked_at IS NULL AND page_access_token != ''`,
    )
    .get(accountId) as { tenant_id: number; page_id: string; page_access_token: string } | undefined;
  return row ? { tenantId: row.tenant_id, pageId: row.page_id, pageAccessToken: openPageToken(row.page_access_token) } : null;
}

/** A connected Page's token for sending a DM, scoped to the tenant (server-only). */
export function getPageTokenForTenant(tenantId: number, pageId: string): string | null {
  const row = controlSqlite
    .prepare("SELECT page_access_token FROM facebook_pages WHERE tenant_id = ? AND page_id = ? AND revoked_at IS NULL AND page_access_token != ''")
    .get(tenantId, pageId) as { page_access_token: string } | undefined;
  return row ? openPageToken(row.page_access_token) || null : null;
}

export interface FacebookPageRow {
  pageId: string;
  pageName: string | null;
  subscribedAt: number | null;
  createdAt: number;
  igUsername: string | null;
}

/** List a tenant's connected Pages for the settings UI — WITHOUT the token. */
export function listFacebookPages(tenantId: number): FacebookPageRow[] {
  const rows = controlSqlite
    .prepare(
      "SELECT page_id, page_name, subscribed_at, created_at, ig_username FROM facebook_pages WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    )
    .all(tenantId) as Array<{ page_id: string; page_name: string | null; subscribed_at: number | null; created_at: number; ig_username: string | null }>;
  return rows.map((r) => ({
    pageId: r.page_id,
    pageName: r.page_name,
    subscribedAt: r.subscribed_at,
    createdAt: r.created_at,
    igUsername: r.ig_username,
  }));
}

export interface PostingPage {
  pageId: string;
  pageName: string | null;
  pageAccessToken: string;
  igUserId: string | null;
}

/**
 * The Page a tenant posts from, with its token: `preferredPageId` when that
 * Page is still connected to this tenant, else the earliest-connected live Page.
 * Null when the tenant has no live connection. Server-side only (token).
 */
export function getPostingPage(tenantId: number, preferredPageId: string | null): PostingPage | null {
  const rows = controlSqlite
    .prepare(
      "SELECT page_id, page_name, page_access_token, ig_user_id FROM facebook_pages WHERE tenant_id = ? AND revoked_at IS NULL AND page_access_token != '' ORDER BY created_at ASC",
    )
    .all(tenantId) as Array<{ page_id: string; page_name: string | null; page_access_token: string; ig_user_id: string | null }>;
  const row = rows.find((r) => r.page_id === preferredPageId) ?? rows[0];
  if (!row) return null;
  return { pageId: row.page_id, pageName: row.page_name, pageAccessToken: openPageToken(row.page_access_token), igUserId: row.ig_user_id };
}

/** Disconnect (revoke) one of a tenant's Pages; best-effort unsubscribe from Graph. */
export async function disconnectFacebookPage(tenantId: number, pageId: string): Promise<void> {
  const row = controlSqlite
    .prepare("SELECT page_access_token FROM facebook_pages WHERE tenant_id = ? AND page_id = ? AND revoked_at IS NULL")
    .get(tenantId, pageId) as { page_access_token: string } | undefined;
  controlSqlite
    .prepare("UPDATE facebook_pages SET revoked_at = ? WHERE tenant_id = ? AND page_id = ? AND revoked_at IS NULL")
    .run(Date.now(), tenantId, pageId);
  if (row) {
    try {
      await fetch(
        `${GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps?` +
          new URLSearchParams({ access_token: openPageToken(row.page_access_token) }),
        { method: "DELETE" },
      );
    } catch {
      // best-effort — the row is already revoked, so the webhook ignores this Page.
    }
    // The privacy policy promises disconnecting deletes the stored token, so
    // wipe it once the unsubscribe call no longer needs it (column is NOT NULL).
    controlSqlite
      .prepare("UPDATE facebook_pages SET page_access_token = '' WHERE tenant_id = ? AND page_id = ? AND revoked_at IS NOT NULL")
      .run(tenantId, pageId);
  }
}

/**
 * Fetch a full lead from the Graph API (by leadgen id + Page token) and map it
 * to our normalized lead shape — including the ad/campaign context, so a native
 * lead carries the same attribution the Make setup captured. `sourceLeadId` is
 * the leadgen id (dedup with `source:"facebook"`); `fullName` is passed through
 * for upsertLead to split. Throws on a Graph failure (the webhook catches).
 */
export async function fetchLeadAsInput(leadgenId: string, pageAccessToken: string): Promise<NormalizedLeadInput> {
  const fields =
    "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform";
  const res = await fetch(
    `${GRAPH_BASE}/${encodeURIComponent(leadgenId)}?` +
      new URLSearchParams({ fields, access_token: pageAccessToken }),
  );
  if (!res.ok) throw new Error(`Facebook lead fetch failed (${res.status})`);
  const lead = (await res.json()) as {
    id?: string;
    created_time?: string;
    field_data?: Array<{ name?: string; values?: string[] }>;
    ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string;
    campaign_id?: string; campaign_name?: string; form_id?: string; platform?: string;
  };

  const answers: Record<string, string> = {};
  let email: string | null = null;
  let phone: string | null = null;
  let fullName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  for (const f of lead.field_data ?? []) {
    const name = (f.name ?? "").trim();
    if (!name) continue;
    const value = (f.values ?? []).join(", ").trim();
    switch (name) {
      case "email": email = value || null; break;
      case "phone_number": phone = value || null; break;
      case "full_name": fullName = value || null; break;
      case "first_name": firstName = value || null; break;
      case "last_name": lastName = value || null; break;
      default: answers[name] = value;
    }
  }
  // If FB only gave a full_name and we have no first name yet, let the shared
  // splitter handle it (upsertLead does this too, but being explicit is clearer).
  if (!firstName && fullName) {
    const s = splitFullName(fullName);
    firstName = s.firstName;
    lastName = lastName ?? s.lastName;
  }

  return {
    source: "facebook",
    sourceLeadId: lead.id ?? leadgenId,
    campaign: lead.campaign_name ?? null,
    firstName,
    lastName,
    fullName,
    email,
    phone,
    rawPayload: {
      campaign_id: lead.campaign_id,
      campaign_name: lead.campaign_name,
      adset_id: lead.adset_id,
      adset_name: lead.adset_name,
      ad_id: lead.ad_id,
      ad_name: lead.ad_name,
      form_id: lead.form_id,
      platform: lead.platform,
      created_time: lead.created_time,
      answers,
    },
  };
}
