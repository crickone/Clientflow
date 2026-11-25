"use client";

import "./chat.css";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatEuros, type TodayCounts } from "@/lib/adonis/todayModel";
import { greetingFor } from "./history";

export type EmptyStateProps = {
  firstName: string | null;
  businessName: string;
  suggestions: string[];
  onPick: (text: string) => void;
  disabled: boolean;
  /** The composer, rendered here (big) until the first question is sent. */
  composer: ReactNode;
  today: TodayCounts | null;
  /** For screenshots with fixed data; defaults to the current time. */
  now?: number;
};

/** What the operator sees before asking anything. */
export function EmptyState({ firstName, businessName, suggestions, onPick, disabled, composer, today, now }: EmptyStateProps) {
  return (
    <div className="ax-hero">
      <div className="ax-mark" aria-hidden>
        A
      </div>
      <h1 className="ax-hello">{greetingFor(now ?? Date.now(), firstName)}</h1>
      <p className="ax-sub">{businessName ? `What should we get done for ${businessName}?` : "What should we get done today?"}</p>
      {composer}
      {suggestions.length > 0 && (
        <div className="ax-sug">
          {suggestions.slice(0, 4).map((s) => (
            <button key={s} type="button" className="ax-sg" disabled={disabled} onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {today && (
        <section className="ax-today" aria-label="Needs you today">
          <div className="ax-today-k">Needs you today</div>
          <Link className="ax-ti" href="/communication">
            <span>Leads waiting for a reply</span>
            <b>{today.leadsWaiting}</b>
          </Link>
          <Link className="ax-ti" href="/communication">
            <span>AI drafts to approve</span>
            <b>{today.draftsToApprove}</b>
          </Link>
          {today.salesCents !== null && (
            <div className="ax-ti">
              <span>Offer and voucher sales this week</span>
              <b>{formatEuros(today.salesCents)}</b>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
