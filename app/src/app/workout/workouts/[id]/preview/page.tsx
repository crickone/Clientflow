import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getWorkout } from "@/lib/individualWorkouts";
import { listExercises } from "@/lib/exerciseLibrary";
import { buildExerciseMediaMap } from "@/lib/workoutPreviewMedia";
import { WorkoutPreview } from "@/components/workout/WorkoutPreview";

export const dynamic = "force-dynamic";

export default async function WorkoutPreviewPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workout = getWorkout(id);
  if (!workout) notFound();
  // Keyed by normalized exercise NAME, not id -- see workoutPreviewMedia.ts:
  // the GEL bootstrap renumbers exercise ids, so a name-stable key is the
  // only one immune to it for pre-existing workout items.
  const media = buildExerciseMediaMap(listExercises());
  return (
    <div className="app-page">
      <WorkoutPreview workout={workout} media={media} />
    </div>
  );
}
