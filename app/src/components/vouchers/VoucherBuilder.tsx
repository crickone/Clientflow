"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { RevealCard } from "@/components/vouchers/RevealCard";
import {
  expiryDate,
  formatEuro,
  formatLongDate,
  latestDeliveryDate,
  validateOrder,
  voucherTitle,
  type Colourway,
  type DeliverTo,
  type OrderDraft,
  type OrderDraftField,
  type StoreTreatment,
  type VoucherKind,
  type VoucherStoreSettings,
} from "@/lib/vouchers/model";

/**
 * The voucher store, on the business's own site: a live preview of the card
 * beside the choices (what, who, look, delivery, pay). Everything visual it
 * cannot know comes from the site's own stylesheet; it sets layout, and
 * colours only on the card and the Pay button, which wear the chosen
 * colourway. Checks run in the browser with the same rules the server uses
 * (lib/vouchers/model validateOrder), so the server's answer is never a
 * surprise.
 */
export interface VoucherBuilderProps {
  /** Signed store token; null when payments aren't ready (no Pay button). */
  token: string | null;
  businessName: string;
  phone: string;
  intro: string;
  settings: VoucherStoreSettings;
  treatments: StoreTreatment[];
  colourways: Colourway[];
  /** Today in Ireland, YYYY-MM-DD (from the server, so the date range is Irish). */
  today: string;
}

type Choice = { kind: "amount"; euros: number } | { kind: "custom" } | { kind: "treatment" };

