// Run: npx tsx src/lib/ads/placements.test.ts
import assert from "node:assert/strict";

import { buildPlacementImageParams, buildPlacementVideoParams, buildSingleVideoParams, validateSpec, type CampaignSpec } from "./spec";

const ad = {
  name: "Version 1",
  creative: { source: "design" as const, designId: 7, format: "single" as const, primaryText: "Main", headline: "Head", description: "Clonmel", cta: "BOOK_NOW" as const, linkUrl: "https://x.ie", extraTexts: ["Second"] },
};
const spec: CampaignSpec = {
  name: "C",
  objective: "traffic",
  adSets: [{ name: "S", dailyBudget: 10, audience: { locations: [{ kind: "country", code: "IE", name: "Ireland" }], ageMin: 18, ageMax: 65, genders: [], interests: [], advantageAudience: false }, ads: [ad] }],
};
const ctx = { pageId: "p1", instagramUserId: "ig1", imageHashes: [], leadFormId: null };

const img = buildPlacementImageParams(spec, ad, ctx, { feed: "F", tall: "T" }) as { asset_feed_spec: Record<string, unknown>; object_story_spec: Record<string, unknown> };
const f = img.asset_feed_spec as { images: { hash: string; adlabels: { name: string }[] }[]; asset_customization_rules: { image_label: { name: string }; customization_spec: { instagram_positions: string[] } }[]; bodies: { text: string }[] };
assert.deepEqual(f.images.map((i) => i.hash), ["F", "T"]);
assert.equal(f.asset_customization_rules[1].image_label.name, "tall_image");
assert.ok(f.asset_customization_rules[1].customization_spec.instagram_positions.includes("reels"));
assert.deepEqual(f.bodies.map((b) => b.text), ["Main", "Second"], "text options travel with it");
assert.equal(img.object_story_spec.instagram_user_id, "ig1");

const vad = { ...ad, creative: { ...ad.creative, source: "video" as const, adCreativeId: 3 } };
const vid = buildPlacementVideoParams(spec, vad, ctx, { feed: { videoId: "v1", thumbnailHash: "h1" }, tall: { videoId: "v2", thumbnailHash: "h2" } }) as { asset_feed_spec: { videos: { video_id: string }[]; ad_formats: string[] } };
assert.deepEqual(vid.asset_feed_spec.videos.map((v) => v.video_id), ["v1", "v2"]);
assert.deepEqual(vid.asset_feed_spec.ad_formats, ["SINGLE_VIDEO"]);

const single = buildSingleVideoParams(spec, vad, ctx, { videoId: "v1", thumbnailHash: "h1" }) as { object_story_spec: { video_data: Record<string, unknown>; link_data?: unknown } };
assert.equal(single.object_story_spec.video_data.video_id, "v1");
assert.equal(single.object_story_spec.link_data, undefined, "a video ad carries video_data, not link_data");

// A video ad needs its ad; a design ad still needs its design.
const bad = validateSpec({ ...spec, adSets: [{ ...spec.adSets[0], ads: [{ ...vad, creative: { ...vad.creative, adCreativeId: undefined } }] }] });
assert.ok(bad.some((e) => e.includes("video ad")));

console.log("placements: all checks passed.");
