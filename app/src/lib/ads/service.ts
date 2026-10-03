import "server-only";

import fs from "node:fs";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { adCampaigns } from "@/lib/db/schema";
import { getCurrentTenant } from "@/lib/db/tenant";
import { GRAPH_BASE } from "@/lib/facebook/graph";
import { getGrantToken, listAdAccounts, type AdAccountRow } from "@/lib/facebook/grants";
import { getPostingPage } from "@/lib/facebook/pages";
import { getPreferredPostingPageId } from "@/lib/social/publisher";
import { postableRenders } from "@/lib/social/schedule";
import { renderFilePath } from "@/lib/image/renderStore";
import { logActivity } from "@/lib/queries";
import {
  buildAdSetParams,
  buildCampaignParams,
  buildCreativeParams,
  buildLeadFormParams,
  toMinorUnits,
  validateSpec,
  type CampaignSpec,
  type InterestRef,
  type Objective,
} from "./spec";

/**
 * The ads manager's side effects: Meta Marketing API calls with the tenant's
 * grant token (lib/facebook/grants), and the ad_campaigns rows that track
 * them. Every function here SPENDS or can spend the business's money, so each
 * is reached only from an admin action or an approved Adonis write; none runs
 * on a timer except the read-only results refresh.
 */

export class AdsError extends Error {}

type MetaIds = {
  campaignId?: string;
  leadFormId?: string;
  adSets?: Array<{ adSetId: string; adIds: string[] }>;
};

export interface AdCampaignRow {
  id: number;
  adAccountId: string;
  pageId: string | null;
  name: string;
  objective: Objective;
  status: "draft" | "launching" | "active" | "paused" | "error" | "archived";
  spec: CampaignSpec;
  metaIds: MetaIds;
  error: string | null;
  insights: AdInsights | null;
  insightsAt: Date | null;
  launchedAt: Date | null;
  createdAt: Date;
}

export interface AdInsights {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  results: number;
  resultLabel: string;
  costPerResult: number | null;
  adSets: Array<{ adSetId: string; name: string; spend: number; results: number }>;
}

function toRow(r: typeof adCampaigns.$inferSelect): AdCampaignRow {
  return {
    id: r.id,
    adAccountId: r.adAccountId,
    pageId: r.pageId,
    name: r.name,
    objective: r.objective as Objective,
    status: r.status,
    spec: JSON.parse(r.spec) as CampaignSpec,
    metaIds: r.metaIds ? (JSON.parse(r.metaIds) as MetaIds) : {},
    error: r.error,
    insights: r.insights ? (JSON.parse(r.insights) as AdInsights) : null,
    insightsAt: r.insightsAt,
    launchedAt: r.launchedAt,
    createdAt: r.createdAt,
  };
}

export function listAdCampaigns(): AdCampaignRow[] {
  return db.select().from(adCampaigns).orderBy(desc(adCampaigns.id)).all().map(toRow);
}

export function getAdCampaign(id: number): AdCampaignRow | null {
  const r = db.select().from(adCampaigns).where(eq(adCampaigns.id, id)).get();
  return r ? toRow(r) : null;
}

function update(id: number, set: Partial<typeof adCampaigns.$inferInsert>): void {
  db.update(adCampaigns).set({ ...set, updatedAt: new Date() }).where(eq(adCampaigns.id, id)).run();
}

// ── Meta plumbing ─────────────────────────────────────────────────────────

function requireToken(): string {
  const token = getGrantToken(getCurrentTenant().id);
  if (!token) throw new AdsError("Facebook is not connected for ads. Connect it in Settings > Integrations > Facebook and tick your ad account.");
  return token;
}

function requireAdAccount(adAccountId: string): AdAccountRow {
  const acct = listAdAccounts(getCurrentTenant().id).find((a) => a.adAccountId === adAccountId);
  if (!acct) throw new AdsError("That ad account is not connected to this business.");
  return acct;
}

