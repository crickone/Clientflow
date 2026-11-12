import Link from "next/link";

import { api } from "@/lib/api";
import { fmtCents, fmtMonthShort } from "@/lib/format";
import { ShareBar } from "@/components/charts/Sparkline";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import type { AlertsResponse, PlatformAnalytics } from "@/lib/types";

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
  const [data, alertsRes] = await Promise.all([
    api<PlatformAnalytics>("/analytics", { revalidate: 30, tags: ["fleet"] }),
    api<AlertsResponse>("/alerts", { revalidate: 60, tags: ["fleet"] }).catch((err) => {
      console.error("[dashboard] alerts unavailable:", err);
      return null;
    }),
  ]);
  const { platform, gyms } = data;
  const alerts = alertsRes?.alerts ?? [];
  const counts = alertsRes?.counts ?? null;
  // An older main-app deploy may not send the newer series yet.
  const mrrMovements = platform.mrrMovements ?? [];
  const aiSpend = (gyms.aiSpendByMonth ?? []).map((p) => p.cents / 100);
  const emailSent = (gyms.emailByMonth ?? []).map((p) => p.sent);

  const growth = platform.gymsByMonth.map((p) => p.total);
  const growthLabels = platform.gymsByMonth.map((p) => fmtMonthShort(p.month));
  const collected = platform.collectedByMonth.map((p) => p.cents);

  // Ordered by what they contribute, so the row that matters is the first one.
  const fleet = [...gyms.perGym].sort((a, b) => b.gmvCentsMonthly - a.gmvCentsMonthly);
  const maxGmv = Math.max(1, ...fleet.map((g) => g.gmvCentsMonthly));

  const needsAttention = counts
    ? counts.bad + counts.warn
    : fleet.filter((g) => !g.exempt && g.status !== "active").length;

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
              <>nothing needs you.</>
            ) : (
              <>
                <strong>{needsAttention}</strong> open {needsAttention === 1 ? "alert" : "alerts"}.
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

      {alertsRes ? (
        <section className="cluster">
          <h2>
            Needs you
            <Link href="/inbox" className="fleet-count">Open the inbox</Link>
          </h2>
          {alerts.length === 0 ? (
            <p style={{ margin: "6px 0 0", color: "var(--text-secondary)", fontSize: 13.5 }}>Nothing open.</p>
          ) : (
            <ul className="inbox">
              {alerts.slice(0, 5).map((a) => (
                <li key={a.id} className={`inbox-row is-${a.level}`} style={{ padding: "12px 0" }}>
                  <span className="inbox-icon" aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: a.level === "bad" ? "var(--red)" : "var(--amber)", marginTop: 7 }} />
                  <div className="inbox-main">
                    <Link href={a.href ?? "/inbox"} className="inbox-title">{a.title}</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {alerts.length > 5 ? (
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>
              <Link href="/inbox" className="fleet-count">and {alerts.length - 5} more</Link>
            </p>
          ) : null}
        </section>
      ) : null}

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

      <section className="board-trends">
        <h2>Twelve months</h2>
        <div className="chart-grid-2">
          <LineChart title="Businesses on the platform" labels={growthLabels} series={[{ label: "Total", values: growth, accent: true }]} />
          <LineChart title="Subscription revenue collected" labels={growthLabels} series={[{ label: "Collected", values: collected.map((c) => c / 100), accent: true }]} format={(v) => `€${Math.round(v)}`} />
          <LineChart title="AI spend across businesses" labels={growthLabels} series={[{ label: "Spend", values: aiSpend, accent: true }]} format={(v) => `€${Math.round(v)}`} />
          <LineChart title="Emails sent" labels={growthLabels} series={[{ label: "Sent", values: emailSent, accent: true }]} />
        </div>
        <BarChart
          title="MRR movements"
          groups={mrrMovements.map((m) => ({ label: fmtMonthShort(m.month), up: (m.newCents + m.expansionCents + m.reactivationCents) / 100, down: (m.churnCents + m.contractionCents) / 100, net: m.netCents / 100 }))}
          format={(v) => `€${Math.round(v)}`}
        />
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
