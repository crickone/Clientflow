"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { saveOfferAction, setOfferOnSaleAction } from "@/app/marketing/campaigns/actions";
import { formatEur, OFFER_STATE_LABEL, type OfferState } from "@/lib/offers/model";

export interface OfferPanelOffer {
  id: number;
  title: string;
  description: string | null;
  priceCents: number;
  compareAtCents: number | null;
  items: { therapyId: number; sessions: number }[];
  quantityLimit: number | null;
  saleStartsAt: number | null;
  saleEndsAt: number | null;
  useByDate: string;
  terms: string | null;
  isActive: boolean;
  state: OfferState;
  sold: number;
  left: number | null;
  revenueCents: number;
  refunded: number;
}

export interface OfferOrderRow {
  id: number;
  createdAt: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  amountCents: number;
  status: string;
  clientId: number | null;
}

/** datetime-local value <-> ms, both in the operator's own (browser) time. */
function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
const euros = (cents: number | null) => (cents === null ? "" : String(cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)));

/**
 * The campaign's offer: what's for sale on its landing page, at what price,
 * how many, until when; whether it's on sale; and who bought it.
 */
export function OfferPanel({
  campaignId,
  offer,
  orders,
  services,
  stripeConnected,
  landingUrl,
}: {
  campaignId: number;
  offer: OfferPanelOffer | null;
  orders: OfferOrderRow[];
  services: { id: number; name: string; priceEur: number }[];
  stripeConnected: boolean;
  landingUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(offer === null);
  const [f, setF] = useState(() => ({
    title: offer?.title ?? "",
    description: offer?.description ?? "",
    price: euros(offer?.priceCents ?? null),
    compareAt: euros(offer?.compareAtCents ?? null),
    items: offer?.items.length ? offer.items : [{ therapyId: 0, sessions: 1 }],
    quantityLimit: offer?.quantityLimit ? String(offer.quantityLimit) : "",
    saleStartsAt: toLocalInput(offer?.saleStartsAt ?? null),
    saleEndsAt: toLocalInput(offer?.saleEndsAt ?? null),
    useByDate: offer?.useByDate ?? "",
    terms: offer?.terms ?? "",
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const usual = f.items.reduce((sum, i) => sum + (services.find((s) => s.id === i.therapyId)?.priceEur ?? 0) * i.sessions, 0);

  function save() {
    start(async () => {
      const r = await saveOfferAction(campaignId, {
        offerId: offer?.id ?? null,
        title: f.title,
        description: f.description,
        price: f.price,
        compareAt: f.compareAt,
        items: f.items,
        quantityLimit: f.quantityLimit,
        saleStartsAt: fromLocalInput(f.saleStartsAt),
        saleEndsAt: fromLocalInput(f.saleEndsAt),
        useByDate: f.useByDate,
        terms: f.terms,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Offer saved");
      setEditing(false);
      router.refresh();
    });
  }

  function onSale(next: boolean) {
    if (!offer) return;
    start(async () => {
      const r = await setOfferOnSaleAction(campaignId, offer.id, next);
      if (!r.ok) return void toast.error(r.error);
      toast.success(next ? "Offer is on sale" : "Offer taken off sale");
      router.refresh();
    });
  }

  return (
    <div className="op">
      <div className="op-head">
        <div>
          <div className="op-eyebrow">Sell online</div>
          {offer && !editing ? (
            <div className="op-title">
              {offer.title} <span className={`op-state is-${offer.state}`}>{OFFER_STATE_LABEL[offer.state]}</span>
            </div>
          ) : (
            <p className="op-sub">Sell a fixed offer from this campaign&rsquo;s landing page. Buyers pay by card through your Stripe.</p>
          )}
        </div>
        {offer && !editing && (
          <div className="op-head-actions">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {offer.isActive ? (
              <Button variant="secondary" size="sm" onClick={() => onSale(false)} loading={pending}>
                Take off sale
              </Button>
            ) : (
              <Button size="sm" onClick={() => onSale(true)} loading={pending} disabled={!stripeConnected}>
                Put on sale
              </Button>
            )}
          </div>
        )}
      </div>

      {!stripeConnected && (
        <p className="op-warn">
          Stripe isn&rsquo;t connected, so buyers can&rsquo;t pay yet. <Link href="/settings/integrations/stripe">Connect Stripe</Link>
        </p>
      )}

      {offer && !editing && (
        <>
          <div className="op-stats">
            <div>
              <span>Price</span>
              <strong>
                {formatEur(offer.priceCents)}
                {offer.compareAtCents ? <s>{formatEur(offer.compareAtCents)}</s> : null}
              </strong>
            </div>
            <div>
              <span>Sold</span>
              <strong>
                {offer.sold}
                {offer.quantityLimit ? ` of ${offer.quantityLimit}` : ""}
              </strong>
            </div>
            <div>
              <span>Revenue</span>
              <strong>{formatEur(offer.revenueCents)}</strong>
            </div>
            <div>
              <span>Use by</span>
              <strong>{new Date(`${offer.useByDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</strong>
            </div>
          </div>
          <div className="op-includes">
            {offer.items.map((i) => (
              <span key={i.therapyId}>
                {i.sessions} x {services.find((s) => s.id === i.therapyId)?.name ?? "Service"}
              </span>
            ))}
            {offer.saleEndsAt && <span className="op-muted">Sale ends {new Date(offer.saleEndsAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</span>}
          </div>
          {offer.isActive && landingUrl && (
            <p className="op-muted" style={{ margin: 0 }}>
              The Buy button is on <a href={landingUrl} target="_blank" rel="noreferrer">the landing page</a>.
            </p>
          )}
          {!landingUrl && <p className="op-warn">Approve this campaign&rsquo;s landing page so there is somewhere to buy it.</p>}

          <div className="op-orders">
            <div className="op-eyebrow">Orders</div>
            {orders.length === 0 ? (
              <p className="op-muted" style={{ margin: 0 }}>No orders yet.</p>
            ) : (
              <div className="ib-table-wrap" style={{ margin: 0 }}>
                <table className="ib-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Buyer</th>
                      <th>Phone</th>
                      <th>Paid</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>{new Date(o.createdAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" })}</td>
                        <td>
                          {o.clientId ? <Link href={`/clients/${o.clientId}`}>{o.name || o.email || "Buyer"}</Link> : o.name || o.email || "Buyer"}
                          {o.email && o.name && <div className="op-muted">{o.email}</div>}
                        </td>
                        <td>{o.phone ?? ""}</td>
                        <td>{formatEur(o.amountCents)}</td>
                        <td>{o.status === "refunded" ? "Refunded" : "Paid"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="op-form">
          <label className="op-field op-wide">
            <span>Offer name</span>
            <input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Black Friday: 2 HBOT + 2 infrared sessions" maxLength={120} />
          </label>

          <div className="op-field op-wide">
            <span>What&rsquo;s included</span>
            <div className="op-items">
              {f.items.map((it, idx) => (
                <div key={idx} className="op-item">
                  <select
                    value={it.therapyId || ""}
                    onChange={(e) => set("items", f.items.map((x, k) => (k === idx ? { ...x, therapyId: Number(e.target.value) } : x)))}
                    aria-label="Service"
                  >
                    <option value="">Pick a service</option>
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({formatEur(Math.round(s.priceEur * 100))})
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={it.sessions}
                    onChange={(e) => set("items", f.items.map((x, k) => (k === idx ? { ...x, sessions: Math.max(1, Math.min(50, Number(e.target.value) || 1)) } : x)))}
                    aria-label="Sessions"
                  />
                  <span className="op-muted">sessions</span>
                  {f.items.length > 1 && (
                    <button type="button" className="op-icon" aria-label="Remove this service" onClick={() => set("items", f.items.filter((_, k) => k !== idx))}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
              {f.items.length < 6 && (
                <button type="button" className="op-add" onClick={() => set("items", [...f.items, { therapyId: 0, sessions: 1 }])}>
                  <Plus size={14} /> Add a service
                </button>
              )}
              {usual > 0 && <span className="op-muted">Usual price for these: {formatEur(Math.round(usual * 100))}</span>}
            </div>
          </div>

          <label className="op-field">
            <span>Offer price (€)</span>
            <input inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="99" />
          </label>
          <label className="op-field">
            <span>Usual price (€, optional)</span>
            <input inputMode="decimal" value={f.compareAt} onChange={(e) => set("compareAt", e.target.value)} placeholder={usual > 0 ? String(Math.round(usual)) : ""} />
            <small>Shown struck through. By law it must be the lowest price you charged in the last 30 days.</small>
          </label>
          <label className="op-field">
            <span>How many for sale (optional)</span>
            <input inputMode="numeric" value={f.quantityLimit} onChange={(e) => set("quantityLimit", e.target.value.replace(/\D/g, ""))} placeholder="No limit" />
          </label>
          <label className="op-field">
            <span>Sessions must be used by</span>
            <input type="date" value={f.useByDate} onChange={(e) => set("useByDate", e.target.value)} />
          </label>
          <label className="op-field">
            <span>Sale starts (optional)</span>
            <input type="datetime-local" value={f.saleStartsAt} onChange={(e) => set("saleStartsAt", e.target.value)} />
          </label>
          <label className="op-field">
            <span>Sale ends (optional)</span>
            <input type="datetime-local" value={f.saleEndsAt} onChange={(e) => set("saleEndsAt", e.target.value)} />
          </label>
          <label className="op-field op-wide">
            <span>Short description (optional)</span>
            <input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={500} placeholder="Shown on the Stripe payment page" />
          </label>
          <label className="op-field op-wide">
            <span>Terms (shown under the Buy button and on the payment page)</span>
            <textarea
              rows={3}
              value={f.terms}
              onChange={(e) => set("terms", e.target.value)}
              maxLength={1000}
              placeholder="Sessions are booked by phone. Non-transferable. You can cancel within 14 days of buying for a full refund if no sessions have been used."
            />
          </label>
          <div className="op-form-actions op-wide">
            {offer && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button onClick={save} loading={pending}>
              Save offer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
