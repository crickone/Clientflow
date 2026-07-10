import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listPrograms } from "@/lib/workout";
import { WorkoutProgramsView } from "@/components/workout/WorkoutProgramsView";

export const dynamic = "force-dynamic";

export default async function WorkoutProgramsPage() {
  await requireUser();
  const programs = listPrograms();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Workout Programs"
        subtitle="Build simple or detailed training programs, or upload a document — assign them to clients."
      />
      <WorkoutProgramsView programs={programs} />
    </div>
  );
}
