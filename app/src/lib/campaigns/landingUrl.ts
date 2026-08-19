/**
 * Pure "which URL is this campaign's landing page live at" helper (Campaign
 * Engine Slice 2, Task 4). A campaign has no `site_id` of its own — campaigns
 * are tenant-wide, not per-site (see schema.ts's header comment) — so a
 * tenant running several CMS sites has no single obviously-correct site to
 * host `/c/<campaignSlug>` on. Rather than make the operator pick one (or
 * worse, let launch.ts and the campaign hub each guess independently and
 * risk disagreeing), this picks ONE deterministic REPRESENTATIVE site:
 *
 *   1. the first LIVE site (in the caller's array order — listSites()
 *      orders by name ascending, so this is alphabetical-by-name among live
 *      sites), or
 *   2. if no site is live, the first site overall (same order), or
 *   3. if the tenant has no sites at all, there is no public URL — `null`.
 *
 * URL shape mirrors resolveHost.ts's `siteUrl()` without needing its
 * `PublicSite`/request-host inputs (this runs from places — launch.ts, a
 * server component — that don't have a request's host to hand, and shouldn't
 * need one just to report a URL): a representative site WITH a `primaryHost`
 * gets a clean absolute `https://<primaryHost>/c/<slug>`; one with NO
 * `primaryHost` (no domain connected yet) gets the root-relative
 * `/site/<slug>/c/<slug>` dev-mount path — no protocol/host, since there's no
 * request to hang one off; the caller renders it as-is (a real deploy always
 * sets `primaryHost` once the domain is connected, so this branch is
 * dev/pre-launch only in practice).
 *
 * Zero runtime imports (not even a type-only one — `LandingSiteLike` below is
 * a local, minimal structural type rather than the full drizzle-inferred
 * `Site`) — mirrors ./plan's `AssetLike`/`LandingAssetLike` pattern, so this
 * loads under the plain tsx test runner with no DB/Next module graph behind
 * it (see landingUrl.test.ts) and test fixtures don't need every `sites`
 * column, only the 3 this function actually reads. A real `Site` row (from
 * @/lib/db/schema) satisfies this structurally, so the async DB wrapper
 * (`getCampaignLandingUrl`, ./store — the ONLY thing launch.ts and the
 * campaign hub detail page actually call) can pass `listSites()`'s result
 * straight through with no cast.
 */

/** The minimal site shape buildCampaignLandingUrl needs — matches both a real Site row (@/lib/db/schema) and a bare test fixture. */
export interface LandingSiteLike {
  slug: string;
  primaryHost: string | null;
  status: "draft" | "live";
}

export function buildCampaignLandingUrl(sites: LandingSiteLike[], campaignSlug: string): string | null {
  if (sites.length === 0) return null;
  const site = sites.find((s) => s.status === "live") ?? sites[0];
  const path = `/c/${campaignSlug}`;
  return site.primaryHost ? `https://${site.primaryHost}${path}` : `/site/${site.slug}${path}`;
}
