/**
 * The ads manager's plan for one Meta campaign, and the pure translation of
 * that plan into Marketing API parameters. No I/O and no `server-only`, so the
 * rules (objective -> optimisation, budget minor units, targeting shape, what
 * each objective requires) are unit-tested directly.
 *
 * A plan is one campaign with one or more ad sets (budget, schedule,
 * audience), each holding one or more ads (a Content Studio design plus the
 * words around it). Budgets live on the ad sets. The campaign is created PAUSED
 * and only switched on once the whole tree exists (lib/ads/service.ts).
 */

export const OBJECTIVES = ["awareness", "traffic", "engagement", "leads", "messages"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  awareness: "Awareness (reach people nearby)",
  traffic: "Traffic (visits to your website)",
  engagement: "Engagement (likes, comments, shares)",
  leads: "Leads (an instant form; leads land in your pipeline)",
  messages: "Messages (opens a Messenger or Instagram chat)",
};

export const CTAS = ["LEARN_MORE", "BOOK_NOW", "SIGN_UP", "CONTACT_US", "GET_OFFER", "SHOP_NOW", "MESSAGE_PAGE", "APPLY_NOW", "SUBSCRIBE"] as const;
export type Cta = (typeof CTAS)[number];

export interface InterestRef {
  id: string;
  name: string;
}

/** A city (Meta location key) with a radius, or a whole country. */
export type LocationRef =
  | { kind: "city"; key: string; name: string; radiusKm: number }
  | { kind: "country"; code: string; name: string }
  /** A pin dropped on the map with a radius: Meta's custom_locations. */
  | { kind: "point"; lat: number; lng: number; name: string; radiusKm: number };

export interface AudienceSpec {
  locations: LocationRef[];
  ageMin: number;
  ageMax: number;
  /** Empty = everyone. */
  genders: Array<"male" | "female">;
  interests: InterestRef[];
  /** Let Meta widen the audience beyond the interests when it finds better results. */
  advantageAudience: boolean;
}

export interface AdCreativeSpec {
  /** Content Studio design (carousel set) whose rendered slides are the images. */
  designId: number;
  /** "single" uses the first slide; "carousel" uses every slide as a carousel card. */
  format: "single" | "carousel";
  primaryText: string;
  headline: string;
  description?: string;
  cta: Cta;
  /** Website link for traffic / awareness / engagement ads. */
  linkUrl?: string;
}

export interface AdSpec {
  name: string;
  creative: AdCreativeSpec;
}

export interface AdSetSpec {
  name: string;
  /** In the ad account's currency, major units (e.g. 10 = EUR 10.00 a day). */
  dailyBudget: number;
  /** ISO datetimes; start defaults to "when launched", end to "until paused". */
  startAt?: string | null;
  endAt?: string | null;
  audience: AudienceSpec;
  ads: AdSpec[];
}

export interface LeadFormSpec {
  /**
   * An instant form that already exists on the Page (made in Meta), by id.
   * When set, the ads use it as it is and the fields below are ignored.
   */
  existingFormId?: string | null;
  name: string;
  /** The intro shown at the top of the form. */
  headline: string;
  /** Which fields Meta pre-fills from the person's profile. */
  fields: Array<"FULL_NAME" | "EMAIL" | "PHONE">;
  privacyPolicyUrl: string;
  /** Where the "done" button sends people. */
  thankYouUrl: string;
}

export interface CampaignSpec {
  name: string;
  objective: Objective;
  adSets: AdSetSpec[];
  /** Required when objective is "leads". */
  leadForm?: LeadFormSpec | null;
  /**
   * Who the ads promote and who pays, shown to people in the EU (Digital
   * Services Act; Meta's dsa_beneficiary / dsa_payor). Blank = the Page name.
   */
  advertiser?: string | null;
  /** For "messages": which inbox the ad opens. */
  messageDestination?: "messenger" | "instagram";
}

const MAX_AD_SETS = 10;
const MAX_ADS_PER_SET = 6;
const MIN_DAILY_BUDGET = 1;
const MAX_DAILY_BUDGET = 1000;