async function graph<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, token: string, params: Record<string, unknown> = {}): Promise<T> {
  const flat: Record<string, string> = { access_token: token };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    flat[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const qs = new URLSearchParams(flat);
  const res =
    method === "GET"
      ? await fetch(`${GRAPH_BASE}/${path}?${qs}`)
      : await fetch(`${GRAPH_BASE}/${path}`, { method, body: qs });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; error_user_title?: string } };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new AdsError(e?.error_user_msg || e?.message || `Meta ${path} failed (${res.status}).`);
  }
  return json;
}

/** The Page (and its Instagram account) ads run from: the business's posting Page. */
function adsPage(): { pageId: string; pageToken: string; igUserId: string | null } {
  const tenantId = getCurrentTenant().id;
  const page = getPostingPage(tenantId, getPreferredPostingPageId(tenantId));
  if (!page) throw new AdsError("No Facebook Page is connected. Ads run from your Page, so connect it first.");
  return { pageId: page.pageId, pageToken: page.pageAccessToken, igUserId: page.igUserId ?? null };
}

async function uploadDesignImages(adAccountId: string, token: string, designId: number, cache: Map<number, string[]>): Promise<string[]> {
  const hit = cache.get(designId);
  if (hit) return hit;
  const { filenames } = postableRenders(designId);
  if (filenames.length === 0) throw new AdsError(`Content Studio design #${designId} has no rendered images. Open it in Content Studio and generate it.`);
  const hashes: string[] = [];
  for (const f of filenames.slice(0, 10)) {
    const bytes = fs.readFileSync(renderFilePath(f)).toString("base64");
    const r = await graph<{ images?: Record<string, { hash: string }> }>("POST", `${adAccountId}/adimages`, token, { bytes });
    const first = r.images ? Object.values(r.images)[0] : undefined;
    if (!first?.hash) throw new AdsError("Meta did not accept one of the images.");
    hashes.push(first.hash);
  }
  cache.set(designId, hashes);
  return hashes;
}

// ── Drafts ────────────────────────────────────────────────────────────────

export function createAdDraft(input: { adAccountId: string; spec: CampaignSpec; createdBy: string }): AdCampaignRow {
  requireAdAccount(input.adAccountId);
  const row = db
    .insert(adCampaigns)
    .values({
      adAccountId: input.adAccountId,
      name: input.spec.name || "Untitled campaign",
      objective: input.spec.objective,
      status: "draft",
      spec: JSON.stringify(input.spec),
      createdBy: input.createdBy,
    })
    .returning()
    .get();
  return toRow(row);
}

export function updateAdDraft(id: number, input: { adAccountId?: string; spec: CampaignSpec }): AdCampaignRow {
  const current = getAdCampaign(id);
  if (!current) throw new AdsError("Campaign not found.");
  if (current.status !== "draft" && current.status !== "error") {
    throw new AdsError("This campaign is already on Meta. Change its budget or pause it instead of editing the plan.");
  }
  if (input.adAccountId) requireAdAccount(input.adAccountId);
  update(id, {
    adAccountId: input.adAccountId ?? current.adAccountId,
    name: input.spec.name || current.name,
    objective: input.spec.objective,
    spec: JSON.stringify(input.spec),
    status: "draft",
    error: null,
  });
  return getAdCampaign(id)!;
}

export function deleteAdDraft(id: number): void {
  const current = getAdCampaign(id);
  if (!current) return;
  if (current.status !== "draft" && current.status !== "error") throw new AdsError("Only a draft can be deleted. Archive a launched campaign instead.");
  db.delete(adCampaigns).where(eq(adCampaigns.id, id)).run();
}

// ── Launch ────────────────────────────────────────────────────────────────

/**
 * Build the whole campaign on Meta, then switch it on. The campaign is created
 * PAUSED and only set ACTIVE after every ad set and ad exists, so a failure
 * half-way never spends: the half-built campaign is deleted and the row goes
 * to `error` with Meta's reason, ready to fix and launch again.
 */
