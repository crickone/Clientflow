/**
 * Pure campaign-kit asset plan + ordering helpers (Campaign Engine Slice 1).
 * Zero imports — loads under the plain-tsx test runner with no DB/React/Next
 * module graph behind it (mirrors src/lib/pipeline/roles.ts). Kept separate
 * from store.ts, which holds the drizzle CRUD behind `server-only` + the
 * ambient `db` — importing store.ts drags in @/lib/db's full tenancy chain
 * (react `cache`, next/headers, better-sqlite3), so anything that needs to
 * run DB-free lives here instead and gets re-exported by store.ts.
 */

/**
 * The 7 artifact kinds a campaign kit can hold, in the order the Marketing
 * agent builds them. Matches campaign_assets.kind's DB enum exactly.
 */
export const ASSET_ORDER = [
  "offer",
  "landing_page",
  "blog",
  "social",
  "email",
  "ad_copy",
  "video_script",
] as const;

export type AssetKind = (typeof ASSET_ORDER)[number];
export type AssetStatus = "pending" | "drafted" | "approved";
export type CampaignStatus =
  | "building"
  | "ready"
  | "active"
  | "complete"
  | "archived";

export interface AssetDef {
  kind: AssetKind;
  title: string;
  sortOrder: number;
}

/**
 * The default 11-asset kit, in build order: one offer, one landing page, one
 * blog post, 3 social posts, 3 emails, one ad copy, one video script.
 * sortOrder is 0..10 and doubles as campaign_assets.sort_order at insert
 * time — store.ts's addAssets(campaignId, DEFAULT_ASSET_PLAN) inserts these
 * verbatim under a freshly created campaign. landing_page sits right after
 * offer (sortOrder 1) since it's generated straight from the offer, same as
 * every other asset in the kit — see ./prompts's landingPagePrompt.
 */
export const DEFAULT_ASSET_PLAN: AssetDef[] = [
  { kind: "offer", title: "Offer", sortOrder: 0 },
  { kind: "landing_page", title: "Landing page", sortOrder: 1 },
  { kind: "blog", title: "Blog post", sortOrder: 2 },
  { kind: "social", title: "Social post 1", sortOrder: 3 },
  { kind: "social", title: "Social post 2", sortOrder: 4 },
  { kind: "social", title: "Social post 3", sortOrder: 5 },
  { kind: "email", title: "Email — Announce", sortOrder: 6 },
  { kind: "email", title: "Email — Proof", sortOrder: 7 },
  { kind: "email", title: "Email — Last chance", sortOrder: 8 },
  { kind: "ad_copy", title: "Ad copy", sortOrder: 9 },
  { kind: "video_script", title: "Video script", sortOrder: 10 },
];

/** The minimal asset shape nextPendingAsset needs — matches both a real CampaignAsset row and a bare test fixture. */
export interface AssetLike {
  sortOrder: number;
  status: AssetStatus;
}

/**
 * The next asset the operator/agent should work on: the lowest-sortOrder
 * asset that isn't yet approved, or null once every asset is approved. Pure
 * — takes whatever asset list the caller already has, so it works
 * identically over a real ordered CampaignAsset[] (store.ts's listAssets)
 * and the plain fixtures in store.test.ts.
 *
 * Two overload signatures rather than one plain generic: with a single
 * `<T extends AssetLike>(assets: T[]): T | null` signature, TypeScript
 * infers T as the *constraint* (AssetLike) — not `any` — when called with an
 * `any`-typed array (as store.test.ts's bare `{id,sortOrder,status} as any`
 * fixtures do), which would make `.id` a type error there. Declaring the
 * generic array overload first (so real, strongly-typed callers keep full
 * inference) and a bare `(assets: any): any` fallback last resolves `any`
 * call sites to that fallback instead, without loosening the real signature.
 */
export function nextPendingAsset<T extends AssetLike>(assets: T[]): T | null;
export function nextPendingAsset(assets: any): any;
export function nextPendingAsset<T extends AssetLike>(assets: T[]): T | null {
  let lowest: T | null = null;
  for (const asset of assets) {
    if (asset.status === "approved") continue;
    if (lowest === null || asset.sortOrder < lowest.sortOrder) lowest = asset;
  }
  return lowest;
}

/**
 * Campaign statuses that no longer accept edits. Later tasks (materialise /
 * launch) should check this before writing to a campaign or its assets —
 * 'complete'/'archived' are the two end states; everything else is still
 * open for the agent/operator to work on.
 */
export function isTerminalStatus(status: CampaignStatus): boolean {
  return status === "complete" || status === "archived";
}

/** The minimal asset shape findApprovedLandingAsset needs — matches both a real CampaignAsset row and a bare test fixture. */
export interface LandingAssetLike {
  kind: AssetKind;
  status: AssetStatus;
}

/**
 * The public landing-page render gate (Campaign Engine Slice 2, Task 3): a
 * campaign's `/site/<slug>/c/<campaignSlug>` route renders ONLY when BOTH
 * hold —
 *   1. the campaign itself is live: status is 'ready' (an approved-but-not-
 *      launched preview) or 'active' (launched) — 'building'/'complete'/
 *      'archived' must never render, mirroring the status check
 *      `/api/campaigns/signup` (lib/campaigns/signupToken.ts's route) makes
 *      independently on the same two values;
 *   2. there is an APPROVED `landing_page` asset to render — a drafted-but-
 *      not-yet-approved landing page (or none at all) has nothing safe to
 *      show a public visitor, even if the campaign is otherwise live.
 *
 * Returns the matching asset (so the caller can parse its `body` — see
 * ./assetBody's parseLandingBody) or `null` if either condition fails. Pure
 * + generic (same shape as nextPendingAsset above) so it's unit-testable
 * with plain fixtures and still returns the CALLER's full asset type (e.g. a
 * real CampaignAsset, with `.body`) rather than just the narrow
 * LandingAssetLike view. When more than one asset qualifies (shouldn't
 * happen — DEFAULT_ASSET_PLAN seeds exactly one landing_page per campaign —
 * but nothing enforces uniqueness at the DB level) this deterministically
 * returns the first match in array order rather than throwing.
 */
export function findApprovedLandingAsset<T extends LandingAssetLike>(
  campaignStatus: CampaignStatus,
  assets: T[],
): T | null {
  if (campaignStatus !== "ready" && campaignStatus !== "active") return null;
  return assets.find((a) => a.kind === "landing_page" && a.status === "approved") ?? null;
}
