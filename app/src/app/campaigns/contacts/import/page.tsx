import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdminPage } from "@/lib/auth";
import { db } from "@/lib/db";
import { contacts, suppressions } from "@/lib/db/schema";
import { normalizeEmail } from "@/lib/marketing/contactImport";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { ContactImportWizard } from "@/components/campaigns/ContactImportWizard";

export const dynamic = "force-dynamic";

export default async function ImportContactsPage() {
  await requireAdminPage();

  const existingRows = db.select({ email: contacts.email }).from(contacts).all();
  const existingEmails = [
    ...new Set(existingRows.map((e) => normalizeEmail(e.email ?? "")).filter(Boolean)),
  ];

  const suppressedRows = db.select({ email: suppressions.email }).from(suppressions).all();
  const suppressedEmails = [
    ...new Set(suppressedRows.map((e) => normalizeEmail(e.email ?? "")).filter(Boolean)),
  ];

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Email marketing"
        title="Import contacts"
        subtitle="Bring your leads and customers into your mailing list from a CSV export."
        actions={
          <Link href="/campaigns/contacts">
            <Button variant="outline" size="sm">
              <ArrowLeft size={14} /> Back to contacts
            </Button>
          </Link>
        }
      />
      <ContactImportWizard existingEmails={existingEmails} suppressedEmails={suppressedEmails} />
    </div>
  );
}
