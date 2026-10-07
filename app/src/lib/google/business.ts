import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { authDb } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import { googleBusinessConnections, googleReviews, type GoogleReview } from "@/lib/db/schema";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { readKeyForTenant } from "@/lib/settings";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { refreshAccessToken } from "@/lib/google/oauth";
import {
  API,
  buildLocalPost,
  dailyMetricsUrl,
  gaChannelBody,
  gaDailyBody,
  googleErrorMessage,
  keywordsUrl,
  parseDailyMetrics,
  parseGaProperties,
  parseGaReport,
  parseKeywords,
  parseReviews,
  parseScRows,
  parseScSites,
  scQueryBody,
  type DailySeries,
} from "@/lib/google/businessApi";

/**
 * A business's Google: its Business Profile listing (metrics, reviews,
 * posts), and from the same sign-in its Search Console site and Analytics
 * property. One connection per tenant in the control plane; reviews are
 * copied into the tenant's own database so the inbox can list them without
 * waiting on Google.
 *
 * Everything here fails with a readable sentence (googleErrorMessage): until
 * Google approves Business Profile API access for the app's project, the calls
 * return 403/429, and the UI says so instead of breaking.
 */

export class GoogleApiError extends Error {}

// ─── Connection ──────────────────────────────────────────────────────────────

export interface GoogleBusinessConnection {
  tenantId: number;
  email: string;
  scope: string;
  accountName: string | null;
  locationName: string | null;
  locationTitle: string | null;
  searchConsoleSite: string | null;
  ga4Property: string | null;
  ga4PropertyName: string | null;
  reviewsSyncedAt: number | null;
}

export function getGoogleBusinessConnection(tenantId: number): GoogleBusinessConnection | null {
  const r = authDb.select().from(googleBusinessConnections).where(eq(googleBusinessConnections.tenantId, tenantId)).get();
  if (!r) return null;
  return {
    tenantId: r.tenantId,
    email: r.email,
    scope: r.scope ?? "",
    accountName: r.accountName,
    locationName: r.locationName,
    locationTitle: r.locationTitle,
    searchConsoleSite: r.searchConsoleSite,
    ga4Property: r.ga4Property,
    ga4PropertyName: r.ga4PropertyName,
    reviewsSyncedAt: r.reviewsSyncedAt ? r.reviewsSyncedAt.getTime() : null,
  };
}

/** A listing is chosen: posts, reviews and profile metrics can run. */
export function isGoogleProfileConnected(tenantId: number): boolean {
  const c = getGoogleBusinessConnection(tenantId);
  return !!(c?.accountName && c.locationName);
}
export function isSearchConsoleConnected(tenantId: number): boolean {
  return !!getGoogleBusinessConnection(tenantId)?.searchConsoleSite;
}
export function isAnalyticsConnected(tenantId: number): boolean {
  return !!getGoogleBusinessConnection(tenantId)?.ga4Property;
}

export function saveGoogleBusinessConnection(opts: {
  tenantId: number;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  scope: string;
  connectedByUserId?: number;
}): void {
  const values = {
    email: opts.email,
    refreshToken: encryptToken(opts.refreshToken),
    accessToken: encryptToken(opts.accessToken),
    tokenExpiry: new Date(Date.now() + opts.expiresIn * 1000),
    scope: opts.scope,
    connectedByUserId: opts.connectedByUserId ?? null,
  };
  const existing = authDb.select({ id: googleBusinessConnections.id }).from(googleBusinessConnections).where(eq(googleBusinessConnections.tenantId, opts.tenantId)).get();
  if (existing) authDb.update(googleBusinessConnections).set(values).where(eq(googleBusinessConnections.id, existing.id)).run();
  else authDb.insert(googleBusinessConnections).values({ tenantId: opts.tenantId, ...values }).run();
}

export function setGoogleSelection(
  tenantId: number,
  patch: Partial<Pick<GoogleBusinessConnection, "accountName" | "locationName" | "locationTitle" | "searchConsoleSite" | "ga4Property" | "ga4PropertyName">>,
): void {
  authDb.update(googleBusinessConnections).set(patch).where(eq(googleBusinessConnections.tenantId, tenantId)).run();
  cache.clear();
}

