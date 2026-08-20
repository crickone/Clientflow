import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clapperboard,
  ExternalLink,
  FileText,
  Gift,
  Globe,
  Image as ImageIcon,
  Mail,
  Megaphone,
  MessageSquarePlus,
} from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { findApprovedLandingAsset, getCampaign, getCampaignLandingUrl, listAssets } from "@/lib/campaigns/store";
import type { CampaignAsset } from "@/lib/campaigns/store";
import { getCampaignBuildModel } from "@/lib/campaigns/buildModel";
import { estimateCampaignBuildCents, formatCentsEur } from "@/lib/campaigns/costEstimate";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { getBlogPost } from "@/lib/blog/posts";
import { getSiteById } from "@/lib/cms/sites";
import { parseEmailBody, parseLandingBody, parseSocialBody } from "@/lib/campaigns/assetBody";
import { countLeadsByCampaign } from "@/lib/leads";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CopyAssetButton } from "@/components/campaigns/CopyAssetButton";
import { LaunchCampaignButton } from "@/components/campaigns/LaunchCampaignButton";

export const dynamic = "force-dynamic";

const CAMPAIGN_STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  building: "neutral",
  ready: "amber",
  active: "green",
  complete: "green",
  archived: "neutral",
};

const ASSET_STATUS_TONE: Record<CampaignAsset["status"], "neutral" | "amber" | "green" | "red"> = {
  pending: "neutral",
  drafted: "amber",
  approved: "green",
};

const KIND_ICON: Record<CampaignAsset["kind"], typeof Gift> = {
  offer: Gift,
  landing_page: Globe,
  blog: FileText,
  social: ImageIcon,
  email: Mail,
  ad_copy: Megaphone,
  video_script: Clapperboard,
};

const EXTERNAL_HOME_LABEL: Record<NonNullable<CampaignAsset["externalKind"]>, string> = {
  blog_post: "View blog post",
  carousel_set: "View in Content Studio",
  email_campaign: "View email campaign",
};

// The 3 plain-text kinds materialiseAsset (@/lib/campaigns/materialise)
// never gives an external home to — they render fully inline instead, with a
// copy affordance (per the Task 7 brief). landing_page (Slice 2) also has no
// external home, but stores structured JSON rather than reader-facing plain
// text, so it's deliberately left out of this set — it gets its OWN "view
// live" affordance instead (Slice 2 Task 4's landing-URL block, rendered
// separately below, right under the Offer) once the public landing route
// exists AND the campaign is live (ready/active) — see
// findApprovedLandingAsset.
const COPYABLE_KINDS = new Set<CampaignAsset["kind"]>(["offer", "ad_copy", "video_script"]);

/**
 * Where an approved asset's materialised record actually lives. A
 * campaign_assets row carries no siteId of its own (campaigns are
 * tenant-wide, not per-site — see schema.ts), so a blog link needs one extra
 * hop: read the linked blog_posts row for its siteId, then the site's slug,
 * to build the real /cms/<siteSlug>/blog/<postId> editor URL. Returns null
 * (never throws) whenever the asset isn't materialised yet, or its linked
 * record has since vanished — the caller just omits the link in that case.
 */
async function externalHref(asset: CampaignAsset): Promise<string | null> {
  if (asset.externalId == null || asset.externalKind == null) return null;
  switch (asset.externalKind) {
    case "blog_post": {
      const post = getBlogPost(asset.externalId);
      if (!post || post.siteId == null) return null;
      const site = await getSiteById(post.siteId);
      if (!site) return null;
      return `/cms/${site.slug}/blog/${post.id}`;
    }
    case "carousel_set":
      return `/content-studio/images/${asset.externalId}`;
    case "email_campaign":
      return `/campaigns/${asset.externalId}`;
    default:
      return null;
  }
}

/**
 * A readable preview of an asset's stored body. offer/ad_copy/video_script/
 * blog store plain text or markdown directly; social/email/landing_page
 * store a JSON envelope (see ./assetBody's header comment) that gets parsed
 * into something readable rather than shown as raw JSON. Never throws — an
 * unparseable social/email/landing_page body (shouldn't happen; setAssetDraft
 * always writes what generateAsset returned) just degrades to an empty
 * preview.
 *
 * landing_page carried fix (Task 4): this used to have no branch for it at
 * all, so it fell through to the final `return asset.body` below and
 * rendered the asset's raw `{headline, subhead, bullets, ctaLabel}` JSON
 * verbatim in the card. Never shows raw JSON now — just the headline (plus
 * subhead, if the model wrote one), same "readable, not raw" bar social/email
 * already meet.
 */
