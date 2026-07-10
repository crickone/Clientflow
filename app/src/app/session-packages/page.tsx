import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import {
  listAssignableClients,
  listPackagePlans,
  listPurchasedPackages,
} from "@/lib/sessionPackages";
import { todayIso } from "@/lib/timetable";
import { PackagesView } from "@/components/packages/PackagesView";

export const dynamic = "force-dynamic";

export default async function SessionPackagesPage() {
  await requireUser();

  const catalog = listPackagePlans();
  const purchased = listPurchasedPackages({});
  const clients = listAssignableClients().map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Products"
        title="Packages"
        subtitle="Prepaid session-credit bundles clients buy and draw down."
      />
      <PackagesView catalog={catalog} purchased={purchased} clients={clients} today={todayIso()} />
    </div>
  );
}
