"use client";

import { Input, Label } from "@/components/ui/Input";
import { euro } from "@/lib/booking/format";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { VoucherCoverage, VoucherInfo } from "@/lib/booking/voucherModel";

import s from "./booking.module.css";

const SECONDARY: [SecondaryMethod, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  code: string;
  onCode: (code: string) => void;
  info: VoucherInfo;
  coverage: VoucherCoverage;
  /** The session price the voucher pays towards. */
  price: number;
  secondary: SecondaryMethod;
  onSecondary: (m: SecondaryMethod) => void;
}

/** Gift voucher: the code, what it pays, and the second method when it pays only part. */
export function VoucherPanel({ code, onCode, info, coverage, price, secondary, onSecondary }: Props) {
  return (
    <div className={s.panel}>
      <div>
        <Label htmlFor="voucherCode" srOnly>
          Voucher code
        </Label>
        <Input id="voucherCode" placeholder="Voucher code" value={code} onChange={(e) => onCode(e.target.value)} autoComplete="off" />
      </div>

      {code && info.state !== "idle" && (
        <div className={s.msgs}>
          {info.state === "valid" ? (
            <>
              <div className={s.msgOk}>
                {info.kind === "treatment" ? `Treatment voucher: one ${info.therapyName ?? "session"}` : `Money voucher: ${euro(info.balance)} left`}
                {info.recipientName ? ` · for ${info.recipientName}` : ""}
              </div>
              {info.expired && <div className={s.msgWarn}>This voucher&apos;s date ({info.expiryDate}) has passed. You can still take it.</div>}
              {coverage.wrongTreatment ? (
                <div className={s.msgBad}>This voucher is for {info.therapyName ?? "a different treatment"}.</div>
              ) : coverage.noPrice ? (
                <div className={s.msgBad}>This voucher cannot be applied: the treatment has no price.</div>
              ) : info.kind === "treatment" ? (
                <div className={s.msg}>
                  {coverage.covers < price
                    ? "Pays for this session up to the treatment's listed price. The voucher is then used up."
                    : "Pays for this session. The voucher is then used up."}
                </div>
              ) : (
                price > 0 &&
                info.balance >= price && (
                  <div className={s.msg}>
                    Pays {euro(price)}. {euro(info.balance - price)} stays on the voucher.
                  </div>
                )
              )}
            </>
          ) : info.state === "empty" ? (
            <div className={s.msgWarn}>This voucher has been used.</div>
          ) : info.state === "cancelled" ? (
            <div className={s.msgBad}>This voucher was cancelled.</div>
          ) : (
            <div className={s.msgBad}>Voucher not found.</div>
          )}
        </div>
      )}

      {coverage.needsSplit && (
        <div className={s.split}>
          <div className={s.splitTitle}>Split payment</div>
          <div className={s.splitText}>
            The voucher pays {euro(coverage.covers)} of {euro(price)}. The other {euro(price - coverage.covers)} is paid by:
          </div>
          <div className={s.chips}>
            {SECONDARY.map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={secondary === m}
                className={`${s.chip} ${s.chipSm} ${secondary === m ? s.chipOn : ""}`}
                onClick={() => onSecondary(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
