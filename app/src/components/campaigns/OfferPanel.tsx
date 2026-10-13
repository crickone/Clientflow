"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Lock, Percent, Plus, Trash2, Unlock } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import {
  createDiscountOffersAction,
  deleteOfferAction,
  saveOfferAction,
  setAllOffersOnSaleAction,
  setAdOnlyAction,
  setOfferOnSaleAction,
} from "@/app/marketing/campaigns/actions";
import { discountedCents, formatEur, OFFER_STATE_LABEL, type OfferState } from "@/lib/offers/model";

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
  offerTitle: string;
}

type Service = { id: number; name: string; priceEur: number };

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
const isMassage = (name: string) => /massage|reflexology|lymphatic|hot lava|cupping|pamper/i.test(name);

/**
 * What a campaign sells from its landing page: one or more offers, each its
 * own price and Buy button. Add one by hand, or a percentage off several
 * services at once; edit, put on and take off sale; see who bought what.
 */
export function OfferPanel({
  campaignId,
  offers,
  orders,
  services,
  stripeConnected,
  landingUrl,
  accessKey,
}: {
  campaignId: number;
  offers: OfferPanelOffer[];
  orders: OfferOrderRow[];
  services: Service[];
  stripeConnected: boolean;
  landingUrl: string | null;
  accessKey: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"none" | "discount" | "add" | number>("none");
  const nameOf = (id: number) => services.find((s) => s.id === id)?.name ?? "Service";
  const onSaleCount = offers.filter((o) => o.isActive).length;
  const revenue = offers.reduce((sum, o) => sum + o.revenueCents, 0);
  const sold = offers.reduce((sum, o) => sum + o.sold, 0);

  function toggle(o: OfferPanelOffer) {
    start(async () => {
      const r = await setOfferOnSaleAction(campaignId, o.id, !o.isActive);
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  }
  function all(onSale: boolean) {
    start(async () => {
      const r = await setAllOffersOnSaleAction(campaignId, onSale);
      if (!r.ok) return void toast.error(r.error);
      toast.success(onSale ? "All offers are on sale" : "All offers taken off sale");
      router.refresh();
    });
  }
  const adLink = landingUrl && accessKey ? `${landingUrl}${landingUrl.includes("?") ? "&" : "?"}k=${accessKey}` : null;
  function adOnly(on: boolean) {
    start(async () => {
      const r = await setAdOnlyAction(campaignId, on);
      if (!r.ok) return void toast.error(r.error);
      toast.success(on ? "Prices now show only through the ad link" : "Prices now show to everyone on the page");
      router.refresh();
    });
  }
  async function copyLink() {
    if (!adLink) return;
    try {
      const full = adLink.startsWith("/") ? `${window.location.origin}${adLink}` : adLink;
      await navigator.clipboard.writeText(full);
      toast.success("Ad link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  function remove(o: OfferPanelOffer) {
    start(async () => {
      const r = await deleteOfferAction(campaignId, o.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Offer deleted");
      router.refresh();
    });
  }

  return (
    <div className="op">
      <div className="op-head">
        <div>
          <div className="op-eyebrow">Sell online</div>
          <p className="op-sub">
            {offers.length === 0
              ? "Sell from this campaign's landing page. Each offer gets its own price and Buy button; buyers pay by card through your Stripe."
              : `${offers.length} ${offers.length === 1 ? "offer" : "offers"}, ${onSaleCount} on sale · ${sold} sold · ${formatEur(revenue)} taken`}
          </p>
        </div>
        <div className="op-head-actions">
          {offers.length > 1 &&
            (onSaleCount < offers.length ? (
              <Button size="sm" onClick={() => all(true)} loading={pending} disabled={!stripeConnected}>
                Put all on sale
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => all(false)} loading={pending}>
                Take all off sale
              </Button>
            ))}
          <Button variant="secondary" size="sm" onClick={() => setMode(mode === "discount" ? "none" : "discount")}>
            <Percent size={14} /> Discount services
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode(mode === "add" ? "none" : "add")}>
            <Plus size={14} /> Add an offer
          </Button>
        </div>
      </div>

      {!stripeConnected && (
        <p className="op-warn">
          Stripe isn&rsquo;t connected, so buyers can&rsquo;t pay yet. <Link href="/settings/integrations/stripe">Connect Stripe</Link>
        </p>
      )}
      {!landingUrl && offers.length > 0 && <p className="op-warn">Approve this campaign&rsquo;s landing page so there is somewhere to buy.</p>}

      {offers.length > 0 && (
        <div className="op-access" data-on={Boolean(accessKey)}>
          <span className="op-access-icon" aria-hidden>
            {accessKey ? <Lock size={15} /> : <Unlock size={15} />}
          </span>
          <div className="op-access-text">
            <strong>{accessKey ? "Ad-only prices" : "Prices show to everyone on the page"}</strong>
            <span>
              {accessKey
                ? "Only people who arrive through the ad link see the prices and Buy buttons. Anyone else sees the page with the sign-up form. The page is hidden from Google."
                : "Make it ad-only so the prices show just to people who click your ad."}
            </span>
            {adLink && (
              <span className="op-adlink">
                <code>{adLink}</code>
                <button type="button" className="op-copy" onClick={copyLink}>
                  <Copy size={13} /> Copy ad link
                </button>
              </span>
            )}
          </div>
          <Button variant={accessKey ? "ghost" : "secondary"} size="sm" onClick={() => adOnly(!accessKey)} loading={pending}>
            {accessKey ? "Show to everyone" : "Make ad-only"}
          </Button>
        </div>
      )}

      {mode === "discount" && <DiscountForm campaignId={campaignId} services={services} onDone={() => setMode("none")} />}
      {mode === "add" && <OfferForm campaignId={campaignId} offer={null} services={services} onDone={() => setMode("none")} />}

      {offers.length > 0 && (
        <div className="op-list">
          {offers.map((o) =>
            mode === o.id ? (
              <OfferForm key={o.id} campaignId={campaignId} offer={o} services={services} onDone={() => setMode("none")} />
            ) : (
              <div key={o.id} className="op-row">
                <div className="op-row-main">
                  <span className="op-row-title">{o.title}</span>
                  <span className="op-muted">
                    {o.items.map((i) => `${i.sessions} x ${nameOf(i.therapyId)}`).join(", ")}
                    {o.quantityLimit ? ` · ${o.sold} of ${o.quantityLimit} sold` : o.sold ? ` · ${o.sold} sold` : ""}
                  </span>
                </div>
                <span className="op-row-price">
                  {formatEur(o.priceCents)}
                  {o.compareAtCents ? <s>{formatEur(o.compareAtCents)}</s> : null}
                </span>
                <span className={`op-state is-${o.state}`}>{OFFER_STATE_LABEL[o.state]}</span>
                <div className="op-row-actions">
                  <Button variant="ghost" size="sm" onClick={() => setMode(o.id)}>
                    Edit
                  </Button>
                  <Button variant={o.isActive ? "secondary" : "primary"} size="sm" onClick={() => toggle(o)} disabled={pending || (!o.isActive && !stripeConnected)}>
                    {o.isActive ? "Take off sale" : "Put on sale"}
                  </Button>
                  {o.sold === 0 && (
                    <button type="button" className="op-icon" aria-label={`Delete ${o.title}`} onClick={() => remove(o)} disabled={pending}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {offers.length > 0 && onSaleCount > 0 && landingUrl && (
        <p className="op-muted" style={{ margin: 0 }}>
          The offers on sale are on <a href={adLink ?? landingUrl} target="_blank" rel="noreferrer">the landing page</a>
          {adLink ? " (opened with the ad link, so you see what ad visitors see)." : "."}
        </p>
      )}

      {offers.length > 0 && (
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
                    <th>Bought</th>
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
                        {o.phone && <div className="op-muted">{o.phone}</div>}
                      </td>
                      <td>{o.offerTitle}</td>
                      <td>{formatEur(o.amountCents)}</td>
                      <td>{o.status === "refunded" ? "Refunded" : "Paid"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The sale window, use-by date and terms, shared by both forms. */
function SaleFields({
  v,
  set,
}: {
  v: { quantityLimit: string; saleStartsAt: string; saleEndsAt: string; useByDate: string; terms: string };
  set: (k: "quantityLimit" | "saleStartsAt" | "saleEndsAt" | "useByDate" | "terms", value: string) => void;
}) {
  return (
    <>
      <label className="op-field">
        <span>How many for sale (optional)</span>
        <input inputMode="numeric" value={v.quantityLimit} onChange={(e) => set("quantityLimit", e.target.value.replace(/\D/g, ""))} placeholder="No limit" />
      </label>
      <label className="op-field">
        <span>Sessions must be used by</span>
        <input type="date" value={v.useByDate} onChange={(e) => set("useByDate", e.target.value)} />
      </label>
      <label className="op-field">
        <span>Sale starts (optional)</span>
        <input type="datetime-local" value={v.saleStartsAt} onChange={(e) => set("saleStartsAt", e.target.value)} />
      </label>
      <label className="op-field">
        <span>Sale ends (optional)</span>
        <input type="datetime-local" value={v.saleEndsAt} onChange={(e) => set("saleEndsAt", e.target.value)} />
      </label>
      <label className="op-field op-wide">
        <span>Terms (shown under the Buy button and on the payment page)</span>
        <textarea
          rows={3}
          value={v.terms}
          onChange={(e) => set("terms", e.target.value)}
          maxLength={1000}
          placeholder="Sessions are booked by phone. Non-transferable. You can cancel within 14 days of buying for a full refund if no sessions have been used."
        />
      </label>
    </>
  );
}

function DiscountForm({ campaignId, services, onDone }: { campaignId: number; services: Service[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<number[]>(() => services.filter((s) => isMassage(s.name)).map((s) => s.id));
  const [pct, setPct] = useState("20");
  const [prefix, setPrefix] = useState("Black Friday");
  const [sessions, setSessions] = useState(1);
  const [v, setV] = useState({ quantityLimit: "", saleStartsAt: "", saleEndsAt: "", useByDate: "", terms: "" });
  const pctNum = Number(pct);
  const preview = useMemo(
    () =>
      services
        .filter((s) => picked.includes(s.id))
        .map((s) => {
          const usual = Math.round(s.priceEur * 100) * sessions;
          return { ...s, usual, now: Number.isFinite(pctNum) && pctNum > 0 ? discountedCents(usual, pctNum) : usual };
        }),
    [services, picked, pctNum, sessions],
  );

  function create() {
    start(async () => {
      const r = await createDiscountOffersAction(campaignId, {
        therapyIds: picked,
        percentOff: pctNum,
        sessions,
        titlePrefix: prefix,
        quantityLimit: v.quantityLimit,
        saleStartsAt: fromLocalInput(v.saleStartsAt),
        saleEndsAt: fromLocalInput(v.saleEndsAt),
        useByDate: v.useByDate,
        terms: v.terms,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.created} offers added. Check them, then put them on sale.`);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="op-form">
      <div className="op-field op-wide">
        <span>Services</span>
        <div className="op-picks">
          {services.map((s) => (
            <label key={s.id} className="op-pick" data-on={picked.includes(s.id)}>
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={(e) => setPicked((xs) => (e.target.checked ? [...xs, s.id] : xs.filter((x) => x !== s.id)))}
              />
              <span>{s.name}</span>
              <span className="op-muted">{formatEur(Math.round(s.priceEur * 100))}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="op-field">
        <span>Discount (%)</span>
        <input inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} />
      </label>
      <label className="op-field">
        <span>Sessions in each offer</span>
        <input type="number" min={1} max={50} value={sessions} onChange={(e) => setSessions(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
      </label>
      <label className="op-field op-wide">
        <span>Name in front of each offer</span>
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={40} placeholder="Black Friday" />
      </label>
      <SaleFields v={v} set={(k, value) => setV((x) => ({ ...x, [k]: value }))} />
      {preview.length > 0 && (
        <div className="op-field op-wide">
          <span>
            {preview.length} {preview.length === 1 ? "offer" : "offers"} will be added, switched off until you put them on sale
          </span>
          <ul className="op-preview">
            {preview.map((p) => (
              <li key={p.id}>
                <span>
                  {prefix ? `${prefix}: ` : ""}
                  {sessions > 1 ? `${sessions} x ` : ""}
                  {p.name}
                </span>
                <span>
                  <s>{formatEur(p.usual)}</s> {formatEur(p.now)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="op-form-actions op-wide">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={create} loading={pending} disabled={preview.length === 0}>
          Add {preview.length || ""} {preview.length === 1 ? "offer" : "offers"}
        </Button>
      </div>
    </div>
  );
}

function OfferForm({ campaignId, offer, services, onDone }: { campaignId: number; offer: OfferPanelOffer | null; services: Service[]; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
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
      onDone();
      router.refresh();
    });
  }

  return (
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
      <SaleFields v={f} set={(k, value) => set(k, value)} />
      <label className="op-field op-wide">
        <span>Short description (optional)</span>
        <input value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={500} placeholder="Shown on the Stripe payment page" />
      </label>
      <div className="op-form-actions op-wide">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={pending}>
          Save offer
        </Button>
      </div>
    </div>
  );
}
