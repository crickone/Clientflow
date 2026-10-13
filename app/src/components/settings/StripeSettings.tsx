"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { disconnectStripeAction, refreshStripeAction } from "@/app/settings/integrations/stripe/actions";

export interface StripeSettingsProps {
  configured: boolean;
  connection: { accountId: string; displayName: string | null; email: string | null; chargesEnabled: boolean; livemode: boolean; connectedAt: number } | null;
  flash: { kind: "good" | "bad"; text: string } | null;
}

/** Connect a business's own Stripe account, see its state, disconnect it. */
export function StripeSettings({ configured, connection, flash }: StripeSettingsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function refresh() {
    start(async () => {
      const r = await refreshStripeAction();
      if (!r.ok) toast.error(r.error ?? "Couldn't check Stripe.");
      else toast.success("Status updated");
      router.refresh();
    });
  }
  function disconnect() {
    start(async () => {
      await disconnectStripeAction();
      toast.success("Stripe disconnected");
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="ib-layout">
      <div className="ib-main">
        {flash && <div className={`st-flash is-${flash.kind}`}>{flash.text}</div>}
        <section className="ib-panel">
          {!configured ? (
            <>
              <h2>Not available yet</h2>
              <p style={{ marginTop: 8 }}>Online payments haven&rsquo;t been switched on for the platform yet. Your AdonisAgent contact can do this.</p>
            </>
          ) : connection ? (
            <>
              <div className="ib-panel-head">
                <div>
                  <h2>{connection.displayName || "Your Stripe account"}</h2>
                  <p>
                    {connection.email ? `${connection.email} · ` : ""}
                    {connection.accountId}
                  </p>
                </div>
                <span className={`ib-status ${connection.chargesEnabled ? "is-good" : "is-bad"}`}>
                  <span className="ib-dot" />
                  {connection.chargesEnabled ? "Taking payments" : "Payments not switched on"}
                </span>
              </div>
              {!connection.livemode && (
                <p className="st-note">This is a Stripe test account: buyers can only pay with Stripe&rsquo;s test cards, and no real money moves.</p>
              )}
              {!connection.chargesEnabled && (
                <p className="st-note">
                  Stripe hasn&rsquo;t switched on payments for this account yet. Finish the account details in your Stripe dashboard, then check again here.
                </p>
              )}
              <div className="st-actions">
                <Button variant="secondary" size="sm" onClick={refresh} loading={pending && !confirming}>
                  {!(pending && !confirming) && <RefreshCw size={14} />} Check status
                </Button>
                <a className="btn btn--ghost btn--sm" href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">
                  Open Stripe <ExternalLink size={14} />
                </a>
                {confirming ? (
                  <>
                    <span className="st-confirm">Buy buttons on your campaign pages will stop working.</span>
                    <Button variant="destructive" size="sm" onClick={disconnect} loading={pending}>
                      Disconnect
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} style={{ marginLeft: "auto" }}>
                    Disconnect
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <h2>Connect your Stripe account</h2>
              <p style={{ marginTop: 8 }}>
                You&rsquo;ll sign in to Stripe and approve the connection. If you don&rsquo;t have an account yet, Stripe will help you make one.
              </p>
              <a className="btn btn--primary btn--md" href="/api/stripe/connect">
                Connect with Stripe
              </a>
            </>
          )}
        </section>
      </div>
      <aside className="ib-side">
        <section className="ib-panel">
          <h3>How it works</h3>
          <ul className="st-facts">
            <li>Add an offer to a campaign and its landing page gets a Buy button.</li>
            <li>Buyers pay on Stripe&rsquo;s own checkout page. The money goes straight to your Stripe account, less Stripe&rsquo;s fees.</li>
            <li>Each sale adds the buyer as a client with their sessions ready to book, records the payment, and marks their lead as won.</li>
            <li>Refunds are made in Stripe. A refunded order&rsquo;s sessions are switched off here.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
