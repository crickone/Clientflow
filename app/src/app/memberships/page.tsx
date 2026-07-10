import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import {
  listAssignableClients,
  listMemberships,
  listPurchased,
} from "@/lib/memberships";
import { todayIso } from "@/lib/timetable";
import { MembershipsView } from "@/components/memberships/MembershipsView";

export const dynamic = "force-dynamic";

export default async function MembershipsPage() {
  await requireUser();

  const catalog = listMemberships();
  const purchased = listPurchased({});
  const clients = listAssignableClients().map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName ?? ""}`.trim(),
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Products"
        title="Memberships"
        subtitle="Recurring plans your clients subscribe to."
      />
      <MembershipsView
        catalog={catalog}
        purchased={purchased}
        clients={clients}
        today={todayIso()}
      />
    </div>
  );
}