export async function launchAdCampaign(id: number): Promise<AdCampaignRow> {
  const current = getAdCampaign(id);
  if (!current) throw new AdsError("Campaign not found.");
  if (current.status !== "draft" && current.status !== "error") throw new AdsError("This campaign has already been launched.");
  const errors = validateSpec(current.spec);
  if (errors.length) throw new AdsError(errors.join(" "));

  const token = requireToken();
  requireAdAccount(current.adAccountId);
  const page = adsPage();
  const spec = current.spec;
  const acct = current.adAccountId;

  update(id, { status: "launching", error: null, pageId: page.pageId });
  const ids: MetaIds = { adSets: [] };
  try {
    ids.campaignId = (await graph<{ id: string }>("POST", `${acct}/campaigns`, token, buildCampaignParams(spec))).id;
    update(id, { metaIds: JSON.stringify(ids) });

    if (spec.objective === "leads" && spec.leadForm) {
      ids.leadFormId = (await graph<{ id: string }>("POST", `${page.pageId}/leadgen_forms`, page.pageToken, buildLeadFormParams(spec.leadForm))).id;
    }

    const images = new Map<number, string[]>();
    for (const set of spec.adSets) {
      const adSetId = (await graph<{ id: string }>("POST", `${acct}/adsets`, token, buildAdSetParams(spec, set, { campaignId: ids.campaignId, pageId: page.pageId }))).id;
      const entry = { adSetId, adIds: [] as string[] };
      ids.adSets!.push(entry);
      for (const ad of set.ads) {
        const hashes = await uploadDesignImages(acct, token, ad.creative.designId, images);
        const creativeId = (
          await graph<{ id: string }>("POST", `${acct}/adcreatives`, token, buildCreativeParams(spec, ad, {
            pageId: page.pageId,
            instagramUserId: page.igUserId,
            imageHashes: ad.creative.format === "carousel" ? hashes : hashes.slice(0, 1),
            leadFormId: ids.leadFormId ?? null,
          }))
        ).id;
        entry.adIds.push((await graph<{ id: string }>("POST", `${acct}/ads`, token, { name: ad.name, adset_id: adSetId, creative: { creative_id: creativeId }, status: "ACTIVE" })).id);
      }
      update(id, { metaIds: JSON.stringify(ids) });
    }

    await graph("POST", ids.campaignId, token, { status: "ACTIVE" });
    update(id, { status: "active", metaIds: JSON.stringify(ids), launchedAt: new Date(), error: null });
    await logActivity("ads.launched", `Ad campaign "${current.name}" launched`, { adCampaignId: id });
    return getAdCampaign(id)!;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch failed.";
    if (ids.campaignId) {
      // Deleting the campaign removes its ad sets and ads with it. Best-effort:
      // it was never switched on, so nothing has spent either way.
      await graph("DELETE", ids.campaignId, token).catch(() => undefined);
    }
    update(id, { status: "error", error: message, metaIds: null });
    throw new AdsError(message);
  }
}

// ── Running campaigns ─────────────────────────────────────────────────────

function launched(id: number): AdCampaignRow & { metaIds: Required<Pick<MetaIds, "campaignId">> & MetaIds } {
  const c = getAdCampaign(id);
  if (!c) throw new AdsError("Campaign not found.");
  if (!c.metaIds.campaignId) throw new AdsError("This campaign has not been launched.");
  return c as AdCampaignRow & { metaIds: Required<Pick<MetaIds, "campaignId">> & MetaIds };
}

export async function setAdCampaignStatus(id: number, status: "active" | "paused" | "archived"): Promise<AdCampaignRow> {
  const c = launched(id);
  const meta = status === "active" ? "ACTIVE" : status === "paused" ? "PAUSED" : "ARCHIVED";
  await graph("POST", c.metaIds.campaignId, requireToken(), { status: meta });
  update(id, { status });
  await logActivity(`ads.${status}`, `Ad campaign "${c.name}" ${status === "active" ? "resumed" : status}`, { adCampaignId: id });
  return getAdCampaign(id)!;
}

