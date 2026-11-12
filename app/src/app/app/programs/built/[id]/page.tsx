// app/src/app/app/programs/built/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey } from "@/lib/programs/memberTemplate";
import { PageTitle } from "@/components/clientapp/ui";
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={running ? "You're running this program" : "Your own program"}>{p.name}</PageTitle>
      {!live && (
        <Link href={`/app/programs/built/${id}/start`} className="pg-cta">
          Start this program
        </Link>
      )}
      <MemberProgramBuilder id={id} from={null} initial={p.template} initialUnit={unit} running={running} current={running && live ? live.state.weights : {}} />
    </div>
  );
}
