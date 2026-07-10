import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/layout/PageHeader";
import { db } from "@/lib/db";
import { packageTemplates, therapies } from "@/lib/db/schema";
import { PackageTemplatesEditor } from "@/components/settings/PackageTemplatesEditor";
import { requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function PackageTemplatesPage() {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());
  const items = db.select().from(packageTemplates).all();
  const therapyList = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();

  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="Settings"
        title={`${vocab.plan} types`}
        subtitle={`Define re-usable ${vocab.plan.toLowerCase()} templates so staff can sell them in one click.`}
      />
      <PackageTemplatesEditor items={items} therapies={therapyList} />
    </div>
  );
}
