import Link from "next/link";

import { api } from "@/lib/api";
import { fmtCents, fmtMonthShort } from "@/lib/format";
import { Sparkline, ShareBar } from "@/components/charts/Sparkline";
import type { PlatformAnalytics } from "@/lib/types";

/**
 * The fleet board.
 *
 * This page used to be four equal stat tiles, two full line charts and a
 * donut. The trouble was what the numbers actually are: MRR and ARR are the
 * same fact twice (ARR is MRR×12), every business is exempt so both read
 * €0.00, the revenue chart was a flat line along zero, and the donut was a
 * single segment at 100%. A dashboard whose largest elements are a number
 * shown twice and two pictures of nothing.
 *
 * The question an operator opens this page with is "which of my businesses
 * needs me today, and is the platform healthy". So the fleet is the page: one
 * row per business, and the money — which is currently zero, and says so —
 * sits in a readout rather than a chart. Charts return when there is a trend
 * to draw; `Sparkline` refuses to draw a flat line for exactly that reason.
 */

/** Status colours, validated for dark surfaces and CVD separation. They never travel without their label. */
const STATUS: Record<string, { dot: string; label: string }> = {
  active: { dot: "#2ea36c", label: "Active" },
  past_due: { dot: "#b8862b", label: "Past due" },
  suspended: { dot: "#c44863", label: "Suspended" },
  pending_payment: { dot: "#b8862b", label: "Pending" },
  none: { dot: "rgba(244,245,247,0.32)", label: "No billing" },
};

function Status({ status, exempt }: { status: string; exempt: boolean }) {
  const s = STATUS[status] ?? STATUS.none!;
  return (
    <span className="fleet-status">
      <i style={{ background: exempt ? "rgba(244,245,247,0.32)" : s.dot }} aria-hidden />
      {exempt ? "Exempt" : s.label}
    </span>
  );
}

/** A number in the instrument face: mono, tabular, with its unit kept small. */
function Readout({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="readout">
      <span className="readout-label">{label}</span>
      <span className="readout-value">{value}</span>
      {note ? <span className="readout-note">{note}</span> : null}
    </div>
  );
}

export default async function DashboardPage() {
  const data = await api<PlatformAnalytics>("/analytics");
  const { platform, gyms } = data;

  const growth = platform.gymsByMonth.map((p) => p.total);
  const growthLabels = platform.gymsByMonth.map((p) => fmtMonthShort(p.month));
  const collected = platform.collectedByMonth.map((p) => p.cents);
  const anyRevenue = collected.some((c) => c > 0);

  // Ordered by what they contribute, so the row that matters is the first one.
  const fleet = [...gyms.perGym].sort((a, b) => b.gmvCentsMonthly - a.gmvCentsMonthly);
  const maxGmv = Math.max(1, ...fleet.map((g) => g.gmvCentsMonthly));

  const needsAttention = fleet.filter((g) => !g.exempt && g.status !== "active").length;

  return (
    <div className="board">
      {/* The one sentence worth reading first. Everything else is detail. */}
      <header className="board-hero">
        <p className="board-eyebrow">Fleet</p>
        <h1>
          <span className="board-figure">{platform.gyms.total}</span>
          <span className="board-sentence">
            {platform.gyms.total === 1 ? "business" : "businesses"} on the platform,{" "}
            {needsAttention === 0 ? (
              <>all of them running.</>
            ) : (
              <>
                <strong>{needsAttention}</strong> needing attention.
              </>
            )}
          </span>
        </h1>
        <div className="board-meters">
          <Readout label="MRR" value={fmtCents(platform.mrrCents)} note={`ARR ${fmtCents(platform.arrCents)}`} />
          <Readout
            label="Paying"
            value={`${platform.gyms.paying} of ${platform.gyms.total}`}
            note={`${platform.gyms.exempt} exempt`}
          />
          <Readout
            label="Client GMV"
            value={`${fmtCents(gyms.gmvCentsMonthly)}/mo`}
            note={`est. residual ${fmtCents(gyms.estResidualCentsMonthly)}/mo`}
          />
        </div>
      </header>

      {/* The signature: the fleet as a row of channels. */}
      <section className="fleet">
        <div className="fleet-head">
          <h2>Businesses</h2>
          <span className="fleet-count">{gyms.tenantsCounted} counted</span>
        </div>

        <div className="fleet-legend">
          <span>Business</span>
          <span>Status</span>
          <span>Share of client GMV</span>
          <span>Members</span>
          <span>GMV / mo</span>
        </div>

        {fleet.length === 0 ? (
          <p className="board-empty">
            No businesses yet. <Link href="/provision">Provision the first one</Link>.
          </p>
        ) : (
          <ul className="fleet-list">
            {fleet.map((g) => (
              <li key={g.tenantId}>
                <Link href={`/gyms/${g.tenantId}`} className="fleet-row">
                  <span className="fleet-name">
                    {g.name}
                    <span className="fleet-type">{g.venueType ?? "type not set"}</span>
                  </span>
                  <Status status={g.status} exempt={g.exempt} />
                  <span className="fleet-share">
                    <ShareBar fraction={g.gmvCentsMonthly / maxGmv} />
                  </span>
                  <span className="fleet-num">{g.members}</span>
                  <span className="fleet-num fleet-gmv">{fmtCents(g.gmvCentsMonthly)}</span>
                  <span className="fleet-go" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Trend, only where one exists. */}
      <section className="board-trends">
        <div className="trend">
          <div className="trend-top">
            <span className="readout-label">Businesses on platform</span>
            <Sparkline values={growth} />
          </div>
          <p className="trend-note">
            {growth.length > 1 && growth[growth.length - 1]! > growth[0]!
              ? `${growth[0]} in ${growthLabels[0]} to ${growth[growth.length - 1]} in ${growthLabels[growthLabels.length - 1]}.`
              : "No change over the last twelve months."}
          </p>
        </div>

        <div className="trend">
          <div className="trend-top">
            <span className="readout-label">Subscription revenue collected</span>
            {anyRevenue ? <Sparkline values={collected} /> : null}
          </div>
          <p className="trend-note">
            {anyRevenue
              ? `${fmtCents(collected.reduce((a, b) => a + b, 0))} over the last twelve months.`
              : "Nothing collected yet — every business is on an exemption."}
          </p>
        </div>
      </section>

      {/* The client-side totals, as a gauge cluster rather than five more cards. */}
      <section className="cluster">
        <h2>Across all businesses</h2>
        <div className="cluster-row">
          <Readout label="Members" value={String(gyms.members)} />
          <Readout label="Active" value={String(gyms.activeMembers)} />
          <Readout label="Classes this week" value={String(gyms.classesThisWeek)} />
          <Readout label="Leads" value={String(gyms.leads)} />
          <Readout label="Revenue this month" value={fmtCents(gyms.revenueCentsThisMonth)} />
        </div>
      </section>
    </div>
  );
}
