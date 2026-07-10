import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listPlans } from "@/lib/nutrition";
import { NutritionPlansView } from "@/components/nutrition/NutritionPlansView";

export const dynamic = "force-dynamic";

export default async function NutritionPlansPage() {
  await requireUser();
  const plans = listPlans();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Nutrition"
        title="Nutrition plans"
        subtitle="Build full meal plans, macro targets, or upload a document — assign them to clients."
      />
      <NutritionPlansView plans={plans} />
    </div>
  );
}
