"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, CreditCard, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { disconnectStripeAction, refreshStripeAction } from "@/app/settings/integrations/stripe/actions";
import { formatEur } from "@/lib/offers/model";

export interface StripeSettingsProps {
  configured: boolean;
  connection: { accountId: string; displayName: string | null; email: string | null; chargesEnabled: boolean; livemode: boolean; connectedAt: number } | null;
  justConnected: boolean;
  error: string | null;
  offersOnSale: number;
  recent: { id: number; name: string; offer: string; amountCents: number; at: number; refunded: boolean; clientId: number | null }[];
}

const STRIPE_SETTINGS = "https://dashboard.stripe.com/settings/account";

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

/**
 * Stripe for one business: connect it, see whether it can take payments and
 * what to do next, and the latest online sales.
 */
export function StripeSettings({ configured, connection, justConnected, error, offersOnSale, recent }: StripeSettingsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // Back from Stripe: say so once, then tidy the address bar.
  useEffect(() => {
    if (justConnected) {
      toast.success("Stripe is connected");
      router.replace(pathname);
    }
  }, [justConnected, pathname, router]);

  function refresh() {
    start(async () => {
      const r = await refreshStripeAction();
      if (!r.ok) toast.error(r.error ?? "Couldn't check Stripe.");
      else toast.success("Up to date with Stripe");
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

  const steps = connection
    ? [
        { done: true, title: "Connected to Stripe", detail: `Since ${shortDate(connection.connectedAt)}`, action: null },
        connection.livemode
          ? {
              done: connection.chargesEnabled,
              title: connection.chargesEnabled ? "Stripe has approved your account" : "Finish your details in Stripe",
              detail: connection.chargesEnabled ? "Card payments and payouts are switched on." : "Stripe needs your business and bank details before it takes payments.",
              action: connection.chargesEnabled ? null : { href: STRIPE_SETTINGS, label: "Open Stripe", external: true },
            }
          : {
              done: Boolean(connection.displayName),
              title: connection.displayName ? "Business name set" : "Add a business name in Stripe",
              detail: connection.displayName ? "Test payments will work." : "Stripe won't open a payment page without one.",
              action: connection.displayName ? null : { href: STRIPE_SETTINGS, label: "Open Stripe", external: true },
            },
        {
          done: offersOnSale > 0,
          title: offersOnSale > 0 ? `${offersOnSale} ${offersOnSale === 1 ? "offer" : "offers"} on sale` : "Put an offer on sale",
          detail: offersOnSale > 0 ? "Buy buttons are live on those campaign pages." : "Add an offer to a campaign and switch it on.",
          action: { href: "/marketing/campaigns", label: "Campaigns", external: false },
        },
      ]
    : [];

  const status = !connection
    ? null
    : !connection.livemode
      ? { tone: "test", text: "Test mode" }
      : connection.chargesEnabled
        ? { tone: "good", text: "Taking payments" }
        : { tone: "wait", text: "Setup needed" };

  return (
    <div className="stp">
      {error && (
        <div className="stp-alert" role="alert">
          {error}
        </div>
      )}

      <section className="ui-card stp-card">
        {!configured ? (
          <div className="stp-empty">
            <span className="stp-mark" aria-hidden>
              <CreditCard size={20} />
            </span>
            <div>
              <h2>Online payments aren&rsquo;t available yet</h2>
              <p>They need switching on for the platform first. Your AdonisAgent contact can do this.</p>
            </div>
          </div>
        ) : !connection ? (
          <div className="stp-empty">
            <span className="stp-mark" aria-hidden>
              <CreditCard size={20} />
            </span>
            <div className="stp-empty-body">
              <h2>Take payments on your campaign pages</h2>
              <p>Buyers pay by card, Apple Pay or Google Pay on Stripe&rsquo;s checkout page. The money goes into your own Stripe account.</p>
              <div className="stp-connect">
                <a className="btn btn--primary btn--md" href="/api/stripe/connect">
                  Connect with Stripe
                </a>
                <span>You&rsquo;ll sign in to Stripe and approve the connection. No Stripe account yet? You can make one there.</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <header className="stp-head">
              <span className="stp-mark" aria-hidden>
                <CreditCard size={20} />
              </span>
              <div className="stp-who">
                <h2>{connection.displayName || connection.email || "Your Stripe account"}</h2>
                <p>
                  {connection.displayName && connection.email ? `${connection.email} · ` : ""}
                  <span className="stp-id">{connection.accountId}</span>
                </p>
              </div>
              {status && <span className={`stp-pill is-${status.tone}`}>{status.text}</span>}
            </header>

            {!connection.livemode && (
              <p className="stp-testnote">Test account: buyers can only pay with Stripe&rsquo;s test cards, and no real money moves.</p>
            )}

            <ol className="stp-steps">
              {steps.map((s) => (
                <li key={s.title} className="stp-step" data-done={s.done}>
                  <span className="stp-tick" aria-hidden>
                    {s.done && <Check size={13} strokeWidth={3} />}
                  </span>
                  <div className="stp-step-text">
                    <span className="stp-step-title">{s.title}</span>
                    <span className="stp-step-detail">{s.detail}</span>
                  </div>
                  {s.action &&
                    (s.action.external ? (
                      <a className="stp-step-link" href={s.action.href} target="_blank" rel="noopener noreferrer">
                        {s.action.label} <ExternalLink size={13} />
                      </a>
                    ) : (
                      <Link className="stp-step-link" href={s.action.href}>
                        {s.action.label}
                      </Link>
                    ))}
                </li>
              ))}
            </ol>

            <footer className="stp-foot">
              <Button variant="secondary" size="sm" onClick={refresh} loading={pending && !confirming}>
                {!(pending && !confirming) && <RefreshCw size={14} />} Check status
              </Button>
              <a className="btn btn--ghost btn--sm" href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer">
                Stripe dashboard <ExternalLink size={13} />
              </a>
              <span className="stp-foot-gap" />
              {confirming ? (
                <span className="stp-confirm">
                  Buy buttons will stop working.
                  <Button variant="destructive" size="sm" onClick={disconnect} loading={pending}>
                    Disconnect
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <button type="button" className="stp-disconnect" onClick={() => setConfirming(true)}>
                  Disconnect
                </button>
              )}
            </footer>
          </>
        )}
      </section>

      {connection && recent.length > 0 && (
        <section className="stp-section">
          <h3>Latest online sales</h3>
          <ul className="stp-sales">
            {recent.map((r) => (
              <li key={r.id}>
                <span className="stp-sale-who">
                  {r.clientId ? <Link href={`/clients/${r.clientId}`}>{r.name}</Link> : r.name}
                  <span>{r.offer}</span>
                </span>
                <span className="stp-sale-amt" data-refunded={r.refunded}>
                  {r.refunded ? "Refunded" : formatEur(r.amountCents)}
                </span>
                <span className="stp-sale-at">{shortDate(r.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stp-section">
        <h3>When someone buys</h3>
        <ol className="stp-flow">
          <li>
            <span className="stp-num">1</span>They pay on Stripe&rsquo;s secure checkout page.
          </li>
          <li>
            <span className="stp-num">2</span>The money goes to your Stripe account, less Stripe&rsquo;s fees.
          </li>
          <li>
            <span className="stp-num">3</span>They&rsquo;re added as a client with their sessions ready to book, and their lead is marked won.
          </li>
          <li>
            <span className="stp-num">4</span>Refunds are made in Stripe. A refunded order&rsquo;s sessions are switched off here.
          </li>
        </ol>
      </section>
    </div>
  );
}
