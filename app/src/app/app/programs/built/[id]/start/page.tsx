// app/src/app/app/programs/built/[id]/start/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { defaultWeekdays } from "@/lib/programs/cards";
import { bestLoggedSet, liveEnrolment, planContextFor } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey, validateMemberTemplate } from "@/lib/programs/memberTemplate";
import { LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";
import { PkHeader } from "@/components/clientapp/programs/kit";
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
      <div className="pk">
        <PkHeader title="Start program" lead={p.name} />
        <div className="pk-error" role="alert">
          <b>Fix these before you start</b>
          <ul>
            {check.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
        <Link href={`/app/programs/built/${id}`} className="pk-btn">
          Edit program
        </Link>
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
    <StartProgramForm
      programKey={memberKey(id)}
      programName={t.name}
      template={t}
      extra={planContextFor(clientId, t)}
      lifts={lifts}
      initialUnit={unit}
      initialStep={keyFromStep(client.plateStepKg)}
      defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
      today={dateKey(Date.now())}
      backHref={`/app/programs/${encodeURIComponent(memberKey(id))}`}
    />
  );
}
