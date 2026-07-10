import { PageHeader } from "@/components/layout/PageHeader";
import { SellPackageForm } from "@/components/packages/SellPackageForm";
import { db } from "@/lib/db";
import { clients, packageTemplates, therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default function NewPackagePage({
  searchParams,
}: {
  searchParams: { client?: string };
}) {
  const vocab = getVocab(getVenueType());
  const therapyList = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();
  const clientList = db.select().from(clients).all();
  const templates = db
    .select()
    .from(packageTemplates)
    .where(eq(packageTemplates.isActive, true))
    .all();
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader eyebrow={vocab.plans} title={`Sell ${vocab.plan.toLowerCase()}`} />
      <SellPackageForm
        clients={clientList}
        therapies={therapyList}
        templates={templates}
        defaultClientId={searchParams.client ? Number(searchParams.client) : undefined}
      />
    </div>
  );
}
