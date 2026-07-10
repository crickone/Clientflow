import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getWorkout } from "@/lib/individualWorkouts";
import { listExercises } from "@/lib/exerciseLibrary";
import { WorkoutBuilder } from "@/components/workout/WorkoutBuilder";

export const dynamic = "force-dynamic";

export default async function EditWorkoutPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workout = getWorkout(id);
  if (!workout) notFound();
  return (
    <div className="app-page">
      <WorkoutBuilder initial={workout} exercises={listExercises()} />
    </div>
  );
}
