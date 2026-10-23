import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import {
  addAdsToCampaign,
  createAdDraft,
  launchAdCampaign,
  listAdCampaigns,
  refreshAdInsights,
  searchAdCities,
  searchAdInterests,
  setAdCampaignStatus,
  setAdCampaignPlatforms,
  setAdSetBudget,
  updateAdDraft,
} from "@/lib/ads/service";
import { OBJECTIVES, PLATFORM_LABEL, PLATFORMS, platformsOf, totalDailyBudget, validateSpec, type AdSpec, type CampaignSpec, type Platforms } from "@/lib/ads/spec";
import { listAdAccounts } from "@/lib/facebook/grants";
import { listCarousels } from "@/lib/image/carousels";
import { fenceUntrusted, type ToolContext, type ToolResult } from "@/lib/agents/toolKit";

/**
 * Adonis's ads tools (the ads manager, lib/ads). Reads run freely: listing
 * campaigns, searching audiences, pulling results. Every write goes through
 * the approval gate (WRITE_TOOL_META): saving a draft, launching, pausing /
 * resuming / archiving, changing a budget, adding an ad to a campaign
 * (live ones included) and changing where a campaign shows. Launching,
 * resuming, a budget change and an ad added to a live campaign spend the
 * business's money on its own ad account.
 */

const AD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    creative: {
      type: "object",
      properties: {
        designId: { type: "integer", description: "A Content Studio design id (list_ad_campaigns lists them)." },
        format: { type: "string", enum: ["single", "carousel"] },
        primaryText: { type: "string" },
        headline: { type: "string" },
        description: { type: "string" },
        cta: { type: "string", enum: ["LEARN_MORE", "BOOK_NOW", "SIGN_UP", "CONTACT_US", "GET_OFFER", "SHOP_NOW", "MESSAGE_PAGE", "APPLY_NOW", "SUBSCRIBE"] },
        linkUrl: { type: "string", description: "https link; required for traffic, awareness and engagement." },
      },
      required: ["designId", "format", "primaryText", "headline", "cta"],
    },
  },
  required: ["name", "creative"],
} as const;

const SPEC_SCHEMA = {
  type: "object",
  description:
    "The whole campaign plan. One campaign, 1-10 ad sets (each with its own daily budget, dates and audience), each holding 1-6 ads built from a Content Studio design.",
  properties: {
    name: { type: "string" },
    objective: { type: "string", enum: [...OBJECTIVES] },
    messageDestination: { type: "string", enum: ["messenger", "instagram"], description: "For objective 'messages': which inbox the ad opens." },
    platforms: {
      type: "string",
      enum: [...PLATFORMS],
      description: "Where the ads show: 'both' (default; Meta places them across Facebook and Instagram), 'facebook' (Facebook only) or 'instagram' (Instagram only).",
    },
    leadForm: {
      type: "object",
      description: "Required for objective 'leads': the instant form.",
      properties: {
        name: { type: "string" },
        headline: { type: "string", description: "One-line intro at the top of the form." },
        fields: { type: "array", items: { type: "string", enum: ["FULL_NAME", "EMAIL", "PHONE"] } },
        privacyPolicyUrl: { type: "string", description: "The business's privacy policy, https." },
        thankYouUrl: { type: "string", description: "The business's website, https." },
      },
      required: ["name", "headline", "fields", "privacyPolicyUrl", "thankYouUrl"],
    },
    adSets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          dailyBudget: { type: "number", description: "Major units of the ad account's currency per day, 1-1000." },
          startAt: { type: "string", description: "ISO datetime, optional (default: at launch)." },
          endAt: { type: "string", description: "ISO datetime, optional (default: until paused)." },
          audience: {
            type: "object",
            properties: {
              locations: {
                type: "array",
                description: "Cities with a radius (key from search_ad_audience type 'city') or whole countries.",
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["city", "country"] },
                    key: { type: "string" },
                    code: { type: "string", description: "Country code, e.g. IE." },
                    name: { type: "string" },
                    radiusKm: { type: "number" },
                  },
                  required: ["kind", "name"],
                },
              },
              ageMin: { type: "integer" },
              ageMax: { type: "integer" },
              genders: { type: "array", items: { type: "string", enum: ["male", "female"] } },
              interests: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id", "name"] } },
              advantageAudience: {
                type: "boolean",
                description: "Advantage+ audience lets Meta reach beyond the ages and interests set. Default false: these are local businesses that want their area and age range kept strict. True only if the operator asks for it.",
              },
            },
            required: ["locations", "ageMin", "ageMax", "genders", "interests", "advantageAudience"],
          },
          ads: {
            type: "array",
            items: AD_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        required: ["name", "dailyBudget", "audience", "ads"],
      },
    },
  },
  required: ["name", "objective", "adSets"],
} as const;

