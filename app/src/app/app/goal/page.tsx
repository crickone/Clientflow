import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ScanLine } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { bodyScansEnabled, getScanProfile } from "@/lib/inbody/scans";
import { formatMetric } from "@/lib/inbody/metrics";
import { getGoal, latestScanForGoal } from "@/lib/goals";
import { bmrFrom } from "@/lib/goalsModel";
import { Card, PageTitle } from "@/components/clientapp/ui";
import { GoalPicker } from "@/components/clientapp/GoalPicker";

export const dynamic = "force-dynamic";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** Pick a goal from the latest InBody scan: the numbers it rests on, three options, one choice. */
export default async function ClientGoalPage() {
  const { clientId, tenantId } = requireClientPage();
  if (!bodyScansEnabled(tenantId)) redirect("/app/nutrition");
  const consent = getScanProfile(clientId).consentAt !== null;
  const scan = consent ? latestScanForGoal(clientId) : null;
  const bmr = scan ? bmrFrom(scan.metrics) : null;
  const current = getGoal(clientId);

  if (!scan || !bmr) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub="Calories and macros from your InBody scan">Your goal</PageTitle>
        <Card style={{ padding: 20, display: "grid", gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)" }}>
            <ScanLine size={22} />
          </span>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>{consent ? "Your first scan sets your goal" : "Turn on body scans first"}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            {consent
              ? "Next time you are in, step on the InBody scanner. Your scan gives the numbers behind each goal: drop body fat, maintain, or build muscle."
              : "Your goal is worked out from your InBody scan. Turn on scans in the app and step on the scanner next time you are in."}
          </div>
          <Link href="/app/body" className="gl-go">
            Body scans <ChevronRight size={16} />
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={`From your scan on ${day(scan.measuredAt)}`}>Your goal</PageTitle>

      <div className="gl-scan" aria-label="The numbers your goal rests on">
        <div>
          <span>Weight</span>
          <b>{formatMetric("weight", scan.metrics.weight)}</b>
        </div>
        <div>
          <span>Muscle</span>
          <b>{formatMetric("smm", scan.metrics.smm)}</b>
        </div>
        <div>
          <span>Body fat</span>
          <b>{formatMetric("pbf", scan.metrics.pbf)}</b>
        </div>
        <div>
          <span>At rest</span>
          <b>{bmr.bmr.toLocaleString("en-IE")} kcal</b>
        </div>
      </div>
      <p className="gl-note">
        {bmr.source === "scan" ? "Your scan measured what you burn at rest." : "What you burn at rest is worked out from your lean mass."} Pick how often you train, then the goal you want. Each
        option shows your calories and macros a day. A guide, not medical advice: ask your coach if you are unsure.
      </p>

      <GoalPicker metrics={scan.metrics} current={current ? { goal: current.goal, activity: current.activity } : null} />
    </div>
  );
}
