import { PageHeader } from "@/components/layout/PageHeader";
import { StripeSettings } from "@/components/settings/StripeSettings";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { stripeConfigured } from "@/lib/stripe/api";
import { getStripeConnection } from "@/lib/stripe/connection";
import { countOffersOnSale, listRecentOrders } from "@/lib/offers/store";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  cancelled: "Stripe wasn't connected: the connection was cancelled.",
  state_mismatch: "Stripe wasn't connected: that link was for a different account or had expired. Try again.",
  not_configured: "Online payments aren't switched on for the platform yet.",
  missing_code: "Stripe didn't send the connection back. Try again.",
};

export default async function StripeSettingsPage(props: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const searchParams = await props.searchParams;
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const conn = getStripeConnection(tenantId);
  const error = searchParams.error ? ERRORS[searchParams.error] ?? `Stripe wasn't connected: ${searchParams.error.slice(0, 200)}` : null;
  return (
    <div className="app-page">
      <PageHeader eyebrow="Integrations" title="Stripe" subtitle="Sell offers from your campaign pages and get paid into your own Stripe account." />
      <StripeSettings
        configured={stripeConfigured()}
        connection={conn ? { accountId: conn.accountId, displayName: conn.displayName, email: conn.email, chargesEnabled: conn.chargesEnabled, livemode: conn.livemode, connectedAt: conn.connectedAt } : null}
        justConnected={searchParams.connected === "1"}
        error={error}
        offersOnSale={conn ? countOffersOnSale() : 0}
        recent={conn ? listRecentOrders(5).map((o) => ({ id: o.id, name: o.name || o.email || "Buyer", offer: o.offerTitle, amountCents: o.amountCents, at: o.paidAt ?? o.createdAt, refunded: o.status === "refunded", clientId: o.clientId })) : []}
      />
    </div>
  );
}
