"use client";

import { offerText, type PrepaidOffer } from "@/lib/booking/packageChoiceModel";

import s from "./booking.module.css";

interface Props {
  offer: PrepaidOffer;
  firstName: string;
  /** This package is paying for the booking. */
  using: boolean;
  onToggle: (use: boolean) => void;
}

/** One green line: "Mary has 1 prepaid Deep tissue massage, 60 min, from Black Friday. Use by 1 Mar 2027." */
export function PrepaidBanner({ offer, firstName, using, onToggle }: Props) {
  const text = offerText(offer, firstName);
  return (
    <div className={s.prepaid}>
      <div className={s.prepaidCount} aria-hidden>
        {offer.count}
      </div>
      <div className={s.prepaidText}>
        {text.lead}
        <b>{text.strong}</b>
        {text.rest}
      </div>
      <button
        type="button"
        aria-pressed={using}
        aria-label={`Use ${offer.packageName} for this booking`}
        className={`${s.chip} ${s.chipSm} ${using ? s.chipOk : ""}`}
        onClick={() => onToggle(!using)}
      >
        {using ? "Using it" : "Use it"}
      </button>
    </div>
  );
}
