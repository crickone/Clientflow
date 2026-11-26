"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Search, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { formatEur } from "@/lib/utils";
import {
  STATE_FILTERS,
  balanceOf,
  daysLeft,
  filterVouchers,
  stateCounts,
  voucherState,
  type SourceFilter,
  type StateFilter,
  type VoucherFigures,
  type VoucherLike,
  type VoucherState,
} from "@/lib/vouchers/listModel";

export interface VoucherListRow extends VoucherLike {
  id: number;
  treatment: { name: string; colour: string } | null;
  delivery: { label: string; tone: "green" | "amber" | "red" } | null;
}

const STATE_LABEL: Record<VoucherState, string> = { unused: "Unused", part: "Part used", used: "Used", expired: "Expired", cancelled: "Cancelled" };
const STATE_TONE: Record<VoucherState, "success" | "info" | "neutral" | "danger" | "warning"> = {
  unused: "success",
  part: "info",
  used: "neutral",
  expired: "warning",
  cancelled: "danger",
};

const DATE = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDay = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));

function expiryNote(v: VoucherLike, today: string): { text: string; warn: boolean } | null {
  const d = daysLeft(v, today);
  if (d == null) return voucherState(v, today) === "expired" ? { text: "Past its date", warn: true } : null;
  if (d === 0) return { text: "Expires today", warn: true };
  if (d <= 30) return { text: `${d} day${d === 1 ? "" : "s"} left`, warn: true };
  return null;
}

function CodeCopy({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the code is still on screen.
    }
  };
  return (
    <span className="vh-code">
      <Link href={`/vouchers/${encodeURIComponent(code)}`}>{code}</Link>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : `Copy ${code}`} title={copied ? "Copied" : "Copy code"}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  );
}

export function VoucherList({ vouchers, figures, today, help }: { vouchers: VoucherListRow[]; figures: VoucherFigures; today: string; help: ReactNode }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<StateFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [expiring, setExpiring] = useState(false);

  const counts = useMemo(() => stateCounts(vouchers, today), [vouchers, today]);
  const shown = useMemo(() => filterVouchers(vouchers, { today, state, source, expiring, q }), [vouchers, today, state, source, expiring, q]);
  const hasOnline = vouchers.some((v) => v.source === "online");

  return (
    <div className="vh">
      <div className="vh-figures">
        <div className="vh-fig">
          <span className="vh-fig-label">Still to be used</span>
          <span className="vh-fig-value">{formatEur(figures.owedEur)}</span>
          <span className="vh-fig-note">on {figures.owedCount} voucher{figures.owedCount === 1 ? "" : "s"}</span>
        </div>
        <div className="vh-fig">
          <span className="vh-fig-label">Sold this month</span>
          <span className="vh-fig-value">{formatEur(figures.soldEur)}</span>
          <span className="vh-fig-note">{figures.soldCount} voucher{figures.soldCount === 1 ? "" : "s"}</span>
        </div>
        <div className="vh-fig">
          <span className="vh-fig-label">Used this month</span>
          <span className="vh-fig-value">{formatEur(figures.usedEur)}</span>
          <span className="vh-fig-note">taken off bookings and sales</span>
        </div>
        <button
          type="button"
          className="vh-fig vh-fig--button"
          aria-pressed={expiring}
          data-warn={figures.expiringCount > 0 || undefined}
          onClick={() => setExpiring((e) => !e)}
          disabled={figures.expiringCount === 0 && !expiring}
        >
          <span className="vh-fig-label">Expiring in 30 days</span>
          <span className="vh-fig-value">{figures.expiringCount}</span>
          <span className="vh-fig-note">{expiring ? "Showing these. Show all" : figures.expiringCount > 0 ? "Show these" : "None due"}</span>
        </button>
      </div>

      {help}

      <div className="vh-tools">
        <label className="vh-search">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by code, name or email" aria-label="Search vouchers" />
        </label>
        <div className="vh-pills" role="group" aria-label="Status">
          {STATE_FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0 || state === f.key).map((f) => (
            <button key={f.key} type="button" className="vh-pill" aria-pressed={state === f.key} onClick={() => setState(f.key)}>
              {f.label} <span>{counts[f.key]}</span>
            </button>
          ))}
        </div>
        {hasOnline && (
          <div className="vh-pills" role="group" aria-label="Where it was sold">
            {(["all", "online", "staff"] as const).map((s) => (
              <button key={s} type="button" className="vh-pill" aria-pressed={source === s} onClick={() => setSource(s)}>
                {s === "all" ? "Anywhere" : s === "online" ? "Online" : "In clinic"}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="vh-none">No vouchers match. Clear the search or pick another filter.</div>
      ) : (
        <div className="vh-wrap">
          <div className="vh-list" role="table" aria-label="Gift vouchers">
            <div className="vh-row vh-head" role="row">
              <span role="columnheader">For</span>
              <span role="columnheader">Code</span>
              <span role="columnheader">Treatment</span>
              <span role="columnheader">Balance</span>
              <span role="columnheader">Expires</span>
              <span role="columnheader">Status</span>
              <span role="columnheader" className="vh-sr">Actions</span>
            </div>
            {shown.map((v) => {
              const s = voucherState(v, today);
              const balance = Math.max(0, balanceOf(v));
              const pct = v.valueEur > 0 ? Math.min(100, Math.round((balance / v.valueEur) * 100)) : 0;
              const note = expiryNote(v, today);
              const from = v.buyerName ?? v.purchaserName;
              const redeemable = s !== "used" && s !== "cancelled";
              return (
                <div key={v.id} className="vh-row" role="row" data-state={s}>
                  <div className="vh-who" role="cell">
                    <Link href={`/vouchers/${encodeURIComponent(v.code)}`} className="vh-name">
                      {v.recipientName || from}
                    </Link>
                    <span className="vh-from">
                      {v.recipientName ? `from ${from}` : "Bought for themselves"}
                      {v.source === "online" ? " · online" : ""}
                    </span>
                    {v.delivery && (
                      <span className="vh-delivery" data-tone={v.delivery.tone}>
                        {v.delivery.label}
                      </span>
                    )}
                  </div>
                  <div className="vh-cell" role="cell" data-label="Code">
                    <CodeCopy code={v.code} />
                  </div>
                  <div className="vh-cell" role="cell" data-label="Treatment">
                    {v.treatment ? <Badge colour={v.treatment.colour}>{v.treatment.name}</Badge> : <span className="vh-muted">Any treatment</span>}
                  </div>
                  <div className="vh-cell vh-balance" role="cell" data-label="Balance">
                    <span>
                      <strong>{formatEur(balance)}</strong> of {formatEur(v.valueEur)}
                    </span>
                    <span className="vh-bar" aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </div>
                  <div className="vh-cell vh-expiry" role="cell" data-label="Expires">
                    <span>{fmtDay(v.expiryDate)}</span>
                    {note && <span className="vh-expiry-note" data-warn={note.warn || undefined}>{note.text}</span>}
                  </div>
                  <div className="vh-cell" role="cell" data-label="Status">
                    <Badge tone={STATE_TONE[s]}>{STATE_LABEL[s]}</Badge>
                  </div>
                  <div className="vh-acts" role="cell">
                    {redeemable && (
                      <Link href={`/appointments/new?voucher=${encodeURIComponent(v.code)}`} className="btn btn--outline btn--sm">
                        <Ticket size={13} /> Redeem
                      </Link>
                    )}
                    <Link href={`/vouchers/${encodeURIComponent(v.code)}`} className="vh-open" aria-label={`Open ${v.code}`}>
                      Open <ArrowUpRight size={13} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
