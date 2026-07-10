import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listFoods } from "@/lib/nutritionLibrary";
import { FoodsView } from "@/components/nutrition/FoodsView";

export const dynamic = "force-dynamic";

export default async function FoodsPage() {
  await requireUser();
  const foods = listFoods();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Nutrition"
        title="Foods"
        subtitle="Your food library — individual foods with per-serving macros, reused across meals and plans."
      />
      <FoodsView foods={foods} />
    </div>
  );
}
