"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { formatCentsEur, formatDate } from "@/lib/utils";
import type { CampaignMetrics } from "@/lib/campaigns/panelMetrics";
import type { CampaignEmailMetrics } from "@/lib/campaigns/emailMetrics";
import { Badge } from "@/components/ui/Badge";
import { CardLabel, CardValue } from "@/components/ui/Card";

/**
 * The expandable campaign list body for /marketing/campaigns (this task).
 * page.tsx (a server component) computes every `CampaignMetrics` object —
 * campaign row + scoreboard + real build estimate + email metrics + derived
 * money math — and passes the plain, already-serialisable array down as
 * `rows`; this component does ZERO data fetching, it only renders and tracks
 * which row ids are expanded. Mirrors page.tsx's OWN collapsed-row markup
 * exactly (same columns, same CFA badge, same "N leads · M converts · €X ·
 * Y× ROAS" line) so the visible list is unchanged from before this task —
 * the only addition to that row is the leading chevron cell.
 */

// Mirrors page.tsx's own STATUS_TONE (kept in sync manually — a small,
// stable 5-value enum, not worth sharing a module for).
const STATUS_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  building: "neutral",
  ready: "amber",
  active: "green",
  complete: "green",
  archived: "neutral",
};

/** Same tri-state read as page.tsx's original cfaBadge (moved here — it's presentational, the row that used it moved here too). */
function cfaBadge(m: Pick<CampaignMetrics, "roas" | "cfaCovered">): {
  tone: "neutral" | "green" | "red";
  label: string;
} {
  if (m.roas === null) return { tone: "neutral", label: "— no ad spend" };
  if (m.cfaCovered) return { tone: "green", label: "✓ Self-funded" };
  return { tone: "red", label: "✗ short" };
}

const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};

// The expanded panel sits on the page's own dark background (NOT a grey
// surface-2 block), and every individual figure gets its own card — the same
// clean card style as the rest of the page (surface-1 + hairline border).
const PANEL_BG = "var(--bg)";
const tileCard: React.CSSProperties = {
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "14px 16px",
};

/** chevron + Name, Season, Status, Assets, Performance, Created — must match page.tsx's <thead> column count for the expanded row's colSpan. */
const COLUMN_COUNT = 7;

function pct(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

export function CampaignRows({ rows }: { rows: CampaignMetrics[] }) {
  const [openIds, setOpenIds] = React.useState<ReadonlySet<number>>(new Set());

  function toggle(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <tbody>
      {rows.map((m) => {
        const isOpen = openIds.has(m.id);
        const badge = cfaBadge(m);
        return (
          <React.Fragment key={m.id}>
            <tr>
              <td style={{ ...td, width: 36, padding: "14px 4px 14px 16px" }}>
                {/* Chevron-only toggle (not the whole row) so the Name link below keeps working as a plain navigation link. */}
                <button
                  type="button"
                  onClick={() => toggle(m.id)}
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Collapse metrics for ${m.name}` : `Expand metrics for ${m.name}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius)",
                    padding: 4,
                    cursor: "pointer",
                    color: "var(--text-tertiary)",
                    transform: isOpen ? "rotate(90deg)" : "none",
                    transition: "transform 150ms ease",
                  }}
                >
                  <ChevronRight size={15} strokeWidth={2} aria-hidden />
                </button>
              </td>
              <td style={{ ...td, color: "var(--text-primary)" }}>
                <Link href={`/marketing/campaigns/${m.id}`} style={{ color: "inherit" }}>
                  {m.name}
                </Link>
              </td>
              <td style={td}>{m.season || "—"}</td>
              <td style={td}>
                <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
              </td>
              <td style={td}>
                {m.assets.approved}/{m.assets.total} approved
              </td>
              <td style={td}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                  <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                    {m.leads} lead{m.leads === 1 ? "" : "s"} · {m.converts} convert
                    {m.converts === 1 ? "" : "s"} · {formatCentsEur(m.adSpendCents)} ·{" "}
                    {m.roas === null ? "—" : `${m.roas.toFixed(1)}×`} ROAS
                  </span>
                </div>
              </td>
              <td style={td}>{formatDate(m.createdAt)}</td>
            </tr>
            {isOpen && (
              <tr>
                <td colSpan={COLUMN_COUNT} style={{ padding: 0, borderBottom: "1px solid var(--hairline)" }}>
                  <CampaignPanel m={m} />
                </td>
              </tr>
            )}
          </React.Fragment>
        );
      })}
    </tbody>
  );
}

// ── the expanded panel ─────────────────────────────────────────────────────

