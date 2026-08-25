import { Megaphone, Plus } from "lucide-react";
import Link from "next/link";

import { requireAdminPage } from "@/lib/auth";
import { findApprovedLandingAsset, getCampaignLandingUrl, listAssets, listCampaigns } from "@/lib/campaigns/store";
import { getCampaignBuildModel, CAMPAIGN_MODEL_CHOICES } from "@/lib/campaigns/buildModel";
import { gatherCampaignRevenue } from "@/lib/campaigns/scoreboardData";
import { computeCampaignScoreboard } from "@/lib/campaigns/scoreboard";
import { estimateCampaignBuildCents } from "@/lib/campaigns/costEstimate";
import { getCampaignEmailMetrics } from "@/lib/campaigns/emailMetrics";
import { computePanelMetrics, type CampaignMetrics } from "@/lib/campaigns/panelMetrics";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CampaignRows } from "@/components/campaigns/CampaignRows";
import { setCampaignBuildModelAction, seedTestCampaignAction, removeTestCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

// Campaign Engine hub (Slice 1, Task 7) — the operator-facing list of
// campaign kits Adonis builds conversationally (see /adonis).
// Admin-gated to match that agent chat + the email Campaigns group (both
// requireAdminPage) — see Sidebar.tsx's comment on the Marketing nav item
// for why. Single-agent product (2026-08-25): this used to be the Marketing
// agent's own chat at /agents/marketing — that agent card was retired, and
// Adonis (which absorbed its campaign-kit tools) is now the only place this
// build happens.
//
// Expandable metrics panel (this task): each row's chevron reveals a full
// per-campaign metrics panel (funnel, money grid, email stats, meta line) —
// STATUS_TONE and the CFA-badge tri-state read moved to
// components/campaigns/CampaignRows.tsx along with the rest of the row
// markup, since that's now a "use client" component (it needs React state
// for which rows are expanded); this file stays a server component that
// only gathers data.

export default async function MarketingCampaignsPage() {
  await requireAdminPage();

  // Task 5: the tenant's current campaign build model, for the selector
  // below. requireAdminPage() above already redirects any non-admin away
  // before this line runs, so everything the rest of this component renders
  // — selector included — is admin-only by construction; no extra isAdmin
  // check is needed here (same reasoning as CapEditor on /agents).
  const buildModel = await getCampaignBuildModel();

  // OpenRouter build models (DeepSeek / GLM) only run with OPENROUTER_API_KEY —
  // getProvider throws without it. Offer them only when it's configured (same
  // gate the agent model picker uses), so an admin can't pick one that would
  // then fail every generation call. process.env is safe to read here (server
  // component).
  const openRouterConfigured = !!process.env.OPENROUTER_API_KEY;
  const modelChoices = CAMPAIGN_MODEL_CHOICES.filter(
    (m) => openRouterConfigured || !m.id.startsWith("openrouter:"),
  );

  const campaigns = listCampaigns();

  // Full per-campaign metrics roll-up (this task, extending the CFA/ROAS
  // roll-up that already lived here) — one CampaignMetrics object per
  // campaign, folding together: the campaign row itself (incl. the new
  // landingViews counter), its Scoreboard (gatherCampaignRevenue +
  // computeCampaignScoreboard — the same call the original roll-up made),
  // the build-progress tally (approved/total, previously its own separate
  // sync map), the REAL Slice-4 build estimate (estimateCampaignBuildCents —
  // NOT the Scoreboard's stubbed 0 below), email send/open/click metrics
  // (getCampaignEmailMetrics), a best-effort live landing URL, and the pure
  // derived money math (computePanelMetrics). Computed here, entirely
  // server-side, and handed to the "use client" <CampaignRows> below as
  // plain, already-serialisable props — that component does zero data
  // fetching of its own.
  //
  // One Promise.all over campaigns (folded into a single pass rather than
  // the previous two — progress used to be its own synchronous map) — same
  // concurrency reasoning the original roll-up documented: each iteration's
  // gatherCampaignRevenue/getCampaignLandingUrl calls are independent DB
  // reads, so running every campaign's work concurrently keeps this page's
  // load close to the SLOWEST single campaign rather than the sum of all of
  // them. Fine at typical scale (a handful to dozens of campaigns per
  // tenant); a very large campaign count would want batching, not attempted
  // here.
  const rows: CampaignMetrics[] = await Promise.all(
    campaigns.map(async (c) => {
      const assets = listAssets(c.id);
      const approved = assets.filter((a) => a.status === "approved").length;

      const rev = await gatherCampaignRevenue(c.name, c.startsOn);
      const sb = computeCampaignScoreboard({
        leads: rev.leads,
        converts: rev.converts,
        adSpendCents: c.adSpendCents,
        // Unused by this roll-up's OWN CFA/CAC/ROAS math (that derives from
        // ad spend/converts, not aiBuild) — the real estimate is computed
        // separately below and is what actually reaches CampaignMetrics.
        // Same reasoning the original roll-up documented for passing 0 here
        // rather than re-deriving a real per-row figure twice.
        aiBuildCents: 0,
        upfrontCashCents: rev.upfrontCashCents,
        mrrCents: rev.mrrCents,
      });

      const aiBuildCents = estimateCampaignBuildCents(assets, buildModel);
      const email = getCampaignEmailMetrics(assets);

      // Landing URL (best-effort): reuses the exact gate + lookup the
      // campaign hub's own landing-link block uses (findApprovedLandingAsset
      // + getCampaignLandingUrl) — a link is only ever offered once there's
      // an APPROVED landing_page asset AND the campaign is ready/active;
      // null (never throws) when the tenant has no CMS site yet.
      const landingAsset = findApprovedLandingAsset(c.status, assets);
      const landingUrl = landingAsset ? await getCampaignLandingUrl(c.slug) : null;

      const derived = computePanelMetrics({
        leads: sb.leads,
        converts: sb.converts,
        adSpendCents: sb.adSpendCents,
        upfrontCashCents: sb.upfrontCashCents,
        landingViews: c.landingViews,
      });

      return {
        id: c.id,
        name: c.name,
        season: c.season,
        status: c.status,
        createdAt: c.createdAt.getTime(),
        offer: c.offer,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        landingViews: c.landingViews,
        leads: sb.leads,
        converts: sb.converts,
        conversionRatePct: sb.conversionRatePct,
        adSpendCents: sb.adSpendCents,
        upfrontCashCents: sb.upfrontCashCents,
        mrrCents: sb.mrrCents,
        cacCents: sb.cacCents,
        cfaCovered: sb.cfaCovered,
        roas: sb.roas,
        assets: { approved, total: assets.length },
        aiBuildCents,
        email,
        landingUrl,
        ...derived,
      } satisfies CampaignMetrics;
    }),
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Campaigns"
        subtitle="Seasonal campaign kits — offer, blog, social posts, emails, ad copy and a video script, drafted by Adonis and approved one asset at a time."
        actions={
          <Link href="/adonis">
            <Button size="sm">
              <Plus size={14} /> New campaign
            </Button>
          </Link>
        }
      />

      <Card
        style={{
          padding: 16,
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>
            Campaign build model
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
            Drives campaign generation and the cost estimate.
          </div>
        </div>
        <form
          action={setCampaignBuildModelAction}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <select
            name="model"
            defaultValue={buildModel}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: "8px 12px",
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          >
            {modelChoices.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.hint}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline">
            Save
          </Button>
        </form>
      </Card>

      {/* Demo data (admin-only page): seed a fully-populated "Test Campaign"
          to preview how a live campaign renders, then remove it. Adds a few
          clearly-marked demo leads/clients so the Performance columns light
          up; "Remove" pulls it all back out. */}
      <Card
        style={{
          padding: 16,
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>Demo data</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2, maxWidth: 560, lineHeight: 1.5 }}>
            Seed a fully-populated &ldquo;Test Campaign&rdquo; to preview this page — adds a few clearly-marked demo
            leads &amp; clients so leads/converts/ROAS show. &ldquo;Remove&rdquo; deletes it and the demo records.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <form action={seedTestCampaignAction}>
            <Button type="submit" size="sm" variant="outline">
              Seed test campaign
            </Button>
          </form>
          <form action={removeTestCampaignAction}>
            <Button type="submit" size="sm" variant="outline">
              Remove
            </Button>
          </form>
        </div>
      </Card>

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={32} strokeWidth={1.4} />}
          title="No campaigns yet"
          message="Ask Adonis to build a campaign — open Adonis and describe a season, offer or promotion. It drafts the whole kit (offer, blog, social, email, ad copy, video script) for your approval, one asset at a time."
          action={
            <Link href="/adonis">
              <Button>
                <Plus size={15} /> Ask Adonis
              </Button>
            </Link>
          }
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {/* Empty header cell for CampaignRows' leading chevron-toggle column. */}
                <th style={{ ...th, width: 36 }} />
                <th style={th}>Name</th>
                <th style={th}>Season</th>
                <th style={th}>Status</th>
                <th style={th}>Assets</th>
                <th style={th}>Performance</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <CampaignRows rows={rows} />
          </table>
        </Card>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
};
