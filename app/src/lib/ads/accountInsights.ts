import "server-only";

import { GRAPH_BASE, metaApiError } from "@/lib/facebook/graph";
import { getGrantToken, listAdAccounts } from "@/lib/facebook/grants";
import { noteGrantRefusal } from "@/lib/facebook/health";
import { listAdCampaigns } from "@/lib/ads/service";
import { getTenantDbById } from "@/lib/db/tenant";
import { leads, offerOrders } from "@/lib/db/schema";
import { parseArrival } from "@/lib/arrival";
import { and, eq, gte, lt } from "drizzle-orm";
import {
  costPer,
  numbersOf,
  rangeBounds,
  rangeOf,
  metaCampaignOf,
  returnOnSpend,
  resultKindFor,
  resultsOf,
  RESULT_LABEL,
  stateOf,
  adsManagerUrl,
  type CampaignState,
  type InsightRow,
  type Numbers,
  type RangeKey,
  type ResultKind,
} from "./accountInsightsModel";

/**
 * Every campaign on the business's chosen ad account(s), with Meta's numbers
 * for a date range: the ones built in AdonisAgent AND the ones made in Meta
 * Ads Manager. Read-only (ads_read). Before this the Ads page listed only
 * campaigns built here, so a business already advertising saw nothing.
 *
 * Three Graph reads per account (campaigns, per-campaign insights, account
 * totals), cached per business and range for 10 minutes: Meta's numbers move
 * slowly and its rate limits are per ad account. Fail-soft per account: a
 * refused token marks the connection for reconnect (health.ts) and the
 * page shows Meta's reason instead of breaking.
 */

export interface CampaignPerformance {
  id: string;
  name: string;
  state: CampaignState;
  objectiveKind: ResultKind;
  resultLabel: string;
  results: number;
  costPerResult: number | null;
  numbers: Numbers;
  /** Where the row opens: the AdonisAgent campaign page, or Ads Manager. */
  href: string;
  builtHere: boolean;
  /** From our own records, matched by the ad link's campaign id (AD_URL_TAGS). */
  ours: { leads: number; sales: number; revenue: number; returnOnSpend: number | null };
}

export interface AccountPerformance {
  adAccountId: string;
  name: string;
  currency: string;
  totals: Numbers;
  leads: number;
  costPerLead: number | null;
  conversations: number;
  /** Paid offers in the period that came from these ads, from Stripe (not Meta's estimate). */
  sales: number;
  revenue: number;
  returnOnSpend: number | null;
  campaigns: CampaignPerformance[];
  /** Campaigns with no spend in the range that are not running (left out of the table). */
  quiet: number;
  error: string | null;
}

