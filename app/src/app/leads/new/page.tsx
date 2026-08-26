import { db } from "@/lib/db";
import { therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/layout/PageHeader";
import { NewLeadForm } from "@/components/leads/NewLeadForm";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default function NewLeadPage() {
  const vocab = getVocab(getVenueType());
  const therapyList = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Pipeline"
        title="Add lead"
        subtitle="Use this for walk-up enquiries or to manually enter leads from elsewhere."
      />
      <NewLeadForm
        serviceLabel={vocab.service}
        therapyOptions={therapyList.map((t) => ({ id: t.id, name: t.name }))}
      />
    </div>
  );
}
