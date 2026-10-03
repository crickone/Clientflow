import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { encryptToken, decryptToken } from "@/lib/google/tokenCrypto";
import { GRAPH_BASE } from "./graph";

/**
 * A tenant's Meta grant: the one token the Facebook Login for Business connect
 * yields, plus the assets it lists. With a configuration (FACEBOOK_LOGIN_CONFIG_ID)
 * the token is a business-integration system-user token that never expires and
 * covers exactly the Pages, Instagram accounts and ad accounts the business
 * ticked; without one it is a 60-day user token. Pages keep their own Page
 * tokens in facebook_pages (posting, messaging, leads); the grant token drives
 * the Marketing API. Tokens are secrets: encrypted at rest, never returned to
 * the UI, never logged.
 */

export type TokenKind = "system_user" | "user";

export interface GraphPage {
  id: string;
  name?: string;
  access_token?: string;
  /** The Instagram professional account linked to the Page (needs instagram_basic). */
  instagram_business_account?: { id?: string; username?: string };
}

export interface GraphAdAccount {
  /** "act_<number>" — the id the Marketing API addresses. */
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";
const AD_ACCOUNT_FIELDS = "id,name,currency,timezone_name,account_status";

async function getJson<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}?` + new URLSearchParams({ ...params, access_token: token }));
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message || `Facebook ${path} failed (${res.status})`);
  return body;
}

/** Every page of a Graph list edge (bounded, so a huge business cannot loop forever). */
async function listAll<T>(path: string, token: string, fields: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${GRAPH_BASE}/${path}?` + new URLSearchParams({ fields, limit: "100", access_token: token });
  for (let i = 0; url && i < 20; i++) {
    const res: Response = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as { data?: T[]; paging?: { next?: string }; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message || `Facebook ${path} failed (${res.status})`);
    out.push(...(body.data ?? []));
    url = body.paging?.next ?? null;
  }
  return out;
}

/**
 * The asset ids a token was granted, per permission, from debug_token's
 * granular_scopes. A fallback when the /me edges come back empty for a
 * system-user token.
 */
