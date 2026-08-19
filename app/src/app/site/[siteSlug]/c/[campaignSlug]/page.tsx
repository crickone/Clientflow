import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { runWithTenant } from "@/lib/db/tenant";
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
      ctaLabel: "Register your interest",
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
    };
  });
}

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const data = resolveCampaignLanding(params, searchParams);
  if (!data) return { title: "Campaign" };
  const title = data.body.headline || data.campaign.name;
  return {
    title: data.business.businessName ? `${title} — ${data.business.businessName}` : title,
    description: data.body.subhead || undefined,
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
