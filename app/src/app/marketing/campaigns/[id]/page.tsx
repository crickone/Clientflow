import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronDown,
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

import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { findApprovedLandingAsset, getCampaign, getCampaignLandingUrl, listAssets } from "@/lib/campaigns/store";
import type { CampaignAsset } from "@/lib/campaigns/store";
import { getCampaignBuildModel, campaignModelLabel } from "@/lib/campaigns/buildModel";
import { estimateCampaignTotalCents, formatCentsEur } from "@/lib/campaigns/costEstimate";
import { getCampaignScoreboard } from "@/lib/campaigns/scoreboardData";
import { getBlogPost } from "@/lib/blog/posts";
import { getSiteById } from "@/lib/cms/sites";
import { parseEmailBody, parseLandingBody, parseSocialBody } from "@/lib/campaigns/assetBody";
import { countLeadsByCampaign } from "@/lib/leads";
import { pipelineForCampaign } from "@/lib/pipeline/pipelineRepo";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CopyAssetButton } from "@/components/campaigns/CopyAssetButton";
import { LaunchCampaignButton } from "@/components/campaigns/LaunchCampaignButton";
import { setCampaignAdSpendAction } from "../actions";
import { OfferPanel } from "@/components/campaigns/OfferPanel";
import { PriceVisibility } from "@/components/campaigns/PriceVisibility";
import { DeleteCampaignButton } from "@/components/campaigns/DeleteCampaignButton";
import { listCampaignOrders, listOffersForCampaign, offerTotals } from "@/lib/offers/store";
import { getOfferAccessKey } from "@/lib/offers/access";
import { getStripeConnection } from "@/lib/stripe/connection";
import { db } from "@/lib/db";
import { therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
const KIND_NAME: Record<CampaignAsset["kind"], string> = {
  offer: "Offer",
  landing_page: "Landing page",
  blog: "Blog post",
  social: "Social post",
  email: "Email",
  ad_copy: "Ad copy",
  video_script: "Video script",
};

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
  const modelLabel = campaignModelLabel(buildModel);
  const estimateCents = estimateCampaignTotalCents(assets, buildModel);

  // Scoreboard (Campaign Engine Slice 5, Task 4) — CFA/CAC/ROAS for this
  // campaign's OWN attributed leads/converts, against the ad spend recorded
  // below. Passes estimateCents straight in as the scoreboard's aiBuildCents
  // rather than letting getCampaignScoreboard recompute it, so the "AI build
  // cost" figure shown in the scoreboard can never disagree with the "Est.
  // build cost" line above — same model, same estimate, one call.
  const scoreboard = await getCampaignScoreboard(campaign, estimateCents);
  // Gated on converts, not on roas/cfaCovered directly: gatherCampaignRevenue
  // always reports upfrontCashCents=0 when there are no converts yet, so if
  // ad spend is already set the plain roas/cfaCovered math below would render
  // a misleading "short of covering" message for a campaign that simply hasn't had
  // time to convert anyone — the empty state (below, in the render) replaces
  // that with a neutral "no conversions yet" instead.
  const hasConverts = scoreboard.converts > 0;
  const heroColor =
    scoreboard.roas === null ? "var(--text-secondary)" : scoreboard.cfaCovered ? "#4ade80" : "#f87171"; // same green/red inks as Badge's tone palette
  const heroText =
    scoreboard.roas === null
      ? "Add ad spend to see if this campaign paid for itself."
      : scoreboard.cfaCovered
        ? `Self-funded — front-end sales covered the ${formatCentsEur(scoreboard.adSpendCents)} ad spend (${scoreboard.roas.toFixed(1)}×)`
        : `${formatCentsEur(scoreboard.adSpendCents - scoreboard.upfrontCashCents)} short of covering the ${formatCentsEur(scoreboard.adSpendCents)} ad spend`;

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
  // The campaign's own board (one per campaign, created with it).
  const pipeline = pipelineForCampaign(campaign.id);

  const campaignOffers = listOffersForCampaign(campaign.id);
  const campaignOrders = listCampaignOrders(campaign.id);
  const accessKey = getOfferAccessKey(campaign.id);
  const services = db
    .select({ id: therapies.id, name: therapies.name, priceEur: therapies.defaultPriceEur })
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const stripeConnected = getStripeConnection(getCurrentMembership()!.tenant.id) !== null;

  const dateRange =
    campaign.startsOn || campaign.endsOn
      ? `${campaign.startsOn ?? "?"} → ${campaign.endsOn ?? "?"}`
      : null;
  const subtitle = [campaign.season, dateRange].filter(Boolean).join(" · ") || undefined;

  const orderCount = campaignOrders.filter((o) => o.status === "paid").length;
  const takenCents = campaignOrders.filter((o) => o.status === "paid").reduce((sum, o) => sum + o.amountCents, 0);
  const statusLabel = campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1);

  return (
    <div className="app-page ch">
      <Link href="/marketing/campaigns" className="ch-back">
        <ArrowLeft size={14} /> Campaigns
      </Link>
      <PageHeader
        eyebrow={[campaign.season, statusLabel].filter(Boolean).join(" · ")}
        title={campaign.name}
        subtitle={niceRange(campaign.startsOn, campaign.endsOn) ?? undefined}
        actions={
          <>
            {landingUrl && (
              <a href={landingUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary">
                  <ExternalLink size={15} /> View page
                </Button>
              </a>
            )}
            {campaign.status === "building" && (
              <Link href="/adonis">
                <Button variant="secondary">
                  <MessageSquarePlus size={15} /> Continue building
                </Button>
              </Link>
            )}
            {campaign.status === "ready" && <LaunchCampaignButton campaignId={campaign.id} campaignName={campaign.name} />}
          </>
        }
      />

      <div className="ch-kpis">
        <Card className="ch-kpi">
          <CardLabel>Assets approved</CardLabel>
          <CardValue>
            {approvedCount}
            <span className="ch-kpi-of">/{assets.length}</span>
          </CardValue>
        </Card>
        <Card className="ch-kpi">
          <CardLabel>Page views</CardLabel>
          <CardValue>{campaign.landingViews}</CardValue>
        </Card>
        <Card className="ch-kpi">
          <CardLabel>Enquiries</CardLabel>
          <CardValue>{signupCount}</CardValue>
        </Card>
        <Card className="ch-kpi">
          <CardLabel>Sales</CardLabel>
          <CardValue>
            {orderCount}
            <span className="ch-kpi-of"> · {formatCentsEur(takenCents)}</span>
          </CardValue>
        </Card>
      </div>

      <div className="ch-grid">
        <div className="ch-main">
          <Card className="ch-card">
            <OfferPanel
              campaignId={campaign.id}
              offers={campaignOffers.map((offer) => ({
                id: offer.id,
                title: offer.title,
                description: offer.description,
                priceCents: offer.priceCents,
                compareAtCents: offer.compareAtCents,
                items: offer.items.map((i) => ({ therapyId: i.therapyId, sessions: i.sessions })),
                quantityLimit: offer.quantityLimit,
                saleStartsAt: offer.saleStartsAt,
                saleEndsAt: offer.saleEndsAt,
                useByDate: offer.useByDate,
                terms: offer.terms,
                isActive: offer.isActive,
                state: offer.state,
                sold: offer.sold,
                left: offer.left,
                revenueCents: offerTotals(offer.id).revenueCents,
              }))}
              orders={campaignOrders.map((o) => ({ id: o.id, createdAt: o.paidAt ?? o.createdAt, name: o.name, email: o.email, phone: o.phone, amountCents: o.amountCents, status: o.status, clientId: o.clientId, offerTitle: o.offerTitle }))}
              services={services}
              stripeConnected={stripeConnected}
              landingUrl={landingUrl}
            />
          </Card>

          <section aria-labelledby="ch-assets-h">
            <div className="ch-section-head">
              <h2 id="ch-assets-h" className="ch-h">
                What Adonis made
              </h2>
              <span className="ch-muted">
                {approvedCount} of {assets.length} approved
              </span>
            </div>
            {assets.length === 0 ? (
              <EmptyState
                icon={<Megaphone size={32} strokeWidth={1.4} />}
                title="No assets yet"
                message="Adonis hasn't drafted anything for this campaign yet. Head to Adonis and continue the conversation to generate the kit."
                action={
                  <Link href="/adonis">
                    <Button variant="secondary">
                      <MessageSquarePlus size={15} /> Continue building
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="ch-assets">
                {assets.map((asset, i) => {
                  const Icon = KIND_ICON[asset.kind];
                  const href = hrefs[i];
                  const preview = asset.status === "pending" ? "" : previewText(asset);
                  return (
                    <details key={asset.id} className="ch-asset" data-empty={!preview}>
                      <summary>
                        <span className="ch-asset-icon" aria-hidden>
                          <Icon size={15} strokeWidth={1.75} />
                        </span>
                        <span className="ch-asset-main">
                          <span className="ch-asset-title">{asset.title}</span>
                          <span className="ch-asset-kind">{KIND_NAME[asset.kind]}</span>
                        </span>
                        <Badge tone={ASSET_STATUS_TONE[asset.status]}>{asset.status === "pending" ? "Not drafted" : asset.status === "drafted" ? "Draft" : "Approved"}</Badge>
                        {preview && <ChevronDown size={15} className="ch-asset-chev" aria-hidden />}
                      </summary>
                      {preview && (
                        <div className="ch-asset-body">
                          <div className="ch-asset-text">{preview}</div>
                          {(href || COPYABLE_KINDS.has(asset.kind)) && (
                            <div className="ch-asset-actions">
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
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="ch-side">
          {landingAsset && (
            <Card className="ch-card">
              <span className="ch-label">Landing page</span>
              {landingUrl ? (
                <>
                  <a className="ch-url" href={landingUrl} target="_blank" rel="noreferrer">
                    {landingUrl.replace(/^https?:\/\//, "")}
                  </a>
                  <div className="ch-row">
                    <CopyAssetButton text={landingUrl} />
                    {pipeline && (
                      <Link href={`/leads?pipeline=${pipeline.id}`} className="ch-link">
                        Enquiries pipeline
                      </Link>
                    )}
                  </div>
                  {campaignOffers.length > 0 && <PriceVisibility campaignId={campaign.id} landingUrl={landingUrl} accessKey={accessKey} />}
                </>
              ) : (
                <p className="ch-note">Add a website under Sites to publish the landing page.</p>
              )}
            </Card>
          )}

          <Card className="ch-card">
            <span className="ch-label">The offer</span>
            {campaign.offer ? (
              <details className="ch-offer">
                <summary>
                  <span className="ch-offer-text">{campaign.offer}</span>
                  <span className="ch-link ch-offer-more">Read all</span>
                </summary>
              </details>
            ) : (
              <p className="ch-note">Not set yet.</p>
            )}
          </Card>

          <Card className="ch-card">
            <span className="ch-label">Scoreboard</span>
            {hasConverts ? <p className="ch-score-hero" style={{ color: heroColor }}>{heroText}</p> : <p className="ch-note">No sales or sign-ups converted yet.</p>}
            <div className="ch-score">
              <div>
                <CardLabel>Leads</CardLabel>
                <CardValue style={{ fontSize: 20 }}>{scoreboard.leads}</CardValue>
              </div>
              {hasConverts && (
                <>
                  <div>
                    <CardLabel>Converts</CardLabel>
                    <CardValue style={{ fontSize: 20 }}>{scoreboard.converts}</CardValue>
                  </div>
                  <div>
                    <CardLabel>CAC</CardLabel>
                    <CardValue style={{ fontSize: 20 }}>{scoreboard.cacCents === null ? "—" : formatCentsEur(scoreboard.cacCents)}</CardValue>
                  </div>
                  <div>
                    <CardLabel>ROAS</CardLabel>
                    <CardValue style={{ fontSize: 20 }}>{scoreboard.roas === null ? "—" : `${scoreboard.roas.toFixed(1)}×`}</CardValue>
                  </div>
                </>
              )}
            </div>
            {/* Admin-only by construction: requireAdminPage() above; the action re-checks too. */}
            <form action={setCampaignAdSpendAction} className="ch-spend">
              <input type="hidden" name="campaignId" value={campaign.id} />
              <label>
                <span>Ad spend</span>
                <span className="ch-spend-field">
                  €
                  <input type="number" name="adSpend" step="0.01" min="0" defaultValue={(campaign.adSpendCents / 100).toFixed(2)} />
                </span>
              </label>
              <Button type="submit" size="sm" variant="secondary">
                Save
              </Button>
            </form>
            <p className="ch-note">
              AI build cost about {formatCentsEur(estimateCents)} on {modelLabel} · created {formatDate(campaign.createdAt)}
            </p>
          </Card>
          <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
        </aside>
      </div>
    </div>
  );
}

function niceRange(start: string | null, end: string | null): string | null {
  const fmt = (iso: string, year: boolean) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: year ? "numeric" : undefined, timeZone: "UTC" });
  if (start && end) return `${fmt(start, start.slice(0, 4) !== end.slice(0, 4))} – ${fmt(end, true)}`;
  if (start) return `From ${fmt(start, true)}`;
  if (end) return `Until ${fmt(end, true)}`;
  return null;
}
