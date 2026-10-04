// Run: npm test -- src/lib/ads/spec.test.ts
//
// The ads manager's pure rules: what a plan must contain before it can launch,
// and the exact Marketing API shapes each objective produces.
import assert from "node:assert/strict";

import {
  buildAssetFeedCreativeParams,
  hasVariants,
  splitVariants,
  textOptions,
  validateSpec,
  buildCampaignParams,
  buildAdSetParams,
  buildCreativeParams,
  buildTargeting,
  buildLeadFormParams,
  toMinorUnits,
  totalDailyBudget,
  type CampaignSpec,
} from "./spec";

let passed = 0;
const check = (name: string, cond: boolean) => { assert.ok(cond, name); passed++; };

const base = (over: Partial<CampaignSpec> = {}): CampaignSpec => ({
  name: "Spring push",
  objective: "traffic",
  adSets: [{
    name: "Clonmel 25-55",
    dailyBudget: 10.5,
    audience: {
      locations: [{ kind: "city", key: "123", name: "Clonmel", radiusKm: 25 }],
      ageMin: 25, ageMax: 55, genders: [], interests: [{ id: "600", name: "Fitness" }], advantageAudience: true,
    },
    ads: [{ name: "Ad A", creative: { designId: 7, format: "single", primaryText: "Hello", headline: "Book today", cta: "LEARN_MORE", linkUrl: "https://example.ie" } }],
  }],
  ...over,
});

check("a complete traffic plan validates", validateSpec(base()).length === 0);
check("traffic without a link is rejected", validateSpec(base({ adSets: [{ ...base().adSets[0], ads: [{ name: "x", creative: { designId: 1, format: "single", primaryText: "a", headline: "b", cta: "LEARN_MORE" } }] }] })).some((e) => e.includes("website link")));
check("leads without a form is rejected", validateSpec(base({ objective: "leads" })).some((e) => e.includes("instant form")));
check("budget below 1 is rejected", validateSpec(base({ adSets: [{ ...base().adSets[0], dailyBudget: 0.5 }] })).some((e) => e.includes("at least")));
check("ages outside 18-65 are rejected", validateSpec(base({ adSets: [{ ...base().adSets[0], audience: { ...base().adSets[0].audience, ageMin: 16 } }] })).some((e) => e.includes("18 and 65")));
check("radius over 80km is rejected", validateSpec(base({ adSets: [{ ...base().adSets[0], audience: { ...base().adSets[0].audience, locations: [{ kind: "city", key: "1", name: "Cork", radiusKm: 120 }] } }] })).some((e) => e.includes("1 to 80")));

check("minor units round", toMinorUnits(10.5) === 1050 && toMinorUnits(0.1 + 0.2) === 30);
check("total daily budget sums ad sets", totalDailyBudget(base({ adSets: [base().adSets[0], { ...base().adSets[0], dailyBudget: 4.5 }] })) === 15);

const camp = buildCampaignParams(base());
check("campaign is created paused with no special category", camp.status === "PAUSED" && Array.isArray(camp.special_ad_categories) && (camp.special_ad_categories as unknown[]).length === 0);
check("traffic maps to OUTCOME_TRAFFIC", camp.objective === "OUTCOME_TRAFFIC");

const set = buildAdSetParams(base(), base().adSets[0], { campaignId: "c1", pageId: "p1" });
check("ad set budget in minor units, on under its paused campaign, link clicks", set.daily_budget === 1050 && set.status === "ACTIVE" && set.optimization_goal === "LINK_CLICKS" && set.destination_type === "WEBSITE");
check("traffic ad set has no promoted page", set.promoted_object === undefined);

const t = buildTargeting(base().adSets[0].audience) as { geo_locations: { cities: Array<{ radius: number; distance_unit: string }> }; genders?: number[]; flexible_spec: unknown[]; targeting_automation: { advantage_audience: number } };
check("city radius in km", t.geo_locations.cities[0].radius === 25 && t.geo_locations.cities[0].distance_unit === "kilometer");

