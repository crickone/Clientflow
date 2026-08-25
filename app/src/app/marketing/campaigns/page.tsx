import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { listAssets, listCampaigns } from "@/lib/campaigns/store";
import { getCampaignBuildModel, CAMPAIGN_MODEL_CHOICES } from "@/lib/campaigns/buildModel";
import { gatherCampaignRevenue } from "@/lib/campaigns/scoreboardData";
import { computeCampaignScoreboard, type Scoreboard } from "@/lib/campaigns/scoreboard";
import { formatCentsEur } from "@/lib/campaigns/costEstimate";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { setCampaignBuildModelAction } from "./actions";

export const dynamic = "force-dynamic";

// Campaign Engine hub (Slice 1, Task 7) — the operator-facing list of
// campaign kits Adonis builds conversationally (see /agents/orchestrator).
// Admin-gated to match that agent chat + the email Campaigns group (both
// requireAdminPage) — see Sidebar.tsx's comment on the Marketing nav item
// for why. Single-agent product (2026-08-25): this used to be the Marketing
// agent's own chat at /agents/marketing — that agent card was retired, and
// Adonis (which absorbed its campaign-kit tools) is now the only place this
// build happens.
const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  building: "neutral",
  ready: "amber",
  active: "green",
  complete: "green",
  archived: "neutral",
};

/**
 * Roll-up follow-on to the Slice-5 hub's CFA hero (see `[id]/page.tsx`'s
 * heroColor/heroText) — same tri-state read of a scoreboard, condensed to a
 * one-word Badge instead of a full sentence: no ad spend recorded yet is
 * neutral (nothing to judge), spend covered by front-end cash is green,
 * spend NOT yet covered is red. Reuses Badge's own green/red inks (#4ade80 /
 * #f87171 — see components/ui/Badge.tsx), the same values the hub hero
 * hardcodes, so the two pages read as one system.
 */
function cfaBadge(sb: Scoreboard): { tone: "neutral" | "green" | "red"; label: string } {
  if (sb.roas === null) return { tone: "neutral", label: "— no ad spend" };
  if (sb.cfaCovered) return { tone: "green", label: "✓ Self-funded" };
  return { tone: "red", label: "✗ short" };
}

export default async function MarketingCampaignsPage() {
  await requireAdminPage();

  // Task 5: the tenant's current campaign build model, for the selector
  // below. requireAdminPage() above already redirects any non-admin away
  // before this line runs, so everything the rest of this component renders
  // — selector included — is admin-only by construction; no extra isAdmin
  // check is needed here (same reasoning as CapEditor on /agents).
  const buildModel = await getCampaignBuildModel();

  const campaigns = listCampaigns();
  // Cheap per-campaign approved/total tally — campaigns are few (a handful
  // per tenant, ~11 assets each), so N synchronous reads here is fine and
  // lets the list itself show build progress at a glance (the whole point
  // of a "hub"), rather than making every row a guess until you click in.
  const progress = campaigns.map((c) => {
    const assets = listAssets(c.id);
    return { approved: assets.filter((a) => a.status === "approved").length, total: assets.length };
  });

  // Cross-campaign performance roll-up (this task) — the same CFA/ROAS
  // scoreboard Slice 5 put on each campaign's own hub
  // (`[id]/page.tsx`'s getCampaignScoreboard call), computed here for EVERY
  // listed campaign so an operator sees at a glance which are performing
  // without clicking into each one. Reuses gatherCampaignRevenue +
  // computeCampaignScoreboard directly (not getCampaignScoreboard) so
  // aiBuildCents can be a plain 0 rather than re-deriving a real build-cost
  // estimate per row — this roll-up never displays the AI-build line, and
  // CFA/CAC/ROAS are computed from ad spend, not aiBuild, so the 0 doesn't
  // change any number this page shows.
  // Promise.all rather than a serial for-await: each gatherCampaignRevenue
  // call is an independent read (its own campaign-scoped DB queries), so
  // running them concurrently keeps this page's load time close to the
  // SLOWEST single campaign's lookup rather than the SUM of all of them.
  // Fine at typical scale (a handful to dozens of campaigns per tenant); a
  // very large campaign count would want batching, not attempted here.
  const scoreboards: Scoreboard[] = await Promise.all(
    campaigns.map(async (c) => {
      const rev = await gatherCampaignRevenue(c.name, c.startsOn);
      return computeCampaignScoreboard({
        leads: rev.leads,
        converts: rev.converts,
        adSpendCents: c.adSpendCents,
        aiBuildCents: 0,
        upfrontCashCents: rev.upfrontCashCents,
        mrrCents: rev.mrrCents,
      });
    }),
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Campaigns"
        subtitle="Seasonal campaign kits — offer, blog, social posts, emails, ad copy and a video script, drafted by Adonis and approved one asset at a time."
        actions={
          <Link href="/agents/orchestrator">
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
            {CAMPAIGN_MODEL_CHOICES.map((m) => (
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

      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={32} strokeWidth={1.4} />}
          title="No campaigns yet"
          message="Ask Adonis to build a campaign — open Adonis and describe a season, offer or promotion. It drafts the whole kit (offer, blog, social, email, ad copy, video script) for your approval, one asset at a time."
          action={
            <Link href="/agents/orchestrator">
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
                <th style={th}>Name</th>
                <th style={th}>Season</th>
                <th style={th}>Status</th>
                <th style={th}>Assets</th>
                <th style={th}>Performance</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => {
                const sb = scoreboards[i];
                const badge = cfaBadge(sb);
                return (
                  <tr key={c.id}>
                    <td style={{ ...td, color: "var(--text-primary)" }}>
                      <Link href={`/marketing/campaigns/${c.id}`} style={{ color: "inherit" }}>
                        {c.name}
                      </Link>
                    </td>
                    <td style={td}>{c.season || "—"}</td>
                    <td style={td}>
                      <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                    </td>
                    <td style={td}>
                      {progress[i].approved}/{progress[i].total} approved
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                        <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                          {sb.leads} lead{sb.leads === 1 ? "" : "s"} · {sb.converts} convert
                          {sb.converts === 1 ? "" : "s"} · {formatCentsEur(sb.adSpendCents)} ·{" "}
                          {sb.roas === null ? "—" : `${sb.roas.toFixed(1)}×`} ROAS
                        </span>
                      </div>
                    </td>
                    <td style={td}>{formatDate(c.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
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
const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
