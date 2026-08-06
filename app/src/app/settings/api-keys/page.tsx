import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { listApiKeys } from "@/lib/apiKeys";
import { ApiKeysManager } from "@/components/settings/ApiKeysManager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant.
  const tenantId = getCurrentMembership()!.tenant.id;

  const keys = listApiKeys(tenantId);

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <Link
        href="/settings"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-secondary)",
          fontSize: 13,
          marginBottom: 14,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} strokeWidth={1.75} />
        Back to settings
      </Link>
      <PageHeader
        eyebrow="Configure"
        title="API keys"
        subtitle="Per-tenant keys for inbound integrations (Zapier, Make, Facebook lead-gen) that post leads into this account. Send the key as the x-api-key header on POST /api/leads/inbound."
      />
      <ApiKeysManager keys={keys} />
    </div>
  );
}
