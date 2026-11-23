import { PageHeader } from "@/components/layout/PageHeader";
import { StripeSettings } from "@/components/settings/StripeSettings";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { oauthConfigured, stripeConfigured } from "@/lib/stripe/api";
import { getStripeConnection } from "@/lib/stripe/connection";
import { countOffersOnSale, listRecentOrders } from "@/lib/offers/store";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  cancelled: "Stripe wasn't connected: the connection was cancelled.",
  not_configured: "Online payments aren't switched on for the platform yet.",
  not_connected: "Stripe isn't connected yet. Click Connect with Stripe to start.",
  state_mismatch: "Stripe wasn't connected: that sign-in link was for another account or had expired. Try again.",
  missing_code: "Stripe wasn't connected: Stripe didn't send the connection back. Try again.",
  wrong_mode: "Stripe wasn't connected: that account is in test mode and the platform takes live payments (or the reverse).",
  in_use: "Stripe wasn't connected: that Stripe account is already connected to another business here.",
};

export default async function StripeSettingsPage(props: { searchParams: Promise<{ connected?: string; unfinished?: string; error?: string }> }) {
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
        canLinkExisting={oauthConfigured()}
        connection={conn ? { accountId: conn.accountId, displayName: conn.displayName, email: conn.email, chargesEnabled: conn.chargesEnabled, livemode: conn.livemode, connectedAt: conn.connectedAt } : null}
        justConnected={searchParams.connected === "1"}
        unfinished={searchParams.unfinished === "1"}
        error={error}
        offersOnSale={conn ? countOffersOnSale() : 0}
        recent={conn ? listRecentOrders(conn.accountId, 5).map((o) => ({ id: o.id, name: o.name || o.email || "Buyer", offer: o.offerTitle, amountCents: o.amountCents, at: o.paidAt ?? o.createdAt, refunded: o.status === "refunded", clientId: o.clientId })) : []}
      />
    </div>
  );
}