async function grantedTargetIds(token: string, scopes: string[]): Promise<{ ids: string[]; granted: string[] }> {
  const appToken = `${process.env.FACEBOOK_APP_ID ?? ""}|${process.env.FACEBOOK_APP_SECRET ?? ""}`;
  const body = await getJson<{ data?: { scopes?: string[]; granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } }>(
    "debug_token",
    appToken,
    { input_token: token },
  );
  const ids = (body.data?.granular_scopes ?? []).filter((g) => scopes.includes(g.scope)).flatMap((g) => g.target_ids ?? []);
  return { ids: [...new Set(ids)], granted: body.data?.scopes ?? [] };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The ad accounts a token can run ads on. Meta does not list them the same way
 * for every token, so try, in order: /me/adaccounts, the ad-account ids in the
 * token's granular scopes, then the ad accounts of the businesses the token can
 * see (owned and client). Every candidate is read back with the token, so only
 * accounts it can actually reach are kept. Logs which route worked and why the
 * others did not (never the token), so an empty result is diagnosable.
 */
export async function discoverAdAccounts(token: string): Promise<GraphAdAccount[]> {
  const notes: string[] = [];
  const found = new Map<string, GraphAdAccount>();
  const add = (list: GraphAdAccount[], via: string) => {
    for (const a of list) if (a?.id && !found.has(a.id)) found.set(a.id, a);
    notes.push(`${via}=${list.length}`);
  };

  try {
    add(await listAll<GraphAdAccount>("me/adaccounts", token, AD_ACCOUNT_FIELDS), "me/adaccounts");
  } catch (e) {
    notes.push(`me/adaccounts failed: ${errText(e)}`);
  }

  if (found.size === 0) {
    try {
      const { ids, granted } = await grantedTargetIds(token, ["ads_management", "ads_read"]);
      notes.push(`scopes=${granted.join(",")}`);
      const read = await Promise.all(
        ids.map((id) =>
          getJson<GraphAdAccount>(id.startsWith("act_") ? id : `act_${id}`, token, { fields: AD_ACCOUNT_FIELDS }).catch((e) => {
            notes.push(`act_${id.replace(/^act_/, "")} failed: ${errText(e)}`);
            return null;
          }),
        ),
      );
      add(read.filter((a): a is GraphAdAccount => a !== null), "granular");
    } catch (e) {
      notes.push(`debug_token failed: ${errText(e)}`);
    }
  }

  if (found.size === 0) {
    try {
      const businesses = await listAll<{ id: string; name?: string }>("me/businesses", token, "id,name");
      notes.push(`businesses=${businesses.length}`);
      for (const b of businesses) {
        for (const edge of ["owned_ad_accounts", "client_ad_accounts"]) {
          try {
            const listed = await listAll<GraphAdAccount>(`${b.id}/${edge}`, token, AD_ACCOUNT_FIELDS);
            const reachable = await Promise.all(
              listed.map((a) => getJson<GraphAdAccount>(a.id, token, { fields: AD_ACCOUNT_FIELDS }).catch(() => null)),
            );
            add(reachable.filter((a): a is GraphAdAccount => a !== null), `${edge}`);
          } catch (e) {
            notes.push(`${edge} failed: ${errText(e)}`);
          }
        }
      }
    } catch (e) {
      notes.push(`me/businesses failed: ${errText(e)}`);
    }
  }

  console.log(`[facebook] ad account discovery: found ${found.size}; ${notes.join("; ")}`);
  return [...found.values()];
}

/** The Pages (with Page tokens + linked Instagram) and ad accounts a token was granted. */
export async function discoverAssets(token: string): Promise<{ pages: GraphPage[]; adAccounts: GraphAdAccount[] }> {
  let pages = await listAll<GraphPage>("me/accounts", token, PAGE_FIELDS);
  if (pages.length === 0) {
    const { ids } = await grantedTargetIds(token, ["pages_show_list"]).catch(() => ({ ids: [] as string[] }));
    pages = (
      await Promise.all(ids.map((id) => getJson<GraphPage>(id, token, { fields: PAGE_FIELDS }).catch(() => null)))
    ).filter((p): p is GraphPage => p !== null);
  }

  const adAccounts = await discoverAdAccounts(token);
  return { pages: pages.filter((p) => Boolean(p.id && p.access_token)), adAccounts };
}

/** Store (or replace) the tenant's grant token, encrypted. */
export function saveGrant(tenantId: number, token: string, kind: TokenKind, expiresAt: number | null, userId: number): void {
  controlSqlite
    .prepare(
      `INSERT INTO meta_grants (tenant_id, token_enc, token_kind, expires_at, granted_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET token_enc = excluded.token_enc, token_kind = excluded.token_kind,
         expires_at = excluded.expires_at, granted_by_user_id = excluded.granted_by_user_id, updated_at = excluded.updated_at`,
    )
    .run(tenantId, encryptToken(token), kind, expiresAt, userId, Date.now(), Date.now());
}

export interface GrantInfo {
  kind: TokenKind;
  expiresAt: number | null;
  updatedAt: number;
}

/** What the settings UI may know about the grant — never the token. */
export function getGrantInfo(tenantId: number): GrantInfo | null {
  const row = controlSqlite
    .prepare("SELECT token_kind, expires_at, updated_at FROM meta_grants WHERE tenant_id = ?")
    .get(tenantId) as { token_kind: TokenKind; expires_at: number | null; updated_at: number } | undefined;
  return row ? { kind: row.token_kind, expiresAt: row.expires_at, updatedAt: row.updated_at } : null;
}

/** The decrypted grant token for server-side Marketing API calls, or null. */
export function getGrantToken(tenantId: number): string | null {
  const row = controlSqlite.prepare("SELECT token_enc, expires_at FROM meta_grants WHERE tenant_id = ?").get(tenantId) as
    | { token_enc: string; expires_at: number | null }
    | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return decryptToken(row.token_enc);
}

/** Forget the grant and the ad accounts it listed. */
export function deleteGrant(tenantId: number): void {
  controlSqlite.prepare("DELETE FROM meta_grants WHERE tenant_id = ?").run(tenantId);
  controlSqlite
    .prepare("UPDATE facebook_ad_accounts SET revoked_at = ? WHERE tenant_id = ? AND revoked_at IS NULL")
    .run(Date.now(), tenantId);
}

/** Record the ad accounts a grant lists; any no longer listed are marked revoked. */
export function saveAdAccounts(tenantId: number, accounts: GraphAdAccount[]): void {
  const now = Date.now();
  const upsert = controlSqlite.prepare(
    `INSERT INTO facebook_ad_accounts (tenant_id, ad_account_id, name, currency, timezone, account_status, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(tenant_id, ad_account_id) DO UPDATE SET name = excluded.name, currency = excluded.currency,
       timezone = excluded.timezone, account_status = excluded.account_status, revoked_at = NULL`,
  );
  controlSqlite.transaction(() => {
    for (const a of accounts) {
      upsert.run(tenantId, a.id, a.name ?? null, a.currency ?? null, a.timezone_name ?? null, a.account_status ?? null, now);
    }
    const keep = new Set(accounts.map((a) => a.id));
    const live = controlSqlite
      .prepare("SELECT ad_account_id FROM facebook_ad_accounts WHERE tenant_id = ? AND revoked_at IS NULL")
      .all(tenantId) as Array<{ ad_account_id: string }>;
    const revoke = controlSqlite.prepare("UPDATE facebook_ad_accounts SET revoked_at = ? WHERE tenant_id = ? AND ad_account_id = ?");
    for (const r of live) if (!keep.has(r.ad_account_id)) revoke.run(now, tenantId, r.ad_account_id);
  })();
}

export interface AdAccountRow {
  adAccountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  /** Meta's account_status: 1 = active; anything else needs attention in Ads Manager. */
  accountStatus: number | null;
}

export function listAdAccounts(tenantId: number): AdAccountRow[] {
  const rows = controlSqlite
    .prepare(
      "SELECT ad_account_id, name, currency, timezone, account_status FROM facebook_ad_accounts WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY name",
    )
    .all(tenantId) as Array<{ ad_account_id: string; name: string | null; currency: string | null; timezone: string | null; account_status: number | null }>;
  return rows.map((r) => ({
    adAccountId: r.ad_account_id,
    name: r.name,
    currency: r.currency,
    timezone: r.timezone,
    accountStatus: r.account_status,
  }));
}
