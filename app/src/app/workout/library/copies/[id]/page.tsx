import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import { isFullBlock } from "@/lib/programs/editing";
import { getCopy } from "@/lib/programs/library";
import { platformProgram } from "@/lib/programs/registry";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { ENGINE_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramCopyPage(props: { params: Promise<{ id: string }> }) {
  // Signs the user in and is null where Programs is off for this business.
  if (!(await currentStaffActor())) notFound();
  const { id } = await props.params;
  const n = Number(id);
  const copy = Number.isInteger(n) && n > 0 ? getCopy(n) : null;
  if (!copy) notFound();
  const original = platformProgram(copy.basedOn);
  return (
    <div className="app-page">
      <Link href="/workout/library" className="cp-back">
        <ArrowLeft size={14} /> Program library
      </Link>
      <PageHeader
        eyebrow={`Our version, based on ${copy.basedOnName}`}
        title={copy.name}
        subtitle="Change exercises, sets, reps, percentages, RPE, rest and notes, and add or remove days and weeks. Members already running it keep the version they started."
      />
      <ProgramCopyEditor
        id={copy.id}
        initial={copy.template}
        lifts={original?.lifts ?? copy.template.lifts}
        engineLabel={ENGINE_LABEL[copy.template.engine.key]}
        isBlock={copy.template.engine.key === "fixed_block"}
        fullBlock={isFullBlock(original ?? copy.template)}
      />
    </div>
  );
}
