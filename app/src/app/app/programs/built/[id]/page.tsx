// app/src/app/app/programs/built/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey } from "@/lib/programs/memberTemplate";
import { PkHeader } from "@/components/clientapp/programs/kit";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

export default async function EditBuiltProgramPage(props: { params: Promise<{ id: string }> }) {
  const { id: raw } = await props.params;
  const { clientId, client } = requireProgramsPage();
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const p = getMemberProgram(clientId, id);
  if (!p) notFound();
  const live = liveEnrolment(clientId);
  const running = !!live && live.programKey === memberKey(id);
  const unit = client.weightUnit === "lb" ? "lb" : "kg";
  return (
    <div className="pk">
      <PkHeader title={p.name} lead={running ? "You're running this program." : "Your own program."}>
        <div className="pk-actions">
          <Link href={`/app/programs/${encodeURIComponent(memberKey(id))}`} className="pk-btn">
            See the program
          </Link>
          {!live && (
            <Link href={`/app/programs/built/${id}/start`} className="pk-btn">
              Start this program
            </Link>
          )}
        </div>
      </PkHeader>
      <MemberProgramBuilder
        id={id}
        from={null}
        initial={p.template}
        initialUnit={unit}
        stepKg={running && live ? live.stepKg : client.plateStepKg}
        running={running}
        current={running && live ? live.state.weights : {}}
      />
    </div>
  );
}
