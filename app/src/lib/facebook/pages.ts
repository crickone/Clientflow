import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { splitFullName } from "@/lib/humanName";
import { GRAPH_BASE } from "./oauth";
import type { NormalizedLeadInput } from "@/lib/leads";

/**
 * Facebook Page connections (control-plane) + the Graph API calls the native
 * lead-gen integration needs. Stored control-plane (facebook_pages, via raw
 * controlSqlite prepared statements like apiKeys.ts) because the leadgen webhook
 * has NO session and must resolve the owning tenant + Page token from an
 * incoming page_id. Page access tokens are secrets — never returned to the UI or
 * put in a thrown/logged string.
 */

interface GraphPage {
  id: string;
  name?: string;
  access_token?: string;
}

/**
 * After OAuth: fetch the user's Pages (with per-Page tokens), store each
 * connection for `tenantId`, and subscribe each Page to our `leadgen` webhook.
 * Returns the connected Page names (for the settings redirect). Throws on the
 * /me/accounts Graph failure (the callback catches); the per-Page subscribe is
 * best-effort. Re-connecting a Page updates its one row (page_id unique).
 */
export async function saveConnectedPages(
  tenantId: number,
  longLivedUserToken: string,
  connectedByUserId: number,
): Promise<string[]> {
  const res = await fetch(
    `${GRAPH_BASE}/me/accounts?` +
      new URLSearchParams({ fields: "id,name,access_token", access_token: longLivedUserToken, limit: "100" }),
  );
  if (!res.ok) throw new Error(`Facebook /me/accounts failed (${res.status})`);
  const body = (await res.json()) as { data?: GraphPage[] };
  const pages = (body.data ?? []).filter((p) => Boolean(p.id && p.access_token));

  const findExisting = controlSqlite.prepare("SELECT id FROM facebook_pages WHERE page_id = ?");
  const insert = controlSqlite.prepare(
    `INSERT INTO facebook_pages (tenant_id, page_id, page_name, page_access_token, connected_by_user_id, subscribed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = controlSqlite.prepare(
    `UPDATE facebook_pages SET tenant_id = ?, page_name = ?, page_access_token = ?,
       connected_by_user_id = ?, subscribed_at = ?, revoked_at = NULL WHERE id = ?`,
  );

  const names: string[] = [];
  for (const page of pages) {
    let subscribedAt: number | null = null;
    try {
      if (await subscribePageToLeadgen(page.id, page.access_token!)) subscribedAt = Date.now();
    } catch {
      // best-effort: store the connection even if subscribe hiccups — it can be
      // retried, and the webhook still resolves the Page by page_id.
    }
    const existing = findExisting.get(page.id) as { id: number } | undefined;
    if (existing) {
      update.run(tenantId, page.name ?? null, page.access_token, connectedByUserId, subscribedAt, existing.id);
    } else {
      insert.run(tenantId, page.id, page.name ?? null, page.access_token, connectedByUserId, subscribedAt);
    }
    names.push(page.name ?? page.id);
  }
  return names;
}

/** Subscribe a Page to the app's `leadgen` webhook field. Returns whether Graph confirmed it. */
export async function subscribePageToLeadgen(pageId: string, pageAccessToken: string): Promise<boolean> {
  const res = await fetch(`${GRAPH_BASE}/${encodeURIComponent(pageId)}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ subscribed_fields: "leadgen", access_token: pageAccessToken }),
  });
  if (!res.ok) return false;
  const body = (await res.json().catch(() => ({}))) as { success?: boolean };
  return body.success !== false;
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

export interface FacebookPageRow {
  pageId: string;
  pageName: string | null;
  subscribedAt: number | null;
  createdAt: number;
}

/** List a tenant's connected Pages for the settings UI — WITHOUT the token. */
export function listFacebookPages(tenantId: number): FacebookPageRow[] {
  const rows = controlSqlite
    .prepare(
      "SELECT page_id, page_name, subscribed_at, created_at FROM facebook_pages WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
    )
    .all(tenantId) as Array<{ page_id: string; page_name: string | null; subscribed_at: number | null; created_at: number }>;
  return rows.map((r) => ({
    pageId: r.page_id,
    pageName: r.page_name,
    subscribedAt: r.subscribed_at,
    createdAt: r.created_at,
  }));
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
