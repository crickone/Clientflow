import { redirect } from "next/navigation";

import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { getBilling, chargeOutstanding } from "@/lib/billing/engine";
import { startCapture } from "@/lib/billing/capture";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription paused — ClientFlow" };

export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: { failed?: string };
}) {
  const user = await requireUserPage();
  const m = getCurrentMembership();
  if (!m) redirect("/login");
  const b = getBilling(m.tenant.id);
  if (!b || b.status !== "suspended") redirect("/dashboard");

  const hasCard = Boolean(b.cardLast4);
  const failed = searchParams.failed === "1";

  async function chargeExisting() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const res = await chargeOutstanding(mm.tenant.id, `tenant:${user.id}`);
    redirect(res.ok ? "/dashboard" : "/billing/suspended?failed=1");
  }

  async function useNewCard() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "reactivate");
    redirect(redirectUrl);
  }

  return (
    <div className="app-page" style={{ maxWidth: 560 }}>
      <PageHeader
        eyebrow="Billing"
        title="Your subscription needs attention"
        subtitle="After several failed payment attempts your ClientFlow subscription is paused, and staff access is limited until payment is sorted."
      />
      <Card style={{ padding: 28 }}>
        {failed && (
          <p
            style={{
              margin: "0 0 16px",
              padding: "10px 14px",
              borderRadius: "var(--radius)",
              background: "rgba(220,38,38,.1)",
              border: "1px solid rgba(220,38,38,.4)",
              color: "var(--text-primary)",
              fontSize: 13.5,
            }}
          >
            That charge didn&apos;t go through. Try a different card below.
          </p>
        )}

        {m.role === "admin" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {hasCard && (
              <form action={chargeExisting}>
                <Button variant="primary" size="lg" style={{ width: "100%" }}>
                  Pay now with card ending {b.cardLast4}
                </Button>
              </form>
            )}
            <form action={useNewCard}>
              <Button
                variant={hasCard ? "outline" : "primary"}
                size="lg"
                style={{ width: "100%" }}
              >
                Use a different card
              </Button>
            </form>
          </div>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
            Ask your account owner to sign in and settle the outstanding payment.
          </p>
        )}
      </Card>
    </div>
  );
}
