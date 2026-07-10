import { requireUser } from "@/lib/auth";
import { blankWorkout } from "@/lib/workoutModel";
import { listExercises } from "@/lib/exerciseLibrary";
import { WorkoutBuilder } from "@/components/workout/WorkoutBuilder";

export const dynamic = "force-dynamic";

export default async function NewWorkoutPage() {
  await requireUser();
  return (
    <div className="app-page">
      <WorkoutBuilder initial={blankWorkout()} exercises={listExercises()} />
    </div>
  );
}