function isHttpsUrl(v: string | undefined | null): boolean {
  if (!v) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Every problem with a plan, in plain words; empty when it can be launched. */
export function validateSpec(spec: CampaignSpec): string[] {
  const errors: string[] = [];
  if (!spec.name?.trim()) errors.push("The campaign needs a name.");
  if (!OBJECTIVES.includes(spec.objective)) errors.push("Pick an objective.");
  if (!spec.adSets?.length) errors.push("Add at least one ad set.");
  if (spec.adSets?.length > MAX_AD_SETS) errors.push(`At most ${MAX_AD_SETS} ad sets per campaign.`);

  if (spec.objective === "leads") {
    const f = spec.leadForm;
    if (!f) errors.push("A leads campaign needs an instant form.");
    else if (f.existingFormId !== undefined && f.existingFormId !== null) {
      if (!String(f.existingFormId).trim()) errors.push("Pick the instant form from your Page.");
    } else {
      if (!f.name?.trim()) errors.push("The instant form needs a name.");
      if (!f.fields?.length) errors.push("The instant form needs at least one field.");
      if (!isHttpsUrl(f.privacyPolicyUrl)) errors.push("The instant form needs your privacy policy link (https).");
      if (!isHttpsUrl(f.thankYouUrl)) errors.push("The instant form needs a website link for its thank-you button (https).");
    }
  }

  (spec.adSets ?? []).forEach((set, i) => {
    const where = `Ad set ${i + 1}${set.name ? ` ("${set.name}")` : ""}`;
    if (!set.name?.trim()) errors.push(`${where} needs a name.`);
    if (!(set.dailyBudget >= MIN_DAILY_BUDGET)) errors.push(`${where}: the daily budget must be at least ${MIN_DAILY_BUDGET}.`);
    if (set.dailyBudget > MAX_DAILY_BUDGET) errors.push(`${where}: the daily budget is capped at ${MAX_DAILY_BUDGET} a day here; raise it in Ads Manager if you really mean it.`);
    if (set.startAt && set.endAt && Date.parse(set.endAt) <= Date.parse(set.startAt)) errors.push(`${where}: the end must be after the start.`);
    if (set.endAt && Date.parse(set.endAt) <= Date.now()) errors.push(`${where}: the end date is in the past.`);
    const a = set.audience;
    if (!a?.locations?.length) errors.push(`${where} needs at least one location.`);
    if (!(a?.ageMin >= 18 && a?.ageMax <= 65 && a.ageMin <= a.ageMax)) errors.push(`${where}: ages must be between 18 and 65, youngest first.`);
    for (const loc of a?.locations ?? []) {
      if ((loc.kind === "city" || loc.kind === "point") && !(loc.radiusKm >= 1 && loc.radiusKm <= 80)) errors.push(`${where}: a radius around ${loc.name} must be 1 to 80 km.`);
      if (loc.kind === "point" && !(Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180)) errors.push(`${where}: the pin "${loc.name}" is not a real place.`);
    }
    if (!set.ads?.length) errors.push(`${where} needs at least one ad.`);
    if (set.ads?.length > MAX_ADS_PER_SET) errors.push(`${where}: at most ${MAX_ADS_PER_SET} ads per ad set.`);
    (set.ads ?? []).forEach((ad, j) => {
      const at = `${where}, ad ${j + 1}`;
      const c = ad.creative;
      if (!ad.name?.trim()) errors.push(`${at} needs a name.`);
      if (!c?.designId) errors.push(`${at} needs a Content Studio design.`);
      if (!c?.primaryText?.trim()) errors.push(`${at} needs its main text.`);
      if (!c?.headline?.trim()) errors.push(`${at} needs a headline.`);
      if ((spec.objective === "traffic" || spec.objective === "awareness" || spec.objective === "engagement") && !isHttpsUrl(c?.linkUrl)) {
        errors.push(`${at} needs a website link (https).`);
      }
    });
  });
  return errors;
}

/** Meta's ad set settings for an objective. */
export function objectiveSettings(spec: CampaignSpec): {
  metaObjective: string;
  optimizationGoal: string;
  billingEvent: string;
  destinationType?: string;
  needsPagePromotedObject: boolean;
} {
  switch (spec.objective) {
    case "awareness":
      return { metaObjective: "OUTCOME_AWARENESS", optimizationGoal: "REACH", billingEvent: "IMPRESSIONS", needsPagePromotedObject: false };
    case "traffic":
      return { metaObjective: "OUTCOME_TRAFFIC", optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS", destinationType: "WEBSITE", needsPagePromotedObject: false };
    case "engagement":
      return { metaObjective: "OUTCOME_ENGAGEMENT", optimizationGoal: "POST_ENGAGEMENT", billingEvent: "IMPRESSIONS", destinationType: "ON_POST", needsPagePromotedObject: false };
    case "leads":
      return { metaObjective: "OUTCOME_LEADS", optimizationGoal: "LEAD_GENERATION", billingEvent: "IMPRESSIONS", destinationType: "ON_AD", needsPagePromotedObject: true };
    case "messages":
      return {
        metaObjective: "OUTCOME_ENGAGEMENT",
        optimizationGoal: "CONVERSATIONS",
        billingEvent: "IMPRESSIONS",
        destinationType: spec.messageDestination === "instagram" ? "INSTAGRAM_DIRECT" : "MESSENGER",
        needsPagePromotedObject: true,
      };
  }
}

/** Major units -> the minor units Meta expects for budgets (EUR 10.50 -> 1050). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** The targeting object for an ad set. */
export function buildTargeting(a: AudienceSpec): Record<string, unknown> {
  const cities = a.locations.filter((l): l is Extract<LocationRef, { kind: "city" }> => l.kind === "city");
  const countries = a.locations.filter((l): l is Extract<LocationRef, { kind: "country" }> => l.kind === "country");
  const geo: Record<string, unknown> = {};
  if (cities.length) geo.cities = cities.map((c) => ({ key: c.key, radius: c.radiusKm, distance_unit: "kilometer" }));
  if (countries.length) geo.countries = countries.map((c) => c.code);
  const points = a.locations.filter((l): l is Extract<LocationRef, { kind: "point" }> => l.kind === "point");
  if (points.length) {
    geo.custom_locations = points.map((p) => ({
      latitude: Number(p.lat.toFixed(6)),
      longitude: Number(p.lng.toFixed(6)),
      radius: p.radiusKm,
      distance_unit: "kilometer",
    }));
  }
  const t: Record<string, unknown> = {
    geo_locations: geo,
    age_min: a.ageMin,
    age_max: a.ageMax,
    targeting_automation: { advantage_audience: a.advantageAudience ? 1 : 0 },
  };
  if (a.genders.length === 1) t.genders = [a.genders[0] === "male" ? 1 : 2];
  if (a.interests.length) t.flexible_spec = [{ interests: a.interests.map((i) => ({ id: i.id, name: i.name })) }];
  return t;
}

export interface AdSetContext {
  campaignId: string;
  pageId: string;
  /** Fallback for spec.advertiser: the Page (or business) name. */
  advertiser?: string | null;
}

/** POST /act_<id>/adsets parameters for one ad set (its campaign is the on/off switch). */
export function buildAdSetParams(spec: CampaignSpec, set: AdSetSpec, ctx: AdSetContext): Record<string, unknown> {
  const o = objectiveSettings(spec);
  const params: Record<string, unknown> = {
    name: set.name,
    campaign_id: ctx.campaignId,
    daily_budget: toMinorUnits(set.dailyBudget),
    billing_event: o.billingEvent,
    optimization_goal: o.optimizationGoal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: buildTargeting(set.audience),
    // ACTIVE under a campaign that stays PAUSED until the whole tree exists, so
    // switching the campaign on is the single launch switch.
    status: "ACTIVE",
  };
  if (o.destinationType) params.destination_type = o.destinationType;
  if (o.needsPagePromotedObject) params.promoted_object = { page_id: ctx.pageId };
  // EU Digital Services Act: every ad set says who it promotes and who paid.
  // Meta refuses EU-targeted ad sets without them ("Enter the person or
  // organization being promoted by an ad").
  const advertiser = (spec.advertiser ?? "").trim() || (ctx.advertiser ?? "").trim();
  if (advertiser) {
    params.dsa_beneficiary = advertiser;
    params.dsa_payor = advertiser;
  }
  if (set.startAt) params.start_time = new Date(set.startAt).toISOString();
  if (set.endAt) params.end_time = new Date(set.endAt).toISOString();
  return params;
}

/** POST /act_<id>/campaigns parameters (created PAUSED; budgets live on the ad sets). */
export function buildCampaignParams(spec: CampaignSpec): Record<string, unknown> {
  return {
    name: spec.name,
    objective: objectiveSettings(spec).metaObjective,
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  };
}

export interface CreativeContext {
  pageId: string;
  instagramUserId: string | null;
  /** Uploaded image hashes in slide order (one for a single-image ad). */
  imageHashes: string[];
  leadFormId: string | null;
}

const MESSENGER_LINK = "https://fb.com/messenger_doc/";

/** POST /act_<id>/adcreatives parameters for one ad. */
export function buildCreativeParams(spec: CampaignSpec, ad: AdSpec, ctx: CreativeContext): Record<string, unknown> {
  const c = ad.creative;
  let link = c.linkUrl ?? "";
  let callToAction: Record<string, unknown> = { type: c.cta, value: { link } };
  if (spec.objective === "leads") {
    // Meta needs a link on a lead ad even though the button opens the form;
    // fb.me is Meta's own placeholder for exactly this.
    link = c.linkUrl || spec.leadForm?.thankYouUrl || "https://fb.me/";
    callToAction = { type: c.cta === "MESSAGE_PAGE" ? "SIGN_UP" : c.cta, value: { lead_gen_form_id: ctx.leadFormId } };
  } else if (spec.objective === "messages") {
    link = MESSENGER_LINK;
    callToAction = {
      type: "MESSAGE_PAGE",
      value: { app_destination: spec.messageDestination === "instagram" ? "INSTAGRAM_DIRECT" : "MESSENGER" },
    };
  }

  const linkData: Record<string, unknown> = {
    link,
    message: c.primaryText,
    call_to_action: callToAction,
  };
  if (c.format === "carousel" && ctx.imageHashes.length > 1) {
    linkData.child_attachments = ctx.imageHashes.slice(0, 10).map((hash) => ({
      image_hash: hash,
      link,
      name: c.headline,
      ...(c.description ? { description: c.description } : {}),
      call_to_action: callToAction,
    }));
    linkData.multi_share_optimized = true;
  } else {
    linkData.image_hash = ctx.imageHashes[0];
    linkData.name = c.headline;
    if (c.description) linkData.description = c.description;
  }

  const storySpec: Record<string, unknown> = { page_id: ctx.pageId, link_data: linkData };
  if (ctx.instagramUserId) storySpec.instagram_user_id = ctx.instagramUserId;
  return { name: ad.name, object_story_spec: storySpec };
}

/** POST /<page-id>/leadgen_forms parameters for the campaign's instant form. */
export function buildLeadFormParams(form: LeadFormSpec): Record<string, unknown> {
  return {
    name: form.name,
    locale: "en_GB",
    questions: form.fields.map((type) => ({ type })),
    privacy_policy: { url: form.privacyPolicyUrl, link_text: "Privacy policy" },
    context_card: { title: form.headline, style: "PARAGRAPH_STYLE", content: [form.headline] },
    thank_you_page: {
      title: "Thanks, we'll be in touch.",
      body: "We have your details and will contact you shortly.",
      button_type: "VIEW_WEBSITE",
      button_text: "Visit our website",
      website_url: form.thankYouUrl,
    },
  };
}

/** Total daily spend across a plan's ad sets, for the confirm-before-launch line. */
export function totalDailyBudget(spec: CampaignSpec): number {
  return (spec.adSets ?? []).reduce((sum, s) => sum + (Number(s.dailyBudget) || 0), 0);
}
