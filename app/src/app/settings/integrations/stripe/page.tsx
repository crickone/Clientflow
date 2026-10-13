import { PageHeader } from "@/components/layout/PageHeader";
import { StripeSettings } from "@/components/settings/StripeSettings";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { stripeConfigured } from "@/lib/stripe/api";
import { getStripeConnection } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  cancelled: "Stripe wasn't connected: the connection was cancelled.",
  state_mismatch: "Stripe wasn't connected: that link was for a different account or had expired. Try again.",
  not_configured: "Online payments aren't switched on for the platform yet.",
  missing_code: "Stripe didn't send the connection back. Try again.",
};

export default async function StripeSettingsPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const conn = getStripeConnection(tenantId);
  const flash = searchParams.connected
    ? { kind: "good" as const, text: "Stripe is connected." }
    : searchParams.error
      ? { kind: "bad" as const, text: ERRORS[searchParams.error] ?? `Stripe wasn't connected: ${searchParams.error.slice(0, 200)}` }
      : null;
  return (
    <div className="app-page">
      <PageHeader eyebrow="Integrations" title="Stripe" subtitle="Sell offers from your campaign pages and get paid into your own Stripe account." />
      <StripeSettings
        configured={stripeConfigured()}
        connection={conn ? { accountId: conn.accountId, displayName: conn.displayName, email: conn.email, chargesEnabled: conn.chargesEnabled, livemode: conn.livemode, connectedAt: conn.connectedAt } : null}
        flash={flash}
      />
    </div>
  );
}
