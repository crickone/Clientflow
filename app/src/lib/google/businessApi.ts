/**
 * Google Business Profile, Search Console and Analytics: the request shapes
 * and the parsing of Google's replies, with no I/O, so they are tested here
 * and lib/google/business.ts only moves bytes.
 *
 * APIs used (all REST, raw fetch, no SDK):
 * - Account Management v1:      accounts list
 * - Business Information v1:    locations list
 * - My Business v4:             localPosts (create), reviews (list, reply)
 * - Business Profile Performance v1: daily metrics + monthly search keywords
 * - Search Console (webmasters v3): sites, searchAnalytics.query
 * - Analytics Admin v1beta + Data v1beta: accountSummaries, runReport
 */

export const GOOGLE_BUSINESS_SCOPES = [
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

export const API = {
  accounts: "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
  locations: (account: string) =>
    `https://mybusinessbusinessinformation.googleapis.com/v1/${account}/locations?readMask=name,title,storefrontAddress,websiteUri&pageSize=100`,
  localPosts: (account: string, location: string) =>
    `https://mybusiness.googleapis.com/v4/${account}/${location}/localPosts`,
  reviews: (account: string, location: string) =>
    `https://mybusiness.googleapis.com/v4/${account}/${location}/reviews?pageSize=50&orderBy=updateTime%20desc`,
  reviewReply: (reviewName: string) => `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
  dailyMetrics: "https://businessprofileperformance.googleapis.com/v1",
  scSites: "https://www.googleapis.com/webmasters/v3/sites",
  scQuery: (site: string) => `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`,
  gaSummaries: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200",
  gaReport: (property: string) => `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
} as const;

// ─── Profile performance ─────────────────────────────────────────────────────

export const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

type YMD = { year: number; month: number; day: number };
const ymd = (ms: number): YMD => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const isoOf = (d: YMD) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** The fetchMultiDailyMetricsTimeSeries URL for a location and an inclusive day range. */
export function dailyMetricsUrl(location: string, fromMs: number, toMs: number): string {
  const s = ymd(fromMs);
  const e = ymd(toMs);
  const q = new URLSearchParams();
  for (const m of DAILY_METRICS) q.append("dailyMetrics", m);
  q.set("dailyRange.startDate.year", String(s.year));
  q.set("dailyRange.startDate.month", String(s.month));
  q.set("dailyRange.startDate.day", String(s.day));
  q.set("dailyRange.endDate.year", String(e.year));
  q.set("dailyRange.endDate.month", String(e.month));
  q.set("dailyRange.endDate.day", String(e.day));
  return `${API.dailyMetrics}/${location}:fetchMultiDailyMetricsTimeSeries?${q.toString()}`;
}

/** Per-day values for each metric: { metric: { "2026-10-01": 12, ... } }. Missing days are absent. */
export type DailySeries = Partial<Record<DailyMetric, Record<string, number>>>;

export function parseDailyMetrics(json: unknown): DailySeries {
  const out: DailySeries = {};
  const groups = (json as { multiDailyMetricTimeSeries?: unknown[] })?.multiDailyMetricTimeSeries ?? [];
  for (const g of groups as Array<{ dailyMetricTimeSeries?: unknown[] }>) {
    for (const s of (g.dailyMetricTimeSeries ?? []) as Array<{ dailyMetric?: string; timeSeries?: { datedValues?: Array<{ date?: YMD; value?: string }> } }>) {
      const metric = s.dailyMetric as DailyMetric | undefined;
      if (!metric || !(DAILY_METRICS as readonly string[]).includes(metric)) continue;
      const days = (out[metric] ??= {});
      for (const v of s.timeSeries?.datedValues ?? []) {
        if (!v.date) continue;
        // Google omits `value` for a day with nothing, rather than sending 0.
        days[isoOf(v.date)] = Number(v.value ?? 0) || 0;
      }
    }
  }
  return out;
}

export interface ProfileTotals {
  searchViews: number;
  mapsViews: number;
  views: number;
  calls: number;
  websiteClicks: number;
  directions: number;
  messages: number;
  bookings: number;
}

const sum = (rec: Record<string, number> | undefined) => Object.values(rec ?? {}).reduce((a, b) => a + b, 0);

export function profileTotals(s: DailySeries): ProfileTotals {
  const searchViews = sum(s.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH) + sum(s.BUSINESS_IMPRESSIONS_MOBILE_SEARCH);
  const mapsViews = sum(s.BUSINESS_IMPRESSIONS_DESKTOP_MAPS) + sum(s.BUSINESS_IMPRESSIONS_MOBILE_MAPS);
  return {
    searchViews,
    mapsViews,
    views: searchViews + mapsViews,
    calls: sum(s.CALL_CLICKS),
    websiteClicks: sum(s.WEBSITE_CLICKS),
    directions: sum(s.BUSINESS_DIRECTION_REQUESTS),
    messages: sum(s.BUSINESS_CONVERSATIONS),
    bookings: sum(s.BUSINESS_BOOKINGS),
  };
}

/** Day-by-day profile views, search and maps, zero-filled across the range. */
export function viewsByDay(s: DailySeries, fromMs: number, days: number): { day: string; search: number; maps: number }[] {
  const out: { day: string; search: number; maps: number }[] = [];
  for (let i = 0; i < days; i++) {
    const day = isoOf(ymd(fromMs + i * 86_400_000));
    const g = (m: DailyMetric) => s[m]?.[day] ?? 0;
    out.push({
      day,
      search: g("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH") + g("BUSINESS_IMPRESSIONS_MOBILE_SEARCH"),
      maps: g("BUSINESS_IMPRESSIONS_DESKTOP_MAPS") + g("BUSINESS_IMPRESSIONS_MOBILE_MAPS"),
    });
  }
  return out;
}

/** Search keywords for one month. */
export function keywordsUrl(location: string, year: number, month: number): string {
  const q = new URLSearchParams({
    "monthlyRange.startMonth.year": String(year),
    "monthlyRange.startMonth.month": String(month),
    "monthlyRange.endMonth.year": String(year),
    "monthlyRange.endMonth.month": String(month),
    pageSize: "100",
  });
  return `${API.dailyMetrics}/${location}/searchkeywords/impressions/monthly?${q.toString()}`;
}

/**
 * Keywords with their count. Google hides small counts behind a threshold
 * ("fewer than 15"); those come back with `under` set and sort last.
 */
export function parseKeywords(json: unknown): { keyword: string; count: number; under: boolean }[] {
  const rows = (json as { searchKeywordsCounts?: unknown[] })?.searchKeywordsCounts ?? [];
  return (rows as Array<{ searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }>)
    .filter((r) => r.searchKeyword)
    .map((r) => {
      const v = r.insightsValue ?? {};
      const exact = v.value != null;
      return { keyword: r.searchKeyword!, count: Number(exact ? v.value : v.threshold) || 0, under: !exact };
    })
    .sort((a, b) => Number(a.under) - Number(b.under) || b.count - a.count);
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface ParsedReview {
  name: string;
  reviewer: string;
  photoUrl: string | null;
  rating: number;
  comment: string;
  createdAt: number;
  updatedAt: number;
  reply: string | null;
  repliedAt: number | null;
}

export function parseReviews(json: unknown): { reviews: ParsedReview[]; average: number | null; total: number | null } {
  const j = (json ?? {}) as { reviews?: unknown[]; averageRating?: number; totalReviewCount?: number };
  const reviews = ((j.reviews ?? []) as Array<{
    name?: string;
    reviewer?: { displayName?: string; profilePhotoUrl?: string; isAnonymous?: boolean };
    starRating?: string;
    comment?: string;
    createTime?: string;
    updateTime?: string;
    reviewReply?: { comment?: string; updateTime?: string };
  }>)
    .filter((r) => r.name)
    .map((r) => ({
      name: r.name!,
      reviewer: r.reviewer?.isAnonymous ? "A Google user" : r.reviewer?.displayName?.trim() || "A Google user",
      photoUrl: r.reviewer?.profilePhotoUrl ?? null,
      rating: STARS[r.starRating ?? ""] ?? 0,
      // Google appends a machine translation block to some reviews; keep the original.
      comment: (r.comment ?? "").split("\n\n(Translated by Google)")[0].replace(/^\(Original\)\n/, "").trim(),
      createdAt: Date.parse(r.createTime ?? "") || 0,
      updatedAt: Date.parse(r.updateTime ?? r.createTime ?? "") || 0,
      reply: r.reviewReply?.comment?.trim() || null,
      repliedAt: r.reviewReply?.updateTime ? Date.parse(r.reviewReply.updateTime) || null : null,
    }));
  return {
    reviews,
    average: typeof j.averageRating === "number" ? j.averageRating : null,
    total: typeof j.totalReviewCount === "number" ? j.totalReviewCount : null,
  };
}

// ─── Local posts ─────────────────────────────────────────────────────────────

/** Google caps a post's text at 1,500 characters. */
export const POST_SUMMARY_MAX = 1500;

/**
 * A Google post from a social caption and its first image. Hashtags mean
 * nothing on Google, so trailing tag lines are dropped. The button calls the
 * business when there is a phone number, else sends people to its website.
 */
export function buildLocalPost(input: { caption: string; imageUrl: string | null; phone?: string | null; websiteUrl?: string | null }) {
  const lines = input.caption.replace(/\r/g, "").split("\n");
  while (lines.length && /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(lines[lines.length - 1])) lines.pop();
  let summary = lines.join("\n").replace(/(?:\s#[\p{L}\p{N}_]+)+\s*$/u, "").trim();
  if (summary.length > POST_SUMMARY_MAX) summary = `${summary.slice(0, POST_SUMMARY_MAX - 1).trimEnd()}…`;
  const body: Record<string, unknown> = { languageCode: "en-IE", summary, topicType: "STANDARD" };
  if (input.imageUrl) body.media = [{ mediaFormat: "PHOTO", sourceUrl: input.imageUrl }];
  if (input.phone) body.callToAction = { actionType: "CALL" };
  else if (input.websiteUrl) body.callToAction = { actionType: "LEARN_MORE", url: input.websiteUrl };
  return body;
}

// ─── Search Console ──────────────────────────────────────────────────────────

export function parseScSites(json: unknown): string[] {
  const rows = (json as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> })?.siteEntry ?? [];
  return rows.filter((r) => r.siteUrl && r.permissionLevel !== "siteUnverifiedUser").map((r) => r.siteUrl!);
}

export function scQueryBody(fromIso: string, toIso: string, dimension: "query" | "page" | "date", rowLimit = 10) {
  return { startDate: fromIso, endDate: toIso, dimensions: [dimension], rowLimit, dataState: "all" };
}

export interface ScRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export function parseScRows(json: unknown): ScRow[] {
  const rows = (json as { rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> })?.rows ?? [];
  return rows.map((r) => ({
    key: r.keys?.[0] ?? "",
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));
}

// ─── Analytics (GA4) ─────────────────────────────────────────────────────────

export function parseGaProperties(json: unknown): { property: string; name: string }[] {
  const accounts = (json as { accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }> })?.accountSummaries ?? [];
  return accounts.flatMap((a) =>
    (a.propertySummaries ?? [])
      .filter((p) => p.property)
      .map((p) => ({ property: p.property!, name: [a.displayName, p.displayName].filter(Boolean).join(" / ") || p.property! })),
  );
}

export function gaDailyBody(fromIso: string, toIso: string) {
  return {
    dateRanges: [{ startDate: fromIso, endDate: toIso }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 400,
  };
}

export function gaChannelBody(fromIso: string, toIso: string) {
  return {
    dateRanges: [{ startDate: fromIso, endDate: toIso }],
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  };
}

/** Report rows as { dims: string[], values: number[] }; a GA date "20261001" becomes "2026-10-01". */
export function parseGaReport(json: unknown): { dims: string[]; values: number[] }[] {
  const rows = (json as { rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }> })?.rows ?? [];
  return rows.map((r) => ({
    dims: (r.dimensionValues ?? []).map((d) => {
      const v = d.value ?? "";
      return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v;
    }),
    values: (r.metricValues ?? []).map((m) => Number(m.value) || 0),
  }));
}

/** Google's error body to one readable line. */
export function googleErrorMessage(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; status?: string } };
    const msg = j.error?.message ?? "";
    if (status === 403 && /has not been used|is disabled|not been enabled/i.test(msg)) {
      return "This Google API is not switched on for the app yet (Google approval or setup is still pending).";
    }
    if (status === 429 || /quota/i.test(msg)) return "Google says the app's quota is used up or not granted yet (Business Profile API access is approved per project).";
    if (status === 401) return "The Google connection has expired. Reconnect it in Settings > Integrations > Google.";
    if (msg) return msg;
  } catch {
    /* not JSON */
  }
  return `Google returned ${status}.`;
}
