/**
 * Wearables: one daily shape for every device, and a parser per provider's
 * documented API response. Pure, so each parser is tested with a sample
 * payload; the network side lives in providers.ts.
 *
 * The six with a web API (Apple Watch and Samsung keep their data on the
 * phone and need a native app):
 *   fitbit, garmin (pushes data to us), oura, whoop, polar, withings.
 */

export type ProviderId = "fitbit" | "garmin" | "oura" | "whoop" | "polar" | "withings";

export const PROVIDERS: { id: ProviderId; name: string; gives: string }[] = [
  { id: "garmin", name: "Garmin", gives: "Steps, sleep, resting heart rate, HRV" },
  { id: "fitbit", name: "Fitbit", gives: "Steps, sleep, resting heart rate, HRV, weight" },
  { id: "oura", name: "Oura", gives: "Sleep, readiness, HRV, resting heart rate, steps" },
  { id: "whoop", name: "Whoop", gives: "Recovery, sleep, HRV, resting heart rate" },
  { id: "polar", name: "Polar", gives: "Sleep, overnight HRV and heart rate, steps" },
  { id: "withings", name: "Withings", gives: "Weight, body fat, sleep, steps" },
];

export const PROVIDER_NAME = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.name])) as Record<ProviderId, string>;

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && PROVIDERS.some((p) => p.id === v);
}

/** One day from one device. Any field can be missing: not every device measures everything. */
export interface WearableDay {
  day: string; // YYYY-MM-DD, the member's own calendar day
  steps?: number;
  activeKcal?: number;
  restingHr?: number;
  hrvMs?: number;
  sleepMinutes?: number;
  sleepScore?: number;
  readiness?: number;
  weightKg?: number;
  bodyFatPct?: number;
}

