import { notFound } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedWorkoutProgramDetail } from "@/lib/clientApp";
import { listExercises } from "@/lib/exerciseLibrary";
import { buildExerciseMediaMap } from "@/lib/workoutPreviewMedia";
import { WorkoutProgramDetail } from "@/components/clientapp/WorkoutProgramDetail";

export const dynamic = "force-dynamic";

export default async function ClientWorkoutProgramPage({ params }: { params: { id: string } }) {
  const { clientId } = requireClientPage();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // assignedWorkoutProgramDetail IS the ownership check (an inner join
  // against this client's own client_workout_programs rows) — null means
  // "not assigned to this client" just as much as "no such program", and
  // both render the same not-found. A client can never open another
  // client's program, or an unassigned one, by guessing an id.
  const program = assignedWorkoutProgramDetail(clientId, id);
  if (!program) notFound();

  // Exercise thumbnails, same lookup the admin preview uses — only needed
  // for "detailed" programs (the only type with exercise rows to enrich).
  const media = program.type === "detailed" ? buildExerciseMediaMap(listExercises()) : {};

  return <WorkoutProgramDetail program={program} media={media} />;
}
