// Run: npm test -- src/lib/campaigns/plan.test.ts
//
// Pure tests for findApprovedLandingAsset — the public landing-page render
// gate (Campaign Engine Slice 2, Task 3). plan.ts has zero runtime imports
// (see its header comment), so — like prompts.test.ts — this loads with a
// plain static import, no react-server shim needed (unlike store.test.ts,
// which tests the SAME underlying plan.ts helpers but only via store.ts's
// re-export, and so needs the shim store.ts's DB module graph requires).
//
// This gate is the whole security-relevant surface of Task 3's render
// decision: get either half wrong (campaign status OR asset approval) and a
// building/unlaunched campaign, or an unapproved draft, leaks to a public,
// unauthenticated visitor. Every case below is chosen to catch exactly that
// kind of mistake.
import assert from "node:assert/strict";

import { findApprovedLandingAsset, type LandingAssetLike } from "./plan";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const approvedLanding: LandingAssetLike = { kind: "landing_page", status: "approved" };
const draftedLanding: LandingAssetLike = { kind: "landing_page", status: "drafted" };
const pendingLanding: LandingAssetLike = { kind: "landing_page", status: "pending" };
const approvedOffer: LandingAssetLike = { kind: "offer", status: "approved" };
const approvedBlog: LandingAssetLike = { kind: "blog", status: "approved" };

// ── the happy paths: 'ready' and 'active' both render ──
check(
  "status 'ready' + approved landing_page -> returns the asset",
  findApprovedLandingAsset("ready", [approvedOffer, approvedLanding]) === approvedLanding,
);
check(
  "status 'active' + approved landing_page -> returns the asset",
  findApprovedLandingAsset("active", [approvedLanding]) === approvedLanding,
);

// ── campaign not live: every non-{ready,active} status -> null, even with an approved asset ──
check(
  "status 'building' + approved landing_page -> null (not live yet)",
  findApprovedLandingAsset("building", [approvedLanding]) === null,
);
check(
  "status 'complete' + approved landing_page -> null (terminal)",
  findApprovedLandingAsset("complete", [approvedLanding]) === null,
);
check(
  "status 'archived' + approved landing_page -> null (terminal)",
  findApprovedLandingAsset("archived", [approvedLanding]) === null,
);

// ── campaign live, but no usable landing asset -> null ──
check("status 'ready' + no assets at all -> null", findApprovedLandingAsset("ready", []) === null);
check(
  "status 'ready' + landing_page still 'drafted' (not approved) -> null",
  findApprovedLandingAsset("ready", [draftedLanding]) === null,
);
check(
  "status 'ready' + landing_page still 'pending' -> null",
  findApprovedLandingAsset("ready", [pendingLanding]) === null,
);
check(
  "status 'ready' + only OTHER kinds approved (offer, blog) -> null (kind must match too)",
  findApprovedLandingAsset("ready", [approvedOffer, approvedBlog]) === null,
);

// ── kind-filtering correctness: an approved landing_page among other approved assets is found specifically ──
check(
  "picks the landing_page asset out of a full approved kit, not just 'any approved'",
  findApprovedLandingAsset("active", [approvedOffer, approvedLanding, approvedBlog]) === approvedLanding,
);

// ── defensive: more than one qualifying asset never throws, deterministically returns the first match ──
check(
  "two approved landing_page rows -> returns the first in array order (never throws)",
  findApprovedLandingAsset("ready", [approvedLanding, { kind: "landing_page", status: "approved" }]) ===
    approvedLanding,
);

// ── the real CampaignAsset shape (extra fields) round-trips through unchanged — proves genericity ──
{
  const realAsset = { id: 42, campaignId: 7, kind: "landing_page" as const, status: "approved" as const, body: "{}" };
  const result = findApprovedLandingAsset("ready", [realAsset]);
  check("generic: returns the FULL asset object (id/campaignId/body preserved), not just kind/status", result === realAsset && result?.body === "{}");
}

console.log(`\nplan.test.ts: ${passed} checks passed.`);
