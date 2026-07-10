import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listFoods, listMeals } from "@/lib/nutritionLibrary";
import { MealsView } from "@/components/nutrition/MealsView";

export const dynamic = "force-dynamic";

export default async function MealsPage() {
  await requireUser();
  const meals = listMeals();
  const foods = listFoods();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Nutrition"
        title="Meals"
        subtitle="Reusable meals built from your foods — drop them into plans in one click."
      />
      <MealsView meals={meals} foods={foods} />
    </div>
  );
}