export interface AdsOverview {
  range: { key: RangeKey; label: string };
  accounts: AccountPerformance[];
  fetchedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, AdsOverview>();

async function get<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}/${path}?` + new URLSearchParams({ ...params, access_token: token }));
  const json = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok || (json as { error?: unknown }).error) throw metaApiError(json, res.status, `Meta ${path.replace(/^act_\d+/, "act_*")} failed (${res.status}).`);
  return json;
}

async function getAll<T>(path: string, token: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await get<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, token, {
      ...params,
      limit: "200",
      ...(after ? { after } : {}),
    });
    out.push(...(page.data ?? []));
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

type MetaCampaign = { id: string; name?: string; objective?: string; effective_status?: string };
type CampaignInsight = InsightRow & { campaign_id?: string };

const FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,actions";

async function accountPerformance(
  tenantId: number,
  account: { adAccountId: string; name: string | null; currency: string | null },
  token: string,
  preset: string,
  builtHere: Map<string, number>,
  ours: Map<string, { leads: number; sales: number; revenue: number }>,
): Promise<AccountPerformance> {
  const base: AccountPerformance = {
    adAccountId: account.adAccountId,
    name: account.name ?? account.adAccountId,
    currency: account.currency ?? "EUR",
    totals: numbersOf(undefined),
    leads: 0,
    costPerLead: null,
    conversations: 0,
    sales: 0,
    revenue: 0,
    returnOnSpend: null,
    campaigns: [],
    quiet: 0,
    error: null,
  };
  try {
    const act = account.adAccountId.startsWith("act_") ? account.adAccountId : `act_${account.adAccountId}`;
    const [campaigns, insights, totals] = await Promise.all([
      getAll<MetaCampaign>(`${act}/campaigns`, token, { fields: "id,name,objective,effective_status" }),
      getAll<CampaignInsight>(`${act}/insights`, token, { level: "campaign", fields: `campaign_id,${FIELDS}`, date_preset: preset }),
      get<{ data?: InsightRow[] }>(`${act}/insights`, token, { fields: FIELDS, date_preset: preset }),
    ]);
    const byId = new Map(insights.map((r) => [r.campaign_id ?? "", r]));

    const rows: CampaignPerformance[] = [];
    let quiet = 0;
    for (const c of campaigns) {
      const ins = byId.get(c.id);
      const numbers = numbersOf(ins);
      const state = stateOf(c.effective_status);
      if (numbers.spend === 0 && state !== "active") {
        quiet++;
        continue;
      }
      const kind = resultKindFor(c.objective, ins?.actions);
      const results = resultsOf(ins, kind);
      const localId = builtHere.get(c.id);
      const own = ours.get(c.id) ?? { leads: 0, sales: 0, revenue: 0 };
      rows.push({
        ours: { ...own, returnOnSpend: returnOnSpend(own.revenue, numbers.spend) },
        id: c.id,
        name: c.name ?? c.id,
        state,
        objectiveKind: kind,
        resultLabel: RESULT_LABEL[kind],
        results,
        costPerResult: costPer(numbers.spend, results),
        numbers,
        href: localId ? `/marketing/ads/${localId}` : adsManagerUrl(act, c.id),
        builtHere: Boolean(localId),
      });
    }
    // Running first, then by spend.
    rows.sort((a, b) => Number(b.state === "active") - Number(a.state === "active") || b.numbers.spend - a.numbers.spend);

    const sales = rows.reduce((s, r) => s + r.ours.sales, 0);
    const revenue = Math.round(rows.reduce((s, r) => s + r.ours.revenue, 0) * 100) / 100;
    const leadRows = rows.filter((r) => r.objectiveKind === "leads");
    const leads = leadRows.reduce((s, r) => s + r.results, 0);
    const leadSpend = leadRows.reduce((s, r) => s + r.numbers.spend, 0);
    return {
      ...base,
      totals: numbersOf(totals.data?.[0]),
      leads,
      costPerLead: costPer(leadSpend, leads),
      conversations: rows.filter((r) => r.objectiveKind === "messages").reduce((s, r) => s + r.results, 0),
      sales,
      revenue,
      returnOnSpend: returnOnSpend(revenue, numbersOf(totals.data?.[0]).spend),
      campaigns: rows,
      quiet,
    };
  } catch (err) {
    await noteGrantRefusal(tenantId, err).catch(() => false);
    console.error(`[ads] account performance for tenant ${tenantId} failed:`, err instanceof Error ? err.message : err);
    return { ...base, error: err instanceof Error ? err.message : "Meta did not return the numbers." };
  }
}

/**
 * The overview for the business's chosen ad accounts. Pass `fresh` to skip
 * the 10-minute cache (the Refresh link).
 */
export async function getAdsOverview(tenantId: number, rangeKey: string | null | undefined, opts: { fresh?: boolean } = {}): Promise<AdsOverview | null> {
  const range = rangeOf(rangeKey);
  const accounts = listAdAccounts(tenantId);
  const token = getGrantToken(tenantId);
  if (!token || accounts.length === 0) return null;

  const key = `${tenantId}:${range.key}:${accounts.map((a) => a.adAccountId).join(",")}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  // Campaigns launched from AdonisAgent open their own page here.
  const builtHere = new Map<string, number>();
  for (const c of listAdCampaigns()) if (c.metaIds.campaignId) builtHere.set(c.metaIds.campaignId, c.id);

  const ours = ownResults(tenantId, rangeBounds(range.key, Date.now()));
  const overview: AdsOverview = {
    range: { key: range.key, label: range.label },
    accounts: await Promise.all(accounts.map((a) => accountPerformance(tenantId, a, token, range.preset, builtHere, ours))),
    fetchedAt: Date.now(),
  };
  if (overview.accounts.every((a) => !a.error)) cache.set(key, overview);
  return overview;
}

/**
 * Leads and paid offers in the period, per Meta campaign id, from our own
 * records: each carries the ad link's utm_campaign (AD_URL_TAGS) in its
 * arrival. This is the revenue that actually reached Stripe, not Meta's
 * modelled estimate. Ads made in Ads Manager count only if their links carry
 * utm_campaign={{campaign.id}} too.
 */
export function ownResults(tenantId: number, bounds: { from: number; to: number }): Map<string, { leads: number; sales: number; revenue: number }> {
  const out = new Map<string, { leads: number; sales: number; revenue: number }>();
  const bump = (id: string) => out.get(id) ?? (out.set(id, { leads: 0, sales: 0, revenue: 0 }), out.get(id)!);
  try {
    const tdb = getTenantDbById(tenantId);
    const orders = tdb
      .select({ arrival: offerOrders.arrival, amountCents: offerOrders.amountCents })
      .from(offerOrders)
      .where(and(eq(offerOrders.status, "paid"), gte(offerOrders.paidAt, bounds.from), lt(offerOrders.paidAt, bounds.to)))
      .all();
    for (const o of orders) {
      const id = metaCampaignOf(parseArrival(o.arrival));
      if (!id) continue;
      const row = bump(id);
      row.sales++;
      row.revenue = Math.round((row.revenue + o.amountCents / 100) * 100) / 100;
    }
    const newLeads = tdb
      .select({ arrival: leads.arrival })
      .from(leads)
      .where(and(gte(leads.createdAt, new Date(bounds.from)), lt(leads.createdAt, new Date(bounds.to))))
      .all();
    for (const l of newLeads) {
      const id = metaCampaignOf(parseArrival(l.arrival));
      if (id) bump(id).leads++;
    }
  } catch (err) {
    console.error(`[ads] own results for tenant ${tenantId} failed:`, err instanceof Error ? err.message : err);
  }
  return out;
}
