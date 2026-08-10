import Link from "next/link";

import { api } from "@/lib/api";
import { fmtCents, fmtMonthShort } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";
import {
  GymGrowthChart,
  RevenueCollectedChart,
  StatusDonut,
} from "@/components/charts/PlatformCharts";
import type { PlatformAnalytics } from "@/lib/types";

/* Semantic status colours (hex to match the theme tokens — SVG fills don't
   resolve CSS var()). green=#3fb950 amber=#f2c14e red=#f0809a accent=#ff6a32 */
const STATUS_GREEN = "#3fb950";
const STATUS_AMBER = "#f2c14e";
const STATUS_RED = "#f0809a";
const STATUS_ACCENT = "#ff6a32";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card style={{ padding: "22px 24px" }}>
      <CardLabel>{label}</CardLabel>
      <CardValue>{value}</CardValue>
      {sub ? (
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 10.5,
            letterSpacing: "0.04em",
            color: "var(--text-tertiary)",
          }}
        >
          {sub}
        </div>
      ) : null}
    </Card>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "0 0 16px",
        fontSize: 15,
        fontWeight: 600,
        color: "var(--text-primary)",
        textTransform: "uppercase",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </h2>
  );
}

export default async function DashboardPage() {
  const data = await api<PlatformAnalytics>("/analytics");
  const { platform, gyms } = data;

  const revenueData = platform.collectedByMonth.map((p) => ({
    label: fmtMonthShort(p.month),
    eur: p.cents / 100,
  }));
  const growthData = platform.gymsByMonth.map((p) => ({
    label: fmtMonthShort(p.month),
    total: p.total,
  }));

  const statusData = [
    { name: "Active", value: platform.gyms.active, color: STATUS_GREEN },
    { name: "Past due", value: platform.gyms.pastDue, color: STATUS_AMBER },
    { name: "Suspended", value: platform.gyms.suspended, color: STATUS_RED },
    { name: "Pending", value: platform.gyms.pendingPayment, color: STATUS_ACCENT },
  ].filter((d) => d.value > 0);

  const topGyms = [...gyms.perGym].sort((a, b) => b.members - a.members).slice(0, 8);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Dashboard</h1>
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 10.5,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-tertiary)",
          }}
        >
          {gyms.tenantsCounted} businesses · {platform.gyms.total} tenants
        </span>
      </div>

      {/* 1 — Headline platform stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <StatCard label="MRR" value={fmtCents(platform.mrrCents)} sub={`ARR ${fmtCents(platform.arrCents)}`} />
        <StatCard label="ARR" value={fmtCents(platform.arrCents)} />
        <StatCard
          label="Paying businesses"
          value={`${platform.gyms.paying}/${platform.gyms.total}`}
          sub={`${platform.gyms.exempt} exempt`}
        />
        <StatCard
          label="Aggregate GMV / mo"
          value={fmtCents(gyms.gmvCentsMonthly)}
          sub={`est. residual ${fmtCents(gyms.estResidualCentsMonthly)}/mo`}
        />
      </div>

      {/* 2 + 3 — Revenue collected + gym growth */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14 }}>
        <Card style={{ padding: 24 }}>
          <PanelTitle>Subscription revenue collected</PanelTitle>
          <RevenueCollectedChart data={revenueData} />
        </Card>
        <Card style={{ padding: 24 }}>
          <PanelTitle>Businesses on platform</PanelTitle>
          <GymGrowthChart data={growthData} />
        </Card>
      </div>

      {/* 4 — Status breakdown */}
      <Card style={{ padding: 24 }}>
        <PanelTitle>Business status breakdown</PanelTitle>
        {statusData.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No billing rows yet.</p>
        ) : (
          <StatusDonut data={statusData} />
        )}
      </Card>

      {/* 5 — Aggregate business figures across all gyms */}
      <div>
        <PanelTitle>Across all businesses</PanelTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
          <StatCard label="Members" value={String(gyms.members)} />
          <StatCard label="Active members" value={String(gyms.activeMembers)} />
          <StatCard label="Classes this week" value={String(gyms.classesThisWeek)} />
          <StatCard label="Leads" value={String(gyms.leads)} />
          <StatCard label="Revenue this month" value={fmtCents(gyms.revenueCentsThisMonth)} />
        </div>
      </div>

      {/* 6 — Top gyms leaderboard */}
      <Card style={{ padding: 24 }}>
        <PanelTitle>Top businesses</PanelTitle>
        {topGyms.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No businesses yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Business</th>
                <th>Type</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Members</th>
                <th style={{ textAlign: "right" }}>Active</th>
                <th style={{ textAlign: "right" }}>GMV / mo</th>
              </tr>
            </thead>
            <tbody>
              {topGyms.map((g) => (
                <tr key={g.tenantId}>
                  <td>
                    <Link href={`/gyms/${g.tenantId}`}>{g.name}</Link>
                  </td>
                  <td style={{ color: "var(--text-secondary)", textTransform: "capitalize" }}>{g.venueType}</td>
                  <td>
                    <StatusChip status={g.status === "none" ? null : g.status} exempt={g.exempt} />
                  </td>
                  <td style={{ textAlign: "right" }}>{g.members}</td>
                  <td style={{ textAlign: "right" }}>{g.activeMembers}</td>
                  <td style={{ textAlign: "right" }}>{fmtCents(g.gmvCentsMonthly)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
