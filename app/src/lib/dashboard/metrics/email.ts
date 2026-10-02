/**
 * Email preset pure helpers (no DB, no server imports; tested in
 * email.test.ts). The loaders live in emailQueries.ts.
 */
import { pct } from "./stats";

export type SendCounts = Record<string, number>;

/** Safe read of `email_campaigns.stats`: only numeric entries of `counts` survive. */
export function countsFromStats(stats: Record<string, unknown> | null): SendCounts {
  const raw = stats?.counts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SendCounts = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

export function sumCounts(all: SendCounts[]): SendCounts {
  const out: SendCounts = {};
  for (const c of all) for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export type CampaignRates = {
  /** Recipients the message reached (statuses are exclusive and forward-only). */
  reached: number;
  openRate: number | null;
  clickRate: number | null;
  deliveredRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  unsubscribeRate: number | null;
};

export function campaignRates(counts: SendCounts): CampaignRates {
  const n = (k: string) => counts[k] ?? 0;
  const reached = n("delivered") + n("opened") + n("clicked") + n("unsubscribed") + n("complained");
  const attempted = reached + n("bounced");
  return {
    reached,
    openRate: pct(n("opened") + n("clicked"), reached),
    clickRate: pct(n("clicked"), reached),
    deliveredRate: pct(reached, attempted),
    bounceRate: pct(n("bounced"), attempted),
    complaintRate: pct(n("complained"), attempted),
    unsubscribeRate: pct(n("unsubscribed"), reached),
  };
}

/** Grouping key for a clicked link: the URL without query string or fragment. */
export function linkGroup(url: string): string {
  return url.split(/[?#]/)[0];
}

/** Short display label: host and path, no scheme or www, truncated to 48 characters. */
export function linkLabel(url: string): string {
  const s = linkGroup(url).replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return s.length > 48 ? `${s.slice(0, 45)}...` : s;
}

/** Percentage change for a figure that can be negative (net list growth); null when the base is 0. */
export function netDeltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}
