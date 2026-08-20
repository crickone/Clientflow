/**
 * NAMESPACE NOTE: this route permanently reserves the `/c/*` path segment on
 * every public site — `/site/<slug>/c/<campaignSlug>` resolves HERE, ahead
 * of the catch-all CMS page renderer (site/[siteSlug]/[...slug]/page.tsx). A
 * CMS page ever published at a `/c/...` slug would be shadowed and
 * unreachable, same accepted tradeoff as the existing `/blog/*` segment
 * (also a dedicated route ahead of the catch-all, for the same structural
 * reason). Not a bug — just a reserved-namespace cost worth knowing about if
 * a client ever wants a CMS page at `/c/...`.
 */
import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { runWithTenant, getCurrentTenant } from "@/lib/db/tenant";
import {
  findApprovedLandingAsset,
  getCampaignBySlug,
  listAssets,
  type Campaign,
} from "@/lib/campaigns/store";
import { parseLandingBody, type ParsedLandingBody } from "@/lib/campaigns/assetBody";
import { signCampaignSignupToken } from "@/lib/campaigns/signupToken";
import { getBrandFontIds, getThemeForTenant } from "@/lib/settings";
import type { ThemeConfig } from "@/lib/theme";
import { getBusinessProfile, type BusinessProfile } from "@/lib/businessProfile";
import { resolveLogoPath } from "@/lib/branding";
import { CampaignLanding } from "@/components/campaigns/CampaignLanding";

export const dynamic = "force-dynamic";

type Props = {
  params: { siteSlug: string; campaignSlug: string };
  searchParams: { site?: string };
};

const LOGO_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

// Unlike the app chrome's own logo (served via a URL, /api/branding/logo),
// this page inlines the raw bytes as a base64 data URI (see logoDataUri()'s
// doc below) — so an oversized upload bloats THIS page's initial HTML
// directly. Raster logos are already implicitly bounded by whatever upload
// limit exists elsewhere, but an SVG is stored verbatim with no downscale: a
// ~5MB SVG would become a ~6.65MB base64 blob embedded in the document.
// 512KB is generous headroom over any real logo (raster or vector) while
// still ruling out that pathological case.
const MAX_LOGO_BYTES = 512 * 1024;

/**
 * Inline the tenant's uploaded logo as a base64 data URI instead of linking
 * `getChromeLogoSrc()`'s `/api/branding/logo` URL. That endpoint resolves
 * its tenant from the SESSION COOKIE only (api/branding/logo/route.ts ->
 * lib/branding.ts's resolveLogoPath -> getCurrentTenant) — correct for the
 * logged-in app chrome (and for /app/login's lingering-session case), but a
 * public campaign-landing visitor never has one, so that URL would 404 for
 * this page's entire actual audience. Calling resolveLogoPath() directly
 * here (still the SAME lib/branding.ts module the brief points at) runs
 * inside this render's runWithTenant(tenantId, …) binding below, so it
 * always resolves the right tenant's file regardless of any cookie —
 * inlining the bytes also keeps the page genuinely self-contained (no
 * follow-up request that could fail independently). Mirrors
 * api/branding/logo/route.ts's own MIME map and fail-closed-to-null
 * behaviour (no logo / unreadable file -> null -> <Logo> falls back to the
 * neutral AdonisAgent wordmark, same as that route's 404 leaves the admin
 * chrome's <Logo>).
 */
