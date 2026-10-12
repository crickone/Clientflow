import { redirect } from "next/navigation";
import { ScanLine } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { formatChange, formatMetric, HEADLINE_METRICS, METRIC_BY_KEY, type MetricKey } from "@/lib/inbody/metrics";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { TrendChart } from "@/components/bodyscans/TrendChart";
import { BodyScanConsent } from "@/components/clientapp/BodyScanConsent";

export const dynamic = "force-dynamic";

function day(ms: number, year = false) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Europe/Dublin" });
}

const CHARTS: MetricKey[] = ["weight", "smm", "pbf"];

export default async function ClientBodyScansPage() {
  const { clientId, tenantId } = requireClientPage();
  if (!bodyScansEnabled(tenantId)) redirect("/app");
  const profile = getScanProfile(clientId);

  if (!profile.consentAt) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub="Your InBody results, in one place">Body scans</PageTitle>
        <Card style={{ padding: 20, display: "grid", gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)" }}>
            <ScanLine size={22} />
          </span>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>See your InBody scans here</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            Each time you step on the InBody scanner, your weight, muscle, body fat and more will show here, with how they have changed since your
            last scan.
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--text-tertiary)" }}>
            Only you and the team can see your results. You can turn this off at any time.
          </div>
          <BodyScanConsent on={false} />
        </Card>
      </div>
    );
  }

  const scans = listClientScans(clientId).filter((s) => Object.keys(s.metrics).length > 0);
  const latest = scans[0];
  const previous = scans[1];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle sub={latest ? `Latest scan ${day(latest.measuredAt, true)}` : "Your InBody results, in one place"}>Body scans</PageTitle>

      {!latest ? (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>No scans yet</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)", marginTop: 4 }}>
            Next time you&rsquo;re in, step on the InBody scanner and enter your mobile number. Your results will show here shortly after.
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {HEADLINE_METRICS.map((k) => {
              const ch = previous ? formatChange(k, latest.metrics[k], previous.metrics[k]) : null;
              return (
                <Card key={k} style={{ padding: 14, display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{METRIC_BY_KEY[k].label}</span>
                  <span style={{ fontSize: 20, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatMetric(k, latest.metrics[k])}</span>
                  {ch && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: ch.tone === "good" ? "var(--success)" : ch.tone === "bad" ? "var(--attn-ink, var(--text-secondary))" : "var(--text-tertiary)",
                      }}
                    >
                      {ch.text}
                    </span>
                  )}
                </Card>
              );
            })}
          </div>
          {previous && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "-6px 2px 0" }}>Changes are since your scan on {day(previous.measuredAt)}.</div>
          )}

          {scans.length > 1 && (
            <div style={{ display: "grid", gap: 10 }}>
              <SectionTitle>Over time</SectionTitle>
              {CHARTS.filter((k) => scans.some((s) => s.metrics[k] !== undefined)).map((k) => (
                <Card key={k} style={{ padding: "14px 14px 10px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{METRIC_BY_KEY[k].label}</span>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{formatMetric(k, latest.metrics[k])}</span>
                  </div>
                  <TrendChart metric={k} points={scans.filter((s) => s.metrics[k] !== undefined).map((s) => ({ at: s.measuredAt, value: s.metrics[k]! }))} height={110} />
                </Card>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gap: 8 }}>
            <SectionTitle>Every scan</SectionTitle>
            {scans.map((s) => (
              <Card key={s.id} style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>{day(s.measuredAt, true)}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {formatMetric("weight", s.metrics.weight)} · {formatMetric("smm", s.metrics.smm)} muscle · {formatMetric("pbf", s.metrics.pbf)} fat
                </span>
              </Card>
            ))}
          </div>
        </>
      )}

      <BodyScanConsent on />
    </div>
  );
}
