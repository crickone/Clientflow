import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getBilling, listInvoices, type BillingStatus, type InvoiceRow } from "@/lib/billing/engine";
import { formatCents } from "@/lib/billing/money";
import { startCapture } from "@/lib/billing/capture";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing — ClientFlow" };

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

  async function updateCard() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "update_card");
    redirect(redirectUrl);
  }

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
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
        title="Billing"
        subtitle="Your ClientFlow subscription, payment card, and invoices."
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

          <Card style={{ padding: 28 }}>
            <CardLabel>Invoices</CardLabel>
            {invoices.length === 0 ? (
              <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 6 }}>
                No invoices yet.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-tertiary)" }}>
                    <Th>Period</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {invoices
                    .slice()
                    .reverse()
                    .map((inv: InvoiceRow) => (
                      <tr key={inv.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                        <Td>{inv.periodStart} → {inv.periodEnd}</Td>
                        <Td>{formatCents(inv.grossCents)}</Td>
                        <Td style={{ textTransform: "capitalize", color: "var(--text-secondary)" }}>
                          {inv.status}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "8px 10px 8px 0",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontWeight: 400,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td style={{ padding: "10px 10px 10px 0", color: "var(--text-primary)", ...style }}>
      {children}
    </td>
  );
}
