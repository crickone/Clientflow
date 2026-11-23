// app/src/lib/vouchers/model.ts
/**
 * The voucher store's rules, pure. No imports: the public builder (a client
 * component) runs the same checks the server runs, so a buyer sees the same
 * message in the browser that the checkout route would give.
 *
 * Money is held in cents wherever it is added or compared, and euros only at
 * the edges (the gift_vouchers columns are REAL euros, as they always were).
 */

// ---- limits ------------------------------------------------------------------

/** Consumer Rights Act 2022: a gift voucher must be valid for at least 5 years. */
export const MIN_EXPIRY_YEARS = 5;
export const MAX_EXPIRY_YEARS = 20;
export const MIN_VOUCHER_EUR = 5;
export const MAX_VOUCHER_EUR = 2000;
export const MAX_PRESET_AMOUNTS = 8;
export const MAX_INTRO = 200;
export const MAX_MESSAGE = 200;
export const MAX_NAME = 60;
/** A dated gift is emailed at this hour, Irish time. */
export const DELIVERY_HOUR = 9;

export type VoucherKind = "amount" | "treatment";
export type DeliverTo = "buyer" | "recipient";

// ---- store settings ------------------------------------------------------------

export interface VoucherStoreSettings {
  enabled: boolean;
  /** Whole euros, ascending, no repeats. */
  amounts: number[];
  allowCustom: boolean;
  customMin: number;
  customMax: number;
  /** Active therapies sold as one-session vouchers, at their list price. */
  therapyIds: number[];
  intro: string;
  expiryYears: number;
  /** Where "Book with this voucher" goes. Blank means the business's phone. */
  bookUrl: string;
}

export const DEFAULT_STORE_SETTINGS: VoucherStoreSettings = {
  enabled: false,
  amounts: [25, 50, 100],
  allowCustom: true,
  customMin: 25,
  customMax: 500,
  therapyIds: [],
  intro: "",
  expiryYears: MIN_EXPIRY_YEARS,
  bookUrl: "",
};

const isWholeEuro = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= MIN_VOUCHER_EUR && n <= MAX_VOUCHER_EUR;

function cleanAmounts(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(isWholeEuro))].sort((a, b) => a - b).slice(0, MAX_PRESET_AMOUNTS);
}

function cleanIds(list: unknown): number[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0))];
}

/**
 * Read the stored setting, forgiving: anything unreadable falls back to the
 * default, and the expiry can never come back below the legal floor whatever
 * was stored.
 */
export function parseStoreSettings(raw: unknown): VoucherStoreSettings {
  const d = DEFAULT_STORE_SETTINGS;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...d, amounts: [...d.amounts], therapyIds: [] };
  const r = raw as Record<string, unknown>;
  const customMin = isWholeEuro(r.customMin) ? r.customMin : d.customMin;
  const customMax = isWholeEuro(r.customMax) && r.customMax >= customMin ? r.customMax : Math.max(customMin, d.customMax);
  const years = typeof r.expiryYears === "number" && Number.isFinite(r.expiryYears) ? Math.floor(r.expiryYears) : d.expiryYears;
  return {
    enabled: r.enabled === true,
    amounts: Array.isArray(r.amounts) ? cleanAmounts(r.amounts) : [...d.amounts],
    allowCustom: typeof r.allowCustom === "boolean" ? r.allowCustom : d.allowCustom,
    customMin,
    customMax,
    therapyIds: cleanIds(r.therapyIds),
    intro: typeof r.intro === "string" ? r.intro.trim().slice(0, MAX_INTRO) : "",
    expiryYears: Math.min(MAX_EXPIRY_YEARS, Math.max(MIN_EXPIRY_YEARS, years)),
    bookUrl: typeof r.bookUrl === "string" && /^https?:\/\/\S+$/.test(r.bookUrl.trim()) ? r.bookUrl.trim() : "",
  };
}

/** "25, 50, €100" -> [25, 50, 100]. Null when any part is not a number. */
export function parseAmountList(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).map((p) => p.replace(/[€]/g, "").trim()).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return null;
    out.push(Number(p));
  }
  return out;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the settings form saves. Strict: every problem is a sentence for the owner. */
