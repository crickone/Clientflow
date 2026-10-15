import "server-only";

import crypto from "node:crypto";

import { parseFitbit, parseOura, parsePolar, parseWhoop, parseWithings, type ProviderId, type WearableDay } from "@/lib/wearables/model";

/**
 * The six wearable APIs, direct (no aggregator). Each needs a developer app
 * registered by the business owner, with its keys in the environment:
 * <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET. A provider without keys
 * shows as "coming soon" in the app. The callback to register with each one
 * is <APP_URL>/api/wearables/callback/<provider>.
 *
 * Raw fetch on purpose, like the other integrations. WEARABLES_TEST_BASE
 * (dev only) points every provider at one local mock server.
 */

export class WearableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  scopeSep?: string;
  pkce: boolean;
  /** How the client id/secret go to the token endpoint. */
  clientAuth: "basic" | "body";
  /** Garmin pushes data to us instead of us pulling it. */
  push?: boolean;
}

const CONFIG: Record<ProviderId, ProviderConfig> = {
  fitbit: { authorizeUrl: "https://www.fitbit.com/oauth2/authorize", tokenUrl: "https://api.fitbit.com/oauth2/token", scope: "activity heartrate sleep weight", pkce: true, clientAuth: "basic" },
  oura: { authorizeUrl: "https://cloud.ouraring.com/oauth/authorize", tokenUrl: "https://api.ouraring.com/oauth/token", scope: "daily heartrate personal", pkce: false, clientAuth: "body" },
  whoop: { authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth", tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token", scope: "read:recovery read:sleep read:cycles read:profile offline", pkce: false, clientAuth: "body" },
  withings: { authorizeUrl: "https://account.withings.com/oauth2_user/authorize2", tokenUrl: "https://wbsapi.withings.net/v2/oauth2", scope: "user.metrics,user.activity", scopeSep: ",", pkce: false, clientAuth: "body" },
  polar: { authorizeUrl: "https://flow.polar.com/oauth2/authorization", tokenUrl: "https://polarremote.com/v2/oauth2/token", scope: "accesslink.read_all", pkce: false, clientAuth: "basic" },
  garmin: { authorizeUrl: "https://connect.garmin.com/oauth2Confirm", tokenUrl: "https://diauth.garmin.com/di-oauth2-service/oauth/token", scope: "", pkce: true, clientAuth: "body", push: true },
};

export function isPushProvider(p: ProviderId): boolean {
  return CONFIG[p].push === true;
}

function keys(p: ProviderId): { id: string; secret: string } | null {
  const up = p.toUpperCase();
  const id = process.env[`${up}_CLIENT_ID`]?.trim();
  const secret = process.env[`${up}_CLIENT_SECRET`]?.trim();
  return id && secret ? { id, secret } : null;
}

export function isProviderConfigured(p: ProviderId): boolean {
  return keys(p) !== null;
}

