import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getPlan } from "@/lib/nutrition";
import { PlanBuilder } from "@/components/nutrition/PlanBuilder";
import { UploadPlanForm } from "@/components/nutrition/UploadPlanForm";

export const dynamic = "force-dynamic";

export default async function EditNutritionPlanPage({ params }: { params: { id: string } }) {
  await requireUser();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const plan = getPlan(id);
  if (!plan) notFound();

  if (plan.type === "upload") {
    return (
      <div className="app-page" style={{ maxWidth: 820 }}>
        <UploadPlanForm initial={plan} />
      </div>
    );
  }
  return (
    <div className="app-page">
      <PlanBuilder initial={plan} />
    </div>
  );
}
