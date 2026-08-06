import { redirect } from "next/navigation";

import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { getBilling } from "@/lib/billing/engine";
import { computeVat, formatCents } from "@/lib/billing/money";
import { getMonthlyPriceCents, getVatRateBp } from "@/lib/billing/settings";
import { startCapture } from "@/lib/billing/capture";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activate — ClientFlow" };

export default async function ActivatePage() {
  await requireUserPage();
  const m = getCurrentMembership();
  if (!m) redirect("/login");
  const b = getBilling(m.tenant.id);
  if (!b || b.status !== "pending_payment") redirect("/dashboard");

  const { netCents, vatCents, grossCents } = computeVat(getMonthlyPriceCents(), getVatRateBp());

  async function pay() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "activate");
    redirect(redirectUrl);
  }

  return (
    <div className="app-page" style={{ maxWidth: 560 }}>
      <PageHeader
        eyebrow="Billing"
        title={`Activate ${m.tenant.name}`}
        subtitle="Your ClientFlow subscription starts today — one flat monthly price, cancel any time."
      />
      <Card style={{ padding: 28 }}>
        <div
          style={{
            padding: 16,
            borderRadius: "var(--radius)",
            border: "1px solid var(--hairline)",
          }}
        >
          <Row label="ClientFlow monthly subscription" value={formatCents(netCents)} />
          <Row label="VAT" value={formatCents(vatCents)} />
          <Row label="Due today" value={formatCents(grossCents)} strong />
        </div>
        {m.role === "admin" ? (
          <form action={pay} style={{ marginTop: 18 }}>
            <Button variant="primary" size="lg" style={{ width: "100%" }}>
              Pay {formatCents(grossCents)} &amp; activate
            </Button>
          </form>
        ) : (
          <p style={{ marginTop: 18, fontSize: 13.5, color: "var(--text-secondary)" }}>
            Ask your account owner to sign in and complete activation.
          </p>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        fontWeight: strong ? 600 : 400,
        color: strong ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
