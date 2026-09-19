// Run: npm test -- src/lib/campaigns/planSites.test.ts
//
// A campaign's landing page and blog post are pages on one of the tenant's
// websites. Before this gate, a business with no website got both of them
// generated, approved and reported as done, while materialise returned null
// by design and launch simply left the URL out of its summary. Nobody was
// ever told. The operator saw a finished campaign; the client had a landing
// page that existed only as a row in a table.
//
// These are the rules that stop that, tested on their own because ./plan is
// deliberately import-free and can be exercised without a database.
import assert from "node:assert/strict";

import {
  DEFAULT_ASSET_PLAN,
  assetBlockedReason,
  filterPlanForSites,
  type AssetDef,
} from "./plan";

const NO_SITE = { siteCount: 0 };
const ONE_SITE = { siteCount: 1 };
const TWO_SITES = { siteCount: 2 };

// ── what is blocked, and what is not ────────────────────────────────────────

assert.ok(assetBlockedReason("landing_page", NO_SITE), "a landing page needs a website");
assert.equal(assetBlockedReason("landing_page", ONE_SITE), null, "…and one website is enough");
assert.equal(
  assetBlockedReason("landing_page", TWO_SITES),
  null,
  "…while several is fine: landingUrl.ts already picks a representative site deterministically",
);

assert.ok(assetBlockedReason("blog", NO_SITE), "a blog post needs a website to be published to");
assert.equal(assetBlockedReason("blog", ONE_SITE), null, "…exactly one is what it wants");
assert.ok(
  assetBlockedReason("blog", TWO_SITES),
  "…and TWO is also blocked, because materialiseBlog resolves a single site or gives up silently",
);

// Everything self-contained is untouched. These are the assets a business
// with no website can still have, and blocking them would be the opposite
// mistake — refusing work that would have succeeded.
for (const kind of ["offer", "social", "email", "ad_copy", "video_script"] as const) {
  assert.equal(assetBlockedReason(kind, NO_SITE), null, `${kind} does not need a website`);
}

// The reason is written for a person and names the fix, because "cannot build
// this" without "here is how" leaves the operator stuck.
const reason = assetBlockedReason("landing_page", NO_SITE)!;
assert.match(reason, /no website in the system/i, "the reason says what is missing");
assert.match(reason, /CMS, Sites/, "…and where to fix it");

// ── filtering a plan ────────────────────────────────────────────────────────

const full = filterPlanForSites(DEFAULT_ASSET_PLAN, ONE_SITE);
assert.deepEqual(full.assets, DEFAULT_ASSET_PLAN, "a tenant with a website gets the whole kit, unchanged");
assert.deepEqual(full.dropped, [], "…and nothing is reported as dropped");

const trimmed = filterPlanForSites(DEFAULT_ASSET_PLAN, NO_SITE);
assert.equal(
  trimmed.assets.length,
  DEFAULT_ASSET_PLAN.length - 2,
  "a tenant with no website loses exactly the landing page and the blog post",
);
assert.ok(!trimmed.assets.some((a) => a.kind === "landing_page" || a.kind === "blog"), "…they are really gone");
assert.deepEqual(
  trimmed.dropped.map((d) => d.kind),
  ["landing_page", "blog"],
  "…and both are reported, in plan order, so the operator can be told",
);
assert.ok(
  trimmed.dropped.every((d) => d.title && d.reason),
  "each dropped asset carries its title and its reason",
);

// The offer, the social posts, the emails, the ad copy and the video script
// all survive: losing a website must not cost the tenant the rest of the kit.
assert.deepEqual(
  trimmed.assets.map((a) => a.kind),
  ["offer", "social", "social", "social", "email", "email", "email", "ad_copy", "video_script"],
  "everything that does not need a website still gets built",
);

// sortOrder is re-sequenced, not left with holes. It doubles as
// campaign_assets.sort_order and drives nextPendingAsset, so a gap would be a
// second, quieter bug sitting on top of the one this prevents.
assert.deepEqual(
  trimmed.assets.map((a) => a.sortOrder),
  [0, 1, 2, 3, 4, 5, 6, 7, 8],
  "sortOrder stays 0-based and gapless after the drop",
);

// Two sites: the blog goes, the landing page stays.
const twoSitePlan = filterPlanForSites(DEFAULT_ASSET_PLAN, TWO_SITES);
assert.deepEqual(twoSitePlan.dropped.map((d) => d.kind), ["blog"], "with two websites only the blog is ambiguous");
assert.ok(twoSitePlan.assets.some((a) => a.kind === "landing_page"), "…the landing page is still built");

// A plan that is ENTIRELY unbuildable comes back empty rather than throwing,
// so the caller can refuse with a reason instead of crashing.
const onlyPages: AssetDef[] = [
  { kind: "landing_page", title: "Landing page", sortOrder: 0 },
  { kind: "blog", title: "Blog post", sortOrder: 1 },
];
const none = filterPlanForSites(onlyPages, NO_SITE);
assert.deepEqual(none.assets, [], "nothing buildable is an empty plan");
assert.equal(none.dropped.length, 2, "…with both reasons intact for the refusal message");

// Filtering is pure: the caller's array is not mutated.
const before = JSON.stringify(DEFAULT_ASSET_PLAN);
filterPlanForSites(DEFAULT_ASSET_PLAN, NO_SITE);
assert.equal(JSON.stringify(DEFAULT_ASSET_PLAN), before, "the shared default plan is never mutated in place");

console.log("planSites.test.ts: all assertions passed");
