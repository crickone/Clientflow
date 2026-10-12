import { getCurrentMembership, requireUser } from "@/lib/auth";
import { blankWorkout } from "@/lib/workoutModel";
import { listExercises } from "@/lib/exerciseLibrary";
import { WorkoutBuilder } from "@/components/workout/WorkoutBuilder";

export const dynamic = "force-dynamic";

export default async function NewWorkoutPage() {
  await requireUser();
  return (
    <div className="app-page">
      <WorkoutBuilder initial={blankWorkout()} exercises={listExercises()} draftKey={`draft:${tenantId()}:workout:new`} />
    </div>
  );
}

/** Drafts are kept per browser, so the key carries the account: two businesses share a browser. */
function tenantId(): number {
  return getCurrentMembership()?.tenant.id ?? 0;
}
