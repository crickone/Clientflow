// app/src/app/app/programs/[key]/start/page.tsx
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { PageTitle } from "@/components/clientapp/ui";
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";

export const dynamic = "force-dynamic";

export default async function StartProgramPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const entry = programByKey(decodeURIComponent(key));
  if (!entry) notFound();
  if (liveEnrolment(clientId)) redirect("/app/programs/mine");
  const t = entry.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(clientId, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null };
  });
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={t.name}>Start program</PageTitle>
      <StartProgramForm
        programKey={t.key}
        tmPct={t.tmPct}
        lifts={lifts}
        initialUnit={unit}
        initialStep={keyFromStep(client.plateStepKg)}
        defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
        today={dateKey(Date.now())}
      />
    </div>
  );
}
