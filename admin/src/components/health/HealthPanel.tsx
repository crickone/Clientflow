"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { healthAction, type HealthActionResult, type HealthOp } from "@/app/(console)/gyms/[id]/health/actions";
import { notify } from "@/lib/toast";
import { Card } from "@/components/ui/Card";
import { LineChart } from "@/components/charts/LineChart";
import { bytes } from "@/lib/format";
import type { TenantHealth } from "@/lib/types";

/**
 * The Health tab: what is wrong, and the two things worth fixing from here.
 *
 * Alerts lead, because the whole page exists to answer "is anything broken".
 * Everything below them is the evidence behind the answer. The repairs are
 * deliberately few: clearing a generation whose process died, and re-queuing
 * work that failed. Anything more invasive belongs in the Data slice, behind
 * a backup.
 */
export function HealthPanel({ tenantId, data }: { tenantId: number; data: TenantHealth }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<HealthActionResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function run(key: string, body: HealthOp) {
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await healthAction(tenantId, body);
      setBusyKey(null);
      if (r.ok) {
        notify.ok(r.note);
        router.refresh();
      } else {
        setResult(r);
        notify.fail(r.error);
      }
    });
  }

  const migrationsBehind = data.migrations.missing.length > 0;
  const labels = data.history.map((h) => new Date(h.at).toLocaleDateString("en-IE", { day: "numeric", month: "short" }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {result && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13.5,
            background: result.ok ? "rgba(63,185,80,.12)" : "rgba(240,128,154,.12)",
            border: `1px solid ${result.ok ? "rgba(63,185,80,.4)" : "rgba(240,128,154,.4)"}`,
          }}
        >
          {result.ok ? result.note : result.error}
        </div>
      )}

      <Card
        style={{
          padding: 24,
          borderColor: data.alerts.some((a) => a.level === "bad")
            ? "var(--red)"
            : data.alerts.length > 0
              ? "var(--amber)"
              : undefined,
        }}
      >
        <h2 className="card-title" style={{ margin: "0 0 12px" }}>
          {data.alerts.length === 0 ? "Healthy" : `${data.alerts.length} thing${data.alerts.length === 1 ? "" : "s"} to look at`}
        </h2>
        {data.alerts.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>
            Database sound, every migration applied, nothing stuck or failed.
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
            {data.alerts.map((a, i) => (
              <li key={i} style={{ color: a.level === "bad" ? "var(--red)" : "var(--amber)" }}>
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 className="card-title" style={{ margin: "0 0 4px" }}>Thirty days</h2>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "var(--text-secondary)" }}>One point an hour. A queue that only grows, or a database that jumps, shows here before anyone reports it.</p>
        {data.history.length < 2 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>History starts after the first two snapshots.</p>
        ) : (
          <div className="chart-grid-2">
            <LineChart title="Database size" labels={labels} series={[{ label: "Database", values: data.history.map((h) => h.dbBytes / 1048576), accent: true }, { label: "WAL", values: data.history.map((h) => h.walBytes / 1048576) }]} format={(v) => `${v.toFixed(1)} MB`} />
            <LineChart title="Queued work" labels={labels} series={[{ label: "Due", values: data.history.map((h) => h.queueDue), accent: true }, { label: "Failed", values: data.history.map((h) => h.queueFailed) }]} />
            <LineChart title="Open alerts" labels={labels} series={[{ label: "Needs action", values: data.history.map((h) => h.alertsBad), accent: true }, { label: "Watch", values: data.history.map((h) => h.alertsWarn) }]} />
          </div>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 className="card-title" style={{ margin: "0 0 12px" }}>Alert history</h2>
        {data.alertHistory.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No alerts recorded for this business.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Opened</th><th>Alert</th><th>Resolved</th></tr></thead>
            <tbody>
              {data.alertHistory.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(a.openedAt).toLocaleDateString("en-IE")}</td>
                  <td style={{ color: a.level === "bad" ? "var(--red)" : undefined }}>{a.title}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-secondary)" }}>{a.resolvedAt ? new Date(a.resolvedAt).toLocaleDateString("en-IE") : "open"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 className="card-title" style={{ margin: "0 0 16px" }}>
          Database
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 20 }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Size</div>
            <div style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{bytes(data.dbBytes)}</div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Write-ahead log</div>
            <div style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{bytes(data.walBytes)}</div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Integrity</div>
            <div style={{ fontSize: 17, color: data.integrity === "failed" ? "var(--red)" : undefined }}>
              {data.integrity === "ok" ? "Sound" : data.integrity === "failed" ? "Failed" : "Not checked"}
            </div>
            {data.integrityDetail && (
              <div style={{ fontSize: 12, color: "var(--red)", marginTop: 4 }}>{data.integrityDetail}</div>
            )}
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Migrations</div>
            <div style={{ fontSize: 17, color: migrationsBehind ? "var(--amber)" : undefined, fontVariantNumeric: "tabular-nums" }}>
              {data.migrations.applied} of {data.migrations.expected}
            </div>
            {migrationsBehind && (
              <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 4 }}>
                Missing: {data.migrations.missing.join(", ")}. They run when the business is next opened.
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 className="card-title" style={{ margin: "0 0 4px" }}>
          Queues
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Work waiting on the dispatch ticker, which runs every minute.
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Queue</th>
              <th>Due now</th>
              <th>Later</th>
              <th>Failed</th>
              <th style={{ width: 1 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.queues.map((q) => (
              <tr key={q.key}>
                <td>
                  {q.label}
                  {q.failed > 0 && q.note && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{q.note}</div>
                  )}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{q.due}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>{q.waiting}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: q.failed > 0 ? "var(--amber)" : undefined }}>{q.failed}</td>
                <td>
                  {q.failed > 0 && (q.key === "nurture" || q.key === "posts") && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={pending}
                      onClick={() => run(`retry-${q.key}`, { op: "retry-queue", queue: q.key as "nurture" | "posts" })}
                    >
                      {busyKey === `retry-${q.key}` ? "…" : "Re-queue failed"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.stuckGenerations > 0 && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, color: "var(--amber)" }}>
              {data.stuckGenerations} design{data.stuckGenerations === 1 ? "" : "s"} stuck mid-generation — the run that owned
              them died with the process that started it.
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={pending}
              onClick={() => run("clear-stuck", { op: "clear-stuck" })}
            >
              {busyKey === "clear-stuck" ? "…" : "Clear them"}
            </button>
          </div>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 className="card-title" style={{ margin: "0 0 4px" }}>
          Background jobs
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Platform-wide, not per business — if one of these is stale, it is stale for everyone.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 20 }}>
          {data.schedulers.map((s) => (
            <div key={s.key}>
              <div className="mono-label" style={{ marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 15, color: s.lastRun ? undefined : "var(--text-tertiary)" }}>
                {s.lastRun ?? "Never run"}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