export function validateStoreSettings(input: VoucherStoreSettings): Checked<VoucherStoreSettings> {
  // The draft comes from a request body: never throw on a malformed one. Coerce
  // the lists and strings to empty so every check below is safe to run, and
  // report a wrong type as an ordinary error rather than saving it.
  const malformed =
    !Array.isArray(input.amounts) || !Array.isArray(input.therapyIds) || typeof input.intro !== "string" || typeof input.bookUrl !== "string";
  const draft: VoucherStoreSettings = {
    ...input,
    amounts: Array.isArray(input.amounts) ? input.amounts : [],
    therapyIds: Array.isArray(input.therapyIds) ? input.therapyIds : [],
    intro: typeof input.intro === "string" ? input.intro : "",
    bookUrl: typeof input.bookUrl === "string" ? input.bookUrl : "",
  };
  if (malformed) return { ok: false, error: "Those settings could not be read. Reload the page and try again." };
  if (draft.amounts.some((a) => !isWholeEuro(a))) {
    return { ok: false, error: `Amounts must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
  }
  const amounts = cleanAmounts(draft.amounts);
  if (amounts.length > MAX_PRESET_AMOUNTS || new Set(draft.amounts).size > MAX_PRESET_AMOUNTS) {
    return { ok: false, error: `Use up to ${MAX_PRESET_AMOUNTS} amounts.` };
  }
  if (draft.allowCustom) {
    if (!isWholeEuro(draft.customMin)) return { ok: false, error: `The lowest other amount must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
    if (!isWholeEuro(draft.customMax)) return { ok: false, error: `The highest other amount must be whole euros from €${MIN_VOUCHER_EUR} to €${MAX_VOUCHER_EUR}.` };
    if (draft.customMax < draft.customMin) return { ok: false, error: "The highest other amount must be at least the lowest." };
  }
  if (!Number.isInteger(draft.expiryYears) || draft.expiryYears < MIN_EXPIRY_YEARS) {
    return { ok: false, error: `Vouchers must last at least ${MIN_EXPIRY_YEARS} years. That is the law in Ireland.` };
  }
  if (draft.expiryYears > MAX_EXPIRY_YEARS) return { ok: false, error: `Vouchers can last at most ${MAX_EXPIRY_YEARS} years.` };
  const intro = draft.intro.trim();
  if (intro.length > MAX_INTRO) return { ok: false, error: `Keep the intro to ${MAX_INTRO} characters.` };
  const bookUrl = draft.bookUrl.trim();
  if (bookUrl && !/^https?:\/\/\S+$/.test(bookUrl)) return { ok: false, error: "The booking link must start with https://" };
  const therapyIds = cleanIds(draft.therapyIds);
  if (draft.enabled && amounts.length === 0 && !draft.allowCustom && therapyIds.length === 0) {
    return { ok: false, error: "Add an amount or a treatment before you switch the store on." };
  }
  return {
    ok: true,
    value: {
      enabled: draft.enabled,
      amounts,
      allowCustom: draft.allowCustom,
      customMin: draft.allowCustom ? draft.customMin : DEFAULT_STORE_SETTINGS.customMin,
      customMax: draft.allowCustom ? draft.customMax : DEFAULT_STORE_SETTINGS.customMax,
      therapyIds,
      intro,
      expiryYears: draft.expiryYears,
      bookUrl,
    },
  };
}

/** Null when a buyer may choose this amount, else the reason. */
export function checkAmount(s: VoucherStoreSettings, euros: number | null): string | null {
  if (euros === null || !Number.isFinite(euros)) return "Choose an amount.";
  if (s.amounts.includes(euros)) return null;
  if (!s.allowCustom) return "Choose one of the amounts.";
  if (!Number.isInteger(euros)) return "Enter whole euros.";
  if (euros < s.customMin) return `The lowest amount is €${s.customMin}.`;
  if (euros > s.customMax) return `The highest amount is €${s.customMax}.`;
  return null;
}

// ---- dates (Irish time) ----------------------------------------------------------

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isYmd(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = YMD.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** The calendar date in Ireland at this instant, YYYY-MM-DD. */
export function dublinDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Calendar months later; the 31st becomes the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const m = YMD.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const total = +m[1] * 12 + (+m[2] - 1) + months;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return ymd(y, mo, Math.min(+m[3], daysInMonth(y, mo)));
}

/**
 * Whole years later. 29 February in a non-leap year rolls FORWARD to 1 March,
 * so the result is never earlier than the full years asked for (a voucher must
 * last at least 5 years).
 */
export function addYears(date: string, years: number): string {
  const m = YMD.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const y = +m[1] + years;
  if (+m[2] === 2 && +m[3] === 29 && Number.isInteger(y) && daysInMonth(y, 2) < 29) return ymd(y, 3, 1);
  return addMonths(date, years * 12);
}

/**
 * The expiry printed on a voucher: purchase date plus the setting, never under
 * 5 years and never over the maximum. A non-finite setting counts as the minimum.
 */
export function expiryDate(purchaseDate: string, years: number): string {
  const whole = Number.isFinite(years) ? Math.floor(years) : MIN_EXPIRY_YEARS;
  return addYears(purchaseDate, Math.min(MAX_EXPIRY_YEARS, Math.max(MIN_EXPIRY_YEARS, whole)));
}

/** The latest day a buyer may choose for the gift email: 12 months ahead. */
export function latestDeliveryDate(today: string): string {
  return addMonths(today, 12);
}

/** Minutes Ireland is ahead of UTC at this instant: 0 in winter, 60 in summer. */
function dublinOffsetMinutes(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** The instant it is `hour`:00 on `date` in Ireland, whichever side of a clock change. */
export function dublinTimeToUtc(date: string, hour: number): number {
  const m = YMD.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], hour);
  const first = dublinOffsetMinutes(guess);
  let t = guess - first * 60000;
  const second = dublinOffsetMinutes(t);
  if (second !== first) t = guess - second * 60000;
  return t;
}

