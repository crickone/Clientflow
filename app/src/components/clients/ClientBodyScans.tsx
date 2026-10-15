import Link from "next/link";

import { TrendChart } from "@/components/bodyscans/TrendChart";
import { ClientInBodyIdForm } from "@/components/clients/ClientInBodyIdForm";
import { formatChange, formatMetric, HEADLINE_METRICS, METRIC_BY_KEY, METRICS, type MetricKey } from "@/lib/inbody/metrics";
import type { ScanView } from "@/lib/inbody/scans";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** Staff view of one client's InBody scans: the latest, the change, the trend, the history. */
export function ClientBodyScans({
  clientId,
  scans,
  inbodyUserId,
  consentAt,
  isAdmin,
  goal = null,
}: {
  clientId: number;
  scans: ScanView[];
  inbodyUserId: string | null;
  consentAt: number | null;
  isAdmin: boolean;
  /** The goal they picked in the app from this scan, with its target. */
  goal?: { label: string; activity: string; calories: number; protein: number; carbs: number; fat: number; setAt: number } | null;
}) {
  const withResults = scans.filter((s) => Object.keys(s.metrics).length > 0);
  const latest = withResults[0];
  const previous = withResults[1];
  const charts: MetricKey[] = (["weight", "smm", "pbf"] as MetricKey[]).filter((k) => withResults.filter((s) => s.metrics[k] !== undefined).length >= 1);
  const historyCols: MetricKey[] = METRICS.map((m) => m.key).filter((k) => !k.startsWith("lean") && withResults.some((s) => s.metrics[k] !== undefined));

  return (
    <div className="bs-staff">
      <div className="bs-meta">
        <span>
          {consentAt ? "Can see their scans in the app" : "Hasn't turned on scans in the app"}
        </span>
        {isAdmin ? <ClientInBodyIdForm clientId={clientId} initial={inbodyUserId ?? ""} /> : inbodyUserId ? <span>InBody ID {inbodyUserId}</span> : null}
      </div>

      {!latest ? (
        <div className="bs-empty">
          <p>No InBody scans for this client yet.</p>
          <p className="bs-muted">
            Scans match by the phone number entered on the scanner, or by the InBody ID above. Unmatched scans wait under{" "}
            <Link href="/settings/integrations/inbody">Settings, InBody</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="bs-latest-head">
            <h3>Latest scan</h3>
            <span className="bs-muted">
              {day(latest.measuredAt)}
              {previous ? `, compared with ${day(previous.measuredAt)}` : ""}
            </span>
          </div>
          {goal && (
            <div className="bs-goal">
              <b>Goal in the app: {goal.label}</b>
              <span>
                {goal.calories.toLocaleString("en-IE")} kcal a day, {goal.protein} g protein, {goal.carbs} g carbs, {goal.fat} g fat. Trains {goal.activity}. Set {day(goal.setAt)}.
              </span>
            </div>
          )}
          <div className="bs-tiles">
            {HEADLINE_METRICS.map((k) => {
              const ch = previous ? formatChange(k, latest.metrics[k], previous.metrics[k]) : null;
              return (
                <div key={k} className="bs-tile">
                  <span className="bs-tile-label">{METRIC_BY_KEY[k].label}</span>
                  <span className="bs-tile-value">{formatMetric(k, latest.metrics[k])}</span>
                  {ch && <span className={`bs-change is-${ch.tone}`}>{ch.text}</span>}
                </div>
              );
            })}
          </div>

          {withResults.length > 1 && charts.length > 0 && (
            <div className="bs-charts">
              {charts.map((k) => (
                <div key={k} className="bs-chart">
                  <div className="bs-chart-label">{METRIC_BY_KEY[k].label}</div>
                  <TrendChart
                    metric={k}
                    points={withResults.filter((s) => s.metrics[k] !== undefined).map((s) => ({ at: s.measuredAt, value: s.metrics[k]! }))}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="bs-history">
            <h3>All scans</h3>
            <div className="ib-table-wrap" style={{ margin: 0 }}>
              <table className="ib-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    {historyCols.map((k) => (
                      <th key={k}>{METRIC_BY_KEY[k].label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scans.map((s) => (
                    <tr key={s.id}>
                      <td>{day(s.measuredAt)}</td>
                      {historyCols.map((k) => (
                        <td key={k}>{formatMetric(k, s.metrics[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
