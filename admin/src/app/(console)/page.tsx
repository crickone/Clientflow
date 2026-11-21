import Link from "next/link";

import { api } from "@/lib/api";
import { joinProblems } from "@/lib/activitySort";
import { fmtCents, fmtMonthShort } from "@/lib/format";
import { isReconnectAlert } from "@/lib/labels";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ActivityTable } from "@/components/fleet/ActivityTable";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import type { ActivityResponse, AlertsResponse, PlatformAlert, PlatformAnalytics } from "@/lib/types";

/**
 * The fleet board: what needs the operator, what each business did this week,
 * and the money.
 *
 * Each of the three fetches is fail-soft on its own. A section whose data did
 * not arrive says so in a quiet line (never an empty "all fine"); the others
 * still render.
 */

const NEEDS_SHOWN = 8;

async function soft<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error(`[dashboard] ${label} unavailable:`, err);
    return null;
  }
}

function openAlerts(all: PlatformAlert[], now: number): PlatformAlert[] {
  return all
    .filter((a) => a.resolvedAt === null && !(a.snoozedUntil != null && a.snoozedUntil > now))
    .sort((a, b) => (a.level === b.level ? b.openedAt - a.openedAt : a.level === "bad" ? -1 : 1));
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
  const [analytics, alertsRes, activity] = await Promise.all([
    soft("analytics", api<PlatformAnalytics>("/analytics", { revalidate: 30, tags: ["fleet"] })),
    soft("alerts", api<AlertsResponse>("/alerts", { revalidate: 60, tags: ["fleet"] })),
    soft("activity", api<ActivityResponse>("/activity", { revalidate: 60, tags: ["fleet"] })),
  ]);

  const now = Date.now();
  const alertList = alertsRes?.alerts ?? [];
  const open = openAlerts(alertList, now);
  const eyebrow = `Fleet · ${new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" }).format(now)}`;

  // With no alerts feed the problem counts are unknown (null), not zero.
  const views = activity ? joinProblems(activity.rows, alertsRes ? alertList : null, now) : null;
  const known = activity ? activity.rows.filter((r) => r.salesCents7d !== null) : [];
  const salesWeek = known.length > 0 ? known.reduce((sum, r) => sum + (r.salesCents7d ?? 0), 0) : null;

  return (
    <div className="board">
      <PageHeader eyebrow={eyebrow} title="Dashboard" />

      {!alertsRes ? (
        <Card>
          <div className="need-head">
            <h2 className="card-title">Needs you</h2>
          </div>
          <p className="inbox-empty" style={{ margin: "8px 0 0" }}>
            Couldn&apos;t load alerts. <Link href="/inbox">Open the inbox.</Link>
          </p>
        </Card>
      ) : (
        <Card>
          <div className="need-head">
            <h2 className="card-title">Needs you · {open.length}</h2>
            <Link href="/inbox" className="fleet-count">Open the inbox</Link>
          </div>
          {open.length === 0 ? (
            <p className="inbox-empty" style={{ margin: "8px 0 0" }}>Nothing needs you.</p>
          ) : (
            <ul className="need-list">
              {open.slice(0, NEEDS_SHOWN).map((a) => (
                <li key={a.id} className={`need-row is-${a.level}`}>
                  <span className="need-dot" aria-hidden />
                  <span className="need-biz">{a.tenantName ?? "Platform"}</span>
                  <span className="need-what">
                    {a.title}
                    {a.detail ? <span className="need-detail"> · {a.detail}</span> : null}
                  </span>
                  <Link
                    href={a.href ?? (a.tenantId !== null ? `/gyms/${a.tenantId}` : "/inbox")}
                    className="btn btn--secondary btn--md"
                  >
                    {isReconnectAlert(a.key) ? "Reconnect" : "Open"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {open.length > NEEDS_SHOWN ? (
            <p className="need-more">
              <Link href="/inbox" className="fleet-count">and {open.length - NEEDS_SHOWN} more</Link>
            </p>
          ) : null}
        </Card>
      )}

      <section>
        <h2 className="board-section-title">This week</h2>
        {views ? (
          <Card style={{ padding: "18px 22px" }}>
            <ActivityTable views={views} now={now} />
          </Card>
        ) : (
          <p className="inbox-empty" style={{ margin: "8px 0 0" }}>Couldn&apos;t load this week&apos;s activity.</p>
        )}
      </section>

      {analytics ? <Money analytics={analytics} salesWeekCents={salesWeek} /> : null}
    </div>
  );
}

function Money({ analytics, salesWeekCents }: { analytics: PlatformAnalytics; salesWeekCents: number | null }) {
  const { platform, gyms } = analytics;

  if (platform.gyms.paying === 0) {
    const allExempt = platform.gyms.exempt === platform.gyms.total;
    return (
      <section>
        <h2 className="board-section-title">Money</h2>
        <Card>
          <p className="money-line">
            {allExempt
              ? `All ${platform.gyms.total} ${platform.gyms.total === 1 ? "business is" : "businesses are"} exempt. Platform MRR starts when the first business pays.`
              : "No business is paying yet. Platform MRR starts when the first business pays."}
          </p>
          {salesWeekCents !== null ? (
            <p className="money-line">
              Client sales through Stripe this week: <strong>{fmtCents(salesWeekCents)}</strong>
            </p>
          ) : null}
        </Card>
      </section>
    );
  }

  // An older main-app deploy may not send the newer series yet.
  const mrrMovements = platform.mrrMovements ?? [];
  const aiSpend = (gyms.aiSpendByMonth ?? []).map((p) => p.cents / 100);
  const emailSent = (gyms.emailByMonth ?? []).map((p) => p.sent);
  const growth = platform.gymsByMonth.map((p) => p.total);
  const growthLabels = platform.gymsByMonth.map((p) => fmtMonthShort(p.month));
  const collected = platform.collectedByMonth.map((p) => p.cents);

  return (
    <>
      <section className="cluster">
        <h2>Money</h2>
        <div className="board-meters">
          <Readout label="MRR" value={fmtCents(platform.mrrCents)} note={`ARR ${fmtCents(platform.arrCents)}`} />
          <Readout label="Paying" value={`${platform.gyms.paying} of ${platform.gyms.total}`} note={`${platform.gyms.exempt} exempt`} />
          <Readout
            label="Client GMV"
            value={`${fmtCents(gyms.gmvCentsMonthly)}/mo`}
            note={`est. residual ${fmtCents(gyms.estResidualCentsMonthly)}/mo`}
          />
        </div>
      </section>

      <section className="board-twelve">
        <h2>Twelve months</h2>
        <div className="chart-grid-2">
          <LineChart title="Businesses on the platform" labels={growthLabels} series={[{ label: "Total", values: growth, accent: true }]} />
          <LineChart title="Subscription revenue collected" labels={growthLabels} series={[{ label: "Collected", values: collected.map((c) => c / 100), accent: true }]} unit="eur" />
          <LineChart title="AI spend across businesses" labels={growthLabels} series={[{ label: "Spend", values: aiSpend, accent: true }]} unit="eur" />
          <LineChart title="Emails sent" labels={growthLabels} series={[{ label: "Sent", values: emailSent, accent: true }]} />
        </div>
        <BarChart
          title="MRR movements"
          groups={mrrMovements.map((m) => ({ label: fmtMonthShort(m.month), up: (m.newCents + m.expansionCents + m.reactivationCents) / 100, down: (m.churnCents + m.contractionCents) / 100, net: m.netCents / 100 }))}
          unit="eur"
        />
      </section>

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
    </>
  );
}
