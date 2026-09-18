"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { moneyAction, type MoneyActionResult, type MoneyOp } from "@/app/(console)/gyms/[id]/money/adjustments-actions";
import { Card } from "@/components/ui/Card";
import { fmtCents } from "@/lib/format";
import type { TenantMoney } from "@/lib/types";

/**
 * A negotiated price and the credits owed to a business.
 *
 * Every control here is owner-only in the API. A manager sees the same
 * figures without them, because knowing what a client pays is part of
 * answering their questions.
 */
export function MoneyAdjustments({
  tenantId,
  data,
  isOwner,
}: {
  tenantId: number;
  data: TenantMoney;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<MoneyActionResult | null>(null);
  const [price, setPrice] = useState(
    data.priceOverrideCents != null ? (data.priceOverrideCents / 100).toFixed(2) : "",
  );
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  function run(body: MoneyOp) {
    setResult(null);
    start(async () => {
      const r = await moneyAction(tenantId, body);
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  function savePrice() {
    const trimmed = price.trim();
    if (!trimmed) {
      run({ op: "set-price", cents: null });
      return;
    }
    const euros = Number(trimmed);
    if (!Number.isFinite(euros) || euros < 0) {
      setResult({ ok: false, error: "Give a price in euro, e.g. 149 or 149.50." });
      return;
    }
    run({ op: "set-price", cents: Math.round(euros * 100) });
  }

  function addCredit() {
    const euros = Number(amount.trim());
    if (!Number.isFinite(euros) || euros <= 0) {
      setResult({ ok: false, error: "Give an amount in euro." });
      return;
    }
    if (!description.trim()) {
      setResult({ ok: false, error: "Say what the credit is for — it appears on their invoice." });
      return;
    }
    const reason = window.prompt("Why is this credit being given? (kept on the audit trail)", "")?.trim() ?? "";
    run({ op: "add-credit", cents: Math.round(euros * 100), description: description.trim(), reason });
    setAmount("");
    setDescription("");
  }

  const onPlatformPrice = data.priceOverrideCents == null;

  return (
    <Card style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Price and credits
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          {onPlatformPrice
            ? `On the platform price, ${fmtCents(data.platformPriceCents)} a month.`
            : `On their own price of ${fmtCents(data.priceOverrideCents!)} a month (the platform price is ${fmtCents(data.platformPriceCents)}).`}
          {data.outstandingCreditCents > 0 &&
            ` ${fmtCents(data.outstandingCreditCents)} of credit comes off their next invoice.`}
        </p>
      </div>

      {result && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13.5,
            background: result.ok ? "rgba(63,185,80,.12)" : "rgba(240,128,154,.12)",
            border: `1px solid ${result.ok ? "rgba(63,185,80,.4)" : "rgba(240,128,154,.4)"}`,
          }}
        >
          {result.ok ? result.note : result.error}
        </div>
      )}

      {isOwner && (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div>
              <label htmlFor="price-override" className="mono-label" style={{ display: "block", marginBottom: 6 }}>
                Their monthly price (€)
              </label>
              <input
                id="price-override"
                className="input"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={(data.platformPriceCents / 100).toFixed(2)}
                style={{ width: 130 }}
              />
            </div>
            <button className="btn btn--primary btn--md" type="button" onClick={savePrice} disabled={pending}>
              Save price
            </button>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)", maxWidth: 380 }}>
              Empty puts them back on the platform price. Either way it applies to their next invoice, never one already
              raised.
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-end",
              flexWrap: "wrap",
              paddingTop: 16,
              borderTop: "1px solid var(--grid)",
            }}
          >
            <div>
              <label htmlFor="credit-amount" className="mono-label" style={{ display: "block", marginBottom: 6 }}>
                Credit (€)
              </label>
              <input
                id="credit-amount"
                className="input"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25.00"
                style={{ width: 110 }}
              />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="credit-desc" className="mono-label" style={{ display: "block", marginBottom: 6 }}>
                What it is for (shown on their invoice)
              </label>
              <input
                id="credit-desc"
                className="input"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Goodwill — March outage"
                style={{ width: "100%" }}
              />
            </div>
            <button className="btn btn--secondary btn--md" type="button" onClick={addCredit} disabled={pending}>
              Add credit
            </button>
          </div>
        </>
      )}

      {data.credits.length > 0 && (
        <table className="tbl">
          <thead>
            <tr>
              <th>Credit</th>
              <th>Amount</th>
              <th>State</th>
              <th style={{ width: 1 }} />
            </tr>
          </thead>
          <tbody>
            {data.credits.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.description}
                  {c.reason && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.reason}</div>}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{fmtCents(c.netCents)}</td>
                <td>
                  {c.appliedAt ? (
                    <span className="chip" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                      used on invoice #{c.appliedInvoiceId}
                    </span>
                  ) : (
                    <span className="chip" style={{ background: "rgba(63,185,80,.15)", color: "var(--green)" }}>owed</span>
                  )}
                </td>
                <td>
                  {isOwner && !c.appliedAt && (
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={pending}
                      onClick={() => run({ op: "cancel-credit", creditId: c.id })}
                    >
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isOwner && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)" }}>
          Changing what a business pays is an owner&rsquo;s action.
        </p>
      )}
    </Card>
  );
}
