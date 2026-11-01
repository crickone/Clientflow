import { CalendarHeart } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { memberCycle } from "@/lib/cycle";
import { PHASE_LABEL, PHASE_NOTE, statusLine } from "@/lib/cycleModel";
import { businessContact } from "@/lib/agreements";
import { Card, dayLabel, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { CycleConsent } from "@/components/clientapp/CycleConsent";
import { DayCheckin, PeriodButtons } from "@/components/clientapp/CycleToday";
import { CycleCalendar } from "@/components/clientapp/CycleCalendar";
import { CycleSettings } from "@/components/clientapp/CycleSettings";

export const dynamic = "force-dynamic";

/**
 * Cycle tracking: where the member is in their cycle today, the period
 * buttons, today's check-in, what to expect in this phase, the calendar, and
 * the sharing and delete controls. Everything is behind the member's own
 * consent; see lib/cycle.ts.
 */
export default async function CyclePage() {
  const { clientId } = requireClientPage();
  const business = businessContact().name;
  const c = memberCycle(clientId);

  if (!c) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PageTitle sub="Your periods, how you feel, and what to expect">Cycle</PageTitle>
        <CycleConsent business={business} />
      </div>
    );
  }

  const tracking = c.settings.mode === "cycle";
  const s = c.status;
  const phase = tracking ? s.phase : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle sub={tracking ? statusLine(s) : "Daily check-ins"}>Cycle</PageTitle>

      {tracking && (
        <Card style={s.onPeriod ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span className="cy-icon"><CalendarHeart size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{phase ? PHASE_LABEL[phase] : "No period logged yet"}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {s.nextStart
                  ? `Next period expected around ${dayLabel(s.nextStart, { weekday: "short", day: "numeric", month: "short" })}${s.cyclesKnown === 0 ? " (based on a 28-day cycle until there's more history)" : ` (your average is ${s.cycleLength} days)`}`
                  : "Log the first day of your period and the app takes it from there."}
              </div>
            </div>
          </div>
          <PeriodButtons onPeriod={s.onPeriod !== null} openStart={s.onPeriod ? null : (c.periods.find((p) => !p.endDay)?.startDay ?? null)} today={c.today} tracking={tracking} />
        </Card>
      )}

      <div>
        <SectionTitle>How are you today?</SectionTitle>
        <Card style={{ padding: "12px 14px" }}>
          <DayCheckin key={c.today} log={c.todayLog} />
        </Card>
      </div>

      {phase && (
        <div>
          <SectionTitle>{PHASE_LABEL[phase]}</SectionTitle>
          <Card>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--text-primary)" }}>{PHASE_NOTE[phase]}</p>
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--text-tertiary)" }}>What&apos;s typical, not a rule. Your own check-ins over a few cycles will show your pattern.</p>
          </Card>
        </div>
      )}

      {tracking && (
        <div>
          <SectionTitle>Calendar</SectionTitle>
          <Card style={{ padding: "12px 14px" }}>
            <CycleCalendar months={c.months} />
          </Card>
        </div>
      )}

      <div>
        <SectionTitle>Privacy and settings</SectionTitle>
        <Card>
          <CycleSettings shareWithCoach={c.settings.shareWithCoach} mode={c.settings.mode} periods={c.periods} onPeriodId={s.onPeriod?.id ?? null} business={business} />
        </Card>
      </div>
    </div>
  );
}
