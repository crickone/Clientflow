import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";

import { PersonProgramEditor } from "@/components/clients/PersonProgramEditor";
import { PageHeader } from "@/components/layout/PageHeader";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { originalTemplate } from "@/lib/programs/coachPrograms";
import { isFullBlock } from "@/lib/programs/editing";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { ENGINE_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function EditPersonProgramPage(props: { params: Promise<{ id: string }> }) {
  // Signs the user in and is null where Programs is off for this business.
  if (!(await currentStaffActor())) notFound();
  const { id } = await props.params;
  const clientId = Number(id);
  if (!Number.isInteger(clientId) || clientId <= 0) notFound();
  const client = db.select({ firstName: clients.firstName, lastName: clients.lastName }).from(clients).where(eq(clients.id, clientId)).get();
  const live = client ? liveEnrolment(clientId) : null;
  if (!client || !live || !live.assignedBy) notFound();
  const first = client.firstName || "the member";
  const fullName = `${client.firstName} ${client.lastName}`.trim();
  const original = originalTemplate(live);
  return (
    <div className="app-page">
      <Link href={`/clients/${clientId}`} className="cp-back">
        <ArrowLeft size={14} /> {fullName}
      </Link>
      <PageHeader
        eyebrow={`Program for ${first}`}
        title={live.template.name}
        subtitle={`Changes apply from ${first}'s next session. Kept exercises keep their weights; training maxes carry over.`}
      />
      <PersonProgramEditor
        clientId={clientId}
        enrolmentId={live.id}
        initial={live.template}
        lifts={original.lifts}
        engineLabel={ENGINE_LABEL[live.template.engine.key]}
        isBlock={live.template.engine.key === "fixed_block"}
        fullBlock={isFullBlock(original)}
      />
    </div>
  );
}
