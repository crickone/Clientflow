import { notFound } from "next/navigation";

import { getCurrentMembership, requireUser } from "@/lib/auth";
import { getWorkout } from "@/lib/individualWorkouts";
import { listExercises } from "@/lib/exerciseLibrary";
import { WorkoutBuilder } from "@/components/workout/WorkoutBuilder";

export const dynamic = "force-dynamic";

export default async function EditWorkoutPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workout = getWorkout(id);
  if (!workout) notFound();
  return (
    <div className="app-page">
      <WorkoutBuilder initial={workout} exercises={listExercises()} draftKey={`draft:${tenantId()}:workout:${id}`} />
    </div>
  );
}

/** Drafts are kept per browser, so the key carries the account: two businesses share a browser. */
function tenantId(): number {
  return getCurrentMembership()?.tenant.id ?? 0;
}