/** When the gift email goes: at once with no date, else 09:00 Irish time that day. */
export function deliveryTime(deliverOn: string | null, paidAtMs: number): number {
  return deliverOn === null ? paidAtMs : dublinTimeToUtc(deliverOn, DELIVERY_HOUR);
}

export function isDeliveryDue(deliverOn: string | null, now: number): boolean {
  return deliverOn === null || dublinTimeToUtc(deliverOn, DELIVERY_HOUR) <= now;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2031-11-23" -> "23 November 2031". */
export function formatLongDate(date: string): string {
  const m = YMD.exec(date);
  if (!m) return date;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// ---- money ---------------------------------------------------------------------

export const toCents = (eur: number): number => Math.round(eur * 100);

/** "€50" for whole euros, "€12.50" otherwise. */
export function formatEuro(eur: number): string {
  const cents = toCents(eur);
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** What a voucher has left: its value less every use, never below nothing. */
export function balanceFrom(valueEur: number, redemptionsEur: readonly number[]): number {
  const left = toCents(valueEur) - redemptionsEur.reduce((s, r) => s + toCents(r), 0);
  return Math.max(0, left) / 100;
}

export interface PaymentSplit {
  /** Paid by the voucher: the "voucher" payment row. */
  voucherEur: number;
  /** Still to pay by another method: the second payment row. */
  remainderEur: number;
  /** Taken off the voucher's balance: the voucher_redemptions row. */
  redemptionEur: number;
}

/**
 * How a booking is paid with a voucher.
 *  - Money voucher: it pays up to its balance; the rest is a second payment.
 *  - Treatment voucher: it pays for one session of its treatment at today's
 *    price, whatever it cost when bought, and is then used up.
 */
export function splitPayment(
  v: { kind: VoucherKind; balanceEur: number },
  priceEur: number,
  treatmentPriceEur: number | null = null,
): PaymentSplit {
  // Non-finite money counts as nothing, so a result is never NaN or negative.
  const cents = (eur: number | null | undefined) => (typeof eur === "number" && Number.isFinite(eur) ? Math.max(0, toCents(eur)) : 0);
  const price = cents(priceEur);
  const balance = cents(v.balanceEur);
  if (v.kind === "treatment") {
    // A used-up voucher covers nothing. A missing treatment price covers nothing
    // too: the booking price is never a stand-in for it.
    if (balance <= 0) return { voucherEur: 0, remainderEur: price / 100, redemptionEur: 0 };
    const covers = Math.min(price, cents(treatmentPriceEur));
    // Used up only when it actually pays for something.
    return { voucherEur: covers / 100, remainderEur: (price - covers) / 100, redemptionEur: covers > 0 ? balance / 100 : 0 };
  }
  const covers = Math.min(price, balance);
  return { voucherEur: covers / 100, remainderEur: (price - covers) / 100, redemptionEur: covers / 100 };
}

export type VoucherState = "active" | "part_used" | "used" | "expired" | "cancelled";

/** Cancelled and used-up vouchers can't be taken; an expired one still can, with a warning. */
export function voucherState(
  v: { valueEur: number; balanceEur: number; expiryDate: string; cancelledAt: number | null },
  today: string,
): VoucherState {
  if (v.cancelledAt) return "cancelled";
  if (toCents(v.balanceEur) <= 0) return "used";
  if (v.expiryDate < today) return "expired";
  if (toCents(v.balanceEur) < toCents(v.valueEur)) return "part_used";
  return "active";
}

// ---- codes ---------------------------------------------------------------------

/** No 0/O or 1/I, so a code read out over the phone survives. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SMALL_WORDS = new Set(["and", "at", "the", "of", "for", "in", "on", "by", "a"]);

/** "Optimal Health & Recovery at Inspire" -> "OH". Two letters from the first two real words. */
export function codePrefix(businessName: string): string {
  const words = businessName
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return letters.length === 2 ? letters : (letters + "GV").slice(0, 2);
}

/** "OH", 2026, [3, 17, 0, 30] -> "OH-2026-DTA8". Indexes pick from CODE_ALPHABET. */
export function formatCode(prefix: string, year: number, picks: readonly number[]): string {
  const tail = picks.map((i) => CODE_ALPHABET[((i % CODE_ALPHABET.length) + CODE_ALPHABET.length) % CODE_ALPHABET.length]).join("");
  return `${prefix}-${year}-${tail}`;
}

/** How staff type a code at the desk: any case, stray spaces. */
export function normaliseCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

// ---- colourways ----------------------------------------------------------------

export interface Colourway {
  id: string;
  name: string;
  /** The card's ground, top-left to bottom-right. */
  base: string;
  base2: string;
  /** The foil sheen, three stops. */
  foil: [string, string, string];
  /** Text on the card. Always readable on both base colours. */
  ink: string;
}

const HEX = /^#[0-9a-f]{6}$/;
const GOLD = "#e8c98a";
const SILVER = "#dfe3ea";

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * Three or four foil colourways from a business's own colours. Pure and
 * deterministic: the same palette always gives the same cards, so a voucher
 * bought today looks the same in the email, on the gift page and at the desk.
 * The brand colour is the most vivid mid-tone in the palette; a second colour
 * far enough round the wheel from it adds a two-tone card.
 */
export function colourways(palette: readonly string[]): Colourway[] {
  const hexes = [...new Set(palette.map((p) => p.trim().toLowerCase()).filter((p) => HEX.test(p)))];
  const list = hexes.length ? hexes : ["#3d4a5c"];
  const hsl = list.map(hexToHsl);
  const vivid = (c: Hsl) => c.s * (1 - Math.abs(c.l - 0.5) * 1.2);
  let brand = hsl[0]!;
  for (const c of hsl) if (vivid(c) > vivid(brand)) brand = c;
  const second = hsl.find((c) => c !== brand && c.s >= 0.15 && hueGap(c.h, brand.h) >= 40) ?? null;
  const bs = clamp(brand.s, 0.35, 0.75);
  const out: Colourway[] = [
    {
      id: "signature",
      name: "Signature",
      base: hslToHex(brand.h, bs, 0.22),
      base2: hslToHex(brand.h, bs, 0.12),
      foil: [hslToHex(brand.h, 0.8, 0.72), GOLD, hslToHex(brand.h + 40, 0.7, 0.75)],
      ink: "#fdf8f0",
    },
    {
      id: "night",
      name: "Night",
      base: hslToHex(brand.h, 0.18, 0.11),
      base2: hslToHex(brand.h, 0.12, 0.05),
      foil: [GOLD, hslToHex(brand.h, 0.6, 0.7), SILVER],
      ink: "#f6f1e7",
    },
    {
      id: "pale",
      name: "Pale",
      base: hslToHex(brand.h, 0.35, 0.93),
      base2: hslToHex(brand.h, 0.3, 0.84),
      foil: [hslToHex(brand.h, 0.7, 0.6), SILVER, GOLD],
      ink: hslToHex(brand.h, 0.45, 0.16),
    },
  ];
  if (second) {
    out.push({
      id: "duo",
      name: "Two-tone",
      base: hslToHex(second.h, clamp(second.s, 0.35, 0.75), 0.24),
      base2: hslToHex(brand.h, bs, 0.14),
      foil: [hslToHex(second.h, 0.8, 0.72), hslToHex(brand.h, 0.8, 0.72), GOLD],
      ink: "#fdf8f0",
    });
  }
  return out;
}

export function findColourway(list: readonly Colourway[], id: string): Colourway | null {
  return list.find((c) => c.id === id) ?? null;
}

/** A colourway saved on an order or voucher (JSON), or null when unreadable. */
export function parseColourway(json: string | null | undefined): Colourway | null {
  if (!json) return null;
  try {
    const c = JSON.parse(json) as Partial<Colourway>;
    const ok =
      typeof c.id === "string" &&
      typeof c.name === "string" &&
      [c.base, c.base2, c.ink].every((x) => typeof x === "string" && HEX.test(x)) &&
      Array.isArray(c.foil) &&
      c.foil.length === 3 &&
      c.foil.every((x) => typeof x === "string" && HEX.test(x));
    return ok ? (c as Colourway) : null;
  } catch {
    return null;
  }
}

// ---- the buyer's order ---------------------------------------------------------

export interface OrderDraft {
  kind: VoucherKind;
  amountEur: number | null;
  therapyId: number | null;
  toName: string;
  fromName: string;
  message: string;
  colourwayId: string;
  deliverTo: DeliverTo;
  recipientEmail: string;
  /** YYYY-MM-DD, or null for "now". Only for deliverTo "recipient". */
  deliverOn: string | null;
  buyerName: string;
  buyerEmail: string;
}

export type OrderDraftField = keyof OrderDraft;

/** A draft from a request body, every field coerced to its type (validateOrder judges it). */
export function parseOrderDraft(raw: unknown): OrderDraft {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    kind: r.kind === "treatment" ? "treatment" : "amount",
    amountEur: num(r.amountEur),
    therapyId: num(r.therapyId),
    toName: str(r.toName),
    fromName: str(r.fromName),
    message: str(r.message),
    colourwayId: str(r.colourwayId),
    deliverTo: r.deliverTo === "recipient" ? "recipient" : "buyer",
    recipientEmail: str(r.recipientEmail),
    deliverOn: typeof r.deliverOn === "string" && r.deliverOn ? r.deliverOn : null,
    buyerName: str(r.buyerName),
    buyerEmail: str(r.buyerEmail),
  };
}

export interface ValidOrder {
  kind: VoucherKind;
  valueCents: number;
  therapyId: number | null;
  therapyName: string | null;
  toName: string;
  fromName: string;
  message: string | null;
  colourwayId: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
  buyerName: string;
  buyerEmail: string;
}

export interface StoreTreatment {
  id: number;
  name: string;
  priceEur: number;
}

export interface OrderContext {
  settings: VoucherStoreSettings;
  /** The treatments on sale (already filtered to active and ticked). */
  treatments: readonly StoreTreatment[];
  colourwayIds: readonly string[];
  today: string;
}

export type OrderCheck = { ok: true; order: ValidOrder } | { ok: false; field: OrderDraftField; error: string };

// No whitespace, comma, semicolon, angle bracket or quote anywhere: one plain address only.
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;

export function isEmail(s: string): boolean {
  return s.length <= 254 && EMAIL.test(s);
}

/** Trim, fold control characters to spaces and squash runs of spaces. */
function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/ {2,}/g, " ").trim() : "";
}

