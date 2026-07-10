import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getCircuit } from "@/lib/circuits";
import { listExercises } from "@/lib/exerciseLibrary";
import { CircuitPreview } from "@/components/workout/CircuitPreview";

export const dynamic = "force-dynamic";

export default async function CircuitPreviewPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const circuit = getCircuit(id);
  if (!circuit) notFound();
  const media = Object.fromEntries(listExercises().map((e) => [e.id, e.imageUrl] as const)) as Record<number, string | null>;
  return (
    <div className="app-page">
      <CircuitPreview circuit={circuit} media={media} />
    </div>
  );
}