function CampaignPanel({ m }: { m: CampaignMetrics }) {
  return (
    <div style={{ background: PANEL_BG, padding: "24px 28px" }}>
      {/* Headline — the three numbers that matter most, as big bento tiles.
          The funnel rates fold in as each tile's sub-line rather than a
          separate strip. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <HeroTile
          label="Leads"
          value={m.leads.toLocaleString()}
          sub={m.viewToLeadPct === null ? undefined : `${m.viewToLeadPct.toFixed(1)}% of page views`}
        />
        <HeroTile
          label="Sales"
          value={m.converts.toLocaleString()}
          sub={m.conversionRatePct === null ? undefined : `${m.conversionRatePct.toFixed(1)}% of leads convert`}
        />
        <HeroTile
          label="Cash collected"
          value={formatCentsEur(m.totalUpfrontCents)}
          sub={m.converts > 0 ? `from ${m.converts} sale${m.converts === 1 ? "" : "s"}` : undefined}
        />
      </div>

      {/* Supporting metrics — a bento grid over 6 columns: two wider tiles up
          top, three smaller ones below. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginTop: 12 }}>
        <BentoTile span={3} label="Page views" value={m.landingViews.toLocaleString()} />
        <BentoTile span={3} label="Ad spend" value={formatCentsEur(m.adSpendCents)} />
        <BentoTile
          span={2}
          label="CAC"
          value={m.cacCents === null ? "—" : formatCentsEur(m.cacCents)}
          subNote={m.cacCents === null ? "No sale yet" : undefined}
        />
        <BentoTile
          span={2}
          label="Cost per lead"
          value={m.costPerLeadCents === null ? "—" : formatCentsEur(m.costPerLeadCents)}
          subNote={m.costPerLeadCents === null ? "No spend or leads yet" : undefined}
        />
        <BentoTile
          span={2}
          label="ROAS"
          value={m.roas === null ? "—" : `${m.roas.toFixed(1)}×`}
          subNote={m.roas === null ? "No ad spend yet" : undefined}
        />
      </div>

      <div style={{ marginTop: 24 }}>
        <CardLabel style={{ marginBottom: 10 }}>Email</CardLabel>
        <EmailRow email={m.email} />
      </div>

      <MetaLine m={m} />
    </div>
  );
}

/** Big headline tile (leads / sales / cash collected) — the top row of the bento. */
function HeroTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...tileCard, padding: "18px 20px" }}>
      <CardLabel>{label}</CardLabel>
      <CardValue style={{ fontSize: 34, marginTop: 2 }}>{value}</CardValue>
      {sub && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/** A supporting bento tile spanning `span` of the parent 6-column grid. */
function BentoTile({ span, label, value, subNote }: { span: number; label: string; value: string; subNote?: string }) {
  return (
    <div style={{ ...tileCard, gridColumn: `span ${span}` }}>
      <CardLabel>{label}</CardLabel>
      <CardValue style={{ fontSize: 19 }}>{value}</CardValue>
      {subNote && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>{subNote}</div>}
    </div>
  );
}

function EmailRow({ email }: { email: CampaignEmailMetrics | null }) {
  if (!email) {
    return (
      <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", fontStyle: "italic", margin: 0 }}>
        No campaign email sent yet — send it from Email campaigns to see opens/clicks here.
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, maxWidth: 486 }}>
      <BentoTile span={2} label="Sent" value={email.sent.toLocaleString()} />
      <BentoTile span={2} label="Open rate" value={pct(email.openRatePct)} />
      <BentoTile span={2} label="Click rate" value={pct(email.clickRatePct)} />
    </div>
  );
}

function Dot() {
  return <span aria-hidden>·</span>;
}

function MetaLine({ m }: { m: CampaignMetrics }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        fontSize: 12,
        color: "var(--text-tertiary)",
        marginTop: 24,
        paddingTop: 16,
        borderTop: "1px solid var(--hairline)",
      }}
    >
      <span>
        Assets {m.assets.approved}/{m.assets.total} approved
      </span>
      <Dot />
      <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{m.status}</Badge>
      <Dot />
      <span>Created {formatDate(m.createdAt)}</span>
      <Dot />
      <span>AI build {formatCentsEur(m.aiBuildCents)}</span>
      {m.offer && (
        <>
          <Dot />
          <span
            title={m.offer}
            style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {m.offer}
          </span>
        </>
      )}
      <Dot />
      <Link href={`/marketing/campaigns/${m.id}`} style={{ color: "var(--accent)" }}>
        View full campaign →
      </Link>
      {m.landingUrl && (
        <>
          <Dot />
          <a href={m.landingUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            {m.landingUrl}
          </a>
        </>
      )}
    </div>
  );
}