export function validateOrder(draft: OrderDraft, ctx: OrderContext): OrderCheck {
  let valueCents: number;
  let therapyId: number | null = null;
  let therapyName: string | null = null;
  if (draft.kind === "treatment") {
    const t = ctx.treatments.find((x) => x.id === draft.therapyId && ctx.settings.therapyIds.includes(x.id));
    if (!t) return { ok: false, field: "therapyId", error: "Choose a treatment." };
    const priceCents = toCents(t.priceEur);
    if (!(priceCents > 0) || !Number.isFinite(priceCents)) return { ok: false, field: "therapyId", error: "This treatment can't be bought online yet." };
    valueCents = priceCents;
    therapyId = t.id;
    therapyName = t.name;
  } else if (draft.kind === "amount") {
    const why = checkAmount(ctx.settings, draft.amountEur);
    if (why) return { ok: false, field: "amountEur", error: why };
    valueCents = toCents(draft.amountEur!);
  } else {
    return { ok: false, field: "kind", error: "Choose an amount or a treatment." };
  }

  const toName = clean(draft.toName);
  if (!toName) return { ok: false, field: "toName", error: "Add who it is for." };
  if (toName.length > MAX_NAME) return { ok: false, field: "toName", error: `Keep the name to ${MAX_NAME} characters.` };
  const fromName = clean(draft.fromName);
  if (!fromName) return { ok: false, field: "fromName", error: "Add who it is from." };
  if (fromName.length > MAX_NAME) return { ok: false, field: "fromName", error: `Keep the name to ${MAX_NAME} characters.` };
  const message = typeof draft.message === "string" ? draft.message.replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").trim() : "";
  if (message.length > MAX_MESSAGE) return { ok: false, field: "message", error: `Keep the message to ${MAX_MESSAGE} characters.` };
  if (!ctx.colourwayIds.includes(draft.colourwayId)) return { ok: false, field: "colourwayId", error: "Choose a colour." };

  let recipientEmail: string | null = null;
  let deliverOn: string | null = null;
  if (draft.deliverTo === "recipient") {
    recipientEmail = clean(draft.recipientEmail).toLowerCase();
    if (!isEmail(recipientEmail)) return { ok: false, field: "recipientEmail", error: "Add their email address." };
    if (draft.deliverOn !== null) {
      if (!isYmd(draft.deliverOn) || draft.deliverOn < ctx.today || draft.deliverOn > latestDeliveryDate(ctx.today)) {
        return { ok: false, field: "deliverOn", error: "Choose a date in the next 12 months." };
      }
      deliverOn = draft.deliverOn;
    }
  } else if (draft.deliverTo !== "buyer") {
    return { ok: false, field: "deliverTo", error: "Choose how the voucher is sent." };
  }

  const buyerEmail = clean(draft.buyerEmail).toLowerCase();
  if (!isEmail(buyerEmail)) return { ok: false, field: "buyerEmail", error: "Add your email address." };
  const buyerName = clean(draft.buyerName);
  if (!buyerName) return { ok: false, field: "buyerName", error: "Add your name." };
  if (buyerName.length > MAX_NAME) return { ok: false, field: "buyerName", error: `Keep the name to ${MAX_NAME} characters.` };

  return {
    ok: true,
    order: {
      kind: draft.kind,
      valueCents,
      therapyId,
      therapyName,
      toName,
      fromName,
      message: message || null,
      colourwayId: draft.colourwayId,
      deliverTo: draft.deliverTo,
      recipientEmail,
      deliverOn,
      buyerName,
      buyerEmail,
    },
  };
}

