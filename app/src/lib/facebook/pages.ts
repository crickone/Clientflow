import "server-only";

import { controlSqlite } from "@/lib/db/control";
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
 * put in a thrown/logged string.
 */


/**
 * After OAuth: store each granted Page (with its Page token and linked
 * Instagram account) for `tenantId`, and subscribe each Page to our webhook
 * (leads + messages). Returns the connected Page names. The per-Page subscribe
 * is best-effort. Re-connecting a Page updates its one row (page_id unique).
 */
export async function saveConnectedPages(
  tenantId: number,
  pages: GraphPage[],
  connectedByUserId: number,
): Promise<string[]> {
  const findExisting = controlSqlite.prepare("SELECT id FROM facebook_pages WHERE page_id = ?");
  const insert = controlSqlite.prepare(
    `INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, connected_by_user_id, subscribed_at, ig_user_id, ig_username)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = controlSqlite.prepare(
    `UPDATE facebook_pages SET tenant_id = ?, page_name = ?, page_access_token = ?,
       connected_by_user_id = ?, subscribed_at = ?, ig_user_id = ?, ig_username = ?, revoked_at = NULL WHERE id = ?`,
  );

  const names: string[] = [];
  for (const page of pages) {
    let subscribedAt: number | null = null;
    try {
      if (await subscribePageToWebhook(page.id, page.access_token!)) subscribedAt = Date.now();
    } catch {
      // best-effort: store the connection even if subscribe hiccups — it can be
      // retried, and the webhook still resolves the Page by page_id.
    }
    const igUserId = page.instagram_business_account?.id ?? null;
    const igUsername = page.instagram_business_account?.username ?? null;
    const existing = findExisting.get(page.id) as { id: number } | undefined;
    if (existing) {
      update.run(tenantId, page.name ?? null, page.access_token, connectedByUserId, subscribedAt, igUserId, igUsername, existing.id);
    } else {
      insert.run(tenantId, page.id, page.name ?? null, page.access_token, connectedByUserId, subscribedAt, igUserId, igUsername);
    }
    names.push(page.name ?? page.id);
  }
  return names;
}

/** The Page webhook fields we use: lead ads, then Messenger (which also carries Instagram DMs). */
const PAGE_FIELDS_FULL = "leadgen,messages,messaging_postbacks,message_echoes";

/**
 * Subscribe a Page to the app's webhook. Messaging fields need pages_messaging;
 * if the grant lacks it the whole call fails, so fall back to leads alone
 * rather than leave the Page unsubscribed. Returns whether Graph confirmed it.
 */
export async function subscribePageToWebhook(pageId: string, pageAccessToken: string): Promise<boolean> {
  for (const fields of [PAGE_FIELDS_FULL, "leadgen"]) {
    const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ subscribed_fields: fields, access_token: pageAccessToken }),
    });
    if (!res.ok) continue;
    const body = (await res.json().catch(() => ({}))) as { success?: boolean };
    if (body.success !== false) return true;
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
  return { tenantId: row.tenant_id, pageAccessToken: row.page_access_token, pageName: row.page_name };
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
  return row ? { tenantId: row.tenant_id, pageId: row.page_id, pageAccessToken: row.page_access_token } : null;
}

/** A connected Page's token for sending a DM, scoped to the tenant (server-only). */
export function getPageTokenForTenant(tenantId: number, pageId: string): string | null {
  const row = controlSqlite
    .prepare("SELECT page_access_token FROM facebook_pages WHERE tenant_id = ? AND page_id = ? AND revoked_at IS NULL AND page_access_token != ''")
    .get(tenantId, pageId) as { page_access_token: string } | undefined;
  return row?.page_access_token ?? null;
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
  return { pageId: row.page_id, pageName: row.page_name, pageAccessToken: row.page_access_token, igUserId: row.ig_user_id };
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
          new URLSearchParams({ access_token: row.page_access_token }),
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
