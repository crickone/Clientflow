import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentTenant } from "@/lib/db/tenant";
import { programsOn } from "@/lib/programs/access";
import { ClientForm } from "@/components/clients/ClientForm";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default function NewClientPage() {
  const vocab = getVocab(getVenueType());
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="People"
        title={`New ${vocab.member.toLowerCase()}`}
        subtitle={`Add a new ${vocab.member.toLowerCase()} to the practice.`}
      />
      <ClientForm showTrainingMode={programsOn(getCurrentTenant().id)} />
    </div>
  );
}
