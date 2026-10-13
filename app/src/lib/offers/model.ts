// Pure offer rules, shared by server and client (no server-only).

export interface OfferItem {
  therapyId: number;
  sessions: number;
}

export type OfferState = "off" | "scheduled" | "live" | "sold_out" | "ended";

export const OFFER_STATE_LABEL: Record<OfferState, string> = {
  off: "Not on sale",
  scheduled: "Starts later",
  live: "On sale",
  sold_out: "Sold out",
  ended: "Sale ended",
};

/** Stripe won't take a card payment under 50 cent. */
export const MIN_PRICE_CENTS = 50;

export function parseItems(json: string | null | undefined): OfferItem[] {
  try {
    const raw = JSON.parse(json ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => ({ therapyId: Number(r?.therapyId), sessions: Number(r?.sessions) }))
      .filter((r) => Number.isInteger(r.therapyId) && r.therapyId > 0 && Number.isInteger(r.sessions) && r.sessions > 0);
  } catch {
    return [];
  }
}

/**
 * Whether the offer can be bought right now. `taken` counts paid orders plus
 * checkouts still open, so the last one can't be sold twice while someone
 * is typing their card number.
 */
export function offerState(
  o: { isActive: boolean; saleStartsAt: number | null; saleEndsAt: number | null; quantityLimit: number | null },
  taken: number,
  now: number,
): OfferState {
  if (!o.isActive) return "off";
  if (o.saleEndsAt !== null && now >= o.saleEndsAt) return "ended";
  if (o.saleStartsAt !== null && now < o.saleStartsAt) return "scheduled";
  if (o.quantityLimit !== null && taken >= o.quantityLimit) return "sold_out";
  return "live";
}

export function remaining(limit: number | null, taken: number): number | null {
  return limit === null ? null : Math.max(0, limit - taken);
}

export function formatEur(cents: number): string {
  const whole = cents % 100 === 0;
  return `€${(cents / 100).toLocaleString("en-IE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function savingLabel(priceCents: number, compareAtCents: number | null): string | null {
  if (compareAtCents === null || compareAtCents <= priceCents) return null;
  return `Save ${formatEur(compareAtCents - priceCents)}`;
}

/**
 * Split what was paid across the bundles, in proportion to each one's usual
 * value (weights), in whole cents that add up to the total exactly.
 */
export function splitPrice(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  const w = sum > 0 ? weights.map((x) => Math.max(0, x) / sum) : weights.map(() => 1 / weights.length);
  const raw = w.map((x) => x * totalCents);
  const out = raw.map(Math.floor);
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out;
}

export interface OfferInput {
  title: string;
  description: string | null;
  priceCents: number;
  compareAtCents: number | null;
  items: OfferItem[];
  quantityLimit: number | null;
  saleStartsAt: number | null;
  saleEndsAt: number | null;
  useByDate: string;
  terms: string | null;
}

/** Euro text ("49", "49.50", "€49,50") to cents; null if it isn't a price. */
export function parseEuroToCents(raw: string): number | null {
  const s = raw.replace(/[€\s]/g, "").replace(",", ".");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function validateOffer(input: OfferInput): { ok: true; value: OfferInput } | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title || title.length > 120) return { ok: false, error: "Give the offer a name (up to 120 characters)." };
  if (!Number.isInteger(input.priceCents) || input.priceCents < MIN_PRICE_CENTS || input.priceCents > 100_000_00) {
    return { ok: false, error: "Enter a price between €0.50 and €100,000." };
  }
  if (input.compareAtCents !== null && (!Number.isInteger(input.compareAtCents) || input.compareAtCents <= input.priceCents)) {
    return { ok: false, error: "The usual price has to be higher than the offer price, or left blank." };
  }
  if (input.items.length === 0) return { ok: false, error: "Add at least one service to the offer." };
  if (input.items.length > 6) return { ok: false, error: "An offer can include up to 6 services." };
  if (input.items.some((i) => i.sessions < 1 || i.sessions > 50)) return { ok: false, error: "Each service needs between 1 and 50 sessions." };
  if (new Set(input.items.map((i) => i.therapyId)).size !== input.items.length) return { ok: false, error: "Each service can only be in the offer once." };
  if (input.quantityLimit !== null && (!Number.isInteger(input.quantityLimit) || input.quantityLimit < 1 || input.quantityLimit > 10000)) {
    return { ok: false, error: "How many are for sale has to be between 1 and 10,000, or left blank." };
  }
  if (input.saleStartsAt !== null && input.saleEndsAt !== null && input.saleEndsAt <= input.saleStartsAt) {
    return { ok: false, error: "The sale has to end after it starts." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.useByDate)) return { ok: false, error: "Pick the date the sessions must be used by." };
  const terms = input.terms?.trim() || null;
  if (terms && terms.length > 1000) return { ok: false, error: "Keep the terms under 1,000 characters." };
  const description = input.description?.trim() || null;
  if (description && description.length > 500) return { ok: false, error: "Keep the description under 500 characters." };
  return { ok: true, value: { ...input, title, terms, description } };
}
