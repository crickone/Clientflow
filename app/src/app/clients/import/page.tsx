import Link from "next/link";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { clients, membershipPlans } from "@/lib/db/schema";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { isEmailConfigured } from "@/lib/email";
import { normalizeEmail, normalizePhone } from "@/lib/memberImport";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { ImportWizard } from "@/components/clients/ImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportMembersPage() {
  await requireAdminPage();
  const vocab = getVocab(getVenueType());

  const planRows = db
    .select({ name: membershipPlans.name })
    .from(membershipPlans)
    .where(eq(membershipPlans.isActive, true))
    .all();
  const availablePlans = planRows.map((p) => p.name);

  const existing = db.select({ email: clients.email, phone: clients.phone }).from(clients).all();
  const existingEmails = [
    ...new Set(existing.map((e) => normalizeEmail(e.email ?? "")).filter(Boolean)),
  ];
  const existingPhones = [
    ...new Set(existing.map((e) => normalizePhone(e.phone ?? "")).filter(Boolean)),
  ];

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Migration"
        title={`Import ${vocab.members.toLowerCase()}`}
        subtitle="Bring your members over from another system with a CSV export."
        actions={
          <Link href="/clients">
            <Button variant="outline" size="sm">
              <ArrowLeft size={14} /> Back to {vocab.members.toLowerCase()}
            </Button>
          </Link>
        }
      />
      <ImportWizard
        availablePlans={availablePlans}
        existingEmails={existingEmails}
        existingPhones={existingPhones}
        emailReady={isEmailConfigured()}
        membersLabel={vocab.members.toLowerCase()}
      />
    </div>
  );
}
