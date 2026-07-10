import { requireUser } from "@/lib/auth";
import { blankPlan, type MacroMode, type PlanType } from "@/lib/nutritionModel";
import { PlanBuilder } from "@/components/nutrition/PlanBuilder";
import { UploadPlanForm } from "@/components/nutrition/UploadPlanForm";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { type?: string; mode?: string };
}

export default async function NewNutritionPlanPage({ searchParams }: Props) {
  await requireUser();

  const type: PlanType =
    searchParams.type === "macro" ? "macro" : searchParams.type === "upload" ? "upload" : "full";
  const macroMode: MacroMode | null =
    type === "macro" ? (searchParams.mode === "daily" ? "daily" : "per_meal") : null;

  const initial = blankPlan(type, macroMode);

  if (type === "upload") {
    return (
      <div className="app-page" style={{ maxWidth: 820 }}>
        <UploadPlanForm initial={initial} />
      </div>
    );
  }
  return (
    <div className="app-page">
      <PlanBuilder initial={initial} />
    </div>
  );
}
