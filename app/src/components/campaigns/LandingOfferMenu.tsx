"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { formatEur } from "@/lib/offers/model";
import { CLOSED, goToCheckout, type LandingOffer } from "./OfferBuyBox";

function formatUseBy(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function ends(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });
}

/** "60 min", "2 sessions of 60 min", or the bundle's contents. */
function itemMeta(o: LandingOffer): string {
  if (o.items.length === 1) {
    const i = o.items[0];
    // "Deep tissue massage (30 min)" already says how long it is.
    const mins = i.durationMinutes && !/\bmin/i.test(i.name) ? `${i.durationMinutes} min` : "";
    if (i.sessions > 1) return [`${i.sessions} sessions`, mins && `of ${mins}`].filter(Boolean).join(" ");
    return mins;
  }
  return o.items.map((i) => `${i.sessions} x ${i.name}`).join(", ");
}

/**
 * The offers as a treatment menu: name and length, usual price struck
 * through, the offer price, and a Buy button that opens Stripe Checkout.
 * Things every offer shares (use-by date, end date, terms) are said once
 * underneath.
 */
export function LandingOfferMenu({ offers }: { offers: LandingOffer[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const same = <T,>(f: (o: LandingOffer) => T) => offers.every((o) => f(o) === f(offers[0]));
  const first = offers[0];
  const anyLive = offers.some((o) => o.state === "live" && o.checkoutToken);

  async function buy(o: LandingOffer) {
    if (!o.checkoutToken) return;
    setBusy(o.id);
    setError(null);
    const err = await goToCheckout(o.checkoutToken);
    if (err) {
      setError({ id: o.id, text: err });
      setBusy(null);
    }
  }

  return (
    <div>
      <ul className="cl-menu">
        {offers.map((o) => {
          const open = o.state === "live" && o.checkoutToken;
          const name = o.items.length === 1 ? o.items[0].name : o.title;
          const meta = itemMeta(o);
          return (
            <li key={o.id} className="cl-item">
              <div>
                <span className="cl-item-name">{name}</span>
                {meta && <span className="cl-item-meta">{meta}</span>}
                {!same((x) => x.useByDate) && <span className="cl-item-meta">Use by {formatUseBy(o.useByDate)}</span>}
              </div>
              <div className="cl-price">
                {o.compareAtCents !== null && o.compareAtCents > o.priceCents && (
                  <span className="cl-price-was">
                    <span className="sr-only">Usual price </span>
                    {formatEur(o.compareAtCents)}
                  </span>
                )}
                <span className="cl-price-now">{formatEur(o.priceCents)}</span>
              </div>
              {open ? (
                <button type="button" className="cl-btn cl-btn--sm" onClick={() => buy(o)} disabled={busy !== null} aria-label={`Buy ${name} for ${formatEur(o.priceCents)}`}>
                  {busy === o.id ? "Opening checkout" : "Buy"}
                </button>
              ) : (
                <span className="cl-item-closed">{CLOSED[o.state] ?? "Not on sale"}</span>
              )}
              {error?.id === o.id && (
                <p className="cl-item-error" role="alert">
                  {error.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="cl-facts">
        {same((o) => o.useByDate) && <span>Use by {formatUseBy(first.useByDate)}</span>}
        {same((o) => o.saleEndsAt) && first.saleEndsAt !== null && anyLive && <span>Offer ends {ends(first.saleEndsAt)}</span>}
        {anyLive && (
          <span>
            <Lock size={13} aria-hidden /> Secure payment by Stripe: card, Apple Pay or Google Pay
          </span>
        )}
      </div>
      {same((o) => o.terms) && first.terms && <p className="cl-terms">{first.terms}</p>}
    </div>
  );
}
