import Link from "next/link";

import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { bytes } from "@/components/health/HealthPanel";
import type { FleetHealth } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every business's alerts in one list, worst first.
 *
 * Shallow by design: no integrity check runs here, because that reads every
 * byte of every database. This page is for skimming; the business's own
 * Health tab is where the deep check happens.
 */
export default async function FleetHealthPage() {
  const { tenants, schedulers } = await api<FleetHealth>("/health");

  const rank = (t: FleetHealth["tenants"][number]) =>
    t.alerts.some((a) => a.level === "bad") ? 0 : t.alerts.length > 0 ? 1 : 2;
  const sorted = [...tenants].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const unhealthy = sorted.filter((t) => t.alerts.length > 0);
  const totalBytes = tenants.reduce((n, t) => n + t.dbBytes, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Health</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          {unhealthy.length === 0
            ? `All ${tenants.length} businesses look healthy.`
            : `${unhealthy.length} of ${tenants.length} businesses need a look.`}
        </p>
      </div>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Background jobs
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          One set for the whole platform. A stale one affects every business.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 20 }}>
          {schedulers.map((s) => (
            <div key={s.key}>
              <div className="mono-label" style={{ marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 15, color: s.lastRun ? undefined : "var(--text-tertiary)" }}>{s.lastRun ?? "Never run"}</div>
            </div>
          ))}
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Databases on disk</div>
            <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{bytes(totalBytes)}</div>
          </div>
        </div>
      </Card>

      <Card style={{ padding: 20 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Business</th>
              <th>Database</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const bad = t.alerts.some((a) => a.level === "bad");
              return (
                <tr key={t.tenantId}>
                  <td>
                    <Link href={`/gyms/${t.tenantId}/health`}>{t.name}</Link>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>{t.slug}</div>
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{bytes(t.dbBytes)}</td>
                  <td>
                    {t.alerts.length === 0 ? (
                      <span className="chip" style={{ background: "rgba(63,185,80,.15)", color: "var(--green)" }}>healthy</span>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
                        {t.alerts.map((a, i) => (
                          <li key={i} style={{ color: bad && a.level === "bad" ? "var(--red)" : "var(--amber)" }}>
                            {a.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
