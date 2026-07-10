import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listExercises } from "@/lib/exerciseLibrary";
import { ExerciseLibraryView } from "@/components/workout/ExerciseLibraryView";

export const dynamic = "force-dynamic";

export default async function ExerciseLibraryPage() {
  await requireUser();
  const exercises = listExercises();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Exercise Library"
        subtitle="Your exercises — name, muscle groups and media, reused when building detailed programs."
      />
      <ExerciseLibraryView exercises={exercises} />
    </div>
  );
}
