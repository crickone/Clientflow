import { notFound } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedNutritionPlanDetail } from "@/lib/clientApp";
import { NutritionPlanDetail } from "@/components/clientapp/NutritionPlanDetail";

export const dynamic = "force-dynamic";

export default async function ClientNutritionPlanPage({ params }: { params: { id: string } }) {
  const { clientId } = requireClientPage();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  // assignedNutritionPlanDetail IS the ownership check (an inner join against
  // this client's own client_nutrition_plans rows) — null means "not assigned
  // to this client" just as much as "no such plan", and both render the same
  // not-found. A client can never open another client's plan, or an
  // unassigned one, by guessing an id.
  const plan = assignedNutritionPlanDetail(clientId, id);
  if (!plan) notFound();

  return <NutritionPlanDetail plan={plan} />;
}