export const METRIC_KEYS = ["steps", "activeKcal", "restingHr", "hrvMs", "sleepMinutes", "sleepScore", "readiness", "weightKg", "bodyFatPct"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const n = (v: unknown): number | undefined => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) ? x : undefined;
};
const day10 = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Fold partial days for the same date together; later values fill gaps, never blank out earlier ones. */
export function mergeDays(parts: WearableDay[]): WearableDay[] {
  const by = new Map<string, WearableDay>();
  for (const p of parts) {
    const cur = by.get(p.day) ?? { day: p.day };
    for (const k of METRIC_KEYS) {
      const v = p[k];
      if (v !== undefined && Number.isFinite(v)) cur[k] = v;
    }
    by.set(p.day, cur);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Round to sensible precision and drop impossible readings (a sensor glitch shouldn't chart). */
export function cleanDay(d: WearableDay): WearableDay {
  const out: WearableDay = { day: d.day };
  const keep = (k: MetricKey, v: number | undefined, min: number, max: number, dp = 0) => {
    if (v === undefined || v < min || v > max) return;
    out[k] = dp ? Math.round(v * 10 ** dp) / 10 ** dp : Math.round(v);
  };
  keep("steps", d.steps, 0, 150000);
  keep("activeKcal", d.activeKcal, 0, 10000);
  keep("restingHr", d.restingHr, 25, 140);
  keep("hrvMs", d.hrvMs, 1, 400);
  keep("sleepMinutes", d.sleepMinutes, 0, 1440);
  keep("sleepScore", d.sleepScore, 0, 100);
  keep("readiness", d.readiness, 0, 100);
  keep("weightKg", d.weightKg, 20, 400, 1);
  keep("bodyFatPct", d.bodyFatPct, 2, 75, 1);
  return out;
}

// ── Fitbit (Web API, range endpoints) ──

export function parseFitbit(p: { steps?: unknown; heart?: unknown; sleep?: unknown; hrv?: unknown; weight?: unknown }): WearableDay[] {
  const parts: WearableDay[] = [];
  for (const r of arr(obj(p.steps)["activities-steps"])) {
    const d = day10(r.dateTime);
    if (d) parts.push({ day: d, steps: n(r.value) });
  }
  for (const r of arr(obj(p.heart)["activities-heart"])) {
    const d = day10(r.dateTime);
    if (d) parts.push({ day: d, restingHr: n(obj(r.value).restingHeartRate) });
  }
  for (const r of arr(obj(p.sleep).sleep)) {
    const d = day10(r.dateOfSleep);
    if (d && r.isMainSleep !== false) parts.push({ day: d, sleepMinutes: n(r.minutesAsleep), sleepScore: n(r.efficiency) });
  }
  for (const r of arr(obj(p.hrv).hrv)) {
    const d = day10(r.dateTime);
    if (d) parts.push({ day: d, hrvMs: n(obj(r.value).dailyRmssd) });
  }
  for (const r of arr(obj(p.weight).weight)) {
    const d = day10(r.date);
    if (d) parts.push({ day: d, weightKg: n(r.weight), bodyFatPct: n(r.fat) });
  }
  return mergeDays(parts);
}

// ── Oura (API v2) ──

export function parseOura(p: { activity?: unknown; dailySleep?: unknown; sleep?: unknown; readiness?: unknown }): WearableDay[] {
  const parts: WearableDay[] = [];
  for (const r of arr(obj(p.activity).data)) {
    const d = day10(r.day);
    if (d) parts.push({ day: d, steps: n(r.steps), activeKcal: n(r.active_calories) });
  }
  for (const r of arr(obj(p.dailySleep).data)) {
    const d = day10(r.day);
    if (d) parts.push({ day: d, sleepScore: n(r.score) });
  }
  for (const r of arr(obj(p.sleep).data)) {
    const d = day10(r.day);
    if (!d || (r.type !== undefined && r.type !== "long_sleep")) continue;
    const secs = n(r.total_sleep_duration);
    parts.push({ day: d, sleepMinutes: secs !== undefined ? secs / 60 : undefined, restingHr: n(r.lowest_heart_rate), hrvMs: n(r.average_hrv) });
  }
  for (const r of arr(obj(p.readiness).data)) {
    const d = day10(r.day);
    if (d) parts.push({ day: d, readiness: n(r.score) });
  }
  return mergeDays(parts);
}

// ── Whoop (API v2) ──

/** Whoop times are UTC instants; the day is the member's Irish calendar day the sleep ended on. */
function dublinDay(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" }) : null;
}

export function parseWhoop(p: { recovery?: unknown; sleep?: unknown; cycle?: unknown }): WearableDay[] {
  const parts: WearableDay[] = [];
  for (const r of arr(obj(p.recovery).records)) {
    const d = dublinDay(r.created_at);
    const s = obj(r.score);
    if (d) parts.push({ day: d, readiness: n(s.recovery_score), restingHr: n(s.resting_heart_rate), hrvMs: n(s.hrv_rmssd_milli) });
  }
  for (const r of arr(obj(p.sleep).records)) {
    if (r.nap === true) continue;
    const d = dublinDay(r.end);
    const s = obj(r.score);
    const st = obj(s.stage_summary);
    const inBed = n(st.total_in_bed_time_milli);
    const awake = n(st.total_awake_time_milli) ?? 0;
    if (d) parts.push({ day: d, sleepScore: n(s.sleep_performance_percentage), sleepMinutes: inBed !== undefined ? (inBed - awake) / 60000 : undefined });
  }
  for (const r of arr(obj(p.cycle).records)) {
    const d = dublinDay(r.start);
    const kj = n(obj(r.score).kilojoule);
    if (d && kj !== undefined) parts.push({ day: d, activeKcal: kj / 4.184 });
  }
  return mergeDays(parts);
}

// ── Withings ──

export function parseWithings(p: { activity?: unknown; meas?: unknown; sleep?: unknown }): WearableDay[] {
  const parts: WearableDay[] = [];
  for (const r of arr(obj(obj(p.activity).body).activities)) {
    const d = day10(r.date);
    if (d) parts.push({ day: d, steps: n(r.steps), activeKcal: n(r.calories) });
  }
  for (const g of arr(obj(obj(p.meas).body).measuregrps)) {
    const t = n(g.date);
    if (t === undefined) continue;
    const d = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
    const part: WearableDay = { day: d };
    for (const m of arr(g.measures)) {
      const v = n(m.value);
      const u = n(m.unit) ?? 0;
      if (v === undefined) continue;
      const real = Math.round(v * 10 ** u * 1000) / 1000;
      if (m.type === 1) part.weightKg = real;
      if (m.type === 6) part.bodyFatPct = real;
    }
    parts.push(part);
  }
  for (const r of arr(obj(obj(p.sleep).body).series)) {
    const d = day10(r.date);
    const data = obj(r.data);
    const secs = n(data.total_sleep_time);
    if (d) parts.push({ day: d, sleepMinutes: secs !== undefined ? secs / 60 : undefined, sleepScore: n(data.sleep_score), restingHr: n(data.hr_min) });
  }
  return mergeDays(parts);
}

// ── Polar (AccessLink v3) ──

export function parsePolar(p: { sleep?: unknown; recharge?: unknown; activities?: unknown[] }): WearableDay[] {
  const parts: WearableDay[] = [];
  for (const r of arr(obj(p.sleep).nights)) {
    const d = day10(r.date);
    const secs = (n(r.light_sleep) ?? 0) + (n(r.deep_sleep) ?? 0) + (n(r.rem_sleep) ?? 0);
    if (d) parts.push({ day: d, sleepMinutes: secs ? secs / 60 : undefined, sleepScore: n(r.sleep_score) });
  }
  for (const r of arr(obj(p.recharge).recharges)) {
    const d = day10(r.date);
    if (d) parts.push({ day: d, restingHr: n(r.heart_rate_avg), hrvMs: n(r.heart_rate_variability_avg) });
  }
  for (const r of arr(p.activities)) {
    const d = day10(r.date);
    if (d) parts.push({ day: d, steps: n(r["active-steps"]), activeKcal: n(r["active-calories"]) });
  }
  return mergeDays(parts);
}

// ── Garmin (Health API push) ──

/** A Garmin push: dailies, sleeps, hrv and body comps, each tagged with the Garmin user. */
export function parseGarminPush(body: unknown): { userId: string; days: WearableDay[] }[] {
  const b = obj(body);
  const byUser = new Map<string, WearableDay[]>();
  const add = (u: unknown, d: WearableDay) => {
    if (typeof u !== "string" || !u) return;
    byUser.set(u, [...(byUser.get(u) ?? []), d]);
  };
  for (const r of arr(b.dailies)) {
    const d = day10(r.calendarDate);
    if (d) add(r.userId, { day: d, steps: n(r.steps), activeKcal: n(r.activeKilocalories), restingHr: n(r.restingHeartRateInBeatsPerMinute) });
  }
  for (const r of arr(b.sleeps)) {
    const d = day10(r.calendarDate);
    const secs = n(r.durationInSeconds);
    if (d) add(r.userId, { day: d, sleepMinutes: secs !== undefined ? secs / 60 : undefined, sleepScore: n(obj(obj(r.overallSleepScore)).value) });
  }
  for (const r of arr(b.hrv)) {
    const d = day10(r.calendarDate);
    if (d) add(r.userId, { day: d, hrvMs: n(r.lastNightAvg) });
  }
  for (const r of arr(b.bodyComps)) {
    const t = n(r.measurementTimeInSeconds);
    if (t === undefined) continue;
    const g = n(r.weightInGrams);
    add(r.userId, { day: new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" }), weightKg: g !== undefined ? g / 1000 : undefined, bodyFatPct: n(r.bodyFatInPercent) });
  }
  return [...byUser].map(([userId, days]) => ({ userId, days: mergeDays(days) }));
}

// ── the member's view ──

/** Several devices can report the same day; pick one value per metric (the first device that has it). */
export function combineDevices(rows: (WearableDay & { provider: ProviderId })[], order: ProviderId[]): WearableDay[] {
  const sorted = [...rows].sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
  const by = new Map<string, WearableDay>();
  for (const r of sorted) {
    const cur = by.get(r.day) ?? { day: r.day };
    for (const k of METRIC_KEYS) if (cur[k] === undefined && r[k] !== undefined) cur[k] = r[k];
    by.set(r.day, cur);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Average of a metric over the days that have it, or null. */
export function average(days: WearableDay[], k: MetricKey): number | null {
  const vals = days.map((d) => d[k]).filter((v): v is number => v !== undefined);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

export function sleepLabel(minutes: number | undefined | null): string {
  if (minutes == null) return "-";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
