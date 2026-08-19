// Run: npm test -- src/lib/campaigns/landingUrl.test.ts
//
// Pure tests for buildCampaignLandingUrl — the representative-site pick + URL
// -format rule SHARED by launch.ts's "landing page live at …" summary line
// and the campaign hub detail page's landing URL/"view" link (Campaign
// Engine Slice 2, Task 4). landingUrl.ts has zero runtime imports (see its
// header comment), so — like plan.test.ts / assetBody.test.ts — this loads
// with a plain static import, no react-server shim needed (unlike
// store.test.ts, which would be needed to test the DB-touching
// getCampaignLandingUrl wrapper, not exercised here since it's a thin,
// untestable-without-a-DB pass-through around this function + listSites()).
import assert from "node:assert/strict";

import { buildCampaignLandingUrl, type LandingSiteLike } from "./landingUrl";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const liveWithHost: LandingSiteLike = { slug: "inspire", primaryHost: "optimalhealthatinspire.ie", status: "live" };
const liveNoHost: LandingSiteLike = { slug: "inspire-preview", primaryHost: null, status: "live" };
const draftWithHost: LandingSiteLike = { slug: "renova", primaryHost: "renovacellular.ie", status: "draft" };
const draftNoHost: LandingSiteLike = { slug: "draft-site", primaryHost: null, status: "draft" };
const secondLiveNoHost: LandingSiteLike = { slug: "second-live", primaryHost: null, status: "live" };

// ── the no-site tenant: no public URL, never throws ──
check("no sites at all -> null", buildCampaignLandingUrl([], "summer-sale") === null);

// ── the common case: a live site with a connected domain -> a clean absolute URL ──
check(
  "single live site with primaryHost -> https://<primaryHost>/c/<slug>",
  buildCampaignLandingUrl([liveWithHost], "summer-sale") === "https://optimalhealthatinspire.ie/c/summer-sale",
);

// ── a live site with no domain connected yet -> the dev mount path, no protocol/host ──
check(
  "single live site with no primaryHost -> /site/<slug>/c/<slug> (dev path)",
  buildCampaignLandingUrl([liveNoHost], "summer-sale") === "/site/inspire-preview/c/summer-sale",
);

// ── a single draft site is still used when it's the tenant's ONLY site (no other choice) ──
check(
  "single draft site (no live site exists) -> still builds a URL from it",
  buildCampaignLandingUrl([draftWithHost], "summer-sale") === "https://renovacellular.ie/c/summer-sale",
);

// ── multiple sites, exactly one live -> the LIVE one wins regardless of array position ──
check(
  "draft first, live second -> the live site is picked, not array-order-first",
  buildCampaignLandingUrl([draftWithHost, liveWithHost], "summer-sale") ===
    "https://optimalhealthatinspire.ie/c/summer-sale",
);
check(
  "live first, draft second -> the live site (already first) is picked",
  buildCampaignLandingUrl([liveWithHost, draftWithHost], "summer-sale") ===
    "https://optimalhealthatinspire.ie/c/summer-sale",
);

// ── multiple sites, NONE live -> falls back to the first site overall, in array order ──
check(
  "no live site among several -> falls back to the FIRST site in array order",
  buildCampaignLandingUrl([draftNoHost, draftWithHost], "summer-sale") === "/site/draft-site/c/summer-sale",
);

// ── multiple LIVE sites -> the first live one in array order wins, deterministically ──
check(
  "two live sites -> the first live one in array order wins",
  buildCampaignLandingUrl([liveWithHost, secondLiveNoHost], "summer-sale") ===
    "https://optimalhealthatinspire.ie/c/summer-sale",
);

// ── the campaign slug is threaded through verbatim, whatever site is picked ──
check(
  "campaign slug is threaded straight into the /c/<slug> path",
  buildCampaignLandingUrl([liveWithHost], "black-friday-2026") ===
    "https://optimalhealthatinspire.ie/c/black-friday-2026",
);

console.log(`\nAll ${passed} checks passed ✓`);