function logoDataUri(): string | null {
  let filePath: string | null;
  try {
    filePath = resolveLogoPath();
  } catch {
    return null;
  }
  if (!filePath) return null;
  try {
    // Stat before read: an oversized file (see MAX_LOGO_BYTES's doc — the
    // pathological case is an uncompressed SVG) shouldn't be inlined at all,
    // so there's no point paying to read+base64-encode it first. <Logo>
    // already renders a text wordmark fallback when src is null, so this is
    // a graceful degrade, not a broken page.
    const size = fs.statSync(filePath).size;
    if (size > MAX_LOGO_BYTES) {
      console.warn(
        `[campaign landing] logo for tenant "${getCurrentTenant().slug}" is ${size} bytes (over the ${MAX_LOGO_BYTES}-byte inline cap) — skipping inline, falling back to text wordmark`,
      );
      return null;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = LOGO_MIME_BY_EXT[ext] ?? "application/octet-stream";
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

interface Resolved {
  campaign: Campaign;
  body: ParsedLandingBody;
  theme: ThemeConfig;
  fonts: { heading: string; body: string };
  logoSrc: string | null;
  business: BusinessProfile;
  signupToken: string;
  /** The resolved public site (host → tenant/site), kept around so
   *  generateMetadata can build this page's own canonical URL via
   *  siteUrl() — mirrors PageContext.resolved in lib/cms/render.ts. */
  publicSite: PublicSite;
  /** Request host, for siteUrl()'s dev (?site=) fallback branch — mirrors
   *  PageContext.host in lib/cms/render.ts. */
  host: string | null;
}

/**
 * Full resolve-and-gate for a campaign landing page. Host -> site -> tenant
 * via resolvePublicSite (never client input — see resolveHost.ts's doc),
 * then everything else bound inside runWithTenant(site.tenantId, …) so the
 * ambient ancillaries (the `db` proxy campaign store reads through, plus the
 * ambient-tenant branding readers getBrandFontIds/getBusinessProfile/
 * resolveLogoPath) resolve the RIGHT tenant even though a public visitor
 * carries no session cookie at all — the exact same binding
 * /api/campaigns/signup uses around its own upsertLead call.
 *
 * Returns null for every "don't render" case — unmapped host, unknown
 * campaign slug, or the findApprovedLandingAsset gate failing (campaign not
 * in {ready,active}, or no APPROVED landing_page asset) — so both callers
 * below treat every failure identically. No path here ever reveals to the
 * client WHY a page didn't render (matches /api/campaigns/signup folding
 * "unknown token" and "tampered token" into the same 400).
 *
 * Called once per render pass by generateMetadata AND the page component
 * (Next.js runs them as separate passes with no shared cache here — this
 * mirrors site/[siteSlug]/page.tsx's own generateMetadata, which likewise
 * re-runs resolvePageContext rather than sharing it with the page body). The
 * work is a handful of synchronous, in-process better-sqlite3 reads, so
 * paying it twice is not worth adding a request-scoped cache for.
 *
 * Also returns `publicSite` + `host` (unused by the page body itself)
 * purely so generateMetadata can build this page's own canonical URL —
 * same shape lib/cms/render.ts's PageContext carries `resolved`/`host` for.
 */
function resolveCampaignLanding(
  params: Props["params"],
  searchParams: Props["searchParams"],
): Resolved | null {
  const host = headers().get("host");
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) return null;

  return runWithTenant(resolved.tenantId, (): Resolved | null => {
    const campaign = getCampaignBySlug(params.campaignSlug);
    if (!campaign) return null;

    const assets = listAssets(campaign.id);
    const landingAsset = findApprovedLandingAsset(campaign.status, assets);
    if (!landingAsset) return null;

    const body = parseLandingBody(landingAsset.body) ?? {
      headline: campaign.name,
      subhead: "",
      bullets: [],
      ctaLabel: "Sign up",
      metaTitle: "",
      metaDescription: "",
    };

    // Mint the signup token HERE — this is the only place in the whole
    // request that has a verified (tenantId, campaignId) pair (resolved
    // from the HOST above + the tenant-scoped campaign lookup just above,
    // never from anything a client sent). It carries that identity down to
    // <CampaignLanding> -> <SignupForm> as the ONLY thing the public form
    // POSTs that names a tenant/campaign — no siteSlug, no campaignSlug (see
    // lib/campaigns/signupToken.ts's header comment for the vulnerability
    // this closes).
    const signupToken = signCampaignSignupToken({
      tenantId: resolved.tenantId,
      campaignId: campaign.id,
    });

    return {
      campaign,
      body,
      theme: getThemeForTenant(resolved.tenantId),
      fonts: getBrandFontIds(),
      logoSrc: logoDataUri(),
      business: getBusinessProfile(),
      signupToken,
      publicSite: resolved,
      host,
    };
  });
}

/**
 * Full SEO suite for a campaign landing page: title, description, OG,
 * Twitter card, canonical, robots. `data.body.metaTitle`/`metaDescription`
 * are the AI-generated meta copy (Campaign Engine Slice 2 SEO pass — see
 * ./assetBody's ParsedLandingBody + ./generate's LANDING_FORMAT_RULES);
 * every other field has a defensive fallback chain, because a landing body
 * can legitimately have blank meta fields (an older asset generated before
 * this SEO pass shipped, a model that dropped the field, or the
 * findApprovedLandingAsset default object) and this must never throw or
 * render an obviously-broken title/description.
 *
 * No og:image/twitter:image: the tenant logo is only servable as a data:
 * URI here (see logoDataUri()'s doc — the cookie-scoped /api/branding/logo
 * URL 404s for an anonymous crawler) and a data: URI isn't a valid OG image
 * value, so images are left out entirely rather than shipping a broken one.
 * TODO: og:image once a public campaign image URL exists.
 */
export function generateMetadata({ params, searchParams }: Props): Metadata {
  const data = resolveCampaignLanding(params, searchParams);
  if (!data) return { title: "Campaign" };

  const { campaign, body, business, publicSite, host } = data;
  const businessName = business.businessName.trim();
  const headline = body.headline.trim();
  // "headline — business name" only when both halves are real — a bare
  // template-string join (`${headline} — ${businessName}`) would still be
  // "truthy" (a non-empty " — ") even when BOTH are blank, so a naive ||
  // chain built straight from that join would never actually reach the
  // campaign.name fallback below. Same conditional-suffix idiom the
  // pre-SEO version of this function, and buildPageMetadata (site/[siteSlug]
  // /page.tsx), already used.
  const headlineTitle = headline ? (businessName ? `${headline} — ${businessName}` : headline) : "";
  const title = body.metaTitle.trim() || headlineTitle || campaign.name;
  const description = body.metaDescription.trim() || body.subhead.trim() || campaign.offer || undefined;
  const canonical = siteUrl(publicSite, `/c/${params.campaignSlug}`, host);
  // Only a LIVE campaign's landing page should be crawled/indexed — "ready"
  // is a pre-launch preview (findApprovedLandingAsset already gates render
  // to campaign.status in {ready, active}, so this is always one of those
  // two here, never building/complete/archived).
  const isLive = campaign.status === "active";

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: businessName || undefined,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: isLive ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export default function CampaignLandingPage({ params, searchParams }: Props) {
  const data = resolveCampaignLanding(params, searchParams);
  if (!data) notFound();

  return (
    <CampaignLanding
      body={data.body}
      theme={data.theme}
      fonts={data.fonts}
      logoSrc={data.logoSrc}
      business={data.business}
      signupToken={data.signupToken}
    />
  );
}