export const ADS_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_ad_campaigns",
    description:
      "List the business's Facebook/Instagram ad campaigns (status, daily budget, spend and results), the connected ad accounts, and the Content Studio designs that can be used as ad images.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_ad_audience",
    description: "Look up Meta targeting ids: interests (e.g. 'yoga') or towns/cities (e.g. 'Clonmel') to use in an ad set's audience.",
    input_schema: {
      type: "object",
      properties: { type: { type: "string", enum: ["interest", "city"] }, query: { type: "string" } },
      required: ["type", "query"],
    },
  },
  {
    name: "get_ad_results",
    description: "Pull a launched ad campaign's latest spend and results from Meta (spend, results, cost per result, reach, per ad set).",
    input_schema: { type: "object", properties: { campaignId: { type: "integer" } }, required: ["campaignId"] },
  },
  {
    name: "draft_ad_campaign",
    description:
      "Save an ad campaign plan as a DRAFT in the ads manager (nothing goes to Meta and nothing spends). Pass campaignId to replace an existing draft. Show the operator the plan (objective, audience, daily budget, ad copy) before calling. House rules for ad copy: no money-back guarantees, no free consults, no prices, no made-up claims.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "integer", description: "An existing draft to replace; omit for a new one." },
        adAccountId: { type: "string", description: "act_... from list_ad_campaigns; defaults to the first connected ad account." },
        spec: SPEC_SCHEMA as unknown as Record<string, unknown>,
      },
      required: ["spec"],
    },
  },
  {
    name: "launch_ad_campaign",
    description:
      "Launch a draft ad campaign on Meta, on the platforms its plan names (Facebook and Instagram, Facebook only, or Instagram only). It goes live immediately and spends up to its total daily budget from the business's ad account. Only when the operator has explicitly asked to launch it.",
    input_schema: { type: "object", properties: { campaignId: { type: "integer" } }, required: ["campaignId"] },
  },
  {
    name: "set_ad_campaign_status",
    description: "Pause, resume or archive a launched ad campaign. Resuming starts spending again.",
    input_schema: {
      type: "object",
      properties: { campaignId: { type: "integer" }, status: { type: "string", enum: ["active", "paused", "archived"] } },
      required: ["campaignId", "status"],
    },
  },
  {
    name: "add_ad_to_campaign",
    description:
      "Add one ad to an ad set of an existing campaign. On a draft it joins the plan. On a LIVE or paused campaign it is created on Meta straight away inside that ad set and, once Meta approves it, shows and spends from that ad set's existing budget. Show the operator the ad (design, texts, button) first. Same copy house rules as draft_ad_campaign. An ad set takes at most 6 ads.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "integer" },
        adSetIndex: { type: "integer", description: "0-based, in the order list_ad_campaigns shows. Default 0." },
        ad: AD_SCHEMA as unknown as Record<string, unknown>,
      },
      required: ["campaignId", "ad"],
    },
  },
  {
    name: "set_ad_placements",
    description:
      "Change where a campaign's ads show: 'both' (Facebook and Instagram), 'facebook' (Facebook only) or 'instagram' (Instagram only). Works on drafts and on live or paused campaigns (every ad set is updated on Meta).",
    input_schema: {
      type: "object",
      properties: { campaignId: { type: "integer" }, platforms: { type: "string", enum: [...PLATFORMS] } },
      required: ["campaignId", "platforms"],
    },
  },
  {
    name: "set_ad_budget",
    description: "Change one ad set's daily budget on a launched campaign (adSetIndex is 0-based, in the order list_ad_campaigns shows).",
    input_schema: {
      type: "object",
      properties: { campaignId: { type: "integer" }, adSetIndex: { type: "integer" }, dailyBudget: { type: "number" } },
      required: ["campaignId", "adSetIndex", "dailyBudget"],
    },
  },
];

const err = (e: unknown): ToolResult => ({ text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) });

/** READ */
export function listAdCampaignsTool(ctx: ToolContext): ToolResult {
  const campaigns = listAdCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    showsOn: PLATFORM_LABEL[platformsOf(c.spec)],
    adAccountId: c.adAccountId,
    dailyBudget: totalDailyBudget(c.spec),
    adSets: c.spec.adSets.map((s, i) => ({ index: i, name: s.name, dailyBudget: s.dailyBudget, ads: s.ads.length })),
    results: c.insights ? { spend: c.insights.spend, results: c.insights.results, label: c.insights.resultLabel, costPerResult: c.insights.costPerResult } : null,
    error: c.error,
  }));
  const adAccounts = listAdAccounts(ctx.tenantId).map((a) => ({ adAccountId: a.adAccountId, name: a.name, currency: a.currency, active: a.accountStatus === 1 }));
  const designs = listCarousels({ includeAdVersions: true })
    .filter((c) => c.generationStatus == null && c.slideCount > 0)
    .slice(0, 30)
    .map((c) => ({ designId: c.id, name: c.name, images: c.slideCount }));
  return { text: fenceUntrusted(JSON.stringify({ adAccounts, campaigns, designs })) };
}

