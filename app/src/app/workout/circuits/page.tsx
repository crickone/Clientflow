import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listCircuits } from "@/lib/circuits";
import { CircuitsView } from "@/components/workout/CircuitsView";

export const dynamic = "force-dynamic";

export default async function CircuitsPage() {
  await requireUser();
  const circuits = listCircuits();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Circuits"
        subtitle="Round-based circuits — a list of exercises run for N rounds with rest between."
      />
      <CircuitsView circuits={circuits} />
    </div>
  );
}