function previewText(asset: CampaignAsset): string {
  if (!asset.body) return "";
  if (asset.kind === "social") {
    const parsed = parseSocialBody(asset.body);
    if (!parsed) return "";
    const headings = parsed.slides.map((s) => s.heading).filter(Boolean).join(" · ");
    return [parsed.caption, headings].filter(Boolean).join("\n\n");
  }
  if (asset.kind === "email") {
    const parsed = parseEmailBody(asset.body);
    if (!parsed) return "";
    return `Subject: ${parsed.subject}\n\n${parsed.content}`;
  }
  if (asset.kind === "landing_page") {
    const parsed = parseLandingBody(asset.body);
    if (!parsed || !parsed.headline) return "";
    return [`Landing page — ${parsed.headline}`, parsed.subhead].filter(Boolean).join("\n\n");
  }
  return asset.body;
}

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();

  const campaign = getCampaign(id);
  if (!campaign) notFound();

  const assets = listAssets(id);
  const hrefs = await Promise.all(assets.map((a) => externalHref(a)));
  const approvedCount = assets.filter((a) => a.status === "approved").length;

  // Cost estimate (Campaign Engine Slice 4, Task 4) — an informational recap,
  // not a live figure: by the time a campaign reaches this hub its assets are
  // already built, so this just answers "what did/would this kit roughly
  // cost", priced off the SAME tenant build-model + pure estimator
  // plan_campaign's own estimate uses (tools.campaign.ts). Degrades to
  // €0.00 for a 0-asset campaign (estimateCampaignBuildCents sums an empty
  // array to 0) — never crashes; the render below omits the stat entirely in
  // that case rather than show a meaningless €0.00.
  const buildModel = await getCampaignBuildModel();
  const modelLabel = MODEL_CATALOG.find((m) => m.id === buildModel)?.label ?? buildModel;
  const estimateCents = estimateCampaignBuildCents(assets, buildModel);

  // Landing page (Slice 2 Task 4): reuses the SAME gate the public
  // `/site/<slug>/c/<campaignSlug>` route checks (findApprovedLandingAsset —
  // an approved landing_page asset AND campaign.status ready/active) so this
  // block only ever offers a link that actually resolves. landingUrl is null
  // when the tenant has no CMS site yet (getCampaignLandingUrl, via the
  // shared buildCampaignLandingUrl — the SAME helper launch.ts's summary
  // line uses, so the two can't disagree) — signupCount is computed
  // unconditionally (cheap, and well-defined regardless of the gate) but
  // only ever displayed alongside the gated block below.
  const landingAsset = findApprovedLandingAsset(campaign.status, assets);
  const landingUrl = landingAsset ? await getCampaignLandingUrl(campaign.slug) : null;
  const signupCount = countLeadsByCampaign(campaign.name);

  const dateRange =
    campaign.startsOn || campaign.endsOn
      ? `${campaign.startsOn ?? "?"} → ${campaign.endsOn ?? "?"}`
      : null;
  const subtitle = [campaign.season, dateRange].filter(Boolean).join(" · ") || undefined;

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow={`Marketing · Campaign · ${campaign.status}`}
        title={campaign.name}
        subtitle={subtitle}
        actions={
          <>
            <Link href="/marketing/campaigns">
              <Button variant="outline">
                <ArrowLeft size={15} /> All campaigns
              </Button>
            </Link>
            {campaign.status === "building" && (
              <Link href="/agents/marketing">
                <Button variant="secondary">
                  <MessageSquarePlus size={15} /> Continue building
                </Button>
              </Link>
            )}
            {campaign.status === "ready" && (
              <LaunchCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
            )}
          </>
        }
      />

      <Card style={{ padding: 20, marginBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status] ?? "neutral"}>{campaign.status}</Badge>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            {approvedCount}/{assets.length} assets approved · created {formatDate(campaign.createdAt)}
            {assets.length > 0 && (
              <> · Est. build cost ≈ {formatCentsEur(estimateCents)} on {modelLabel}</>
            )}
          </span>
        </div>
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
              marginBottom: 6,
            }}
          >
            Offer
          </div>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {campaign.offer || "Not set yet."}
          </p>
        </div>

        {landingAsset && (
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--text-tertiary)",
                marginBottom: 6,
              }}
            >
              Landing page
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {landingUrl ? (
                <>
                  <code
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-secondary)",
                      background: "var(--surface-2)",
                      border: "1px solid var(--hairline)",
                      borderRadius: "var(--radius)",
                      padding: "4px 8px",
                    }}
                  >
                    {landingUrl}
                  </code>
                  <CopyAssetButton text={landingUrl} />
                  <a href={landingUrl} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm">
                      <ExternalLink size={13} />
                      View
                    </Button>
                  </a>
                </>
              ) : (
                <span style={{ fontSize: 13, color: "var(--text-tertiary)", fontStyle: "italic" }}>
                  Add a site to publish the landing page.
                </span>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 8 }}>
              {signupCount === 1 ? "1 sign-up so far" : `${signupCount} sign-ups so far`}
            </div>
          </div>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {assets.map((asset, i) => {
          const Icon = KIND_ICON[asset.kind];
          const href = hrefs[i];
          const preview = previewText(asset);

          return (
            <Card key={asset.id} style={{ padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Icon size={16} strokeWidth={1.75} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{asset.title}</div>
                  <div
                    style={{
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {asset.kind.replace("_", " ")}
                  </div>
                </div>
                <Badge tone={ASSET_STATUS_TONE[asset.status]}>{asset.status}</Badge>
              </div>

              {asset.status === "pending" || !preview ? (
                <p style={{ fontSize: 13, color: "var(--text-tertiary)", fontStyle: "italic" }}>Not drafted yet.</p>
              ) : (
                <>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      maxHeight: 220,
                      overflowY: "auto",
                      background: "var(--surface-2)",
                      border: "1px solid var(--hairline)",
                      borderRadius: "var(--radius)",
                      padding: "10px 12px",
                    }}
                  >
                    {preview}
                  </div>
                  {(href || COPYABLE_KINDS.has(asset.kind)) && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      {href && (
                        <Link href={href}>
                          <Button variant="ghost" size="sm">
                            <ExternalLink size={13} />
                            {asset.externalKind ? EXTERNAL_HOME_LABEL[asset.externalKind] : "View"}
                          </Button>
                        </Link>
                      )}
                      {COPYABLE_KINDS.has(asset.kind) && <CopyAssetButton text={asset.body} />}
                    </div>
                  )}
                </>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
