import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { ClientForm } from "@/components/clients/ClientForm";
import { getClient } from "@/lib/queries";

export default async function EditClientPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const client = await getClient(id);
  if (!client) notFound();
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="People"
        title={`Edit ${client.firstName} ${client.lastName}`}
      />
      <ClientForm client={client} />
    </div>
  );
}
