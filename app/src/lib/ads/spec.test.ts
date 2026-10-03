// Run: npm test -- src/lib/ads/spec.test.ts
//
// The ads manager's pure rules: what a plan must contain before it can launch,
// and the exact Marketing API shapes each objective produces.
import assert from "node:assert/strict";

import {
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

console.log(`ads/spec.test.ts: ${passed} checks passed.`);
