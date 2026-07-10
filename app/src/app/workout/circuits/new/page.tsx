import { requireUser } from "@/lib/auth";
import { blankCircuit } from "@/lib/workoutModel";
import { listExercises } from "@/lib/exerciseLibrary";
import { CircuitBuilder } from "@/components/workout/CircuitBuilder";

export const dynamic = "force-dynamic";

export default async function NewCircuitPage() {
  await requireUser();
  return (
    <div className="app-page">
      <CircuitBuilder initial={blankCircuit()} exercises={listExercises()} />
    </div>
  );
}