export function deleteGoogleBusinessConnection(tenantId: number): void {
  authDb.delete(googleBusinessConnections).where(eq(googleBusinessConnections.tenantId, tenantId)).run();
  cache.clear();
}

async function accessToken(tenantId: number): Promise<string> {
  const row = authDb.select().from(googleBusinessConnections).where(eq(googleBusinessConnections.tenantId, tenantId)).get();
  if (!row) throw new GoogleApiError("Google is not connected. Connect it in Settings > Integrations > Google.");
  if (row.accessToken && row.tokenExpiry && row.tokenExpiry.getTime() > Date.now() + 60_000) return decryptToken(row.accessToken);
  let refreshed;
  try {
    refreshed = await refreshAccessToken(decryptToken(row.refreshToken));
  } catch {
    throw new GoogleApiError("The Google connection has expired. Reconnect it in Settings > Integrations > Google.");
  }
  authDb
    .update(googleBusinessConnections)
    .set({ accessToken: encryptToken(refreshed.access_token), tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000) })
    .where(eq(googleBusinessConnections.id, row.id))
    .run();
  return refreshed.access_token;
}

async function g<T = unknown>(tenantId: number, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken(tenantId);
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new GoogleApiError(googleErrorMessage(res.status, text));
  return (text ? JSON.parse(text) : {}) as T;
}

/** The signed-in Google account's address, straight after the code exchange. */
export async function fetchGoogleEmail(token: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return "";
  return ((await res.json()) as { email?: string }).email ?? "";
}

// ─── Choosing what to read ───────────────────────────────────────────────────

export interface ListingChoice {
  accountName: string;
  locationName: string;
  title: string;
  address: string;
}

export async function listGoogleListings(tenantId: number): Promise<ListingChoice[]> {
  const accounts = await g<{ accounts?: Array<{ name?: string }> }>(tenantId, API.accounts);
  const out: ListingChoice[] = [];
  for (const a of (accounts.accounts ?? []).slice(0, 10)) {
    if (!a.name) continue;
    const locs = await g<{ locations?: Array<{ name?: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string } }> }>(
      tenantId,
      API.locations(a.name),
    );
    for (const l of locs.locations ?? []) {
      if (!l.name) continue;
      const addr = [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality].filter(Boolean).join(", ");
      out.push({ accountName: a.name, locationName: l.name, title: l.title ?? l.name, address: addr });
    }
  }
  return out;
}

export async function listSearchConsoleSites(tenantId: number): Promise<string[]> {
  return parseScSites(await g(tenantId, API.scSites));
}

export async function listAnalyticsProperties(tenantId: number): Promise<{ property: string; name: string }[]> {
  return parseGaProperties(await g(tenantId, API.gaSummaries));
}

// ─── Metrics (cached in-process) ─────────────────────────────────────────────

const TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

const dayStart = (ms: number) => Math.floor(ms / 86_400_000) * 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function need(c: GoogleBusinessConnection | null, what: "profile" | "sc" | "ga"): GoogleBusinessConnection {
  if (!c) throw new GoogleApiError("Google is not connected. Connect it in Settings > Integrations > Google.");
  if (what === "profile" && !(c.accountName && c.locationName)) throw new GoogleApiError("Pick your business listing in Settings > Integrations > Google.");
  if (what === "sc" && !c.searchConsoleSite) throw new GoogleApiError("Pick your website in Search Console, in Settings > Integrations > Google.");
  if (what === "ga" && !c.ga4Property) throw new GoogleApiError("Pick your Analytics property in Settings > Integrations > Google.");
  return c;
}

/**
 * Daily profile metrics for [fromMs, toMs). Google's data lags a few days
 * and the API rejects an end date in the future, so the range is clamped to
 * yesterday.
 */
