"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { formatEur, savingLabel, type OfferState } from "@/lib/offers/model";

export interface LandingOffer {
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  items: { name: string; sessions: number }[];
  useByDate: string;
  saleEndsAt: number | null;
  terms: string | null;
  state: OfferState;
  left: number | null;
  checkoutToken: string | null;
}

const CLOSED: Partial<Record<OfferState, string>> = {
  sold_out: "Sold out",
  ended: "This offer has ended",
  scheduled: "Not on sale yet",
  off: "Not on sale",
};

function longDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });
}

/** The price, what's included and the Buy button, which opens Stripe Checkout. */
export function OfferBuyBox({ offer }: { offer: LandingOffer }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = savingLabel(offer.priceCents, offer.compareAtCents);
  const open = offer.state === "live" && offer.checkoutToken;
  const useBy = new Date(`${offer.useByDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  async function buy() {
    if (!offer.checkoutToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/offers/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: offer.checkoutToken }) });
      const r = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (r?.ok && r.url) {
        window.location.assign(r.url);
        return;
      }
      setError(r?.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Couldn't reach the payment page. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="ob">
      <div className="ob-title">{offer.title}</div>
      <div className="ob-price">
        <span className="ob-now">{formatEur(offer.priceCents)}</span>
        {offer.compareAtCents !== null && offer.compareAtCents > offer.priceCents && (
          <span className="ob-was">
            <span className="sr-only">Usual price </span>
            <s>{formatEur(offer.compareAtCents)}</s>
          </span>
        )}
        {saving && <span className="ob-save">{saving}</span>}
      </div>
      <ul className="ob-includes">
        {offer.items.map((i) => (
          <li key={i.name}>
            <span className="ob-qty">{i.sessions} x</span> {i.name}
          </li>
        ))}
      </ul>
      <div className="ob-facts">
        <span>Use by {useBy}</span>
        {offer.saleEndsAt !== null && offer.state === "live" && <span>Offer ends {longDate(offer.saleEndsAt)}</span>}
        {offer.left !== null && offer.state === "live" && offer.left <= 20 && <span>{offer.left} left</span>}
      </div>
      {open ? (
        <button type="button" className="ob-buy" onClick={buy} disabled={busy}>
          {busy ? "Opening secure checkout" : `Buy now for ${formatEur(offer.priceCents)}`}
        </button>
      ) : (
        <div className="ob-closed">{CLOSED[offer.state] ?? "Not on sale"}</div>
      )}
      {error && (
        <p className="ob-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <p className="ob-secure">
          <Lock size={13} aria-hidden /> Secure payment by Stripe. You can pay by card, Apple Pay or Google Pay.
        </p>
      )}
      {offer.terms && <p className="ob-terms">{offer.terms}</p>}
    </div>
  );
}
