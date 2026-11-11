/**
 * The ad account's own numbers, as Meta reports them: every campaign on the
 * business's chosen ad account, including the ones made in Meta Ads Manager,
 * not only those built in AdonisAgent. Pure: the fetch is accountInsights.ts.
 *
 * "Results" follows each campaign's objective, the way Ads Manager counts
 * them: leads for a lead campaign, conversations for a messages campaign,
 * link clicks for traffic, people reached for awareness, and so on.
 */

export const RANGES = [
  { key: "7d", label: "Last 7 days", preset: "last_7d" },
  { key: "30d", label: "Last 30 days", preset: "last_30d" },
  { key: "this_month", label: "This month", preset: "this_month" },
  { key: "last_month", label: "Last month", preset: "last_month" },
  { key: "max", label: "All time", preset: "maximum" },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

export function rangeOf(key: string | null | undefined): (typeof RANGES)[number] {
  return RANGES.find((r) => r.key === key) ?? RANGES[1];
}

export type ResultKind = "leads" | "messages" | "link_clicks" | "reach" | "engagement" | "purchases" | "installs";

export const RESULT_LABEL: Record<ResultKind, string> = {
  leads: "Leads",
  messages: "Conversations",
  link_clicks: "Link clicks",
  reach: "People reached",
  engagement: "Engagements",
  purchases: "Purchases",
  installs: "App installs",
};

/** Meta action types that count for each kind, best first (Meta reports a lead under several names). */
const ACTIONS: Record<Exclude<ResultKind, "reach">, string[]> = {
  leads: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped"],
  messages: ["onsite_conversion.messaging_conversation_started_7d"],
  link_clicks: ["link_click"],
  engagement: ["post_engagement", "page_engagement"],
  purchases: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
  installs: ["mobile_app_install", "app_install"],
};

export type MetaAction = { action_type: string; value: string };

export interface InsightRow {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
}

export function actionCount(actions: MetaAction[] | undefined, kind: Exclude<ResultKind, "reach">): number {
  for (const type of ACTIONS[kind]) {
    const hit = actions?.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

/**
 * What a campaign's results are, from its Meta objective. An engagement
 * campaign that started conversations is a messages campaign (Meta files
 * click-to-message ads under engagement since the 2022 objectives).
 */
export function resultKindFor(objective: string | null | undefined, actions?: MetaAction[]): ResultKind {
  switch ((objective ?? "").toUpperCase()) {
    case "OUTCOME_LEADS":
    case "LEAD_GENERATION":
      return "leads";
    case "MESSAGES":
      return "messages";
    case "OUTCOME_ENGAGEMENT":
    case "POST_ENGAGEMENT":
    case "PAGE_LIKES":
    case "EVENT_RESPONSES":
    case "VIDEO_VIEWS":
      return actionCount(actions, "messages") > 0 ? "messages" : "engagement";
    case "OUTCOME_AWARENESS":
    case "REACH":
    case "BRAND_AWARENESS":
      return "reach";
    case "OUTCOME_SALES":
    case "CONVERSIONS":
    case "PRODUCT_CATALOG_SALES":
      return "purchases";
    case "OUTCOME_APP_PROMOTION":
    case "APP_INSTALLS":
      return "installs";
    default:
      return "link_clicks";
  }
}

export interface Numbers {
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  /** Link clicks per impression, as a percentage; null with no impressions. */
  ctr: number | null;
}

export function numbersOf(row: InsightRow | undefined): Numbers {
  const spend = Number(row?.spend ?? 0) || 0;
  const impressions = Number(row?.impressions ?? 0) || 0;
  const linkClicks = Number(row?.inline_link_clicks ?? 0) || actionCount(row?.actions, "link_clicks");
  return {
    spend,
    impressions,
    reach: Number(row?.reach ?? 0) || 0,
    linkClicks,
    ctr: impressions > 0 ? Math.round((linkClicks / impressions) * 10000) / 100 : null,
  };
}

export function resultsOf(row: InsightRow | undefined, kind: ResultKind): number {
  return kind === "reach" ? Number(row?.reach ?? 0) || 0 : actionCount(row?.actions, kind);
}

/** Spend per result, rounded to the cent; null when there were none. */
export function costPer(spend: number, results: number): number | null {
  return results > 0 ? Math.round((spend / results) * 100) / 100 : null;
}

export type CampaignState = "active" | "paused" | "issue" | "ended" | "other";

/** Meta's effective_status, in the few words a business needs. */
export function stateOf(effectiveStatus: string | null | undefined): CampaignState {
  switch ((effectiveStatus ?? "").toUpperCase()) {
    case "ACTIVE":
    case "IN_PROCESS":
    case "PENDING_REVIEW":
      return "active";
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return "paused";
    case "WITH_ISSUES":
    case "DISAPPROVED":
    case "PENDING_BILLING_INFO":
      return "issue";
    case "ARCHIVED":
    case "DELETED":
    case "COMPLETED":
      return "ended";
    default:
      return "other";
  }
}

/** Ads Manager's page for one campaign on an ad account ("act_123"). */
export function adsManagerUrl(adAccountId: string, campaignId: string): string {
  const act = adAccountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(act)}&selected_campaign_ids=${encodeURIComponent(campaignId)}`;
}
