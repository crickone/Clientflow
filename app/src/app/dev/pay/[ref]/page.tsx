import { notFound, redirect } from "next/navigation";

import { requireUserPage } from "@/lib/auth";
import { controlSqlite } from "@/lib/db/control";
import { formatCents } from "@/lib/billing/money";
import { completeCapture, DEV_TOKENS } from "@/lib/billing/capture";
import { Card, CardLabel } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

/** DEV-ONLY simulated hosted payment page (the DevProvider's "gateway"). */
export default async function DevPayPage({ params }: { params: { ref: string } }) {
  await requireUserPage();
  if ((process.env.PAYMENT_PROVIDER ?? "dev") !== "dev") notFound();
  const s = controlSqlite
    .prepare("SELECT ref, amount_cents, status FROM capture_sessions WHERE ref = ?")
    .get(params.ref) as { ref: string; amount_cents: number | null; status: string } | undefined;
  if (!s || s.status !== "pending") notFound();

  async function decide(formData: FormData) {
    "use server";
    const outcome = String(formData.get("outcome"));
    const { returnTo } = await completeCapture(params.ref, {
      ok: outcome !== "cancel",
      token: outcome === "approve" ? DEV_TOKENS.ok : DEV_TOKENS.decline,
      last4: outcome === "approve" ? "4242" : "0002",
      expiry: "12/29",
      chargeRef: outcome === "approve" ? `dev_cap_${params.ref.slice(-6)}` : undefined,
    });
    redirect(returnTo);
  }

  return (
    <div className="app-page" style={{ maxWidth: 480 }}>
      <Card style={{ padding: 28 }}>
        <CardLabel>Dev payment gateway (simulated)</CardLabel>
        <h1 style={{ fontSize: 22, margin: "6px 0 4px", color: "var(--text-primary)" }}>
          {s.amount_cents != null ? `Pay ${formatCents(s.amount_cents)}` : "Save card"}
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.55 }}>
          No real gateway is configured — choose an outcome to simulate the hosted card page.
        </p>
        <form action={decide} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
          <Button name="outcome" value="approve" variant="primary" style={{ width: "100%" }}>
            Approve (card ending 4242)
          </Button>
          <Button name="outcome" value="save-failing" variant="outline" style={{ width: "100%" }}>
            Save a card that declines later
          </Button>
          <Button name="outcome" value="cancel" variant="ghost" size="sm" style={{ width: "100%" }}>
            Cancel
          </Button>
        </form>
      </Card>
    </div>
  );
}
