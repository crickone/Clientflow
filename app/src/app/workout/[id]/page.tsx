import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getProgram } from "@/lib/workout";
import { listExercises } from "@/lib/exerciseLibrary";
import { SimpleBuilder } from "@/components/workout/SimpleBuilder";
import { DetailedBuilder } from "@/components/workout/DetailedBuilder";
import { UploadProgramForm } from "@/components/workout/UploadProgramForm";

export const dynamic = "force-dynamic";

export default async function EditProgramPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const program = getProgram(id);
  if (!program) notFound();

  if (program.type === "simple") {
    return (
      <div className="app-page" style={{ maxWidth: 980 }}>
        <SimpleBuilder initial={program} />
      </div>
    );
  }
  if (program.type === "upload") {
    return (
      <div className="app-page" style={{ maxWidth: 900 }}>
        <UploadProgramForm initial={program} />
      </div>
    );
  }
  return (
    <div className="app-page">
      <DetailedBuilder initial={program} exercises={listExercises()} />
    </div>
  );
}