/** Dev only: send every provider URL to one mock server, keeping the path. */
function u(url: string): string {
  const base = process.env.NODE_ENV !== "production" ? process.env.WEARABLES_TEST_BASE?.trim() : "";
  if (!base) return url;
  const parsed = new URL(url);
  return `${base.replace(/\/$/, "")}/${parsed.hostname}${parsed.pathname}${parsed.search}`;
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(p: ProviderId, opts: { state: string; redirectUri: string; challenge: string | null }): string {
  const k = keys(p);
  if (!k) throw new WearableError(`${p} isn't set up yet.`, 503);
  const c = CONFIG[p];
  const q = new URLSearchParams({ response_type: "code", client_id: k.id, redirect_uri: opts.redirectUri, state: opts.state });
  if (c.scope) q.set("scope", c.scope);
  if (c.pkce && opts.challenge) {
    q.set("code_challenge", opts.challenge);
    q.set("code_challenge_method", "S256");
  }
  return `${u(c.authorizeUrl)}?${q.toString()}`;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  externalUserId: string | null;
}

async function call(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new WearableError(`${new URL(url).hostname} said ${res.status}: ${typeof body === "string" ? body.slice(0, 160) : JSON.stringify(body).slice(0, 160)}`, res.status);
  return body;
}

function tokenFrom(p: ProviderId, raw: unknown, now: number): Tokens {
  // Withings wraps everything in {status, body}; a non-zero status is an error.
  let b = (raw ?? {}) as Record<string, unknown>;
  if (p === "withings") {
    if (b.status !== 0) throw new WearableError(`Withings said status ${String(b.status)}`, 400);
    b = (b.body ?? {}) as Record<string, unknown>;
  }
  const access = typeof b.access_token === "string" ? b.access_token : "";
  if (!access) throw new WearableError("No access token came back.", 400);
  const exp = typeof b.expires_in === "number" ? b.expires_in : Number(b.expires_in);
  const uid = b.user_id ?? b.x_user_id ?? b.userid ?? null;
  return {
    accessToken: access,
    refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
    expiresAt: Number.isFinite(exp) && exp > 0 ? now + exp * 1000 : null,
    externalUserId: uid === null || uid === undefined ? null : String(uid),
  };
}

async function tokenRequest(p: ProviderId, params: Record<string, string>): Promise<Tokens> {
  const k = keys(p);
  if (!k) throw new WearableError(`${p} isn't set up yet.`, 503);
  const c = CONFIG[p];
  const form = new URLSearchParams(params);
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (p === "withings") form.set("action", "requesttoken");
  if (c.clientAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${k.id}:${k.secret}`).toString("base64")}`;
  else {
    form.set("client_id", k.id);
    form.set("client_secret", k.secret);
  }
  return tokenFrom(p, await call(u(c.tokenUrl), { method: "POST", headers, body: form.toString() }), Date.now());
}

export async function exchangeCode(p: ProviderId, code: string, redirectUri: string, verifier: string | null): Promise<Tokens> {
  const params: Record<string, string> = { grant_type: "authorization_code", code, redirect_uri: redirectUri };
  if (CONFIG[p].pkce && verifier) params.code_verifier = verifier;
  const t = await tokenRequest(p, params);
  // Some providers name the account separately, or need the member registered first.
  if (p === "whoop" && !t.externalUserId) {
    // Only a label for the account: data is pulled with the token, so a failed lookup doesn't stop the connection.
    const prof = (await call(u("https://api.prod.whoop.com/developer/v2/user/profile/basic"), { headers: bearer(t.accessToken) }).catch(() => null)) as { user_id?: unknown } | null;
    if (prof?.user_id !== undefined) t.externalUserId = String(prof.user_id);
  }
  if (p === "polar") await registerPolarUser(t);
  if (p === "garmin") {
    const id = (await call(u("https://apis.garmin.com/wellness-api/rest/user/id"), { headers: bearer(t.accessToken) })) as { userId?: unknown };
    if (id?.userId) t.externalUserId = String(id.userId);
  }
  return t;
}

export async function refresh(p: ProviderId, refreshToken: string): Promise<Tokens> {
  return tokenRequest(p, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Tell the provider we're done with this member (best effort). */
export async function revoke(p: ProviderId, accessToken: string, externalUserId: string | null): Promise<void> {
  try {
    if (p === "garmin") await call(u("https://apis.garmin.com/wellness-api/rest/user/registration"), { method: "DELETE", headers: bearer(accessToken) });
    if (p === "polar" && externalUserId) await call(u(`https://www.polaraccesslink.com/v3/users/${encodeURIComponent(externalUserId)}`), { method: "DELETE", headers: bearer(accessToken) });
  } catch {
    /* already gone, or the provider is down: the connection is removed on our side either way */
  }
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function registerPolarUser(t: Tokens): Promise<void> {
  try {
    await call(u("https://www.polaraccesslink.com/v3/users"), { method: "POST", headers: { ...bearer(t.accessToken), "Content-Type": "application/json" }, body: JSON.stringify({ "member-id": crypto.randomUUID() }) });
  } catch (e) {
    // 409: already registered with this app, which is fine.
    if (!(e instanceof WearableError && e.status === 409)) throw e;
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Pull the days in [from, to] (inclusive, YYYY-MM-DD). Garmin pushes instead, so it returns nothing here. */
export async function fetchDays(p: ProviderId, accessToken: string, externalUserId: string | null, from: string, to: string): Promise<WearableDay[]> {
  const h = bearer(accessToken);
  if (p === "fitbit") {
    const base = "https://api.fitbit.com";
    const [steps, heart, sleep, hrv, weight] = await Promise.all([
      call(u(`${base}/1/user/-/activities/steps/date/${from}/${to}.json`), { headers: h }),
      call(u(`${base}/1/user/-/activities/heart/date/${from}/${to}.json`), { headers: h }),
      call(u(`${base}/1.2/user/-/sleep/date/${from}/${to}.json`), { headers: h }),
      call(u(`${base}/1/user/-/hrv/date/${from}/${to}.json`), { headers: h }).catch(() => null),
      call(u(`${base}/1/user/-/body/log/weight/date/${from}/${to}.json`), { headers: h }).catch(() => null),
    ]);
    return parseFitbit({ steps, heart, sleep, hrv, weight });
  }
  if (p === "oura") {
    const q = `start_date=${from}&end_date=${to}`;
    const base = "https://api.ouraring.com/v2/usercollection";
    const [activity, dailySleep, sleep, readiness] = await Promise.all(["daily_activity", "daily_sleep", "sleep", "daily_readiness"].map((c) => call(u(`${base}/${c}?${q}`), { headers: h })));
    return parseOura({ activity, dailySleep, sleep, readiness });
  }
  if (p === "whoop") {
    const start = `${from}T00:00:00.000Z`;
    const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
    const all = async (path: string) => {
      const records: unknown[] = [];
      let next: string | null = null;
      for (let i = 0; i < 5; i++) {
        const q = new URLSearchParams({ start, end, limit: "25" });
        if (next) q.set("nextToken", next);
        const r = (await call(u(`https://api.prod.whoop.com/developer/v2${path}?${q}`), { headers: h })) as { records?: unknown[]; next_token?: string | null };
        records.push(...(r?.records ?? []));
        next = r?.next_token ?? null;
        if (!next) break;
      }
      return { records };
    };
    const [recovery, sleep, cycle] = await Promise.all([all("/recovery"), all("/activity/sleep"), all("/cycle")]);
    return parseWhoop({ recovery, sleep, cycle });
  }
  if (p === "withings") {
    const post = (path: string, params: Record<string, string>) =>
      call(u(`https://wbsapi.withings.net${path}`), { method: "POST", headers: { ...h, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
    const startUnix = String(Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000));
    const endUnix = String(Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000));
    const [activity, meas, sleep] = await Promise.all([
      post("/v2/measure", { action: "getactivity", startdateymd: from, enddateymd: to, data_fields: "steps,calories" }),
      post("/measure", { action: "getmeas", meastypes: "1,6", category: "1", startdate: startUnix, enddate: endUnix }),
      post("/v2/sleep", { action: "getsummary", startdateymd: from, enddateymd: to, data_fields: "total_sleep_time,sleep_score,hr_min" }),
    ]);
    return parseWithings({ activity, meas, sleep });
  }
  if (p === "polar") {
    const base = "https://www.polaraccesslink.com/v3";
    const [sleep, recharge] = await Promise.all([call(u(`${base}/users/sleep`), { headers: h }).catch(() => null), call(u(`${base}/users/nightly-recharge`), { headers: h }).catch(() => null)]);
    const activities = externalUserId ? await polarActivities(base, h, externalUserId) : [];
    return parsePolar({ sleep, recharge, activities }).filter((d) => d.day >= from && d.day <= to);
  }
  return [];
}

/** Polar hands out new daily activity through a transaction: open, read each summary, commit. */
async function polarActivities(base: string, h: Record<string, string>, uid: string): Promise<unknown[]> {
  const res = await fetch(u(`${base}/users/${encodeURIComponent(uid)}/activity-transactions`), { method: "POST", headers: h, signal: AbortSignal.timeout(20_000) });
  if (res.status === 204 || !res.ok) return [];
  const tx = (await res.json().catch(() => null)) as { "transaction-id"?: number } | null;
  const tid = tx?.["transaction-id"];
  if (!tid) return [];
  const list = (await call(u(`${base}/users/${encodeURIComponent(uid)}/activity-transactions/${tid}`), { headers: h })) as { "activity-log"?: string[] };
  const out: unknown[] = [];
  for (const url of (list?.["activity-log"] ?? []).slice(0, 60)) out.push(await call(u(url), { headers: h }).catch(() => null));
  await fetch(u(`${base}/users/${encodeURIComponent(uid)}/activity-transactions/${tid}`), { method: "PUT", headers: h, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  return out.filter(Boolean);
}

export { ymd };
