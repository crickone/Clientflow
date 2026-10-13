import { redirect } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { getTrainingPlanRow, trainingOverview } from "@/lib/trainingOverview";
import { Card, PageTitle } from "@/components/clientapp/ui";
import { TrainingDaysForm } from "@/components/clientapp/TrainingDaysForm";

export const dynamic = "force-dynamic";

export default async function TrainingDaysPage() {
  const { clientId } = requireClientPage();
  const { programs } = trainingOverview(clientId);
  if (programs.length === 0) redirect("/app/workouts");
  const row = getTrainingPlanRow(clientId);
  const programId = programs.some((p) => p.id === row.programId) ? row.programId! : programs[0].id;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Your week, planned around your programme">Training days</PageTitle>
      <Card style={{ padding: 18 }}>
        <TrainingDaysForm programs={programs} initialProgramId={programId} initialWeekdays={row.programId === programId ? row.weekdays : []} />
      </Card>
    </div>
  );
}
