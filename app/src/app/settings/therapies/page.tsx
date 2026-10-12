import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { therapies } from "@/lib/db/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import { TherapyList } from "@/components/settings/TherapyEditor";
import { requireAdminPage } from "@/lib/auth";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function TherapiesSettingsPage() {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());
  const items = db.select().from(therapies).all();
  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow="Settings"
        title={vocab.services}
        subtitle={`Edit the ${vocab.services.toLowerCase()} you offer. Inactive ${vocab.services.toLowerCase()} don't appear in the ${vocab.booking.toLowerCase()} form.`}
      />
      <TherapyList items={items} />
    </div>
  );
}