/** The big line on the card: "€50", or the treatment's name. */
export function voucherTitle(v: { kind: VoucherKind; valueEur: number; therapyName: string | null }): string {
  return v.kind === "treatment" ? v.therapyName || "Treatment" : formatEuro(v.valueEur);
}

/** What is left, in words: "€20 left", "Not used yet", "Used". */
export function balanceLabel(v: { kind: VoucherKind; valueEur: number; balanceEur: number }): string {
  if (toCents(v.balanceEur) <= 0) return "Used";
  if (v.kind === "treatment") return "Not used yet";
  return `${formatEuro(v.balanceEur)} left`;
}

export interface DeliveryInfo {
  label: string;
  tone: "green" | "amber" | "red";
}

/** How an online voucher's email stands, for the staff list and detail page. */
export function deliveryStatus(o: {
  deliverTo: DeliverTo;
  deliverOn: string | null;
  deliveredAt: number | null;
  deliveryError: string | null;
  status: string;
}): DeliveryInfo {
  if (o.status === "refunded") return { label: "Refunded in Stripe", tone: "red" };
  if (o.deliveryError) return { label: `Email failed: ${o.deliveryError}`, tone: "red" };
  if (o.deliveredAt) return { label: o.deliverTo === "buyer" ? "Sent to the buyer" : "Emailed to the recipient", tone: "green" };
  if (o.deliverTo === "recipient" && o.deliverOn) return { label: `Sends ${formatLongDate(o.deliverOn)} at 9am`, tone: "amber" };
  return { label: "Not sent yet", tone: "amber" };
}
