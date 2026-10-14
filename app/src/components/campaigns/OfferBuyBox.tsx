"use client";

import { useState } from "react";
import { Lock } from "lucide-react";

import { readArrival } from "@/components/cms/arrivalClient";

import { formatEur, savingLabel, type OfferState } from "@/lib/offers/model";

export interface LandingOffer {
  id: number;
  title: string;
  priceCents: number;
  compareAtCents: number | null;
  items: { name: string; sessions: number; durationMinutes: number }[];
  useByDate: string;
  saleEndsAt: number | null;
  terms: string | null;
  state: OfferState;
  left: number | null;
  checkoutToken: string | null;
}

export const CLOSED: Partial<Record<OfferState, string>> = {
  sold_out: "Sold out",
  ended: "This offer has ended",
  scheduled: "Not on sale yet",
  off: "Not on sale",
};

/** Ask for a Stripe Checkout page and go there; returns an error message if it can't. */
export async function goToCheckout(token: string): Promise<string | null> {
  try {
    const res = await fetch("/api/offers/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, arrival: readArrival() }) });
    const r = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
    if (r?.ok && r.url) {
      window.location.assign(r.url);
      return null;
    }
    return r?.error ?? "Something went wrong. Please try again.";
  } catch {
    return "Couldn't reach the payment page. Check your connection and try again.";
  }
}

function useByLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

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
    const err = await goToCheckout(offer.checkoutToken);
    if (err) {
      setError(err);
      setBusy(false);
    }
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

/**
 * Several offers on one page (e.g. 20% off each massage): a menu with each
 * one's price and its own Buy button. The use-by date, end date and terms
 * are shown once when every offer shares them.
 */
export function OfferMenu({ offers }: { offers: LandingOffer[] }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const same = <T,>(f: (o: LandingOffer) => T) => offers.every((o) => f(o) === f(offers[0]));
  const shared = { useBy: same((o) => o.useByDate), ends: same((o) => o.saleEndsAt), terms: same((o) => o.terms) };
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
    <div className="ob">
      <ul className="om-list">
        {offers.map((o) => {
          const item = o.items.length === 1 ? o.items[0] : null;
          const open = o.state === "live" && o.checkoutToken;
          return (
            <li key={o.id} className="om-row">
              <div className="om-main">
                <span className="om-name">{item ? `${item.sessions > 1 ? `${item.sessions} x ` : ""}${item.name.replace(/\s*\(\d+\s*min\)\s*$/i, "")}` : o.title}</span>
                <span className="om-meta">
                  {item?.durationMinutes ? `${item.durationMinutes} min` : o.items.map((i) => `${i.sessions} x ${i.name}`).join(", ")}
                  {!shared.useBy && ` · use by ${useByLabel(o.useByDate)}`}
                  {o.left !== null && o.state === "live" && o.left <= 10 && ` · ${o.left} left`}
                </span>
              </div>
              <span className="om-price">
                {o.compareAtCents !== null && o.compareAtCents > o.priceCents && <s>{formatEur(o.compareAtCents)}</s>}
                <strong>{formatEur(o.priceCents)}</strong>
              </span>
              {open ? (
                <button type="button" className="om-buy" onClick={() => buy(o)} disabled={busy !== null} aria-label={`Buy ${o.title} for ${formatEur(o.priceCents)}`}>
                  {busy === o.id ? "Opening" : "Buy"}
                </button>
              ) : (
                <span className="om-closed">{CLOSED[o.state] ?? "Not on sale"}</span>
              )}
              {error?.id === o.id && (
                <p className="ob-error om-error" role="alert">
                  {error.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="ob-facts">
        {shared.useBy && <span>Use by {useByLabel(first.useByDate)}</span>}
        {shared.ends && first.saleEndsAt !== null && anyLive && <span>Offer ends {longDate(first.saleEndsAt)}</span>}
      </div>
      {anyLive && (
        <p className="ob-secure">
          <Lock size={13} aria-hidden /> Secure payment by Stripe. You can pay by card, Apple Pay or Google Pay.
        </p>
      )}
      {shared.terms && first.terms && <p className="ob-terms">{first.terms}</p>}
    </div>
  );
}
