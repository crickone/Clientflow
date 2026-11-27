import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getBilling, listInvoices, type BillingStatus, type InvoiceRow } from "@/lib/billing/engine";
import { formatCents } from "@/lib/billing/money";
import { startCapture } from "@/lib/billing/capture";
import { monthlyLines } from "@/lib/billing/addons";
import { getVatRateBp } from "@/lib/billing/settings";
import { computeVat } from "@/lib/billing/money";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing — AdonisAgent" };

const STATUS_LABEL: Record<BillingStatus, string> = {
  pending_payment: "Pending activation",
  active: "Active",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};
const STATUS_COLOR: Record<BillingStatus, string> = {
  pending_payment: "var(--text-secondary)",
  active: "#22c55e",
  past_due: "#f2c14e",
  suspended: "#dc2626",
  cancelled: "var(--text-tertiary)",
};

export default async function BillingSettingsPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const b = getBilling(tenantId);
  const invoices = b ? listInvoices(tenantId) : [];
  // What this account pays every month — base plan + active add-ons, from the
  // same composition the invoice itself is built from.
  const planLines = monthlyLines(tenantId);
  const planTotal = computeVat(
    planLines.reduce((sum, l) => sum + l.netCents, 0),
    getVatRateBp(),
  );

  async function updateCard() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "update_card");
    redirect(redirectUrl);
  }

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Configure"
        title="Billing"
        subtitle="Your AdonisAgent subscription, payment card, and invoices."
      />

      {!b || b.billingExempt ? (
        <Card style={{ padding: 28 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.55 }}>
            {b?.billingExempt
              ? "This account is exempt from subscription billing — no payment is required."
              : "Subscription billing isn't enabled for this account."}
          </p>
        </Card>
      ) : (
        <>
          <Card style={{ padding: 28, marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 24,
                flexWrap: "wrap",
              }}
            >
              <div>
                <CardLabel>Subscription</CardLabel>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: STATUS_COLOR[b.status],
                    }}
                  />
                  {STATUS_LABEL[b.status]}
                </div>
                <div style={{ marginTop: 14 }}>
                  <CardLabel>Your plan</CardLabel>
                  <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    {planLines.map((l) => (
                      <div key={l.kind + l.addonKey} style={{ display: "flex", gap: 10, justifyContent: "space-between", maxWidth: 380 }}>
                        <span>{l.description}</span>
                        <span>{formatCents(l.netCents)}</span>
                      </div>
                    ))}
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        justifyContent: "space-between",
                        maxWidth: 380,
                        marginTop: 6,
                        paddingTop: 6,
                        borderTop: "1px solid var(--hairline)",
                        color: "var(--text-primary)",
                        fontWeight: 600,
                      }}
                    >
                      <span>Monthly total, incl. VAT</span>
                      <span>{formatCents(planTotal.grossCents)}</span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <CardLabel>Card on file</CardLabel>
                  <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    {b.cardLast4
                      ? `•••• ${b.cardLast4} · exp ${b.cardExpiry ?? "—"}`
                      : "No card on file"}
                  </div>
                </div>
              </div>
              <form action={updateCard}>
                <Button variant="outline" size="md">
                  {b.cardLast4 ? "Update card" : "Add card"}
                </Button>
              </form>
            </div>
          </Card>

          {invoices.length === 0 ? (
            <Card style={{ padding: 28 }}>
              <CardLabel>Invoices</CardLabel>
              <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 6 }}>
                No invoices yet.
              </p>
            </Card>
          ) : (
            <div>
              <CardLabel>Invoices</CardLabel>
              <div className="dt-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="dt-num">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices
                      .slice()
                      .reverse()
                      .map((inv: InvoiceRow) => (
                        <tr key={inv.id}>
                          <td>{inv.periodStart} → {inv.periodEnd}</td>
                          <td className="dt-num">{formatCents(inv.grossCents)}</td>
                          <td style={{ textTransform: "capitalize" }}>{inv.status}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