export function VoucherBuilder(p: VoucherBuilderProps) {
  const firstChoice: Choice = p.settings.amounts.length
    ? { kind: "amount", euros: p.settings.amounts[Math.min(1, p.settings.amounts.length - 1)]! }
    : p.settings.allowCustom
      ? { kind: "custom" }
      : { kind: "treatment" };
  const [choice, setChoice] = useState<Choice>(firstChoice);
  const [custom, setCustom] = useState("");
  const [therapyId, setTherapyId] = useState<number | null>(p.treatments[0]?.id ?? null);
  const [toName, setToName] = useState("");
  const [fromName, setFromName] = useState("");
  const [message, setMessage] = useState("");
  const [colourwayId, setColourwayId] = useState(p.colourways[0]?.id ?? "");
  const [deliverTo, setDeliverTo] = useState<DeliverTo>("recipient");
  const [when, setWhen] = useState<"now" | "date">("now");
  const [deliverOn, setDeliverOn] = useState(p.today);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [error, setError] = useState<{ field: OrderDraftField | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const kind: VoucherKind = choice.kind === "treatment" ? "treatment" : "amount";
  const amountEur = choice.kind === "amount" ? choice.euros : choice.kind === "custom" && custom.trim() ? Number(custom) : null;
  const treatment = p.treatments.find((t) => t.id === therapyId) ?? null;
  const colourway = p.colourways.find((c) => c.id === colourwayId) ?? p.colourways[0]!;
  const latest = latestDeliveryDate(p.today);
  const expiryLabel = `Valid until ${formatLongDate(expiryDate(p.today, p.settings.expiryYears))}`;
  const title =
    kind === "treatment"
      ? voucherTitle({ kind, valueEur: treatment?.priceEur ?? 0, therapyName: treatment?.name ?? "Treatment" })
      : amountEur && Number.isFinite(amountEur) && amountEur > 0
        ? formatEuro(amountEur)
        : "€";
  const priceEur = kind === "treatment" ? treatment?.priceEur ?? 0 : amountEur ?? 0;

  const draft: OrderDraft = useMemo(
    () => ({
      kind,
      amountEur,
      therapyId: kind === "treatment" ? therapyId : null,
      toName,
      fromName,
      message,
      colourwayId,
      deliverTo,
      recipientEmail,
      deliverOn: deliverTo === "recipient" && when === "date" ? deliverOn : null,
      buyerName,
      buyerEmail,
    }),
    [kind, amountEur, therapyId, toName, fromName, message, colourwayId, deliverTo, recipientEmail, when, deliverOn, buyerName, buyerEmail],
  );

  const errorFor = (field: OrderDraftField) =>
    error && error.field === field ? (
      <p className="vb__error" role="alert" id={`vb-err-${field}`}>
        <AlertCircle size={16} aria-hidden className="vb__errorIcon" />
        <span>{error.message}</span>
      </p>
    ) : null;
  // aria-invalid + aria-describedby for a field; `extra` is an always-on description (the counter).
  const invalid = (field: OrderDraftField, extra?: string) => {
    const ids = [extra, error?.field === field ? `vb-err-${field}` : undefined].filter(Boolean).join(" ");
    return {
      ...(error?.field === field ? { "aria-invalid": true as const } : {}),
      ...(ids ? { "aria-describedby": ids } : {}),
    };
  };
  // Typing in (or changing) a field clears that field's own error, and only that one.
  const clear = (...fields: Array<OrderDraftField | "form">) => setError((e) => (e && fields.includes(e.field) ? null : e));

  // Coming back from Stripe with the browser's back button restores this page
  // from the back/forward cache with busy still true: free the Pay button.
  useEffect(() => {
    const onShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!p.token || busy) return;
    const check = validateOrder(draft, { settings: p.settings, treatments: p.treatments, colourwayIds: p.colourways.map((c) => c.id), today: p.today });
    if (!check.ok) {
      setError({ field: check.field, message: check.error });
      document.getElementById(`vb-${check.field}`)?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/voucher-store/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: p.token, order: draft }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string; field?: OrderDraftField } | null;
      if (data?.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      setError({ field: data?.field ?? "form", message: data?.error ?? "Payments aren't working right now. Nothing was charged." });
    } catch {
      setError({ field: "form", message: "We couldn't reach the payment page. Nothing was charged. Please try again." });
    }
    setBusy(false);
  }

  const shownName = toName.trim() || "them";

  return (
    <div className="vb">
      <style dangerouslySetInnerHTML={{ __html: VB_CSS }} />
      <div className="vb__head">
        <h1>Gift vouchers</h1>
        <p>{p.intro || `Buy a gift voucher for ${p.businessName}. Send it by email now or on a date you choose.`}</p>
      </div>

      <div className="vb__grid">
        <div className="vb__preview">
          <RevealCard
            colourway={colourway}
            businessName={p.businessName}
            title={title}
            forName={toName.trim() || "someone special"}
            code="Your code"
            expiryLabel={expiryLabel}
          />
          {message.trim() && <p className="vb__note">&ldquo;{message.trim()}&rdquo;{fromName.trim() ? ` From ${fromName.trim()}.` : ""}</p>}
        </div>

        {!p.token ? (
          <div className="vb__closed">
            <h2>Not taking orders online yet</h2>
            <p>{p.phone ? `To buy a gift voucher, call ${p.phone}.` : `To buy a gift voucher, contact ${p.businessName}.`}</p>
          </div>
        ) : (
          <form className="vb__form" onSubmit={pay} noValidate>
            <fieldset>
              <legend>1. Choose the gift</legend>
              <div className="vb__chips" id={choice.kind === "custom" ? undefined : "vb-amountEur"} tabIndex={-1}>
                {p.settings.amounts.map((a) => (
                  <button key={a} type="button" className="vb__chip" aria-pressed={choice.kind === "amount" && choice.euros === a} onClick={() => {
                      setChoice({ kind: "amount", euros: a });
                      clear("amountEur", "therapyId", "kind");
                    }}>
                    {formatEuro(a)}
                  </button>
                ))}
                {p.settings.allowCustom && (
                  <button type="button" className="vb__chip" aria-pressed={choice.kind === "custom"} onClick={() => {
                      setChoice({ kind: "custom" });
                      clear("amountEur", "therapyId", "kind");
                    }}>
                    Other amount
                  </button>
                )}
                {p.treatments.length > 0 && (
                  <button type="button" className="vb__chip" aria-pressed={choice.kind === "treatment"} onClick={() => {
                      setChoice({ kind: "treatment" });
                      clear("amountEur", "therapyId", "kind");
                    }}>
                    A treatment
                  </button>
                )}
              </div>
              {choice.kind === "custom" && (
                <label className="vb__field">
                  <span>
                    Amount in euros, {formatEuro(p.settings.customMin)} to {formatEuro(p.settings.customMax)}
                  </span>
                  <input
                    id="vb-amountEur"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-required="true"
                    value={custom}
                    onChange={(e) => {
                      setCustom(e.target.value.replace(/[^0-9]/g, ""));
                      clear("amountEur");
                    }}
                    {...invalid("amountEur")}
                  />
                </label>
              )}
              {choice.kind === "treatment" && (
                <label className="vb__field">
                  <span>Treatment</span>
                  <span className="vb__select">
                    <select id="vb-therapyId" value={therapyId ?? ""} onChange={(e) => {
                        setTherapyId(Number(e.target.value) || null);
                        clear("therapyId");
                      }} {...invalid("therapyId")}>
                      {p.treatments.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}, {formatEuro(t.priceEur)}
                        </option>
                      ))}
                    </select>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </label>
              )}
              {errorFor("amountEur")}
              {errorFor("therapyId")}
            </fieldset>

            <fieldset>
              <legend>2. Who is it for?</legend>
              <label className="vb__field">
                <span>To</span>
                <input
                  id="vb-toName"
                  value={toName}
                  maxLength={60}
                  autoComplete="off"
                  aria-required={deliverTo === "recipient" ? "true" : undefined}
                  onChange={(e) => {
                    setToName(e.target.value);
                    clear("toName");
                  }}
                  {...invalid("toName")}
                />
              </label>
              {errorFor("toName")}
              <label className="vb__field">
                <span>From</span>
                <input
                  id="vb-fromName"
                  value={fromName}
                  maxLength={60}
                  aria-required="true"
                  onChange={(e) => {
                    setFromName(e.target.value);
                    clear("fromName");
                  }}
                  {...invalid("fromName")}
                />
              </label>
              {errorFor("fromName")}
              <label className="vb__field">
                <span>Message (optional)</span>
                <textarea
                  id="vb-message"
                  value={message}
                  maxLength={200}
                  rows={3}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    clear("message");
                  }}
                  {...invalid("message", "vb-message-count")}
                />
              </label>
              <p className="vb__hint" id="vb-message-count">
                {200 - message.length} characters left
              </p>
              {errorFor("message")}
            </fieldset>

            <fieldset>
              <legend>3. Card colour</legend>
              <div className="vb__swatches" id="vb-colourwayId" tabIndex={-1}>
                {p.colourways.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="vb__swatch"
                    aria-pressed={c.id === colourwayId}
                    aria-label={c.name}
                    title={c.name}
                    onClick={() => {
                      setColourwayId(c.id);
                      clear("colourwayId");
                    }}
                    style={{ background: `linear-gradient(135deg, ${c.base}, ${c.base2})`, boxShadow: `inset 0 0 0 3px ${c.foil[1]}` }}
                  />
                ))}
              </div>
              {errorFor("colourwayId")}
            </fieldset>

            <fieldset>
              <legend>4. How should it arrive?</legend>
              <div className="vb__chips">
                <button type="button" className="vb__chip" aria-pressed={deliverTo === "recipient"} onClick={() => {
                    setDeliverTo("recipient");
                    clear("deliverTo");
                  }}>
                  Email it to {shownName}
                </button>
                <button type="button" className="vb__chip" aria-pressed={deliverTo === "buyer"} onClick={() => {
                    setDeliverTo("buyer");
                    clear("deliverTo", "recipientEmail", "deliverOn");
                  }}>
                  Send it to me
                </button>
              </div>
              {deliverTo === "recipient" && (
                <>
                  <label className="vb__field">
                    <span>Their email</span>
                    <input
                      id="vb-recipientEmail"
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      aria-required="true"
                      value={recipientEmail}
                      onChange={(e) => {
                        setRecipientEmail(e.target.value);
                        clear("recipientEmail");
                      }}
                      {...invalid("recipientEmail")}
                    />
                  </label>
                  {errorFor("recipientEmail")}
                  <div className="vb__chips">
                    <button type="button" className="vb__chip" aria-pressed={when === "now"} onClick={() => {
                        setWhen("now");
                        clear("deliverOn");
                      }}>
                      Now
                    </button>
                    <button type="button" className="vb__chip" aria-pressed={when === "date"} onClick={() => setWhen("date")}>
                      On a date
                    </button>
                  </div>
                  {when === "date" && (
                    <label className="vb__field">
                      <span>Date (it arrives at 9am)</span>
                      <input
                        id="vb-deliverOn"
                        type="date"
                        min={p.today}
                        max={latest}
                        aria-required="true"
                        value={deliverOn}
                        onChange={(e) => {
                          setDeliverOn(e.target.value);
                          clear("deliverOn");
                        }}
                        {...invalid("deliverOn")}
                      />
                    </label>
                  )}
                  {errorFor("deliverOn")}
                </>
              )}
              {deliverTo === "buyer" && <p className="vb__hint">We email the voucher to you. Print it or forward it.</p>}
            </fieldset>

            <fieldset>
              <legend>5. Your details</legend>
              <label className="vb__field">
                <span>Your name</span>
                <input
                  id="vb-buyerName"
                  autoComplete="name"
                  aria-required="true"
                  value={buyerName}
                  maxLength={60}
                  onChange={(e) => {
                    setBuyerName(e.target.value);
                    clear("buyerName");
                  }}
                  {...invalid("buyerName")}
                />
              </label>
              {errorFor("buyerName")}
              <label className="vb__field">
                <span>Your email (for the receipt)</span>
                <input
                  id="vb-buyerEmail"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  aria-required="true"
                  value={buyerEmail}
                  onChange={(e) => {
                    setBuyerEmail(e.target.value);
                    clear("buyerEmail");
                  }}
                  {...invalid("buyerEmail")}
                />
              </label>
              {errorFor("buyerEmail")}
            </fieldset>

            {error?.field === "form" || error?.field === "kind" || error?.field === "deliverTo" ? (
              <p className="vb__error" role="alert">
                <AlertCircle size={16} aria-hidden className="vb__errorIcon" />
                <span>{error.message}</span>
              </p>
            ) : null}
            <button type="submit" className="vb__pay" disabled={busy} aria-busy={busy} style={{ background: colourway.base, color: colourway.ink, ["--vb-base" as string]: colourway.base, ["--vb-ink" as string]: colourway.ink }}>
              {busy ? "Opening secure payment" : priceEur > 0 ? `Pay ${formatEuro(priceEur)}` : "Pay"}
            </button>
            <p className="vb__hint">
              Paid securely with Stripe to {p.businessName}. {expiryLabel}.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