// Map pins: Meta custom_locations with a km radius; out-of-range radius refused.
const pinAudience = { ...base().adSets[0].audience, locations: [{ kind: "point" as const, lat: 52.355, lng: -7.7039, name: "Clonmel", radiusKm: 12 }] };
const pt = buildTargeting(pinAudience) as { geo_locations: { custom_locations: Array<{ latitude: number; longitude: number; radius: number; distance_unit: string }> } };
check("pin becomes a custom location", pt.geo_locations.custom_locations[0].latitude === 52.355 && pt.geo_locations.custom_locations[0].longitude === -7.7039 && pt.geo_locations.custom_locations[0].radius === 12 && pt.geo_locations.custom_locations[0].distance_unit === "kilometer");
check("pin radius over 80km is rejected", validateSpec(base({ adSets: [{ ...base().adSets[0], audience: { ...pinAudience, locations: [{ kind: "point", lat: 52, lng: -7, name: "Far", radiusKm: 90 }] } }] })).some((e) => e.includes("1 to 80")));
check("no gender filter when both", t.genders === undefined);
check("interests in flexible_spec", t.flexible_spec.length === 1);
check("advantage audience flag explicit", t.targeting_automation.advantage_audience === 1);
check("one gender maps to Meta code", (buildTargeting({ ...base().adSets[0].audience, genders: ["female"] }) as { genders: number[] }).genders[0] === 2);

const leads = base({ objective: "leads", leadForm: { name: "Form", headline: "Free assessment", fields: ["FULL_NAME", "EMAIL", "PHONE"], privacyPolicyUrl: "https://x.ie/privacy", thankYouUrl: "https://x.ie" } });
check("a complete leads plan validates (no link needed on the ad)", validateSpec({ ...leads, adSets: [{ ...leads.adSets[0], ads: [{ name: "L", creative: { designId: 2, format: "single", primaryText: "a", headline: "b", cta: "SIGN_UP" } }] }] }).length === 0);
const leadSet = buildAdSetParams(leads, leads.adSets[0], { campaignId: "c", pageId: "PAGE" });
check("leads ad set promotes the page, on-ad destination", leadSet.optimization_goal === "LEAD_GENERATION" && leadSet.destination_type === "ON_AD" && (leadSet.promoted_object as { page_id: string }).page_id === "PAGE");
const leadCreative = buildCreativeParams(leads, leads.adSets[0].ads[0], { pageId: "PAGE", instagramUserId: "IG", imageHashes: ["h1"], leadFormId: "F1" }) as { object_story_spec: { instagram_user_id: string; link_data: { call_to_action: { value: { lead_gen_form_id: string } } } } };
check("lead creative points at the form", leadCreative.object_story_spec.link_data.call_to_action.value.lead_gen_form_id === "F1");
check("creative carries the Instagram account", leadCreative.object_story_spec.instagram_user_id === "IG");

const msgs = base({ objective: "messages", messageDestination: "instagram" });
const msgSet = buildAdSetParams(msgs, msgs.adSets[0], { campaignId: "c", pageId: "P" });
check("messages ad set optimises for conversations into Instagram", msgSet.optimization_goal === "CONVERSATIONS" && msgSet.destination_type === "INSTAGRAM_DIRECT");
const msgCreative = buildCreativeParams(msgs, msgs.adSets[0].ads[0], { pageId: "P", instagramUserId: null, imageHashes: ["h"], leadFormId: null }) as { object_story_spec: { link_data: { call_to_action: { type: string; value: { app_destination: string } } } } };
check("messages creative opens Instagram Direct", msgCreative.object_story_spec.link_data.call_to_action.type === "MESSAGE_PAGE" && msgCreative.object_story_spec.link_data.call_to_action.value.app_destination === "INSTAGRAM_DIRECT");

const carousel = buildCreativeParams(base(), { name: "C", creative: { ...base().adSets[0].ads[0].creative, format: "carousel" } }, { pageId: "P", instagramUserId: null, imageHashes: ["a", "b", "c"], leadFormId: null }) as { object_story_spec: { link_data: { child_attachments: unknown[]; image_hash?: string } } };
check("carousel ad has one card per slide and no single image", carousel.object_story_spec.link_data.child_attachments.length === 3 && carousel.object_story_spec.link_data.image_hash === undefined);

const form = buildLeadFormParams(leads.leadForm!) as { questions: Array<{ type: string }>; privacy_policy: { url: string } };
check("lead form asks the chosen fields with the privacy link", form.questions.length === 3 && form.privacy_policy.url === "https://x.ie/privacy");


// An existing Page form: only the choice is needed, and lead ads get Meta's placeholder link.
{
  const withForm = base({ objective: "leads", leadForm: { existingFormId: "999", name: "", headline: "", fields: [], privacyPolicyUrl: "", thankYouUrl: "" } });
  check("existing form needs no links", !validateSpec(withForm).some((e) => e.includes("instant form")));
  check("blank existing form id is refused", validateSpec(base({ objective: "leads", leadForm: { existingFormId: "", name: "", headline: "", fields: [], privacyPolicyUrl: "", thankYouUrl: "" } })).some((e) => e.includes("Pick the instant form")));
}


