import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getCircuit } from "@/lib/circuits";
import { listExercises } from "@/lib/exerciseLibrary";
import { CircuitBuilder } from "@/components/workout/CircuitBuilder";

export const dynamic = "force-dynamic";

export default async function EditCircuitPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const circuit = getCircuit(id);
  if (!circuit) notFound();
  return (
    <div className="app-page">
      <CircuitBuilder initial={circuit} exercises={listExercises()} />
    </div>
  );
}