const VB_CSS = `
.vb{max-width:1180px;margin:0 auto;padding:clamp(40px,7vw,96px) 16px clamp(56px,8vw,110px);box-sizing:border-box}
@media(min-width:640px){.vb{padding-left:clamp(18px,4vw,40px);padding-right:clamp(18px,4vw,40px)}}
.vb *,.vb *::before,.vb *::after{box-sizing:border-box}
.vb__head h1{font-size:clamp(34px,6vw,60px);line-height:1.05;margin:0}
.vb__head p{margin:.7em 0 0;max-width:56ch;opacity:.78;line-height:1.6}
.vb__grid{display:grid;gap:clamp(28px,4vw,56px);margin-top:clamp(26px,4vw,44px)}
@media(min-width:900px){.vb__grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}.vb__preview{position:sticky;top:96px}}
.vb__note{margin:18px auto 0;max-width:420px;text-align:center;font-style:italic;opacity:.8;line-height:1.6;overflow-wrap:anywhere}
.vb fieldset{border:0;padding:0;margin:0 0 28px;min-width:0}
.vb legend{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:0 0 12px;padding:0}
.vb__chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;outline:none}
.vb__chip{min-height:44px;padding:0 18px;border-radius:999px;border:1px solid rgba(127,127,127,.55);background:transparent;color:inherit;font:inherit;font-size:15px;line-height:1.2;cursor:pointer;max-width:100%;overflow-wrap:anywhere}
.vb__chip[aria-pressed="true"]{border-color:currentColor;box-shadow:inset 0 0 0 1px currentColor;font-weight:600}
.vb__field{display:block;margin:0 0 12px}
.vb__field > span:first-child{display:block;font-size:14px;margin-bottom:6px;opacity:.8}
.vb input,.vb textarea,.vb select{display:block;width:100%;min-height:48px;padding:12px 16px;border-radius:10px;border:1px solid rgba(127,127,127,.55);background:transparent;color:inherit;font:inherit;font-size:16px}
.vb textarea{min-height:96px;resize:vertical}
.vb__select{position:relative;display:block}
.vb select{appearance:none;-webkit-appearance:none;padding-right:40px;cursor:pointer}
/* Kept on purpose: the native dropdown list is painted by the browser on a light panel even on dark sites, and the select inherits a light text colour there. */
.vb select option{color:#111;background:#fff}
.vb__select svg{position:absolute;right:12px;top:50%;transform:translateY(-50%);pointer-events:none;opacity:.75}
.vb__swatches{display:flex;flex-wrap:wrap;gap:12px;outline:none}
.vb__swatch{width:48px;height:48px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
.vb__swatch[aria-pressed="true"]{outline:2px solid currentColor;outline-offset:3px}
.vb__hint{margin:4px 0 0;font-size:13px;opacity:.7;line-height:1.5}
.vb__error{display:flex;align-items:flex-start;gap:8px;margin:4px 0 12px;padding-left:10px;border-left:3px solid currentColor;font-size:14px;line-height:1.4;font-weight:600}
.vb__errorIcon{flex:none;margin-top:1px}
.vb__pay{display:block;width:100%;min-height:54px;padding:0 24px;border:0;border-radius:999px;font:inherit;font-size:17px;font-weight:600;cursor:pointer;margin-top:4px}
.vb__pay[disabled]{opacity:.65;cursor:progress}
.vb__closed{padding:clamp(20px,4vw,32px);border:1px solid rgba(127,127,127,.4);border-radius:14px}
.vb__closed h2{margin:0 0 .4em;font-size:clamp(22px,3vw,28px)}
.vb__closed p{margin:0;line-height:1.6;opacity:.85}
.vb :focus-visible{outline:2px solid currentColor;outline-offset:3px}
.vb__pay:focus-visible{outline:2px solid var(--vb-base,currentColor);outline-offset:2px;box-shadow:inset 0 0 0 2px var(--vb-ink,#fff)}
`;


/**
 * The "confirming your payment" view re-checks on its own: the server page
 * asks Stripe again each time it renders. Every 5 seconds, at most 12 times.
 */
export function AutoRefresh({ everyMs = 5000, max = 12 }: { everyMs?: number; max?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      router.refresh();
      if (n >= max) window.clearInterval(id);
    }, everyMs);
    return () => window.clearInterval(id);
  }, [router, everyMs, max]);
  return null;
}
