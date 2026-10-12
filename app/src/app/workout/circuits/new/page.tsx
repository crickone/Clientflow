import { getCurrentMembership, requireUser } from "@/lib/auth";
import { blankCircuit } from "@/lib/workoutModel";
import { listExercises } from "@/lib/exerciseLibrary";
import { CircuitBuilder } from "@/components/workout/CircuitBuilder";

export const dynamic = "force-dynamic";

export default async function NewCircuitPage() {
  await requireUser();
  return (
    <div className="app-page">
      <CircuitBuilder initial={blankCircuit()} exercises={listExercises()} draftKey={`draft:${tenantId()}:circuit:new`} />
    </div>
  );
}

/** Drafts are kept per browser, so the key carries the account: two businesses share a browser. */
function tenantId(): number {
  return getCurrentMembership()?.tenant.id ?? 0;
}
