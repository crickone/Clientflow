"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

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
                  <CampaignPanel m={m} badge={badge} />
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

function CampaignPanel({
  m,
  badge,
}: {
  m: CampaignMetrics;
  badge: { tone: "neutral" | "green" | "red"; label: string };
}) {
  return (
    <div style={{ background: "var(--surface-2)", padding: "24px 28px" }}>
      <FunnelStrip m={m} />
      <MoneyGrid m={m} badge={badge} />
      <div style={{ marginTop: 24 }}>
        <CardLabel style={{ marginBottom: 10 }}>Email</CardLabel>
        <EmailRow email={m.email} />
      </div>
      <MetaLine m={m} />
    </div>
  );
}

function FunnelStrip({ m }: { m: CampaignMetrics }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", marginBottom: 28 }}>
      <FunnelNode label="Page views" value={m.landingViews} />
      <FunnelArrow rate={pct(m.viewToLeadPct)} />
      <FunnelNode label="Sign-ups (leads)" value={m.leads} />
      <FunnelArrow rate={pct(m.conversionRatePct)} />
      <FunnelNode label="Sales (converts)" value={m.converts} />
    </div>
  );
}

function FunnelNode({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: "center", minWidth: 110 }}>
      <CardValue style={{ fontSize: 28 }}>{value.toLocaleString()}</CardValue>
      <CardLabel style={{ marginTop: 6, marginBottom: 0 }}>{label}</CardLabel>
    </div>
  );
}

function FunnelArrow({ rate }: { rate: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 18px",
        color: "var(--text-tertiary)",
        flexShrink: 0,
      }}
    >
      <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 11 }}>{rate}</span>
      <ArrowRight size={16} strokeWidth={1.75} style={{ marginTop: 2 }} aria-hidden />
    </div>
  );
}

function StatTile({ label, value, subNote }: { label: string; value: string; subNote?: string }) {
  return (
    <div>
      <CardLabel>{label}</CardLabel>
      <CardValue style={{ fontSize: 19 }}>{value}</CardValue>
      {subNote && <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>{subNote}</div>}
    </div>
  );
}

function MoneyGrid({
  m,
  badge,
}: {
  m: CampaignMetrics;
  badge: { tone: "neutral" | "green" | "red"; label: string };
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 20,
        paddingTop: 20,
        borderTop: "1px solid var(--hairline)",
      }}
    >
      <StatTile label="Ad spend" value={formatCentsEur(m.adSpendCents)} />
      <StatTile label="Cash collected" value={formatCentsEur(m.totalUpfrontCents)} />
      <StatTile label="MRR added" value={`${formatCentsEur(m.mrrCents)}/mo`} />
      <StatTile
        label="CAC"
        value={m.cacCents === null ? "—" : formatCentsEur(m.cacCents)}
        subNote={m.cacCents === null ? "No sale yet" : undefined}
      />
      <StatTile
        label="Cost per lead"
        value={m.costPerLeadCents === null ? "—" : formatCentsEur(m.costPerLeadCents)}
        subNote={m.costPerLeadCents === null ? "No spend or leads yet" : undefined}
      />
      <StatTile
        label="Revenue per sale"
        value={m.revenuePerSaleCents === null ? "—" : formatCentsEur(m.revenuePerSaleCents)}
        subNote={m.revenuePerSaleCents === null ? "No sale yet" : undefined}
      />
      <StatTile
        label="ROAS"
        value={m.roas === null ? "—" : `${m.roas.toFixed(1)}×`}
        subNote={m.roas === null ? "No ad spend yet" : undefined}
      />
      <div>
        <CardLabel>CFA</CardLabel>
        <div style={{ marginTop: 2 }}>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 6 }}>
          {m.cfaRatioPct === null ? "No ad spend recorded" : `Covers ${m.cfaRatioPct.toFixed(1)}% of spend`}
        </div>
      </div>
      <StatTile label="AI build cost" value={formatCentsEur(m.aiBuildCents)} />
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
    <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
      <StatTile label="Sent" value={email.sent.toLocaleString()} />
      <StatTile label="Open rate" value={pct(email.openRatePct)} />
      <StatTile label="Click rate" value={pct(email.clickRatePct)} />
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