// EU DSA: beneficiary and payer on every ad set, the plan's advertiser or the Page name.
{
  const dsa = buildAdSetParams(base(), base().adSets[0], { campaignId: "c", pageId: "p", advertiser: "Adonis Agent" }) as Record<string, unknown>;
  check("DSA beneficiary and payer default to the Page name", dsa.dsa_beneficiary === "Adonis Agent" && dsa.dsa_payor === "Adonis Agent");
  const own = buildAdSetParams(base({ advertiser: "Vantaige Limited" }), base().adSets[0], { campaignId: "c", pageId: "p", advertiser: "Adonis Agent" }) as Record<string, unknown>;
  check("the plan's advertiser wins", own.dsa_beneficiary === "Vantaige Limited" && own.dsa_payor === "Vantaige Limited");
}

// Library photos: needs at least one; several go out as a carousel.
{
  const ad0 = base().adSets[0].ads[0];
  const lib = (ids: number[]) => base({ adSets: [{ ...base().adSets[0], ads: [{ ...ad0, creative: { ...ad0.creative, source: "library" as const, designId: 0, imageAssetIds: ids } }] }] });
  check("library ad with no photos is refused", validateSpec(lib([])).some((e) => e.includes("at least one photo")));
  check("library ad needs no design", !validateSpec(lib([5])).some((e) => e.includes("Content Studio design")));
  const two = lib([5, 6]);
  const cp = buildCreativeParams(two, two.adSets[0].ads[0], { pageId: "p", instagramUserId: null, imageHashes: ["h1", "h2"], leadFormId: null }) as { object_story_spec: { link_data: { child_attachments?: unknown[] } } };
  check("two library photos make a carousel", (cp.object_story_spec.link_data.child_attachments ?? []).length === 2);
}

// Text and image options (Ads Manager's multiple texts / media).
{
  const ad0 = base().adSets[0].ads[0];
  const withOpts = { ...ad0, creative: { ...ad0.creative, primaryText: "A", extraTexts: ["B", "C"], headline: "H1", extraHeadlines: ["H2"] } };
  check("text options collect main + extras", textOptions(withOpts.creative).texts.join() === "A,B,C" && textOptions(withOpts.creative).headlines.join() === "H1,H2");
  check("no extras and one image is not a variant ad", !hasVariants(ad0.creative, 1));
  check("extra texts make a variant ad", hasVariants(withOpts.creative, 1));
  check("image options make a variant ad", hasVariants({ ...ad0.creative, format: "options" }, 3));
  const feed = buildAssetFeedCreativeParams(base(), withOpts, { pageId: "p", instagramUserId: "ig", imageHashes: ["h1", "h2"], leadFormId: null }) as { object_story_spec: Record<string, unknown>; asset_feed_spec: { bodies: unknown[]; titles: unknown[]; images: unknown[]; optimization_type: string; link_urls: Array<{ website_url: string }> } };
  check("asset feed lists every text, headline and image", feed.asset_feed_spec.bodies.length === 3 && feed.asset_feed_spec.titles.length === 2 && feed.asset_feed_spec.images.length === 2);
  check("asset feed is Meta's degrees-of-freedom kind", feed.asset_feed_spec.optimization_type === "DEGREES_OF_FREEDOM" && !("link_data" in feed.object_story_spec));
  const parts = splitVariants({ ...withOpts, creative: { ...withOpts.creative, format: "options" } }, ["h1", "h2"]);
  check("fallback splits into one ad per option, cycling", parts.length === 3 && parts[1].ad.creative.primaryText === "B" && parts[1].ad.creative.headline === "H2" && parts[2].imageHashes[0] === "h1");
  check("empty text option is refused", validateSpec(base({ adSets: [{ ...base().adSets[0], ads: [{ ...ad0, creative: { ...ad0.creative, extraTexts: [" "] } }] }] })).some((e) => e.includes("empty text option")));
}

// Advantage+ audience: ages are a suggestion; hard limits stay wide.
{
  const aud = base().adSets[0].audience;
  const adv = buildTargeting({ ...aud, ageMin: 30, ageMax: 60, advantageAudience: true }) as Record<string, unknown>;
  check("Advantage+ narrow ages go as a suggested range", adv.age_min === 25 && adv.age_max === 65 && JSON.stringify(adv.age_range) === "[30,60]");
  const strict = buildTargeting({ ...aud, ageMin: 30, ageMax: 60, advantageAudience: false }) as Record<string, unknown>;
  check("without Advantage+ ages are a hard limit", strict.age_min === 30 && strict.age_max === 60 && strict.age_range === undefined);
}
console.log(`ads/spec.test.ts: ${passed} checks passed.`);
