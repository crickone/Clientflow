// app/src/app/app/programs/built/[id]/start/page.tsx
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey, validateMemberTemplate } from "@/lib/programs/memberTemplate";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { Card, PageTitle } from "@/components/clientapp/ui";
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";

export const dynamic = "force-dynamic";

/** Start one of the member's own programs: a max only for the lifts its percent exercises use. */
export default async function StartBuiltProgramPage(props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const p = getMemberProgram(clientId, id);
  if (!p) notFound();
  if (liveEnrolment(clientId)) redirect("/app/programs/mine");
  const check = validateMemberTemplate(p.template, memberKey(id));
  if (!check.ok) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub={p.name}>Start program</PageTitle>
        <Card style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Fix these before you start</div>
          {check.errors.map((e) => (
            <div key={e} style={{ fontSize: 13.5, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>
              {e}
            </div>
          ))}
        </Card>
      </div>
    );
  }
  const t = check.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null, keptKg: p.maxes[lift] ?? null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={t.name}>Start program</PageTitle>
      <StartProgramForm
        programKey={memberKey(id)}
        tmPct={1}
        lifts={lifts}
        initialUnit={unit}
        initialStep={keyFromStep(client.plateStepKg)}
        defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
        today={dateKey(Date.now())}
      />
    </div>
  );
}
