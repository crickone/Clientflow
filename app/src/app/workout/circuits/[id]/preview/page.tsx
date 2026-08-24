import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getCircuit } from "@/lib/circuits";
import { listExercises } from "@/lib/exerciseLibrary";
import { buildExerciseMediaMap } from "@/lib/workoutPreviewMedia";
import { CircuitPreview } from "@/components/workout/CircuitPreview";

export const dynamic = "force-dynamic";

export default async function CircuitPreviewPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const circuit = getCircuit(id);
  if (!circuit) notFound();
  // Keyed by normalized exercise NAME, not id -- see workoutPreviewMedia.ts:
  // the GEL bootstrap renumbers exercise ids, so a name-stable key is the
  // only one immune to it for pre-existing circuit items.
  const media = buildExerciseMediaMap(listExercises());
  return (
    <div className="app-page">
      <CircuitPreview circuit={circuit} media={media} />
    </div>
  );
}
