import Link from "next/link";
import { ChevronRight, ScanLine } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, signed } from "@/lib/trainingProgress";
import { connectionsFor, recentDays } from "@/lib/wearables/store";
import { PROVIDER_NAME } from "@/lib/wearables/model";
import { WearableSummary } from "@/components/clientapp/WearableSummary";
import { formatSet } from "@/lib/workoutLogModel";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { formatChange, formatMetric, METRIC_BY_KEY, type MetricKey } from "@/lib/inbody/metrics";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { TrendChart } from "@/components/bodyscans/TrendChart";
import { WeekBars } from "@/components/progress/WeekBars";
import { Sparkline } from "@/components/progress/Sparkline";

export const dynamic = "force-dynamic";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

const TONE: Record<string, string> = { good: "var(--success)", bad: "var(--attn-ink, var(--text-secondary))", flat: "var(--text-tertiary)" };

export default async function ProgressPage() {
  const { clientId, tenantId } = requireClientPage();
  const t = trainingOverview(clientId);

  const scansOn = bodyScansEnabled(tenantId);
  const consent = scansOn && getScanProfile(clientId).consentAt !== null;
  const scans = consent ? listClientScans(clientId).filter((s) => Object.keys(s.metrics).length > 0) : [];
  const latestScan = scans[0];
  const firstScan = scans[scans.length - 1];
  const bodyKeys: MetricKey[] = ["smm", "pbf", "weight"];

  const strengthNow = t.strength.length ? t.strength[t.strength.length - 1].value : null;
  const tracked = t.lifts.filter((l) => l.sessions > 1);
  const thisWeek = t.weeks[t.weeks.length - 1];
  const devices = connectionsFor(tenantId, clientId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle sub={t.totalWorkouts ? `${t.totalWorkouts} workout${t.totalWorkouts === 1 ? "" : "s"} logged` : "Your strength and body, over time"}>Progress</PageTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Tile label="Strength" value={strengthNow !== null && tracked.length ? signed(strengthNow, "%") : "-"} note={tracked.length ? `across ${tracked.length} lift${tracked.length === 1 ? "" : "s"}` : "log a lift twice"} tone={strengthNow && strengthNow > 0 ? "good" : "flat"} />
        <Tile label="Week streak" value={String(t.streak)} note={t.streak === 1 ? "week in a row" : "weeks in a row"} />
        <Tile label="Last 30 days" value={String(t.workouts30)} note={t.workouts30 === 1 ? "workout" : "workouts"} />
        {latestScan && firstScan && latestScan !== firstScan ? (
          <Tile
            label="Body fat"
            value={formatChange("pbf", latestScan.metrics.pbf, firstScan.metrics.pbf)?.text ?? "-"}
            note={`since ${day(firstScan.measuredAt)}`}
            tone={formatChange("pbf", latestScan.metrics.pbf, firstScan.metrics.pbf)?.tone}
          />
        ) : (
          <Tile label="This week" value={String(thisWeek?.workouts ?? 0)} note={thisWeek?.volume ? `${thisWeek.volume.toLocaleString("en-IE")} kg lifted` : "workouts"} />
        )}
      </div>

      <Card style={{ padding: "14px 14px 10px", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>Strength</span>
          {strengthNow !== null && tracked.length > 0 && <span style={{ fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{signed(strengthNow, "%")}</span>}
        </div>
        {t.strength.length > 1 && tracked.length > 0 ? (
          <>
            <TrendChart label="Strength" unit="%" points={t.strength} height={120} />
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-tertiary)" }}>
              The average rise in your estimated one-rep max on each lift since you first logged it.
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            Log the same lifts over a few weeks and this line shows how much stronger you are getting.
          </div>
        )}
      </Card>

      <Card style={{ padding: "14px 14px 10px", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>Workouts each week</span>
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Last 12 weeks</span>
        </div>
        <WeekBars label="Workouts each week" weeks={t.weeks.map((w) => ({ weekStart: w.weekStart, value: w.workouts }))} />
      </Card>

      {devices.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          <SectionTitle>From your {devices.length === 1 ? PROVIDER_NAME[devices[0].provider] : "devices"}</SectionTitle>
          <Card>
            <WearableSummary days={recentDays(tenantId, clientId, 14)} today={dateKey(Date.now())} />
          </Card>
        </div>
      )}

      {scansOn && (
        <div style={{ display: "grid", gap: 10 }}>
          <SectionTitle>Body</SectionTitle>
          {!consent ? (
            <Link href="/app/body">
              <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={iconBox}><ScanLine size={18} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Add your InBody scans</div>
                  <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>See your muscle and body fat next to your strength</div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
              </Card>
            </Link>
          ) : !latestScan ? (
            <Card>
              <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                No InBody scans yet. Step on the scanner next time you&rsquo;re in and your muscle and body fat will show here.
              </div>
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {bodyKeys.map((k) => {
                  const ch = firstScan !== latestScan ? formatChange(k, latestScan.metrics[k], firstScan.metrics[k]) : null;
                  return (
                    <Card key={k} style={{ padding: 12, display: "grid", gap: 3 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{k === "smm" ? "Muscle" : k === "pbf" ? "Body fat" : "Weight"}</span>
                      <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatMetric(k, latestScan.metrics[k])}</span>
                      {ch && <span style={{ fontSize: 11.5, fontWeight: 500, color: TONE[ch.tone] }}>{ch.text}</span>}
                    </Card>
                  );
                })}
              </div>
              {firstScan !== latestScan && (
                <div style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "-4px 2px 0" }}>Changes since your first scan on {day(firstScan.measuredAt)}.</div>
              )}
              {scans.length > 1 &&
                (["smm", "pbf"] as MetricKey[])
                  .filter((k) => scans.filter((s) => s.metrics[k] !== undefined).length > 1)
                  .map((k) => (
                    <Card key={k} style={{ padding: "14px 14px 10px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{METRIC_BY_KEY[k].label}</span>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{formatMetric(k, latestScan.metrics[k])}</span>
                      </div>
                      <TrendChart metric={k} points={scans.filter((s) => s.metrics[k] !== undefined).map((s) => ({ at: s.measuredAt, value: s.metrics[k]! }))} height={100} />
                    </Card>
                  ))}
              <Link href="/app/body" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-ink)", fontSize: 13.5, padding: "2px 2px" }}>
                Every scan <ChevronRight size={15} />
              </Link>
            </>
          )}
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <SectionTitle>Lifts</SectionTitle>
        {t.lifts.length === 0 ? (
          <Card>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>Log a workout with weights and each lift shows here with its best set.</div>
          </Card>
        ) : (
          t.lifts.map((l) => (
            <Link key={l.key} href={`/app/workouts/progress/${encodeURIComponent(l.key)}`}>
              <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                    Best {formatSet(l.best)}
                    {l.sessions > 1 && l.change.kg !== 0 ? ` · ${signed(l.change.kg, " kg")} est. max` : ""}
                  </span>
                </div>
                <Sparkline values={l.points.map((p) => p.e1rm)} />
                <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "good" | "bad" | "flat" }) {
  return (
    <Card style={{ padding: 14, display: "grid", gap: 3 }}>
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, color: tone === "good" ? "var(--success)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{note}</span>
    </Card>
  );
}

const iconBox: React.CSSProperties = { width: 36, height: 36, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 };
