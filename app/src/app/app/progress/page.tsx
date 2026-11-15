import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, signed } from "@/lib/trainingProgress";
import { connectionsFor, recentDays } from "@/lib/wearables/store";
import { PROVIDER_NAME } from "@/lib/wearables/model";
import { WearableSummary } from "@/components/clientapp/WearableSummary";
import { formatSet } from "@/lib/workoutLogModel";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { formatChange, formatMetric, METRIC_BY_KEY, type MetricKey } from "@/lib/inbody/metrics";
import { memberSeesPrograms } from "@/lib/programs/access";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { programProgress, type ProgramProgressData } from "@/lib/programs/progressData";
import { PkCard, PkHeader, PkSection, QuietRow, StatStrip } from "@/components/clientapp/programs/kit";
import { ProgramProgress } from "@/components/clientapp/programs/ProgramProgress";
import { TrendChart } from "@/components/bodyscans/TrendChart";
import { WeekBars } from "@/components/progress/WeekBars";
import { Sparkline } from "@/components/progress/Sparkline";

export const dynamic = "force-dynamic";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

const BODY_LABEL: Record<string, string> = { smm: "Muscle", pbf: "Body fat", weight: "Weight" };

/** Progress: a running program's path first, then strength, weeks, lifts, body scans and wearables. An empty section is one quiet row. */
export default async function ProgressPage() {
  const { clientId, client, tenantId } = requireClientPage();
  const t = trainingOverview(clientId);

  // Only an active program shows here; a paused one (coach guided) does not.
  const live = memberSeesPrograms({ tenantId, client, clientId }) ? liveEnrolment(clientId) : null;
  const view = live && live.status === "active" ? live : null;
  // A row that will not read must never take the page down: log it and leave the program section out.
  let progress: ProgramProgressData | null = null;
  if (view) {
    try {
      progress = programProgress(view);
    } catch (e) {
      console.error("[progress] program progress failed", view.id, e);
    }
  }

  const scansOn = bodyScansEnabled(tenantId);
  const consent = scansOn && getScanProfile(clientId).consentAt !== null;
  const scans = consent ? listClientScans(clientId).filter((s) => Object.keys(s.metrics).length > 0) : [];
  const latestScan = scans[0];
  const firstScan = scans[scans.length - 1];
  const bodyKeys = (["smm", "pbf", "weight"] as MetricKey[]).filter((k) => latestScan?.metrics[k] !== undefined);

  const strengthNow = t.strength.length ? t.strength[t.strength.length - 1].value : null;
  const tracked = t.lifts.filter((l) => l.sessions > 1);
  const hasStrength = t.strength.length > 1 && tracked.length > 0;
  const hasWeeks = t.weeks.some((w) => w.workouts > 0);
  const devices = connectionsFor(tenantId, clientId);

  // No zero tiles: a number shows only when it is above zero, and the strip only when a workout is logged.
  const strip: { label: string; value: string; sub?: string }[] = [];
  if (t.totalWorkouts > 0) {
    if (strengthNow !== null && tracked.length > 0) strip.push({ label: "Strength", value: signed(strengthNow, "%"), sub: `across ${tracked.length} lift${tracked.length === 1 ? "" : "s"}` });
    if (t.streak > 0) strip.push({ label: "Streak", value: String(t.streak), sub: t.streak === 1 ? "week" : "weeks" });
    if (t.workouts30 > 0) strip.push({ label: "Last 30 days", value: String(t.workouts30), sub: t.workouts30 === 1 ? "workout" : "workouts" });
  }

  return (
    <div className="pk">
      <PkHeader title="Progress" lead={t.totalWorkouts ? `${t.totalWorkouts} workout${t.totalWorkouts === 1 ? "" : "s"} logged` : undefined} />

      {view && progress && (
        <PkSection label="Your program">
          <ProgramProgress data={progress} />
          <QuietRow href="/app/programs/mine" label="See your program" icon="chevron" />
        </PkSection>
      )}

      {strip.length > 0 && <StatStrip items={strip} />}

      {hasStrength ? (
        <PkCard>
          <div className="pk-row">
            <b style={{ fontSize: 15, color: "var(--text-primary)" }}>Strength</b>
            {strengthNow !== null && <b style={{ fontSize: 17, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{signed(strengthNow, "%")}</b>}
          </div>
          <TrendChart label="Strength" unit="%" points={t.strength} height={120} />
          <span className="pk-small">The average rise in your estimated one-rep max on each lift since you first logged it.</span>
        </PkCard>
      ) : (
        <QuietRow href="/app/workouts" label="Log a lift twice to see your strength trend" icon="chevron" />
      )}

      {hasWeeks ? (
        <PkSection label="Workouts each week">
          <WeekBars label="Workouts each week" weeks={t.weeks.map((w) => ({ weekStart: w.weekStart, value: w.workouts }))} />
          <span className="pk-small">Last 12 weeks</span>
        </PkSection>
      ) : (
        <QuietRow href="/app/workouts" label="Log a workout to see your weeks" icon="chevron" />
      )}

      {t.lifts.length === 0 ? (
        <QuietRow href="/app/workouts" label="Log a workout with weights to see your lifts" icon="chevron" />
      ) : (
        <PkSection label="Lifts">
          {t.lifts.map((l) => (
            <Link key={l.key} href={`/app/workouts/progress/${encodeURIComponent(l.key)}`} className="pk-linkrow" style={{ borderBottom: "1px solid var(--hairline)", padding: "6px 0" }}>
              <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                <span className="pk-small" style={{ fontVariantNumeric: "tabular-nums" }}>
                  Best {formatSet(l.best)}
                  {l.sessions > 1 && l.change.kg !== 0 ? ` · ${signed(l.change.kg, " kg")} est. max` : ""}
                </span>
              </div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <Sparkline values={l.points.map((p) => p.e1rm)} />
                <ChevronRight size={16} className="pk-chev" aria-hidden />
              </span>
            </Link>
          ))}
        </PkSection>
      )}

      {scansOn &&
        (!consent ? (
          <QuietRow href="/app/body" label="Add your InBody scans" icon="chevron" />
        ) : !latestScan ? (
          <QuietRow label="No InBody scans yet. Step on the scanner next time you’re in and your muscle and body fat will show here." />
        ) : (
          <PkSection label="Body">
            {bodyKeys.length > 0 && (
              <StatStrip
                items={bodyKeys.map((k) => {
                  const ch = firstScan !== latestScan ? formatChange(k, latestScan.metrics[k], firstScan.metrics[k]) : null;
                  return { label: BODY_LABEL[k], value: formatMetric(k, latestScan.metrics[k]), sub: ch?.text };
                })}
              />
            )}
            {firstScan !== latestScan && <span className="pk-small">Changes since your first scan on {day(firstScan.measuredAt)}.</span>}
            {scans.length > 1 &&
              (["smm", "pbf"] as MetricKey[])
                .filter((k) => scans.filter((s) => s.metrics[k] !== undefined).length > 1)
                .map((k) => (
                  <div key={k} style={{ display: "grid", gap: 6 }}>
                    <div className="pk-row">
                      <span className="pk-muted">{METRIC_BY_KEY[k].label}</span>
                      <b style={{ fontSize: 15, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatMetric(k, latestScan.metrics[k])}</b>
                    </div>
                    <TrendChart metric={k} points={scans.filter((s) => s.metrics[k] !== undefined).map((s) => ({ at: s.measuredAt, value: s.metrics[k]! }))} height={100} />
                  </div>
                ))}
            <QuietRow href="/app/body" label="Every scan" icon="chevron" />
          </PkSection>
        ))}

      {devices.length > 0 && (
        <PkSection label={`From your ${devices.length === 1 ? PROVIDER_NAME[devices[0].provider] : "devices"}`}>
          <WearableSummary days={recentDays(tenantId, clientId, 14)} today={dateKey(Date.now())} />
        </PkSection>
      )}
    </div>
  );
}
