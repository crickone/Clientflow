import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { RangePicker } from "@/components/reports/RangePicker";
import { rangeFromKey } from "@/lib/reportsRange";
import { ExportButton } from "@/components/reports/ExportButton";
import { RevenueLine } from "@/components/charts/RevenueLine";
import { TherapyDonut } from "@/components/charts/TherapyDonut";
import { StackedClients } from "@/components/charts/StackedClients";
import { TopClients } from "@/components/charts/TopClients";
import {
  attendanceStats,
  leadConversionByTherapy,
  newVsReturning,
  packageUtilization,
  reportsSummary,
  revenueSeries,
  sessionsByTherapy,
  topClientsBySpend,
} from "@/lib/queries";
import { formatEur } from "@/lib/utils";
import { requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { range?: string };
}

export default async function ReportsPage({ searchParams }: Props) {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());
  const range = rangeFromKey(searchParams.range ?? "month");

  const [revenue, donut, clientsBars, top, summary, attendance, pkgUtil, leadConv] =
    await Promise.all([
      revenueSeries(range.start, range.end),
      sessionsByTherapy(range.start, range.end),
      newVsReturning(range.start, range.end),
      topClientsBySpend(range.start, range.end, 10),
      reportsSummary(range.start, range.end),
      attendanceStats(range.start, range.end),
      packageUtilization(),
      leadConversionByTherapy(range.start, range.end),
    ]);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Insights"
        title="Reports"
        subtitle={range.label}
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <ExportButton label={vocab.bookings} resource="appointments" start={range.start} end={range.end} />
            <ExportButton label={vocab.members} resource="clients" start={range.start} end={range.end} />
            <ExportButton label="Revenue" resource="revenue" start={range.start} end={range.end} />
          </div>
        }
      />

      <div style={{ marginBottom: 24 }}>
        <RangePicker />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Card>
          <CardLabel>Revenue</CardLabel>
          <RevenueLine
            data={fillRange(revenue, range.start, range.end)}
            height={260}
          />
        </Card>
        <Card>
          <CardLabel>Sessions by {vocab.service.toLowerCase()}</CardLabel>
          <TherapyDonut data={donut} height={260} />
        </Card>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Card>
          <CardLabel>New vs returning</CardLabel>
          <StackedClients data={clientsBars} />
        </Card>
        <Card>
          <CardLabel>Top {vocab.members.toLowerCase()}</CardLabel>
          <TopClients data={top} />
        </Card>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
        }}
      >
        <Stat label="Total revenue" value={formatEur(summary.totalRevenue)} />
        <Stat label="Total sessions" value={String(summary.totalSessions)} />
        <Stat label="Avg session" value={formatEur(summary.avgSession)} />
        <Stat label="Most popular" value={summary.mostPopularTherapy ?? "—"} />
        <Stat label="Busiest day" value={summary.busiestDay ?? "—"} />
        <Stat label={`${vocab.plans} sold`} value={String(summary.packagesSold)} />
      </div>

      <div style={{ marginTop: 32, marginBottom: 12 }}>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: 1.4,
            color: "var(--text-secondary)",
            margin: 0,
          }}
        >
          Operator insights
        </h2>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Card>
          <CardLabel>Attendance</CardLabel>
          {attendance.total === 0 ? (
            <Empty>No completed {vocab.bookings.toLowerCase()} in this range</Empty>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 16,
                }}
              >
                <BigStat
                  label="No-show rate"
                  value={pct(attendance.noShowRate)}
                  detail={`${attendance.noShow} of ${attendance.total}`}
                />
                <BigStat
                  label="Cancellation rate"
                  value={pct(attendance.cancellationRate)}
                  detail={`${attendance.cancelled} of ${attendance.total}`}
                />
              </div>
              {attendance.topNoShowClients.length > 0 && (
                <>
                  <div style={{ ...subhead, marginBottom: 8 }}>
                    Top no-show {vocab.members.toLowerCase()}
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {attendance.topNoShowClients.map((c) => (
                      <li
                        key={c.clientId}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "6px 0",
                          borderBottom: "1px solid var(--hairline)",
                          fontSize: 13,
                        }}
                      >
                        <span>{c.name}</span>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {c.noShows} no-show{c.noShows === 1 ? "" : "s"} ·{" "}
                          {c.cancellations} cancelled · of {c.total}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardLabel>Lead conversion by {vocab.service.toLowerCase()}</CardLabel>
          {leadConv.total === 0 ? (
            <Empty>No leads created in this range</Empty>
          ) : (
            <>
              <BigStat
                label="Overall"
                value={pct(leadConv.overallConversion)}
                detail={`${leadConv.booked} booked · ${leadConv.lost} lost · ${leadConv.total} leads`}
              />
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "16px 0 0",
                }}
              >
                {leadConv.byTherapy.map((t) => (
                  <li
                    key={t.therapy}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--hairline)",
                      fontSize: 13,
                    }}
                  >
                    <span>{t.therapy}</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      {pct(t.conversionPct)} ({t.booked} / {t.total})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card>
        <CardLabel>{vocab.plan} utilization</CardLabel>
        {pkgUtil.activeCount === 0 ? (
          <Empty>No active {vocab.plans.toLowerCase()}</Empty>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 16,
                marginBottom: pkgUtil.stalled.length > 0 ? 20 : 0,
              }}
            >
              <BigStat
                label={`Active ${vocab.plans.toLowerCase()}`}
                value={String(pkgUtil.activeCount)}
              />
              <BigStat
                label="Avg utilization"
                value={pct(pkgUtil.avgUtilizationPct)}
                detail={`${pkgUtil.totalSessionsUsed} / ${pkgUtil.totalSessionsSold} sessions`}
              />
              <BigStat
                label="Stalled"
                value={String(pkgUtil.stalled.length)}
                detail="<50% used, expiring ≤60d"
              />
            </div>
            {pkgUtil.stalled.length > 0 && (
              <>
                <div style={{ ...subhead, marginBottom: 8 }}>
                  Stalled {vocab.plans.toLowerCase()} — chase these
                </div>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ color: "var(--text-secondary)" }}>
                      <th style={th}>{vocab.member}</th>
                      <th style={th}>{vocab.service}</th>
                      <th style={th}>{vocab.plan}</th>
                      <th style={{ ...th, textAlign: "right" }}>Used</th>
                      <th style={{ ...th, textAlign: "right" }}>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkgUtil.stalled.map((p) => (
                      <tr
                        key={p.packageId}
                        style={{ borderTop: "1px solid var(--hairline)" }}
                      >
                        <td style={td}>{p.clientName}</td>
                        <td style={td}>{p.therapyName}</td>
                        <td style={td}>{p.packageName}</td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {p.sessionsUsed}/{p.totalSessions} ·{" "}
                          {pct(p.utilizationPct)}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {p.expiryDate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function pct(n: number): string {
  return `${(n * 100).toFixed(n < 0.1 && n > 0 ? 1 : 0)}%`;
}

const subhead = {
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  color: "var(--text-secondary)",
};
const th = {
  textAlign: "left" as const,
  padding: "6px 4px",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
};
const td = { padding: "8px 4px" };

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: "var(--text-secondary)",
        fontSize: 13,
        padding: "16px 0",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function BigStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "var(--text-secondary)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 22,
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
      {detail && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 2,
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardLabel>{label}</CardLabel>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 24,
          textTransform: "uppercase",
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
    </Card>
  );
}

function fillRange(
  rows: { day: string; total: number }[],
  start: string,
  end: string,
): { day: string; total: number }[] {
  const map = new Map(rows.map((r) => [r.day, r.total]));
  const out: { day: string; total: number }[] = [];
  const startDate = new Date(start);
  const endDate = new Date(end);
  for (
    let d = new Date(startDate);
    d.getTime() <= endDate.getTime();
    d.setDate(d.getDate() + 1)
  ) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ day: key, total: map.get(key) ?? 0 });
  }
  return out;
}
