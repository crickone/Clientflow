"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, MoreHorizontal, Pencil, Percent, Plus, Trash2 } from "lucide-react";

import { OfferScheduleForm as ScheduleForm } from "./OfferScheduleForm";
import { fromLocalInput, toLocalInput } from "./offerDates";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import {
  createDiscountOffersAction,
  deleteOfferAction,
  saveOfferAction,
  setAllOffersOnSaleAction,
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
}: {
  campaignId: number;
  offers: OfferPanelOffer[];
  orders: OfferOrderRow[];
  services: Service[];
  stripeConnected: boolean;
  landingUrl: string | null;
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
  function remove(o: OfferPanelOffer) {
    start(async () => {
      const r = await deleteOfferAction(campaignId, o.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Offer deleted");
      router.refresh();
    });
  }

  const [scheduling, setScheduling] = useState(false);
  // "Black Friday: Swedish massage" x 13 -> show "Swedish massage" and say the prefix once.
  const prefix = commonPrefix(offers.map((o) => o.title));
  const shortTitle = (t: string) => (prefix ? t.slice(prefix.length) : t);
  const shared = {
    starts: same(offers.map((o) => o.saleStartsAt)),
    ends: same(offers.map((o) => o.saleEndsAt)),
    useBy: same(offers.map((o) => o.useByDate)),
  };
  const first = offers[0];

  return (
    <div className="op">
      <div className="op-head">
        <div>
          <h2 className="op-h">Sell online</h2>
          <p className="op-sub">
            {offers.length === 0
              ? "Sell from this campaign's landing page. Each offer gets its own price and Buy button; buyers pay by card through your Stripe."
              : `${offers.length} ${offers.length === 1 ? "offer" : "offers"} · ${onSaleCount} on sale · ${sold} sold · ${formatEur(revenue)} taken`}
          </p>
        </div>
        <div className="op-head-actions">
          <Button variant="ghost" size="sm" onClick={() => setMode(mode === "discount" ? "none" : "discount")}>
            <Percent size={14} /> Discount services
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode(mode === "add" ? "none" : "add")}>
            <Plus size={14} /> Add an offer
          </Button>
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
        </div>
      </div>

      {!stripeConnected && (
        <p className="op-warn">
          Stripe isn&rsquo;t connected, so buyers can&rsquo;t pay yet. <Link href="/settings/integrations/stripe">Connect Stripe</Link>
        </p>
      )}
      {!landingUrl && offers.length > 0 && <p className="op-warn">Approve this campaign&rsquo;s landing page so there is somewhere to buy.</p>}

      {mode === "discount" && <DiscountForm campaignId={campaignId} services={services} onDone={() => setMode("none")} />}
      {mode === "add" && <OfferForm campaignId={campaignId} offer={null} services={services} onDone={() => setMode("none")} />}

      {offers.length > 0 && (
        <div className="op-sched">
          {scheduling ? (
            <ScheduleForm
              campaignId={campaignId}
              initial={{ starts: shared.starts ? first.saleStartsAt : null, ends: shared.ends ? first.saleEndsAt : null, useBy: shared.useBy ? first.useByDate : "" }}
              onDone={() => setScheduling(false)}
            />
          ) : (
            <>
              <dl className="op-sched-facts">
                <div>
                  <dt>On sale from</dt>
                  <dd>{shared.starts ? (first.saleStartsAt ? shortDateTime(first.saleStartsAt) : "Now") : "Varies"}</dd>
                </div>
                <div>
                  <dt>Until</dt>
                  <dd data-warn={shared.ends && first.saleEndsAt === null}>
                    {shared.ends ? (first.saleEndsAt ? shortDateTime(first.saleEndsAt) : "No end date") : "Varies"}
                  </dd>
                </div>
                <div>
                  <dt>Use by</dt>
                  <dd>{shared.useBy ? longDate(first.useByDate) : "Varies"}</dd>
                </div>
              </dl>
              <Button variant="secondary" size="sm" onClick={() => setScheduling(true)}>
                <CalendarClock size={14} /> Change for all
              </Button>
            </>
          )}
        </div>
      )}

      {offers.length > 0 && (
        <div className="op-list">
          {prefix && <div className="op-list-head">{prefix.replace(/[:\s–-]+$/, "")}</div>}
          {offers.map((o) =>
            mode === o.id ? (
              <OfferForm key={o.id} campaignId={campaignId} offer={o} services={services} onDone={() => setMode("none")} />
            ) : (
              <div key={o.id} className="op-row" data-on={o.isActive}>
                <div className="op-row-main">
                  <span className="op-row-title">{shortTitle(o.title)}</span>
                  {rowMeta(o, nameOf, shared) && <span className="op-muted">{rowMeta(o, nameOf, shared)}</span>}
                </div>
                <span className="op-row-price">
                  {o.compareAtCents ? <s>{formatEur(o.compareAtCents)}</s> : null}
                  {formatEur(o.priceCents)}
                </span>
                {o.isActive ? <span className={`op-state is-${o.state}`}>{stateLabel(o)}</span> : <span className="op-state-gap" aria-hidden />}
                <Switch
                  on={o.isActive}
                  label={`${o.isActive ? "Take" : "Put"} ${shortTitle(o.title)} ${o.isActive ? "off" : "on"} sale`}
                  onClick={() => toggle(o)}
                  disabled={pending || (!o.isActive && !stripeConnected)}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="op-icon" aria-label={`More for ${shortTitle(o.title)}`}>
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setMode(o.id)}>
                      <Pencil size={14} /> Edit
                    </DropdownMenuItem>
                    {o.sold === 0 && (
                      <DropdownMenuItem destructive onSelect={() => remove(o)}>
                        <Trash2 size={14} /> Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ),
          )}
        </div>
      )}

      {offers.length > 0 && (
        <div className="op-orders">
          <h3 className="op-h3">Orders</h3>
          {orders.length === 0 ? (
            <p className="op-muted" style={{ margin: 0 }}>No orders yet. Paid orders appear here, and each buyer is added as a client.</p>
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
                      <td>{shortTitle(o.offerTitle)}</td>
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

function same<T>(xs: T[]): boolean {
  return xs.every((x) => x === xs[0]);
}

/** The shared "Name: " every title starts with, if there is one and more than one offer. */
function commonPrefix(titles: string[]): string {
  if (titles.length < 2) return "";
  const m = /^(.{3,40}?:\s+)/.exec(titles[0]);
  return m && titles.every((t) => t.startsWith(m[1]) && t.length > m[1].length) ? m[1] : "";
}

function shortDateTime(ms: number) {
  const d = new Date(ms);
  const date = d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
  const time = d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
  return time === "00:00" ? date : `${date}, ${time}`;
}

function longDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** What the row needs to say beyond its name: bundles, stock, sales, and dates that differ from the rest. */
function rowMeta(o: OfferPanelOffer, nameOf: (id: number) => string, shared: { starts: boolean; ends: boolean; useBy: boolean }): string {
  const parts: string[] = [];
  const bundle = o.items.length > 1 || o.items.some((i) => i.sessions > 1);
  if (bundle) parts.push(o.items.map((i) => `${i.sessions} x ${nameOf(i.therapyId)}`).join(", "));
  if (o.quantityLimit) parts.push(`${o.sold} of ${o.quantityLimit} sold`);
  else if (o.sold) parts.push(`${o.sold} sold`);
  if (!shared.starts && o.saleStartsAt) parts.push(`from ${shortDateTime(o.saleStartsAt)}`);
  if (!shared.ends && o.saleEndsAt) parts.push(`until ${shortDateTime(o.saleEndsAt)}`);
  if (!shared.useBy) parts.push(`use by ${longDate(o.useByDate)}`);
  return parts.join(" · ");
}

function stateLabel(o: OfferPanelOffer): string {
  if (o.state === "scheduled" && o.saleStartsAt) return `Starts ${new Date(o.saleStartsAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" })}`;
  return OFFER_STATE_LABEL[o.state];
}

function Switch({ on, onClick, disabled, label }: { on: boolean; onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="op-switch" data-on={on} onClick={onClick} disabled={disabled}>
      <span />
    </button>
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
