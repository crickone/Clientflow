import "server-only";

import { inbodyCredentials } from "@/lib/inbody/connection";
import { mergeMetrics, readMetrics, type Metrics } from "@/lib/inbody/metrics";

/**
 * The InBody Web API (LookinBody Web), raw fetch. Every call is fail-soft and
 * returns a readable reason, because the commonest failures are on InBody's
 * side and the operator needs to know which one:
 *
 * - The API is a paid add-on InBody approves per account. Until then, calls
 *   are refused.
 * - The API is IP-allowlisted: the server's outbound IP must be registered in
 *   the LookinBody API portal (SETUP). An unregistered caller gets the same
 *   generic 401 as a wrong key, so a 401 says both.
 *
 * Endpoints (POST, JSON, headers `Account` + `API-KEY`):
 *   /user/test                                         connection check
 *   /inbody/GetFullInBodyDataByID {UserID, Datetimes}  full-named fields
 *   /inbody/GetInBodyDataByID     {UserID, Datetimes}  abbreviated fields
 *   /inbody/GetFullInBodyData     {usertoken, datetimes}  by phone
 *   /inbody/GetInBodyData         {usertoken, datetimes}
 *   /inbody/GetTodayMeasurements  {Date: yyyyMMdd}     [{UserID, UserToken, DateTimes}]
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const TIMEOUT_MS = 10_000;

async function call(tenantId: number, path: string, body: unknown): Promise<ApiResult<unknown>> {
  const creds = inbodyCredentials(tenantId);
  if (!creds) return { ok: false, error: "InBody isn't connected yet. Add the account name and API key in Settings." };
  let res: Response;
  try {
    res = await fetch(`${creds.base}${path}`, {
      method: "POST",
      headers: { Account: creds.account, "API-KEY": creds.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    return { ok: false, error: `Couldn't reach InBody (${err instanceof Error ? err.message : "network error"}).` };
  }
  const text = await res.text().catch(() => "");
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error:
        "InBody refused the request. Check the account name and API key, that InBody has approved API access, and that this server's IP address is registered in the LookinBody API portal.",
    };
  }
  if (!res.ok) return { ok: false, error: `InBody returned an error (${res.status}).` };
  if (!text.trim()) return { ok: true, data: null };
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: true, data: text };
  }
}

export async function testInBodyConnection(tenantId: number): Promise<ApiResult<null>> {
  const r = await call(tenantId, "/user/test", {});
  return r.ok ? { ok: true, data: null } : r;
}

/**
 * The full result of one scan, by InBody user ID (local to the gym) or by
 * phone (InBody's global "usertoken"). Asks both the full-name and the
 * abbreviated endpoint and merges them: which fields each returns varies by
 * scanner model.
 */
export async function fetchScanResult(
  tenantId: number,
  who: { userId?: string | null; phone?: string | null },
  datetimes: string,
): Promise<ApiResult<{ metrics: Metrics; raw: unknown }>> {
  const byId = Boolean(who.userId && who.userId.trim());
  if (!byId && !(who.phone && who.phone.trim())) return { ok: false, error: "The scan has no InBody ID or phone number to look it up by." };
  const [full, short] = await Promise.all(
    byId
      ? [
          call(tenantId, "/inbody/GetFullInBodyDataByID", { UserID: who.userId, Datetimes: datetimes }),
          call(tenantId, "/inbody/GetInBodyDataByID", { UserID: who.userId, Datetimes: datetimes }),
        ]
      : [
          call(tenantId, "/inbody/GetFullInBodyData", { usertoken: who.phone, datetimes }),
          call(tenantId, "/inbody/GetInBodyData", { usertoken: who.phone, datetimes }),
        ],
  );
  if (!full.ok && !short.ok) return full;
  const metrics = mergeMetrics(full.ok ? readMetrics(full.data) : {}, short.ok ? readMetrics(short.data) : {});
  return { ok: true, data: { metrics, raw: { full: full.ok ? full.data : null, short: short.ok ? short.data : null } } };
}

export interface TodayMeasurement {
  userId: string;
  phone: string;
  datetimes: string;
}

/** Every scan taken on a day (yyyyMMdd, Irish time). Needs InBody to have enabled it on the key. */
export async function measurementsOn(tenantId: number, date: string): Promise<ApiResult<TodayMeasurement[]>> {
  const r = await call(tenantId, "/inbody/GetTodayMeasurements", { Date: date });
  if (!r.ok) return r;
  const list = Array.isArray(r.data) ? r.data : [];
  const out: TodayMeasurement[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const pickStr = (...keys: string[]) => {
      for (const k of keys) {
        const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
        if (hit && o[hit] !== null && o[hit] !== undefined) return String(o[hit]).trim();
      }
      return "";
    };
    // One entry per person, and a person scanned twice in a day may carry a
    // list of times, so split whatever arrives into separate stamps.
    const stamps = pickStr("DateTimes", "Datetimes", "TestDatetimes").split(/[^\d]+/).filter((d) => d.length >= 12);
    for (const datetimes of stamps) out.push({ userId: pickStr("UserID"), phone: pickStr("UserToken", "TelHP"), datetimes });
  }
  return { ok: true, data: out };
}
