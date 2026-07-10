import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getWorkout } from "@/lib/individualWorkouts";
import { listExercises } from "@/lib/exerciseLibrary";
import { WorkoutPreview } from "@/components/workout/WorkoutPreview";

export const dynamic = "force-dynamic";

export default async function WorkoutPreviewPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const workout = getWorkout(id);
  if (!workout) notFound();
  const media = Object.fromEntries(
    listExercises().map((e) => [e.id, e.imageUrl] as const),
  ) as Record<number, string | null>;
  return (
    <div className="app-page">
      <WorkoutPreview workout={workout} media={media} />
    </div>
  );
}
