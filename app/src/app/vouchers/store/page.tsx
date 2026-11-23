import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { StoreSettingsForm } from "@/components/vouchers/StoreSettingsForm";
import { requireAdminPage } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { listSites } from "@/lib/cms/sites";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import { getStoreSettings, listSellableTherapies } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Online voucher store — AdonisAgent" };

/**
 * Products > Vouchers > Online store. The module guard (voucher_store) keeps
 * this page from a business without the module; requireAdminPage keeps it
 * from staff who aren't admins.
 */
export default async function VoucherStorePage() {
  await requireAdminPage();
  const tenantId = getCurrentTenant().id;
  const settings = getStoreSettings();
  const therapies = listSellableTherapies();
  const conn = getStripeConnection(tenantId);
  const ready = canTakePayments(conn);
  const sites = await listSites();
  const site = sites.find((s) => s.status === "live") ?? sites[0] ?? null;
  const storeUrl = site ? (site.primaryHost ? `https://${site.primaryHost}/vouchers` : `/site/${site.slug}/vouchers`) : null;

  return (
    <div className="app-page" style={{ maxWidth: 820 }}>
      <PageHeader
        eyebrow="Vouchers"
        title="Online voucher store"
        subtitle="Sell gift vouchers on your own website. Payments go straight to your Stripe account."
      />

      <Card style={{ marginBottom: 20 }}>
        <CardLabel>Payments</CardLabel>
        {ready ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
            Payments go to your Stripe account{conn?.displayName ? ` (${conn.displayName})` : ""}. You keep everything except Stripe&apos;s own fee.
          </p>
        ) : (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
            Connect Stripe before the store can take payments. Until then it shows that you are not taking orders online.{" "}
            <Link href="/settings/integrations/stripe" style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
              Connect Stripe
            </Link>
          </p>
        )}
        {storeUrl && settings.enabled && (
          <p style={{ margin: "12px 0 0", fontSize: 14 }}>
            <a href={storeUrl} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              Open your store <ExternalLink size={14} />
            </a>
          </p>
        )}
        {!site && (
          <p style={{ margin: "12px 0 0", color: "var(--text-secondary)", fontSize: 14 }}>
            The store lives on your website, and this business has no website yet.
          </p>
        )}
      </Card>

      <StoreSettingsForm
        initial={{
          enabled: settings.enabled,
          amountsText: settings.amounts.join(", "),
          allowCustom: settings.allowCustom,
          customMin: settings.customMin,
          customMax: settings.customMax,
          therapyIds: settings.therapyIds,
          intro: settings.intro,
          expiryYears: settings.expiryYears,
          bookUrl: settings.bookUrl,
        }}
        therapies={therapies}
      />
    </div>
  );
}
