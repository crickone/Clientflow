import { redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { requireUserPage, getCurrentMembership } from "@/lib/auth";
import { getBilling } from "@/lib/billing/engine";
import { computeVat, formatCents } from "@/lib/billing/money";
import { getVatRateBp } from "@/lib/billing/settings";
import { monthlyLines } from "@/lib/billing/addons";
import { addMonthClamped, dublinDayOfMonth, dublinToday } from "@/lib/billing/dates";
import { startCapture } from "@/lib/billing/capture";
import { getFeatureFlags } from "@/lib/settings";
import { MODULE_CATALOG, isModuleOn } from "@/lib/features";
import { formatDate } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardLabel } from "@/components/ui/Card";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { ActivateButton } from "@/components/billing/ActivateButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activate — AdonisAgent" };

export default async function ActivatePage() {
  await requireUserPage();
  const m = getCurrentMembership();
  if (!m) redirect("/login");
  const b = getBilling(m.tenant.id);
  if (!b || b.status !== "pending_payment") redirect("/dashboard");

  // Base plan + any add-on already switched on — the same composition
  // startCapture authorises and ensureInvoice bills, so all three agree.
  const lines = monthlyLines(m.tenant.id);
  const vatRateBp = getVatRateBp();
  const { vatCents, grossCents } = computeVat(
    lines.reduce((sum, l) => sum + l.netCents, 0),
    vatRateBp,
  );
  const gross = formatCents(grossCents);

  // What the first charge anchors: activateTenant takes today's Dublin day as
  // the anchor and sets the next renewal a month on (clamped), so quoting it
  // the same way here means the date on this page is the date they're billed.
  const today = dublinToday();
  const nextCharge = addMonthClamped(today, dublinDayOfMonth(today));

  // The modules actually switched on for THIS business, not a generic feature
  // list — it answers "what am I paying for?" with their own entitlement.
  const flags = getFeatureFlags();
  const included = MODULE_CATALOG.filter((mod) => isModuleOn(flags, mod.key));

  const isAdmin = m.role === "admin";

  async function pay() {
    "use server";
    const mm = getCurrentMembership();
    if (!mm || mm.role !== "admin") redirect("/login");
    const { redirectUrl } = await startCapture(mm.tenant.id, "activate");
    redirect(redirectUrl);
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Activation"
        title={`Activate ${m.tenant.name}`}
        subtitle="One flat monthly price for everything below. Cancel any time."
      />

      <div className="activate-grid">
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div className="activate-manifest-head">
            <CardLabel style={{ margin: 0 }}>
              Included — {included.length} {included.length === 1 ? "module" : "modules"}
            </CardLabel>
          </div>
          <RevealGroup stagger={0.03}>
            <ul className="activate-manifest">
              {included.map((mod) => (
                <Reveal key={mod.key} as="li" className="activate-item">
                  <span className="activate-item__label">{mod.label}</span>
                  <span className="activate-item__blurb">{mod.blurb}</span>
                </Reveal>
              ))}
            </ul>
          </RevealGroup>
        </Card>

        <div className="activate-summary">
          <div className="activate-panel">
            <CardLabel style={{ margin: 0 }}>Due today</CardLabel>
            <div className="activate-total">{gross}</div>

            <dl className="activate-lines">
              {lines.map((l) => (
                <div className="activate-line" key={l.kind + l.addonKey}>
                  <dt>{l.description}</dt>
                  <dd>{formatCents(l.netCents)}</dd>
                </div>
              ))}
              <div className="activate-line">
                <dt>VAT {vatRateBp / 100}%</dt>
                <dd>{formatCents(vatCents)}</dd>
              </div>
            </dl>

            {isAdmin ? (
              <form action={pay} className="activate-action">
                <ActivateButton amount={gross} />
              </form>
            ) : (
              <p className="activate-note activate-note--block">
                Only an admin can activate. Ask your account owner to sign in and
                finish this step.
              </p>
            )}

            <p className="activate-renewal">
              Then {gross} on {formatDate(nextCharge)}, and the same day each month.
            </p>
            <p className="activate-note">
              <Lock size={12} aria-hidden />
              Your card is handled by our payment provider. We store the last four
              digits, never the full number.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
