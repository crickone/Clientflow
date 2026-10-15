import Link from "next/link";
import { ChevronRight, ScanLine } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { bodyScansEnabled, getScanProfile } from "@/lib/inbody/scans";
import { formatMetric } from "@/lib/inbody/metrics";
import { bodyForGoal, getGoal, getManualBody } from "@/lib/goals";
import { bmrFrom } from "@/lib/goalsModel";
import { Card, PageTitle } from "@/components/clientapp/ui";
import { GoalPicker } from "@/components/clientapp/GoalPicker";
import { BodyForm } from "@/components/clientapp/BodyForm";

export const dynamic = "force-dynamic";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

function ageFrom(dob: string | null): string {
  if (!dob) return "";
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
  return age >= 16 && age <= 100 ? String(age) : "";
}

/**
 * Pick a goal: the numbers it rests on (an InBody scan, or typed in), three
 * options, one choice. Anyone can type their numbers in; a scan takes over
 * when there is one.
 */
export default async function ClientGoalPage({ searchParams }: { searchParams: { edit?: string } }) {
  const { clientId, tenantId, client } = requireClientPage();
  const scansOn = bodyScansEnabled(tenantId);
  const consent = scansOn && getScanProfile(clientId).consentAt !== null;
  const from = bodyForGoal(clientId);
  const bmr = from ? bmrFrom(from.body) : null;
  const current = getGoal(clientId);
  const manual = getManualBody(clientId);
  const editing = searchParams.edit === "1" || !from || !bmr;

  const initial = manual
    ? { weightKg: String(manual.weightKg), heightCm: String(manual.heightCm), age: String(manual.age), sex: manual.sex, pbf: manual.pbf === null ? "" : String(manual.pbf) }
    : { weightKg: "", heightCm: "", age: ageFrom(client.dateOfBirth), sex: "", pbf: "" };

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub="Calories and macros from your numbers">Your goal</PageTitle>
        <Card style={{ padding: 18, display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>{manual ? "Update your numbers" : "Enter your numbers"}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)", marginTop: 4 }}>
              Your weight, height and age give the calories you burn at rest. Add your body fat if you know it and the figure is closer.
            </div>
          </div>
          <BodyForm initial={initial} />
          {from && (
            <Link href="/app/goal" className="gl-edit">
              Keep what I have
            </Link>
          )}
        </Card>
        {scansOn && (
          <Link href="/app/body">
            <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 }}>
                <ScanLine size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Or step on the InBody scanner</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {consent ? "Your next scan replaces these numbers automatically." : "Turn on body scans and your next scan replaces these numbers."}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
            </Card>
          </Link>
        )}
      </div>
    );
  }

  const b = from!.body;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={from!.source === "scan" ? `From your scan on ${day(from!.at)}` : `From the numbers you entered on ${day(from!.at)}`}>Your goal</PageTitle>

      <div className="gl-scan" aria-label="The numbers your goal rests on">
        <div>
          <span>Weight</span>
          <b>{formatMetric("weight", b.weight)}</b>
        </div>
        {from!.source === "scan" ? (
          <div>
            <span>Muscle</span>
            <b>{formatMetric("smm", b.smm)}</b>
          </div>
        ) : (
          <div>
            <span>Height</span>
            <b>{b.heightCm ? `${Math.round(b.heightCm)} cm` : "-"}</b>
          </div>
        )}
        <div>
          <span>Body fat</span>
          <b>{formatMetric("pbf", b.pbf)}</b>
        </div>
        <div>
          <span>At rest</span>
          <b>{bmr!.bmr.toLocaleString("en-IE")} kcal</b>
        </div>
      </div>
      <p className="gl-note">
        {bmr!.source === "scan"
          ? "Your scan measured what you burn at rest."
          : bmr!.source === "lean"
            ? "What you burn at rest is worked out from your lean mass."
            : "What you burn at rest is worked out from your weight, height, age and sex."}{" "}
        Pick how often you train, then the goal you want. Each option shows your calories and macros a day. A guide, not medical advice: ask your coach if you are unsure.
      </p>
      {from!.source === "manual" && (
        <Link href="/app/goal?edit=1" className="gl-edit">
          Update my numbers
        </Link>
      )}

      <GoalPicker metrics={b} current={current ? { goal: current.goal, activity: current.activity } : null} />
    </div>
  );
}