/** READ */
export async function searchAdAudienceTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const q = String(input.query ?? "");
    const data = input.type === "city" ? await searchAdCities(q) : await searchAdInterests(q);
    return { text: fenceUntrusted(JSON.stringify(data)) };
  } catch (e) {
    return err(e);
  }
}

/** READ (a Meta read; it only refreshes the cached numbers) */
export async function getAdResultsTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const c = await refreshAdInsights(Number(input.campaignId));
    return { text: JSON.stringify({ name: c.name, status: c.status, results: c.insights }) };
  } catch (e) {
    return err(e);
  }
}

/** WRITE — save a draft (no Meta call, no spend). */
export function draftAdCampaignTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  try {
    const spec = input.spec as CampaignSpec;
    const adAccountId = typeof input.adAccountId === "string" && input.adAccountId ? input.adAccountId : listAdAccounts(ctx.tenantId)[0]?.adAccountId;
    if (!adAccountId) return { text: JSON.stringify({ error: "No ad account is connected. Connect Facebook and tick the ad account in Settings > Integrations > Facebook." }) };
    const row = input.campaignId ? updateAdDraft(Number(input.campaignId), { adAccountId, spec }) : createAdDraft({ adAccountId, spec, createdBy: "Adonis" });
    const problems = validateSpec(row.spec);
    return {
      text: JSON.stringify({
        result: `Draft saved as ad campaign #${row.id}.`,
        reviewUrl: `/marketing/ads/${row.id}`,
        stillToFix: problems,
      }),
    };
  } catch (e) {
    return err(e);
  }
}

/** WRITE — spends money. */
export async function launchAdCampaignTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const c = await launchAdCampaign(Number(input.campaignId));
    return { text: JSON.stringify({ result: `"${c.name}" is live (${PLATFORM_LABEL[platformsOf(c.spec)]}).`, url: `/marketing/ads/${c.id}` }) };
  } catch (e) {
    return err(e);
  }
}

/** WRITE */
export async function setAdCampaignStatusTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const status = input.status;
  if (status !== "active" && status !== "paused" && status !== "archived") return { text: JSON.stringify({ error: "status must be active, paused or archived." }) };
  try {
    const c = await setAdCampaignStatus(Number(input.campaignId), status);
    return { text: JSON.stringify({ result: `"${c.name}" is now ${status === "active" ? "running" : status}.` }) };
  } catch (e) {
    return err(e);
  }
}

/** WRITE — can raise spend. */
export async function setAdBudgetTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const c = await setAdSetBudget(Number(input.campaignId), Number(input.adSetIndex), Number(input.dailyBudget));
    return { text: JSON.stringify({ result: `Budget updated on "${c.name}".` }) };
  } catch (e) {
    return err(e);
  }
}

/** WRITE — on a live campaign this spends from the ad set's budget once Meta approves the ad. */
export async function addAdToCampaignTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    const ad = input.ad as AdSpec | undefined;
    if (!ad || typeof ad !== "object" || !ad.creative) return { text: JSON.stringify({ error: "ad is required (name and creative)." }) };
    const adSetIndex = input.adSetIndex === undefined ? 0 : Number(input.adSetIndex);
    const c = await addAdsToCampaign(Number(input.campaignId), adSetIndex, [{ ...ad, creative: { source: "design", ...ad.creative } }]);
    const live = c.status === "active" || c.status === "paused";
    return {
      text: JSON.stringify({
        result: live
          ? `Added to "${c.spec.adSets[adSetIndex]?.name}" in "${c.name}". Meta reviews new ads before they run, usually within a few hours.`
          : `Added to the draft "${c.name}". Nothing runs until it is launched.`,
        url: `/marketing/ads/${c.id}`,
      }),
    };
  } catch (e) {
    return err(e);
  }
}

/** WRITE */
export async function setAdPlacementsTool(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const platforms = input.platforms as Platforms;
  if (!(PLATFORMS as readonly string[]).includes(platforms)) return { text: JSON.stringify({ error: "platforms must be both, facebook or instagram." }) };
  try {
    const c = await setAdCampaignPlatforms(Number(input.campaignId), platforms);
    return { text: JSON.stringify({ result: `"${c.name}" now shows on ${PLATFORM_LABEL[platforms]}.` }) };
  } catch (e) {
    return err(e);
  }
}
