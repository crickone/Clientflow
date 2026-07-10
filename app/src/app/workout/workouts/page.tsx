import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listWorkouts } from "@/lib/individualWorkouts";
import { WorkoutsView } from "@/components/workout/WorkoutsView";

export const dynamic = "force-dynamic";

export default async function WorkoutsPage() {
  await requireUser();
  const workouts = listWorkouts();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Workouts"
        subtitle="Single reusable workouts — warm up, workout and cool down. Build once, drop into programs."
      />
      <WorkoutsView workouts={workouts} />
    </div>
  );
}