/** Change one ad set's daily budget (major units) on Meta and in the plan. */
export async function setAdSetBudget(id: number, adSetIndex: number, dailyBudget: number): Promise<AdCampaignRow> {
  const c = launched(id);
  const entry = c.metaIds.adSets?.[adSetIndex];
  const set = c.spec.adSets[adSetIndex];
  if (!entry || !set) throw new AdsError("No such ad set.");
  if (!(dailyBudget >= 1 && dailyBudget <= 1000)) throw new AdsError("The daily budget must be between 1 and 1000.");
  await graph("POST", entry.adSetId, requireToken(), { daily_budget: toMinorUnits(dailyBudget) });
  set.dailyBudget = dailyBudget;
  update(id, { spec: JSON.stringify(c.spec) });
  await logActivity("ads.budget", `Ad set "${set.name}" budget set to ${dailyBudget} a day`, { adCampaignId: id });
  return getAdCampaign(id)!;
}

// ── Results ───────────────────────────────────────────────────────────────

const RESULT_ACTION: Record<Objective, { type: string | null; label: string }> = {
  awareness: { type: null, label: "People reached" },
  traffic: { type: "link_click", label: "Link clicks" },
  engagement: { type: "post_engagement", label: "Engagements" },
  leads: { type: "lead", label: "Leads" },
  messages: { type: "onsite_conversion.messaging_conversation_started_7d", label: "Conversations started" },
};

type InsightRow = {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  adset_id?: string;
  adset_name?: string;
  actions?: Array<{ action_type: string; value: string }>;
};

function resultsOf(row: InsightRow, objective: Objective): number {
  const want = RESULT_ACTION[objective];
  if (!want.type) return Number(row.reach ?? 0);
  return Number(row.actions?.find((a) => a.action_type === want.type)?.value ?? 0);
}

/** Pull lifetime spend and results from Meta and keep them on the row. Read-only on Meta. */
export async function refreshAdInsights(id: number): Promise<AdCampaignRow> {
  const c = launched(id);
  const token = requireToken();
  const fields = "spend,impressions,reach,clicks,actions";
  const total = (await graph<{ data?: InsightRow[] }>("GET", `${c.metaIds.campaignId}/insights`, token, { fields, date_preset: "maximum" })).data?.[0] ?? {};
  const bySet = (await graph<{ data?: InsightRow[] }>("GET", `${c.metaIds.campaignId}/insights`, token, { fields: `${fields},adset_id,adset_name`, level: "adset", date_preset: "maximum" })).data ?? [];
  const results = resultsOf(total, c.objective);
  const spend = Number(total.spend ?? 0);
  const insights: AdInsights = {
    spend,
    impressions: Number(total.impressions ?? 0),
    reach: Number(total.reach ?? 0),
    clicks: Number(total.clicks ?? 0),
    results,
    resultLabel: RESULT_ACTION[c.objective].label,
    costPerResult: results > 0 ? Math.round((spend / results) * 100) / 100 : null,
    adSets: bySet.map((r) => ({ adSetId: r.adset_id ?? "", name: r.adset_name ?? "", spend: Number(r.spend ?? 0), results: resultsOf(r, c.objective) })),
  };
  update(id, { insights: JSON.stringify(insights), insightsAt: new Date() });
  return getAdCampaign(id)!;
}

// ── Audience search ───────────────────────────────────────────────────────

export async function searchAdInterests(q: string): Promise<Array<InterestRef & { audienceSize: number | null }>> {
  if (!q.trim()) return [];
  const r = await graph<{ data?: Array<{ id: string; name: string; audience_size_upper_bound?: number }> }>("GET", "search", requireToken(), {
    type: "adinterest",
    q: q.trim(),
    limit: "15",
  });
  return (r.data ?? []).map((i) => ({ id: i.id, name: i.name, audienceSize: i.audience_size_upper_bound ?? null }));
}

export async function searchAdCities(q: string): Promise<Array<{ key: string; name: string; region: string | null; country: string | null }>> {
  if (!q.trim()) return [];
  const r = await graph<{ data?: Array<{ key: string; name: string; region?: string; country_name?: string }> }>("GET", "search", requireToken(), {
    type: "adgeolocation",
    location_types: ["city"],
    q: q.trim(),
    limit: "10",
  });
  return (r.data ?? []).map((c) => ({ key: c.key, name: c.name, region: c.region ?? null, country: c.country_name ?? null }));
}
