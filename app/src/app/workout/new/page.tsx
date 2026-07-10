import { requireUser } from "@/lib/auth";
import { blankProgram, type ProgramType } from "@/lib/workoutModel";
import { listExercises } from "@/lib/exerciseLibrary";
import { SimpleBuilder } from "@/components/workout/SimpleBuilder";
import { DetailedBuilder } from "@/components/workout/DetailedBuilder";
import { UploadProgramForm } from "@/components/workout/UploadProgramForm";

export const dynamic = "force-dynamic";

export default async function NewProgramPage({ searchParams }: { searchParams: { type?: string } }) {
  await requireUser();
  const type: ProgramType =
    searchParams.type === "detailed" ? "detailed" : searchParams.type === "upload" ? "upload" : "simple";
  const initial = blankProgram(type);

  if (type === "simple") {
    return (
      <div className="app-page" style={{ maxWidth: 980 }}>
        <SimpleBuilder initial={initial} />
      </div>
    );
  }
  if (type === "upload") {
    return (
      <div className="app-page" style={{ maxWidth: 900 }}>
        <UploadProgramForm initial={initial} />
      </div>
    );
  }
  return (
    <div className="app-page">
      <DetailedBuilder initial={initial} exercises={listExercises()} />
    </div>
  );
}