export async function getProfileSeries(tenantId: number, fromMs: number, toMs: number): Promise<DailySeries> {
  const c = need(getGoogleBusinessConnection(tenantId), "profile");
  const end = Math.min(dayStart(toMs - 1), dayStart(Date.now()) - 86_400_000);
  const start = Math.min(dayStart(fromMs), end);
  return cached(`p:${tenantId}:${c.locationName}:${start}:${end}`, async () =>
    parseDailyMetrics(await g(tenantId, dailyMetricsUrl(c.locationName!, start, end))),
  );
}

/** Search terms people used to find the listing, for the last complete month. */
export async function getSearchKeywords(tenantId: number) {
  const c = need(getGoogleBusinessConnection(tenantId), "profile");
  const d = new Date();
  const lastMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const y = lastMonth.getUTCFullYear();
  const m = lastMonth.getUTCMonth() + 1;
  const rows = await cached(`k:${tenantId}:${c.locationName}:${y}-${m}`, async () =>
    parseKeywords(await g(tenantId, keywordsUrl(c.locationName!, y, m))),
  );
  return { month: lastMonth.toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" }), rows };
}

export async function getSearchConsoleRows(tenantId: number, fromMs: number, toMs: number, dimension: "query" | "page" | "date", rowLimit = 10) {
  const c = need(getGoogleBusinessConnection(tenantId), "sc");
  const from = isoDay(fromMs);
  const to = isoDay(Math.min(toMs - 1, Date.now()));
  return cached(`sc:${tenantId}:${c.searchConsoleSite}:${dimension}:${from}:${to}:${rowLimit}`, async () =>
    parseScRows(await g(tenantId, API.scQuery(c.searchConsoleSite!), { body: scQueryBody(from, to, dimension, rowLimit) })),
  );
}

export async function getAnalyticsDaily(tenantId: number, fromMs: number, toMs: number) {
  const c = need(getGoogleBusinessConnection(tenantId), "ga");
  const from = isoDay(fromMs);
  const to = isoDay(Math.min(toMs - 1, Date.now()));
  return cached(`ga:${tenantId}:${c.ga4Property}:${from}:${to}`, async () =>
    parseGaReport(await g(tenantId, API.gaReport(c.ga4Property!), { body: gaDailyBody(from, to) })).map((r) => ({
      day: r.dims[0],
      sessions: r.values[0] ?? 0,
      users: r.values[1] ?? 0,
      views: r.values[2] ?? 0,
    })),
  );
}

export async function getAnalyticsChannels(tenantId: number, fromMs: number, toMs: number) {
  const c = need(getGoogleBusinessConnection(tenantId), "ga");
  const from = isoDay(fromMs);
  const to = isoDay(Math.min(toMs - 1, Date.now()));
  return cached(`gac:${tenantId}:${c.ga4Property}:${from}:${to}`, async () =>
    parseGaReport(await g(tenantId, API.gaReport(c.ga4Property!), { body: gaChannelBody(from, to) })).map((r) => ({
      channel: r.dims[0] || "(other)",
      sessions: r.values[0] ?? 0,
    })),
  );
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

const SUMMARY_KEY = "google_review_summary";
const SYNC_GAP_MS = 30 * 60 * 1000;

/** Copy the latest reviews into the tenant's database. Returns how many are new. */
export async function syncGoogleReviews(tenantId: number): Promise<number> {
  const c = need(getGoogleBusinessConnection(tenantId), "profile");
  const parsed = parseReviews(await g(tenantId, API.reviews(c.accountName!, c.locationName!)));
  const tdb = getTenantDbById(tenantId);
  const now = new Date();
  let fresh = 0;
  for (const r of parsed.reviews) {
    const existing = tdb.select().from(googleReviews).where(eq(googleReviews.reviewName, r.name)).get();
    const values = {
      reviewer: r.reviewer,
      photoUrl: r.photoUrl,
      rating: r.rating,
      comment: r.comment,
      reviewedAt: new Date(r.createdAt || Date.now()),
      updatedAt: new Date(r.updatedAt || r.createdAt || Date.now()),
      reply: r.reply,
      repliedAt: r.repliedAt ? new Date(r.repliedAt) : null,
      syncedAt: now,
    };
    if (!existing) {
      tdb.insert(googleReviews).values({ reviewName: r.name, isRead: false, ...values }).run();
      fresh++;
    } else {
      // An edited review is new to the operator again.
      const edited = values.updatedAt.getTime() > existing.updatedAt.getTime() && values.comment !== existing.comment;
      tdb.update(googleReviews).set({ ...values, ...(edited ? { isRead: false } : {}) }).where(eq(googleReviews.id, existing.id)).run();
    }
  }
  tdb.run(sql`INSERT INTO settings (key, value) VALUES (${SUMMARY_KEY}, ${JSON.stringify({ average: parsed.average, total: parsed.total, at: now.getTime() })})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  authDb.update(googleBusinessConnections).set({ reviewsSyncedAt: now }).where(eq(googleBusinessConnections.tenantId, tenantId)).run();
  return fresh;
}

// Failed attempts are spaced out too: until Google approves the app every call
// is refused, and the minute ticker must not knock on the door sixty times an hour.
const lastAttempt = new Map<number, number>();

/** Sync when the last one is older than half an hour; never throws. */
export async function syncGoogleReviewsIfStale(tenantId: number, timeoutMs = 4000): Promise<void> {
  const c = getGoogleBusinessConnection(tenantId);
  if (!c?.locationName) return;
  if (c.reviewsSyncedAt && Date.now() - c.reviewsSyncedAt < SYNC_GAP_MS) return;
  if (Date.now() - (lastAttempt.get(tenantId) ?? 0) < SYNC_GAP_MS) return;
  lastAttempt.set(tenantId, Date.now());
  await Promise.race([syncGoogleReviews(tenantId).catch(() => 0), new Promise((r) => setTimeout(r, timeoutMs))]);
}

export function listStoredReviews(tenantId: number, limit = 200): GoogleReview[] {
  return getTenantDbById(tenantId).select().from(googleReviews).orderBy(desc(googleReviews.updatedAt)).limit(limit).all();
}

export function getReviewSummary(tenantId: number): { average: number | null; total: number | null; at: number } | null {
  return readKeyForTenant(tenantId, SUMMARY_KEY, null);
}

export function markReviewsRead(tenantId: number, ids: number[]): void {
  if (ids.length === 0) return;
  const tdb = getTenantDbById(tenantId);
  for (const id of ids) tdb.update(googleReviews).set({ isRead: true }).where(eq(googleReviews.id, id)).run();
}

/** Post (or replace) the business's public reply to a review. */
export async function replyToGoogleReview(tenantId: number, reviewId: number, text: string): Promise<void> {
  const tdb = getTenantDbById(tenantId);
  const row = tdb.select().from(googleReviews).where(eq(googleReviews.id, reviewId)).get();
  if (!row) throw new GoogleApiError("That review is no longer in the list. Refresh and try again.");
  const comment = text.trim();
  if (!comment) throw new GoogleApiError("Write a reply first.");
  if (comment.length > 4000) throw new GoogleApiError("Google allows up to 4,000 characters in a reply.");
  await g(tenantId, API.reviewReply(row.reviewName), { method: "PUT", body: { comment } });
  tdb.update(googleReviews).set({ reply: comment, repliedAt: new Date(), isRead: true }).where(eq(googleReviews.id, reviewId)).run();
}

// ─── Posts ───────────────────────────────────────────────────────────────────

/** Publish a post to the listing. Google downloads the image from `imageUrl`. */
export async function postToGoogle(tenantId: number, input: { caption: string; imageUrl: string | null }): Promise<string> {
  const c = need(getGoogleBusinessConnection(tenantId), "profile");
  const profile = getBusinessProfileForTenant(tenantId);
  const body = buildLocalPost({ caption: input.caption, imageUrl: input.imageUrl, phone: profile.phone || null, websiteUrl: profile.website || null });
  const res = await g<{ name?: string; searchUrl?: string }>(tenantId, API.localPosts(c.accountName!, c.locationName!), { body });
  return res.searchUrl ?? res.name ?? "posted";
}
