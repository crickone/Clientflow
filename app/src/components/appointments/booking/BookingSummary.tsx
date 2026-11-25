"use client";

import { Button } from "@/components/ui/Button";
import { euro } from "@/lib/booking/format";
import type { SummaryMoney } from "@/lib/booking/summaryModel";

import s from "./booking.module.css";

interface Props {
  client: string;
  /** "Deep tissue massage, 60 min" */
  treatment: string;
  /** "Thu 26 Nov, 12:45 to 13:45" */
  when: string;
  money: SummaryMoney;
  bookLabel: string;
  canBook: boolean;
  submitting: boolean;
  onBook: () => void;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={s.row}>
      <span className={s.rowKey}>{k}</span>
      <span className={`${s.rowValue} ${v ? "" : s.rowEmpty}`}>{v || "Not set"}</span>
    </div>
  );
}

/** The sticky Booking panel on wide screens. */
export function BookingSummary({ client, treatment, when, money, bookLabel, canBook, submitting, onBook }: Props) {
  return (
    <div className={s.summary}>
      <h2 className={s.summaryTitle}>Booking</h2>
      <Row k="Client" v={client} />
      <Row k="Treatment" v={treatment} />
      <Row k="When" v={when} />
      <Row k="Payment" v={money.paymentLabel} />
      <div className={s.total}>
        <span className={s.totalKey}>Value</span>
        <span className={s.totalValue}>
          {money.struck != null && (
            <span className={s.struck} aria-label={`List price ${euro(money.struck)}`}>
              {euro(money.struck)}
            </span>
          )}
          {euro(money.value)}
        </span>
      </div>
      <div className={money.tone === "paid" ? s.notePaid : s.noteDue}>{money.note}</div>
      <Button type="button" size="lg" className={s.book} disabled={!canBook} loading={submitting} onClick={onBook}>
        {submitting ? "Booking" : bookLabel}
      </Button>
    </div>
  );
}

interface BarProps {
  /** "Deep tissue, Thu 26 Nov 12:45" */
  title: string;
  money: SummaryMoney;
  canBook: boolean;
  submitting: boolean;
  onBook: () => void;
}

/** The narrow-screen version: one summary line and Book, pinned to the bottom while the form scrolls. */
export function BookingBar({ title, money, canBook, submitting, onBook }: BarProps) {
  return (
    <div className={s.bar}>
      <div className={s.barText}>
        <span className={s.barTitle}>{title}</span>
        {money.shortPayment} · {euro(money.value)}
      </div>
      <Button type="button" disabled={!canBook} loading={submitting} onClick={onBook}>
        Book
      </Button>
    </div>
  );
}
